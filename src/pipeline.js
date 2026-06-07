/**
 * Pipeline orchestration: walk a target, extract facts from every file,
 * optionally run the semantic lift, and assemble a complete Prolog program
 * (rules + facts) ready for the engine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile } from './extract/index.js'
import { dedupe, factsToProlog } from './lift/fact-model.js'
import { liftOffline, liftOnline } from './lift/ai-lifter.js'
import { link } from './link/linker.js'
import { linkTaint } from './link/taint-link.js'
import { materialize } from './verify/datalog.js'
import { pointsTo } from './verify/points-to.js'
import { getCached, setCache } from './cache.js'
import { generateHoareOffline, generateHoareOnline } from './formalize/hoare.js'
import { generateInvariantsOffline, generateInvariantsOnline } from './formalize/invariant.js'
import { generateRefinementsOffline, generateRefinementsOnline } from './formalize/refinement.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const RULES_DIR = path.join(__dirname, 'rules')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', '__pycache__'])
const EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.c', '.h', '.cpp', '.cc', '.cs', '.scala', '.swift', '.prisma', '.sql',
])

export function walkFiles(root) {
  const out = []
  const st = fs.statSync(root)
  if (st.isFile()) return [{ abs: root, fileId: path.basename(root), ext: path.extname(root) }]
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(abs)
      } else if (EXTS.has(path.extname(e.name))) {
        out.push({ abs, fileId: path.relative(root, abs).replace(/\\/g, '/'), ext: path.extname(e.name) })
      }
    }
  }
  return out
}

export async function extractProject(root, { lift = 'offline', formalize = 'off', maxFiles = 5000, engine = 'prolog', pointsToEnabled = false } = {}) {
  const files = walkFiles(root).slice(0, maxFiles)
  let facts = []
  const rawLines = []
  const methods = {}
  for (const { abs, fileId, ext } of files) {
    let code
    try { code = fs.readFileSync(abs, 'utf8') } catch { continue }
    let ff, method
    const cached = getCached(abs, code)
    if (cached) {
      ff = cached
      method = 'cache'
    } else {
      const result = await extractFile(fileId, code, ext)
      ff = result.facts
      method = result.method
      setCache(abs, code, ff)
    }
    methods[method] = (methods[method] || 0) + 1
    facts.push(...ff)
    // ★7 points-to: run Andersen per-file (so bare base-relation names can't
    // collide across files), and lower each resolved variable-call into a
    // SYNTHETIC calls3 edge — the linker then QId-resolves it exactly like a real
    // call, so reaches/dead_code see the dynamic-dispatch edge. Opt-in (--points-to).
    if (pointsToEnabled) {
      for (const r of pointsTo(ff).resolved) {
        const [scope, fn] = r.split('\t')
        facts.push({ pred: 'calls3', args: [fileId, scope, fn] })
      }
    }
    if (lift === 'online') {
      const online = await liftOnline(fileId, code, ff)
      if (online) rawLines.push(...online)
    }
  }
  if (lift !== 'none') facts.push(...liftOffline(facts))
  // AI formalization: Hoare triples + loop invariants
  if (formalize !== 'off') {
    const hoareFacts = formalize === 'online'
      ? (await generateHoareOnline(facts)).length > 0 ? await generateHoareOnline(facts) : generateHoareOffline(facts)
      : generateHoareOffline(facts)
    facts.push(...hoareFacts)
    const invFacts = formalize === 'online'
      ? (await generateInvariantsOnline(facts)).length > 0 ? await generateInvariantsOnline(facts) : generateInvariantsOffline(facts)
      : generateInvariantsOffline(facts)
    facts.push(...invFacts)
    // Refinement predicates { v:T | φ } over args/return (decidable QF-LIA, ★2).
    let refFacts = formalize === 'online' ? await generateRefinementsOnline(facts) : []
    if (!refFacts.length) refFacts = generateRefinementsOffline(facts)
    facts.push(...refFacts)
  }
  // Scope-aware linking: resolve bare-name call edges into a file-qualified
  // graph (decl/node/rcall) so downstream rules stop merging same-name funcs.
  facts.push(...link(facts))
  // ★6c cross-file taint: resolve taint_arg call sites against param_sink
  // summaries in other files (needs decl/4 from link above) → virtual sinks.
  facts.push(...linkTaint(facts))
  facts = dedupe(facts)
  // ★5 scale engine (docs/11): materialize the expensive closures (dead_code,
  // tainted) with the zero-install semi-naive engine and assert engine_materialized,
  // so tau-prolog's recursive rules short-circuit and violation/2 reads the facts.
  // Opt-in (engine='datalog'); default 'prolog' leaves the fact base untouched.
  if (engine === 'datalog') facts.push(...materialize(facts))
  return { facts, rawLines, fileCount: files.length, methods }
}

export function loadRules(rulesDir = RULES_DIR) {
  return fs.readdirSync(rulesDir).filter((f) => f.endsWith('.pl')).sort()
    .map((f) => `% ==== ${f} ====\n${fs.readFileSync(path.join(rulesDir, f), 'utf8')}`)
    .join('\n\n')
}

export function buildProgram({ facts, rawLines = [] }, rulesDir = RULES_DIR) {
  const rules = loadRules(rulesDir)
  const factText = factsToProlog(facts, ['EXTRACTED FACTS'])
  const ai = rawLines.length ? `\n% ===== AI SEMANTIC FACTS =====\n${rawLines.join('\n')}\n` : ''
  return `${rules}\n\n${factText}${ai}`
}
