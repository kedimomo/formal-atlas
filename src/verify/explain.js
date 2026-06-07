/**
 * ★3 derivation-trace explainer.
 *
 * Turns a derived violation(Subject, Rule) into a STRUCTURED "why" — the source
 * facts and clause chain that produced it — by querying the SAME Prolog program
 * the verdict came from. Every "because" line is a fact the engine can witness,
 * never a guess. The result feeds both human output (CLI `explain`) and the ★3
 * repair loop, which hands the LLM this proof tree + the ★2 Z3 counterexample as
 * structured feedback (docs/05 §13: falsification-driven closed loop).
 */
import { runQuery } from './prolog-engine.js'
import { termOf } from '../lift/fact-model.js'

const SEVERITY = {
  'taint-reaches-sink': 'CRITICAL',
  'crypto-in-loop': 'CRITICAL',
  'hardcoded-sensitive': 'HIGH',
  'await-in-loop': 'HIGH',
  'refinement-not-entailed': 'HIGH',
  'refinement-vacuous': 'HIGH',
  'intent-effect-mismatch': 'WARN',
  'external-call': 'INFO',
  'dead-code': 'INFO',
}

/** Parse a tau-prolog list rendering "[a,b,c]" into ['a','b','c'] (ids carry no commas). */
function plList(s) {
  const inner = String(s ?? '').trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return []
  return inner.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

async function one(program, goal) {
  const rows = await runQuery(program, goal, { limit: 1 })
  return rows[0] || null
}

/** taint-reaches-sink: untrusted source → dataflow chain → sink, + content-type verdict. */
async function explainTaint(program, subject) {
  const t = termOf(subject)
  const kind = (await one(program, `sink(${t}, Kind).`))?.Kind || '?'
  const ct = (await one(program, `sink_ct(${t}, CT).`))?.CT || 'unknown'
  const pathRow = await one(program, `tainted_path(${t}, Src, P).`)
  const chain = plList(pathRow?.P)
  const because = []
  if (pathRow?.Src) because.push(`untrusted source: ${pathRow.Src}`)
  if (chain.length > 1) because.push(`flows through: ${chain.join(' → ')}`)
  because.push(`reaches ${kind} sink: ${subject}`)
  because.push('not neutralized by any upstream sanitizer')
  because.push(ct === 'unknown'
    ? `response content-type could NOT be proven JSON (classified ${ct}) — kept for triage`
    : `response content-type classified: ${ct}`)
  return { because, contentType: ct, witnesses: { kind, source: pathRow?.Src || null, path: chain } }
}

/** refinement violations carry a Z3 counterexample (★2 output) as their evidence. */
async function explainRefinement(program, subject, rule) {
  if (rule === 'refinement-vacuous') {
    return { because: [`refinement preconditions of ${subject} are mutually contradictory (UNSAT) — the contract can never hold`], counterexample: null }
  }
  const ce = (await one(program, `refinement_broken(${termOf(subject)}, CE).`))?.CE || null
  return {
    because: [
      `Z3 found an input that satisfies every precondition but breaks the declared return refinement of ${subject}`,
      ce ? `counterexample: ${ce}` : 'counterexample: (unavailable)',
    ],
    counterexample: ce,
  }
}

/** Fallback: report the rule and any registered fix suggestion for it. */
async function explainGeneric(program, subject, rule) {
  const sugg = (await one(program, `suggestion(${termOf(rule)}, T).`))?.T || null
  const because = [`${rule} holds for ${subject}`]
  if (sugg) because.push(`suggested fix: ${sugg}`)
  return { because, suggestion: sugg }
}

/** Explain a single violation as a structured derivation. */
export async function explainViolation(program, subject, rule) {
  let detail
  if (rule === 'taint-reaches-sink') detail = await explainTaint(program, subject)
  else if (rule === 'refinement-not-entailed' || rule === 'refinement-vacuous') detail = await explainRefinement(program, subject, rule)
  else detail = await explainGeneric(program, subject, rule)
  return { rule, subject, severity: SEVERITY[rule] || 'WARN', ...detail }
}

/** Explain every violation in a program (optionally filtered by rule/subject). */
export async function explainAll(program, { rule, subject } = {}) {
  const rows = await runQuery(program, 'violation(Subject, Rule).')
  const out = []
  for (const r of rows) {
    if (rule && r.Rule !== rule) continue
    if (subject && r.Subject !== subject) continue
    out.push(await explainViolation(program, r.Subject, r.Rule))
  }
  return out
}

/** Human-readable proof tree for one explanation. */
export function formatExplanation(e) {
  const lines = [`[${e.severity}] ${e.rule}  —  ${e.subject}`]
  e.because.forEach((b, i) => lines.push(`    ${i === e.because.length - 1 ? '└─' : '├─'} ${b}`))
  return lines.join('\n')
}
