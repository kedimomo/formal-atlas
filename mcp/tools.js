/**
 * formal-atlas MCP tools — thin wrappers over the verification engine.
 *
 * "Extract once, query many": the built Prolog program is cached per resolved
 * path, so repeated structural questions about the same repo cost ONE
 * extraction (0 LLM tokens) instead of re-reading files every time. Each tool
 * returns a small JSON verdict the agent can act on without loading source.
 */
import path from 'node:path'
import { extractProject, buildProgram } from '../src/pipeline.js'
import { runQuery } from '../src/verify/prolog-engine.js'
import { checkContract } from '../src/verify/smt-bridge.js'
import { termOf } from '../src/lift/fact-model.js'

const cache = new Map() // absPath -> { program, files }

async function programFor(p) {
  const abs = path.resolve(process.cwd(), String(p))
  if (!cache.has(abs)) {
    const proj = await extractProject(abs, { lift: 'offline' })
    cache.set(abs, { program: buildProgram(proj), files: proj.fileCount })
  }
  return cache.get(abs)
}

async function ask(p, goal) {
  const { program } = await programFor(p)
  const g = goal.trim().endsWith('.') ? goal.trim() : `${goal.trim()}.`
  return runQuery(program, g)
}

const j = (o) => JSON.stringify(o, null, 2)
const P = { path: { type: 'string', description: 'Dir or file to analyze (relative to cwd, or absolute).' } }

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
]

export async function runTool(name, a = {}) {
  switch (name) {
    case 'reaches': {
      const rows = await ask(a.path, `reaches(${termOf(a.from)}, ${termOf(a.to)}).`)
      return j({ from: a.from, to: a.to, reachable: rows.length > 0, derivations: rows.length })
    }
    case 'dead_code': {
      const rows = await ask(a.path, 'dead_code(File, Name).')
      return j({ count: rows.length, items: rows.slice(0, 500).map((r) => ({ file: r.File, name: r.Name })) })
    }
    case 'impact': {
      const rows = await ask(a.path, `impact(${termOf(a.target)}, Caller).`)
      return j({ target: a.target, callers: [...new Set(rows.map((r) => r.Caller))] })
    }
    case 'verify': {
      const rows = await ask(a.path, 'violation(Subject, Rule).')
      return j({ count: rows.length, violations: rows.slice(0, 500).map((r) => ({ subject: r.Subject, rule: r.Rule })) })
    }
    case 'taint': {
      const rows = await ask(a.path, "violation(N, 'taint-reaches-sink').")
      return j({ count: rows.length, sinks: rows.slice(0, 500).map((r) => r.N) })
    }
    case 'query': {
      const rows = await ask(a.path, String(a.goal))
      return j({ goal: a.goal, count: rows.length, rows: rows.slice(0, 500) })
    }
    case 'contract': {
      return j(await checkContract({ vars: a.vars, pre: a.pre, post: a.post, name: a.name }))
    }
    case 'map': {
      const { program, files } = await programFor(a.path)
      const mode = a.mode || 'overview'
      if (mode === 'overview') {
        const rows = await runQuery(program, 'defines(File, Name, Kind).')
        const byFile = {}
        for (const r of rows) {
          if (!byFile[r.File]) byFile[r.File] = []
          byFile[r.File].push({ name: r.Name, kind: r.Kind })
        }
        return j({ files: Object.entries(byFile).map(([file, symbols]) => ({ file, exports: symbols.filter(s => s.kind === 'routine').map(s => s.name) })), totalFiles: files })
      }
      if (mode === 'file') {
        const target = a.target || ''
        const rows = await runQuery(program, `defines('${target}', Name, Kind).`)
        const imports = await runQuery(program, `import_binding('${target}', _, _, Name).`)
        return j({ file: target, defines: rows.map(r => ({ name: r.Name, kind: r.Kind })), imports: imports.map(r => r.Name) })
      }
      if (mode === 'symbol') {
        const sym = a.target || ''
        const defRows = await runQuery(program, `defines(File, '${sym}', Kind).`)
        const callers = await runQuery(program, `caller_of('${sym}', C).`)
        const callees = await runQuery(program, `calls('${sym}', C).`)
        return j({ symbol: sym, definedIn: defRows.map(r => ({ file: r.File, kind: r.Kind })), callers: [...new Set(callers.map(r => r.C))], callees: [...new Set(callees.map(r => r.C))] })
      }
      return j({ error: 'unknown mode' })
    }
    case 'search': {
      const { program } = await programFor(a.path)
      const results = []
      if (a.pattern) {
        const rows = await runQuery(program, 'defines(File, Name, Kind).')
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
      const { program } = await programFor(a.path)
      const focus = a.focus || 'all'
      const findings = []
      // Phase 1: Governance violations
      const violations = await runQuery(program, 'violation(Subject, Rule).')
      const severity = { 'crypto-in-loop': 'CRITICAL', 'await-in-loop': 'HIGH', 'taint-reaches-sink': 'CRITICAL', 'external-call': 'MEDIUM', 'hardcoded-sensitive': 'HIGH', 'intent-effect-mismatch': 'WARN', 'dead-code': 'LOW' }
      for (const v of violations) findings.push({ subject: v.Subject, rule: v.Rule, severity: severity[v.Rule] || 'MEDIUM', phase: 'governance' })
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
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
