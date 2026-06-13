/**
 * Formalization coverage + efficacy report — the empirical proof that formal-atlas
 * lifts an ENTIRE real codebase into logical facts AND that its analyses produce real
 * results on it. Pure offline, deterministic, zero external.
 *
 *   node coverage-report.js [targetDir]        (default ../src — the parent backend)
 *
 * "Coverage" = of every source file walked, how many were formalized, and by which
 * strategy (acorn full AST / tree-sitter grammar = strong; regex fallback = parser
 * failed → degraded). "Efficacy" = run the closure analyses (reaches / dead code /
 * recursion / taint) over the whole fact base and report the findings.
 */
import { extractProject } from './src/pipeline.js'
import { evaluate } from './src/verify/datalog.js'

const target = process.argv[2] || '../src'
const fmt = (n) => Number(n).toLocaleString('en-US')

const t0 = Date.now()
const { facts, fileCount, methods } = await extractProject(target, { lift: 'offline', maxFiles: 20000 })
const ms = Date.now() - t0

const m = methods || {}
if (m.program_cache) { console.error('# program cache hit — run after `rm -rf .cache .formal-atlas-cache` for a true coverage breakdown'); }
const full = (m['acorn-ast'] || 0) + (m['tree-sitter'] || 0) + (m.cache || 0)
const fallback = m['regex-fallback'] || 0
const generic = m.regex || 0

const hist = {}
for (const f of facts) hist[f.pred] = (hist[f.pred] || 0) + 1
const top = Object.entries(hist).sort((a, b) => b[1] - a[1])

const e = evaluate(facts)

const pct = (x) => (fileCount ? (x / fileCount * 100).toFixed(1) : '0')
console.log(`\n=== formal-atlas — formalization coverage of "${target}" ===`)
console.log(`files walked:          ${fmt(fileCount)}   (extract ${ms} ms)`)
console.log(`extraction methods:    ${Object.entries(m).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  full AST / grammar:  ${fmt(full)}  (${pct(full)}%)   acorn-ast + tree-sitter + cache`)
console.log(`  regex fallback:      ${fmt(fallback)}  (${pct(fallback)}%)   parser failed → degraded (lower = better)`)
console.log(`  generic (sql/etc):   ${fmt(generic)}  (${pct(generic)}%)`)
console.log(`COVERAGE:              ${pct(full + fallback + generic)}% of files produced facts; ${pct(full)}% got full structural formalization`)
console.log(`total facts:           ${fmt(facts.length)}`)

console.log(`\ntop fact predicates (the logical model):`)
for (const [p, c] of top.slice(0, 16)) console.log(`  ${p.padEnd(22)} ${fmt(c)}`)

console.log(`\n=== efficacy — analyses over the WHOLE fact base (zero-install semi-naive engine) ===`)
console.log(`functions / declarations:    ${fmt(hist.decl || 0)}`)
console.log(`resolved call edges (rcall): ${fmt(hist.rcall || 0)}`)
console.log(`reaches (transitive closure):${fmt(e.reaches.size)}`)
console.log(`dead code (unreachable fns): ${fmt(e.deadCode.size)}`)
console.log(`cyclic (recursion):          ${fmt(e.cyclic.size)}`)
console.log(`taint source→sink paths:     ${fmt(e.tainted.size)}`)
console.log(`taint base relations:        source=${fmt(hist.source || 0)} sink=${fmt(hist.sink || 0)} dataflow=${fmt(hist.dataflow || 0)} sanitizer=${fmt(hist.sanitizer || 0)}`)
console.log(`refinement facts (★2):       ${fmt(hist.refinement || 0)}`)
console.log('')
