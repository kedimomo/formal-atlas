/**
 * ★8 ITP C-tier rule 3 — self-built STRONG (course-of-values) INDUCTION, ZERO external prover.
 *
 * Weak induction (induction.js) hands the step only P(n-1). That cannot prove properties of a
 * function whose recurrence reaches FURTHER back — e.g. Fibonacci f(n) = f(n-1) + f(n-2) needs
 * P(n-1) AND P(n-2). Strong induction assumes P(k) for ALL k<n. We realize it soundly and
 * QUANTIFIER-FREELY by instantiating the strong IH at exactly the `depth` points the recurrence
 * uses (f(n-1)…f(n-depth)) and discharging `depth` base cases (n = 0…depth-1) — so every
 * obligation is a plain checkContract entailment z3 decides. This is the same LCF discipline:
 * one trusted rule (complete induction over ℕ), z3 does the per-case work, no Lean/Coq/Dafny.
 *
 *   TRUSTED RULE:  [ P(0) … P(depth-1) ]  ∧  [ ∀n≥depth. (P(n-1)…P(n-depth)) ⇒ P(n) ]  ⟹  ∀n≥0. P(n).
 *
 * (Generalises induction.js: depth=1 with bases=[f0] is ordinary weak induction.) A false claim
 * is rejected because z3 refutes one of the base cases or the step; the kernel never asserts ∀.
 */
import { checkContract } from '../smt-bridge.js'
import { varsOf } from '../smt-dsl.js'

const sub = (src, name, repl) => src.replace(new RegExp(`\\b${name}\\b`, 'g'), repl)

/**
 * Prove ∀ n≥0. P(f(n), n) by strong induction over a depth-`d` recurrence.
 * spec = { name?, n?: 'n', fn: 'f', depth: 2, bases: ['0','1'], step: '(f_1 + f_2)', property: 'f >= 0', vars?: {} }
 *   - fn       variable standing for f(n); f(n-k) is referenced as `${fn}_${k}` (e.g. f_1, f_2)
 *   - depth    how many previous values the recurrence uses (d); bases must have length d
 *   - bases    f(0), f(1), …, f(depth-1) as DSL exprs (the base values)
 *   - step     f(n) for n≥depth, in terms of f_1…f_depth and n
 *   - property P(f(n), n), referencing `fn` and (optionally) `n`
 */
export async function proveByStrongInduction(spec) {
  const n = spec.n || 'n'
  const fn = spec.fn
  const d = spec.depth
  const P = spec.property
  const bases = spec.bases || []
  if (!fn || !P || spec.step === undefined || !Number.isInteger(d) || d < 1) throw new Error('strong-induction spec needs { fn, depth>=1, bases, step, property }')
  if (bases.length !== d) throw new Error(`bases must list exactly depth=${d} base values (got ${bases.length})`)
  if (fn === n) throw new Error('the recursion variable (fn) must differ from the induction variable (n)')
  if (!varsOf(P).includes(fn)) throw new Error(`property must reference the recursion variable "${fn}"`)
  const extra = spec.vars || {}
  const name = spec.name || 'strong-induction'

  // BASE cases: P(f(i), i) for i = 0 … depth-1, each with f(i)=bases[i].
  const baseResults = []
  for (let i = 0; i < d; i++) {
    baseResults.push(await checkContract({
      name: `${name}:base[${i}]`,
      vars: { [n]: 'int', [fn]: 'int', ...extra },
      pre: [`${n} == ${i}`, `${fn} == ${bases[i]}`],
      post: [P],
    }))
  }

  // STEP (n ≥ depth): assume the IH at the d points the recurrence uses — P(f(n-k), n-k) for
  // k=1…depth — plus the recurrence f(n)=step(f(n-1)…f(n-depth), n); prove P(f(n), n).
  const ihVars = {}
  const ih = []
  for (let k = 1; k <= d; k++) {
    const fk = `${fn}_${k}`            // stands for f(n-k)
    ihVars[fk] = 'int'
    ih.push(sub(sub(P, fn, fk), n, `(${n} - ${k})`)) // P(f(n-k), n-k)
  }
  const step = await checkContract({
    name: `${name}:step`,
    vars: { [n]: 'int', [fn]: 'int', ...ihVars, ...extra },
    pre: [`${n} >= ${d}`, ...ih, `${fn} == ${spec.step}`],
    post: [P],
  })

  const baseOk = baseResults.every((b) => b.entailed && b.preSat === 'sat')
  const stepOk = step.entailed && step.preSat === 'sat'
  return {
    name,
    proved: baseOk && stepOk,
    vacuous: baseResults.some((b) => b.preSat !== 'sat') || step.preSat !== 'sat',
    bases: baseResults.map((b, i) => ({ ...b, i, ok: b.entailed && b.preSat === 'sat' })),
    step: { ...step, ok: stepOk },
    claim: `∀ ${n} >= 0. ${P}`,
    depth: d,
  }
}

/** Render a strong-induction result for the CLI. */
export function formatStrongInduction(res) {
  if (res.proved) return `✅ ${res.name}: PROVED by strong induction (depth ${res.depth}) — ${res.claim} (${res.depth} base case(s) + the step all discharged by z3; self-built complete-induction rule, no external prover)`
  const tag = (o) => (o.preSat !== 'sat' ? '⚠ vacuous (hypotheses UNSAT)' : o.entailed ? '✅' : '❌')
  const lines = [`❌ ${res.name}: NOT proved by strong induction (claim: ${res.claim})`]
  for (const b of res.bases) lines.push(`   ${tag(b)} base P(${b.i})${b.counterexample ? ` — counterexample ${b.counterexample}` : ''}`)
  lines.push(`   ${tag(res.step)} step (P(n-1)…P(n-${res.depth})) ⇒ P(n)${res.step.counterexample ? ` — counterexample ${res.step.counterexample}` : ''}`)
  return lines.join('\n')
}
