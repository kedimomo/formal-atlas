/**
 * ★8 ITP C-tier — self-built INDUCTION kernel (docs/13 §五·一/§五·三), ZERO external prover.
 *
 * The one thing the bundled z3 cannot do alone is UNBOUNDED induction over a
 * recursively-defined function: z3 treats `f` as uninterpreted, so "∀n≥0. P(f(n))"
 * is out of reach (Presburger decides linear ∀, but not a property of a recursive
 * f, nor non-linear terms). docs/13 once said this apex tier needs an external
 * trusted kernel (Lean/Coq/Dafny). It does NOT: the De Bruijn criterion is about a
 * kernel being SMALL ENOUGH TO AUDIT, not about it being Lean. So we add exactly
 * ONE trusted inference rule — mathematical induction over ℕ — and let z3 discharge
 * the two decidable per-case obligations. This is the LCF idea (a tiny trusted core;
 * untrusted automation must pass through it) with no Lean, no install.
 *
 *   TRUSTED RULE:  [ P(0) ]  ∧  [ ∀n≥0. P(n) ⇒ P(n+1) ]   ⟹   ∀n≥0. P(n).
 *
 * The kernel NEVER asserts the ∀ on its own — it composes two z3-checked lemmas.
 * A false claim is therefore rejected because z3 refutes its base or its step; the
 * only way a wrong theorem escapes is a bug in z3 (already trusted at tiers A/B) or
 * in the few lines below — small enough to read and adversarially test (a base-false
 * and a non-inductive claim are both checked to be REJECTED in the engines test).
 * A contradictory hypothesis is surfaced as `vacuous` and never counted (mirrors ★2).
 */
import { checkContract } from '../smt-bridge.js'
import { varsOf } from '../smt-dsl.js'

/** Word-boundary substitution so `n` → `(n + 1)` cannot touch `f` or an embedded `n`. */
const sub = (src, name, repl) => src.replace(new RegExp(`\\b${name}\\b`, 'g'), repl)

/**
 * Prove ∀ n≥0. P(f(n), n) by z3-discharged induction (the C-tier discharge).
 * spec = { name?, n?: 'n', fn: 's', f0: '0', step: '(s + (n + 1))', property: 's >= n', vars?: {} }
 *   - n        induction variable (default 'n')
 *   - fn       the variable standing for f(n) (an int)
 *   - f0       f(0) as a DSL expr        (base value of the recursion)
 *   - step     f(n+1) in terms of fn and n   (the recurrence)
 *   - property P(f(n), n), referencing `fn` and `n`
 *   - vars     extra free (∀-quantified) parameters → type, optional
 */
export async function proveByInduction(spec) {
  const n = spec.n || 'n'
  const fn = spec.fn
  const P = spec.property
  if (!fn || !P || spec.f0 === undefined || spec.step === undefined) throw new Error('induction spec needs { fn, f0, step, property }')
  if (fn === n) throw new Error('the recursion variable (fn) must differ from the induction variable (n)')
  if (!varsOf(P).includes(fn)) throw new Error(`property must reference the recursion variable "${fn}"`)
  const fnNext = `${fn}__next` // fresh next-state var for f(n+1); `__` keeps it distinct from user vars
  const extra = spec.vars || {}

  // P(n+1): shift the recursion variable to f(n+1), then the index n to n+1. Order
  // matters — substitute fn first so the index pass cannot rewrite an `n` inside it.
  const Pnext = sub(sub(P, fn, fnNext), n, `(${n} + 1)`)

  // BASE  P(0): with n=0 and f(0)=f0, prove the property. checkContract proves
  // pre ⇒ post for ALL valuations, so this is exactly P(f(0), 0).
  const base = await checkContract({
    name: `${spec.name || 'induction'}:base`,
    vars: { [n]: 'int', [fn]: 'int', ...extra },
    pre: [`${n} == 0`, `${fn} == ${spec.f0}`],
    post: [P],
  })

  // STEP  P(n) ⇒ P(n+1): assume the IH P(f(n),n) and the recurrence f(n+1)=step(f(n),n),
  // prove P(f(n+1), n+1). `fn` ranges over every possible f(n); `fnNext` is pinned to the
  // recurrence — so a z3 entailment here IS the inductive step for the real recursive f.
  const step = await checkContract({
    name: `${spec.name || 'induction'}:step`,
    vars: { [n]: 'int', [fn]: 'int', [fnNext]: 'int', ...extra },
    pre: [`${n} >= 0`, P, `${fnNext} == ${spec.step}`],
    post: [Pnext],
  })

  const baseOk = base.entailed && base.preSat === 'sat'
  const stepOk = step.entailed && step.preSat === 'sat'
  return {
    name: spec.name || 'induction',
    proved: baseOk && stepOk,
    vacuous: base.preSat !== 'sat' || step.preSat !== 'sat',
    base: { ...base, ok: baseOk },
    step: { ...step, ok: stepOk },
    claim: `∀ ${n} >= 0. ${P}`,
  }
}

/** Render an induction result for the CLI. */
export function formatInduction(res) {
  if (res.proved) return `✅ ${res.name}: PROVED by induction — ${res.claim} (base + step both discharged by z3; self-built ℕ-induction rule, no external prover)`
  const tag = (o) => (o.preSat !== 'sat' ? '⚠ vacuous (hypotheses UNSAT)' : o.entailed ? '✅' : '❌')
  return [
    `❌ ${res.name}: NOT proved by induction (claim: ${res.claim})`,
    `   ${tag(res.base)} base P(0)${res.base.counterexample ? ` — counterexample ${res.base.counterexample}` : ''}`,
    `   ${tag(res.step)} step P(n) ⇒ P(n+1)${res.step.counterexample ? ` — counterexample ${res.step.counterexample}` : ''}`,
  ].join('\n')
}
