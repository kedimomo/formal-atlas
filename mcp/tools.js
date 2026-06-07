/**
 * formal-atlas MCP tools — thin wrappers over the verification engine.
 *
 * "Extract once, query many": the built Prolog program is cached per resolved
 * path, so repeated structural questions about the same repo cost ONE
 * extraction (0 LLM tokens) instead of re-reading files every time. Each tool
 * returns a small JSON verdict the agent can act on without loading source.
 */
import path from 'node:path'
import fs from 'node:fs'
import { extractProject, buildProgram } from '../src/pipeline.js'
import { runQuery } from '../src/verify/prolog-engine.js'
import { checkContract } from '../src/verify/smt-bridge.js'
import { checkRefinementsVerbose } from '../src/verify/refinement-check.js'
import { termOf } from '../src/lift/fact-model.js'

const cache = new Map() // absPath -> { program, files }

async function programFor(p, onProgress) {
  const abs = path.resolve(process.cwd(), String(p))
  if (!cache.has(abs)) {
    if (onProgress) onProgress(`extracting ${abs}...`)
    const proj = await extractProject(abs, { lift: 'offline' })
    if (onProgress) onProgress(`building Prolog program from ${proj.facts.length} facts...`)
    cache.set(abs, { program: buildProgram(proj), files: proj.fileCount })
    if (onProgress) onProgress(`cached ${abs} (${proj.fileCount} files)`)
  }
  return cache.get(abs)
}

async function ask(p, goal, onProgress) {
  const { program } = await programFor(p, onProgress)
  if (onProgress) onProgress(`querying: ${goal}`)
  const g = goal.trim().endsWith('.') ? goal.trim() : `${goal.trim()}.`
  return runQuery(program, g)
}

const j = (o) => JSON.stringify(o, null, 2)
const P = { path: { type: 'string', description: 'Dir or file to analyze (relative to cwd, or absolute).' } }

const SIGNAL_FILE_DEFAULT = path.resolve(process.cwd(), 'data', 'fdrs_audit_pending.json')

