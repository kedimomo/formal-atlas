/**
 * ★8 ITP C-tier — self-built TERMINATION rule (docs/13 §五·一/§五·三), ZERO external prover.
 *
 * Total correctness = partial correctness (the loop VCs / induction) + TERMINATION.
 * Termination is a C-tier obligation z3 cannot decide alone (it is about the ABSENCE of an
 * infinite run). The standard sound argument is a RANKING FUNCTION: exhibit a measure
 * m(state) that is (1) bounded below (≥ 0) while the loop runs and (2) strictly DECREASES
 * every iteration. ℕ is well-founded — no infinite strictly-decreasing sequence of
 * non-negative integers exists — so the loop must stop. We add exactly this ONE trusted
 * rule and let z3 discharge the two decidable lemmas (same LCF discipline as induction.js;
 * no Lean/Coq/Dafny, no install).
 *
 *   TRUSTED RULE:  [ G ⇒ m ≥ 0 ]  ∧  [ G ∧ x' = body(x) ⇒ m(x') < m(x) ]   ⟹   the loop terminates.
 *
 * Both lemmas reduce to checkContract by modelling the next state x' as fresh vars and the
 * transition as preconditions (the same trick induction.js uses for f(n+1)) — no new z3 code.
 * The kernel never claims termination on its own; a loop with no valid ranking (e.g. an
 * infinite `i := i+1`) is REJECTED because z3 refutes the strict-decrease lemma.
 */
import { checkContract } from '../smt-bridge.js'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Prove a counting/while loop terminates via a ranking function.
 * spec = { name?, vars: {i:'int', n:'int'}, guard: 'i < n', body: [{var,expr}], measure: '(n - i)' }
 *   - vars    loop state variables → type
 *   - guard   loop condition (the loop runs while this holds)
 *   - body    transition: assignments performed once per iteration (unassigned vars are framed)
 *   - measure the candidate ranking function over the state vars
 */
export async function proveTermination(spec) {
  const vars = spec.vars || {}
  const m = spec.measure
  if (!m || !spec.guard) throw new Error('termination spec needs { vars, guard, body, measure }')
  const names = Object.keys(vars)

  // Next state x': fresh consts + transition as precondition equalities (assigned: x'==expr;
  // unassigned: x'==x frame) — exactly the recurrence-as-constraint trick from induction.js.
  const nextVars = {}
  for (const v of names) nextVars[`${v}__next`] = vars[v]
  const assigned = new Map((spec.body || []).map((a) => [a.var, a.expr]))
  const trans = names.map((v) => `${v}__next == ${assigned.has(v) ? assigned.get(v) : v}`)
  // m(x'): replace every state var with its __next form in ONE pass (no cascading collision).
  const re = names.length ? new RegExp(`\\b(${names.map(escapeRe).join('|')})\\b`, 'g') : null
  const mNext = re ? m.replace(re, (w) => `${w}__next`) : m

  // VC1  bounded below:  G ⇒ m ≥ 0.
  const bound = await checkContract({
    name: `${spec.name || 'termination'}:bound`,
    vars,
    pre: [spec.guard],
    post: [`${m} >= 0`],
  })
  // VC2  strictly decreasing:  G ∧ x' = body(x) ⇒ m(x') < m(x).
  const decr = await checkContract({
    name: `${spec.name || 'termination'}:decreasing`,
    vars: { ...vars, ...nextVars },
    pre: [spec.guard, ...trans],
    post: [`${mNext} < ${m}`],
  })

  const boundOk = bound.entailed && bound.preSat === 'sat'
  const decrOk = decr.entailed && decr.preSat === 'sat'
  return {
    name: spec.name || 'termination',
    terminates: boundOk && decrOk,
    vacuous: bound.preSat !== 'sat' || decr.preSat !== 'sat',
    bound: { ...bound, ok: boundOk },
    decreasing: { ...decr, ok: decrOk },
    measure: m,
  }
}

/** Render a termination result for the CLI. */
export function formatTermination(res) {
  if (res.terminates) return `✅ ${res.name}: TERMINATES — ranking function ${res.measure} is ≥ 0 under the guard and strictly decreases each iteration (well-founded descent on ℕ; z3-discharged, no external prover)`
  const tag = (o) => (o.preSat !== 'sat' ? '⚠ vacuous (hypotheses UNSAT)' : o.entailed ? '✅' : '❌')
  return [
    `❌ ${res.name}: termination NOT proved with measure ${res.measure}`,
    `   ${tag(res.bound)} bound:    G ⇒ ${res.measure} ≥ 0${res.bound.counterexample ? ` — counterexample ${res.bound.counterexample}` : ''}`,
    `   ${tag(res.decreasing)} decrease: G ∧ step ⇒ measure′ < measure${res.decreasing.counterexample ? ` — counterexample ${res.decreasing.counterexample}` : ''}`,
  ].join('\n')
}