function ensureDir(filePath) {
  const d = path.dirname(filePath)
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

function inferPillar(rule) {
  const r = String(rule || '').toLowerCase()
  if (r.includes('crypto_in_loop') || r.includes('await_in_loop')) return 'where'
  if (r.includes('hardcoded') || r.includes('sensitive')) return 'boundary'
  if (r.includes('dead')) return 'whether'
  if (r.includes('taint') || r.includes('sink')) return 'boundary'
  if (r.includes('external')) return 'boundary'
  if (r.includes('intent') || r.includes('effect')) return 'how_correct'
  return 'meta'
}

export const TOOLS = [
  {
    name: 'reaches',
    description: 'Definitively decide whether function `from` can transitively reach `to` in the call graph. A FALSE result is an exhaustive proof of unreachability (not "I did not find a path"). Use instead of reading the call chain across files. Triggers when user asks: "Can X reach Y?", "Is there a path from A to B?", "Can user input reach the database?", "X能不能到达Y?", "有没有从A到B的路径?"',
    inputSchema: { type: 'object', properties: { ...P, from: { type: 'string' }, to: { type: 'string' } }, required: ['path', 'from', 'to'] },
  },
  {
    name: 'dead_code',
    description: 'List functions provably never called (whole-graph, scope-aware — NOT a grep of one file; same-name functions across files are not merged). Use to answer "is this safe to delete?".',
    inputSchema: { type: 'object', properties: { ...P }, required: ['path'] },
  },
  {
    name: 'impact',
    description: 'Blast radius: every routine that transitively reaches `target`. Use BEFORE refactoring a function to see exactly who is affected.',
    inputSchema: { type: 'object', properties: { ...P, target: { type: 'string' } }, required: ['path', 'target'] },
  },
  {
    name: 'verify',
    description: 'Run the governance rule base; return violations (crypto-in-loop, await-in-loop, external-call, hardcoded-sensitive, dead-code, intent-effect-mismatch, taint-reaches-sink).',
    inputSchema: { type: 'object', properties: { ...P }, required: ['path'] },
  },
  {
    name: 'taint',
    description: 'Data-flow taint analysis: find untrusted input (req/argv/location/prompt) reaching a dangerous sink (SQL/command/XSS) WITHOUT sanitization — the CWE-89/CWE-79 injection family. Returns the vulnerable sink locations (file:line:kind). Triggers when user asks: "Security issues?", "SQL injection?", "XSS?", "Can untrusted input reach a sink?", "安全问题?", "注入漏洞?", "有没有污点传播?"',
    inputSchema: { type: 'object', properties: { ...P }, required: ['path'] },
  },
  {
    name: 'query',
    description: 'Run an arbitrary Prolog/Datalog goal over the fact base, e.g. "cyclic(N).", "caller_of(foo, C).". Power-user escape hatch. Triggers when user asks: "Run a Prolog query", "Custom Datalog goal", "Arbitrary graph question", "跑个Prolog查询", "自定义查询"',
    inputSchema: { type: 'object', properties: { ...P, goal: { type: 'string' } }, required: ['path', 'goal'] },
  },
  {
    name: 'contract',
    description: 'SMT (Z3) Hoare-style check: does the precondition ENTAIL the postcondition? Returns a machine-checked verdict or a concrete counterexample. vars maps name -> "int"|"bool"; pre/post are arrays of expression strings. Triggers when user asks: "Does precondition guarantee postcondition?", "Contract check", "Verify Hoare triple", "前置条件能保证后置条件吗?", "契约检查"',
    inputSchema: { type: 'object', properties: { vars: { type: 'object' }, pre: { type: 'array', items: { type: 'string' } }, post: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['vars', 'pre', 'post'] },
  },
  {
    name: 'refine',
    description: 'Refinement-type check (Z3): lift DECIDABLE predicate refinements { v:T | φ(v) } on a project\'s routine arguments/returns, then prove φ_pre ⇒ φ_post for each. Flags `vacuous` specs (contradictory preconditions) and `broken` specs (a concrete counterexample input satisfies pre but breaks post); reports `unchecked` posts (no precondition — need body-level VC). The decidable, whole-project upgrade of `contract`. Triggers when user asks: "refinement types", "are the contracts decidable/consistent", "prove the pre guarantees the post over the codebase", "精化类型", "契约可判定吗", "前置能否保证后置".',
    inputSchema: { type: 'object', properties: { ...P, online: { type: 'boolean', description: 'Use the online LLM lifter to propose refinements (needs API key / MCP sampling); default offline heuristic.' } }, required: ['path'] },
  },
  {
    name: 'map',
    description: 'Codebase overview: files, exports, entry points. Returns a compact map so the agent can answer "what\'s in this repo" / "what does this file expose" / "where is X defined" without reading source files (token-cheap). Triggers when user asks: "What\'s in this project?", "Show me the structure", "Where is X defined?", "项目结构?", "这个文件有什么?", "X在哪定义?"',
    inputSchema: { type: 'object', properties: { ...P, mode: { type: 'string', enum: ['overview', 'file', 'symbol'], description: 'overview = per-file headlines (default); file = single file detail; symbol = callers+callees for one symbol' }, target: { type: 'string', description: 'File path (for mode=file) or symbol name (for mode=symbol)' } }, required: ['path'] },
  },
  {
    name: 'search',
    description: 'Search symbols (functions/methods) in the call graph by name pattern or call relationship. Returns matches with file, callers/callees counts. Triggers when user asks: "Find function X", "Who calls Y?", "Search for Z", "找函数X", "谁调用了Y?", "搜索Z"',
    inputSchema: { type: 'object', properties: { ...P, pattern: { type: 'string', description: 'Name pattern (case-insensitive substring match)' }, calls: { type: 'string', description: 'Find routines that call this symbol' }, calledBy: { type: 'string', description: 'Find routines called by this symbol' } }, required: ['path'] },
  },
  {
    name: 'review',
    description: 'Automated code review: runs governance check, dead code scan, taint analysis, and impact hotspots in one call. Returns findings sorted by severity. Triggers when user asks: "Review this code", "Code review", "Full analysis", "代码审查", "全面分析", "检查代码"',
    inputSchema: { type: 'object', properties: { ...P, focus: { type: 'string', enum: ['all', 'quick', 'security'], description: 'all = full review (default); quick = overview + governance only; security = governance + taint only' } }, required: ['path'] },
  },
  {
    name: 'formalize',
    description: 'Generate Hoare triples (precondition/postcondition) and loop invariants for functions, then verify against contract rules. Uses IDE LLM via MCP sampling when available, falls back to API key or offline heuristics. Triggers when user asks: "Generate contracts", "What are the preconditions?", "Formalize this code", "生成契约", "前置条件是什么?", "形式化代码"',
    inputSchema: { type: 'object', properties: { ...P, mode: { type: 'string', enum: ['hoare', 'invariant', 'all'], description: 'hoare = pre/post conditions only; invariant = loop invariants only; all = both (default)' } }, required: ['path'] },
  },
  {
    name: 'deep_signal',
    description: 'Run formal-atlas deep analysis (governance + dead_code + taint) and emit an FDRS signal file. Chains: extract → review → fdrs-bridge → signal file. After this, call fdrs-mcp rules/evolve to close the FDRS loop. Use when you want to trigger automatic rule evolution from deep code analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        ...P,
        focus: { type: 'string', enum: ['all', 'quick', 'security'], description: 'Analysis depth (default: all)' },
        signalFile: { type: 'string', description: 'Output signal file path (default: data/fdrs_audit_pending.json)' },
        rulesDir: { type: 'string', description: 'FDRS rules directory (default: .trae/rules/)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'explain',
    description: 'Explain WHY a violation fired: the derivation / proof tree (untrusted source → dataflow chain → sink, or the Z3 counterexample behind a refinement violation). Use after `verify`/`taint` to see the evidence for a finding or to judge a false positive. Triggers when user asks: "why is this flagged?", "explain this violation", "show the proof/derivation", "为什么报这个?", "解释这个告警", "给出推导".',
    inputSchema: { type: 'object', properties: { ...P, rule: { type: 'string', description: 'Filter to one rule id (e.g. taint-reaches-sink)' }, subject: { type: 'string', description: 'Filter to one violation subject (file:line:tag)' } }, required: ['path'] },
  },
  {
    name: 'repair',
    description: '★3 closed-loop repair: for each violation, hand the LLM the proof tree + Z3 counterexample, get a triage verdict or a patch, then RE-VERIFY and accept ONLY if the violation clears with no regression (generate-and-check — the LLM proposes, the solver disposes). Dry-run by default; apply=true writes accepted patches to disk. With no LLM configured, returns the structured repair prompt per finding (status `needs-llm`). Triggers when user asks: "fix these violations", "auto-repair", "triage the findings", "自动修复", "闭环修复", "把误报消掉".',
    inputSchema: { type: 'object', properties: { ...P, apply: { type: 'boolean', description: 'Write accepted patches to disk (default false = dry run)' }, online: { type: 'boolean', description: 'Hint the LLM layer to use the online provider' }, max: { type: 'number', description: 'Max violations to process (default 20)' } }, required: ['path'] },
  },
  {
    name: 'faithfulness',
    description: 'Spec-faithfulness eval (★4): score a contract/refinement against labeled accept-legal / reject-illegal samples — DECIDABLY (QF-LIA, no LLM, no solver in the grading loop). Flags `too-weak` (accepts an ILLEGAL sample — a vacuous/`true` spec) and `too-strong` (rejects a LEGAL one). Pass {vars, pre[], post[], samples:[{label:"legal"|"illegal", point:{var:val}}]}. Catches a ★3 closed loop that would self-certify a WRONG spec. Triggers when user asks: "is this spec faithful?", "grade the contract", "does the spec accept good / reject bad inputs?", "规约忠实吗", "给契约打忠实分".',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, vars: { type: 'object' }, pre: { type: 'array', items: { type: 'string' } }, post: { type: 'array', items: { type: 'string' } }, samples: { type: 'array', description: '[{label:"legal"|"illegal", point:{var:number|bool}}]' } }, required: ['samples'] },
  },
]

export async function runTool(name, a = {}, onProgress) {
  switch (name) {
    case 'reaches': {
      const rows = await ask(a.path, `reaches(${termOf(a.from)}, ${termOf(a.to)}).`, onProgress)
      return j({ from: a.from, to: a.to, reachable: rows.length > 0, derivations: rows.length })
    }
    case 'dead_code': {
      const rows = await ask(a.path, 'dead_code(File, Name).', onProgress)
      return j({ count: rows.length, items: rows.slice(0, 500).map((r) => ({ file: r.File, name: r.Name })) })
    }
    case 'impact': {
      const rows = await ask(a.path, `impact(${termOf(a.target)}, Caller).`, onProgress)
      return j({ target: a.target, callers: [...new Set(rows.map((r) => r.Caller))] })
    }
    case 'verify': {
      if (onProgress) onProgress('running governance verification...')
      const rows = await ask(a.path, 'violation(Subject, Rule).', onProgress)
      return j({ count: rows.length, violations: rows.slice(0, 500).map((r) => ({ subject: r.Subject, rule: r.Rule, suggestion: r.suggestion })) })
    }
    case 'taint': {
      if (onProgress) onProgress('running taint analysis...')
      const rows = await ask(a.path, "violation(N, 'taint-reaches-sink').", onProgress)
      return j({ count: rows.length, sinks: rows.slice(0, 500).map((r) => r.N) })
    }
    case 'query': {
      const rows = await ask(a.path, String(a.goal), onProgress)
      return j({ goal: a.goal, count: rows.length, rows: rows.slice(0, 500) })
    }
    case 'contract': {
      return j(await checkContract({ vars: a.vars, pre: a.pre, post: a.post, name: a.name }))
    }
    case 'refine': {
      const abs = path.resolve(process.cwd(), String(a.path))
      if (onProgress) onProgress(`extracting + lifting refinements from ${abs}...`)
      const proj = await extractProject(abs, { lift: 'offline', formalize: a.online ? 'online' : 'offline' })
      if (onProgress) onProgress(`Z3-checking ${proj.facts.filter((f) => f.pred === 'refinement').length} refinement predicates...`)
      const results = await checkRefinementsVerbose(proj.facts)
      const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})
      return j({ count: results.length, tally, refinements: results.slice(0, 200) })
    }
    case 'map': {
      const { program, files } = await programFor(a.path, onProgress)
      const mode = a.mode || 'overview'
      if (mode === 'overview') {
        const rows = await runQuery(program, 'defines(File, Name, Kind, _).')
        const byFile = {}
        for (const r of rows) {
          if (!byFile[r.File]) byFile[r.File] = []
          byFile[r.File].push({ name: r.Name, kind: r.Kind })
        }
        return j({ files: Object.entries(byFile).map(([file, symbols]) => ({ file, exports: symbols.filter(s => s.kind === 'routine').map(s => s.name) })), totalFiles: files })
      }
      if (mode === 'file') {
        const target = a.target || ''
        const rows = await runQuery(program, `defines('${target}', Name, Kind, _).`)
        const imports = await runQuery(program, `import_binding('${target}', _, _, Name).`)
        return j({ file: target, defines: rows.map(r => ({ name: r.Name, kind: r.Kind })), imports: imports.map(r => r.Name) })
      }
      if (mode === 'symbol') {
        const sym = a.target || ''
        const defRows = await runQuery(program, `defines(File, '${sym}', Kind, _).`)
        const callers = await runQuery(program, `caller_of('${sym}', C).`)
        const callees = await runQuery(program, `calls('${sym}', C).`)
        return j({ symbol: sym, definedIn: defRows.map(r => ({ file: r.File, kind: r.Kind })), callers: [...new Set(callers.map(r => r.C))], callees: [...new Set(callees.map(r => r.C))] })
      }
      return j({ error: 'unknown mode' })
    }
    case 'search': {
      const { program } = await programFor(a.path, onProgress)
      const results = []
      if (a.pattern) {
        const rows = await runQuery(program, 'defines(File, Name, Kind, _).')
        const pat = a.pattern.toLowerCase()
        const matches = rows.filter(r => r.Name.toLowerCase().includes(pat))
        for (const m of matches.slice(0, 50)) {
          const callers = await runQuery(program, `caller_of('${m.Name}', C).`)
          const callees = await runQuery(program, `calls('${m.Name}', C).`)
          results.push({ name: m.Name, file: m.File, kind: m.Kind, callerCount: [...new Set(callers.map(r => r.C))].length, calleeCount: [...new Set(callees.map(r => r.C))].length })
        }
      } else if (a.calls) {
        const rows = await runQuery(program, `calls('${a.calls}', C).`)
        return j({ target: a.calls, calls: [...new Set(rows.map(r => r.C))] })
      } else if (a.calledBy) {
        const rows = await runQuery(program, `caller_of('${a.calledBy}', C).`)
        return j({ target: a.calledBy, calledBy: [...new Set(rows.map(r => r.C))] })
      }
      return j({ count: results.length, results })
    }
    case 'review': {
      const { program } = await programFor(a.path, onProgress)
      const focus = a.focus || 'all'
      const findings = []
      // Phase 1: Governance violations
      const violations = await runQuery(program, 'violation(Subject, Rule).')
      const severity = { 'crypto-in-loop': 'CRITICAL', 'await-in-loop': 'HIGH', 'taint-reaches-sink': 'CRITICAL', 'external-call': 'MEDIUM', 'hardcoded-sensitive': 'HIGH', 'intent-effect-mismatch': 'WARN', 'dead-code': 'LOW' }
      for (const v of violations) findings.push({ subject: v.Subject, rule: v.Rule, severity: severity[v.Rule] || 'MEDIUM', phase: 'governance', suggestion: v.suggestion })
      if (focus === 'quick') return j({ focus, count: findings.length, findings: findings.sort((a, b) => a.severity.localeCompare(b.severity)) })
      // Phase 2: Dead code
      const dead = await runQuery(program, 'dead_code(File, Name).')
      for (const d of dead) findings.push({ subject: `${d.File}:${d.Name}`, rule: 'dead-code', severity: 'LOW', phase: 'dead-code' })
      if (focus === 'security') return j({ focus, count: findings.length, findings: findings.sort((a, b) => a.severity.localeCompare(b.severity)) })
      // Phase 3: Taint
      const taintRows = await runQuery(program, "violation(N, 'taint-reaches-sink').")
      for (const t of taintRows) findings.push({ subject: t.N, rule: 'taint-reaches-sink', severity: 'CRITICAL', phase: 'taint' })
      return j({ focus, count: findings.length, findings: findings.sort((a, b) => a.severity.localeCompare(b.severity)) })
    }
    case 'formalize': {
      const mode = a.mode || 'all'
      const { program, facts } = await programFor(a.path)
      const results = { mode }
      if (mode === 'hoare' || mode === 'all') {
        const pres = await runQuery(program, "precondition(R, C).")
        const posts = await runQuery(program, "postcondition(R, C).")
        results.preconditions = pres.map(r => ({ routine: r.R, condition: r.C }))
        results.postconditions = posts.map(r => ({ routine: r.R, condition: r.C }))
      }
      if (mode === 'invariant' || mode === 'all') {
        const invs = await runQuery(program, "invariant(S, I).")
        results.invariants = invs.map(r => ({ scope: r.S, invariant: r.I }))
      }
      // Also run correctness rules
      const violations = await runQuery(program, "violation(S, R).")
      const contractViolations = violations.filter(v =>
        ['postcondition-contradiction', 'precondition-not-checked', 'invariant-crypto-contradiction', 'invariant-await-contradiction'].includes(v.R))
      results.contractViolations = contractViolations
      return j(results)
    }
    case 'deep_signal': {
      const targetPath = path.resolve(process.cwd(), String(a.path))
      if (onProgress) onProgress(`extracting ${targetPath}...`)
      const proj = await extractProject(targetPath, { lift: 'all' })
      if (onProgress) onProgress(`building Prolog program from ${proj.facts.length} facts...`)
      const program = buildProgram(proj)

      // Run review-style governance scan
      if (onProgress) onProgress('running governance scan...')
      const violations = await runQuery(program, 'violation(Subject, Rule).')
      const dead = await runQuery(program, 'dead_code(File, Name).')

      if (onProgress) onProgress('lowering to FDRS concept facts...')
      const { lowerToFdrs } = await import('../src/integrations/fdrs-bridge.js')
      const fdrsFacts = lowerToFdrs(proj.facts)

      // Build signal
      const vItems = violations.map(r => ({
        file: String(r.Subject || ''), rule: String(r.Rule || ''), message: String(r.suggestion || r.Rule || ''), pillar: inferPillar(r.Rule),
      }))
      for (const d of dead) {
        vItems.push({ file: String(d.File || ''), rule: 'dead-code', message: `${d.Name} is never called`, pillar: 'whether' })
      }

      const hitPillars = [...new Set(vItems.map(v => v.pillar).filter(Boolean))]
      const signal = {
        triggeredAt: new Date().toISOString(),
        score: Math.min(vItems.length * 3, 30),
        threshold: 5,
        reasons: vItems.map(v => `${v.file}: ${v.message}`),
        hitPillars,
        source: 'formal-atlas+deep_signal',
        violationCount: vItems.length,
        fdrsFactsCount: fdrsFacts.length,
      }

      // Write signal file
      const signalFile = a.signalFile || SIGNAL_FILE_DEFAULT
      ensureDir(signalFile)
      fs.writeFileSync(signalFile, j(signal))
      if (onProgress) onProgress(`signal written to ${signalFile}`)

      return j({
        ok: true,
        signalFile,
        violationCount: vItems.length,
        fdrsFactsCount: fdrsFacts.length,
        violations: vItems.slice(0, 20),
        hitPillars,
        signal,
        nextStep: {
          tool: 'fdrs-mcp rules/evolve',
          params: { phase: 'diagnose', signalFile },
          hint: 'Call fdrs-mcp rules/evolve(phase=diagnose) with the signalFile above to start the FDRS closed loop.',
        },
      })
    }
    case 'explain': {
      const { program } = await programFor(a.path, onProgress)
      const { explainAll } = await import('../src/verify/explain.js')
      if (onProgress) onProgress('building derivation traces...')
      const expls = await explainAll(program, { rule: a.rule, subject: a.subject })
      return j({ count: expls.length, explanations: expls.slice(0, 100) })
    }
    case 'repair': {
      const { repairViolations } = await import('../src/repair/loop.js')
      if (onProgress) onProgress('running closed-loop repair (LLM → re-verify)...')
      return j(await repairViolations(a.path, { online: !!a.online, apply: !!a.apply, max: a.max || 20 }))
    }
    case 'faithfulness': {
      const { scoreFaithfulness } = await import('../src/verify/faithfulness.js')
      return j(scoreFaithfulness({ name: a.name, vars: a.vars, pre: a.pre, post: a.post }, a.samples || []))
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
