/**
 * ★4 spec-faithfulness evaluation — roadmap Phase 3 / 06-frontier-map ★4.
 *
 * ★2 made specs machine-DECIDABLE; ★3 made the loop SELF-HEALING. But a closed
 * loop can self-consistently certify the WRONG spec — so ★4 measures whether a
 * generated `contract`/`refinement` is FAITHFUL to intent. Faithfulness cannot be
 * proven (it is about intent, 05 §13), only FALSIFIED with labeled executable
 * samples — exactly the Verus-SpecGym discipline:
 *
 *   legal sample   (should satisfy) → a faithful spec must ACCEPT it.
 *   illegal sample (should violate) → a faithful spec must REJECT it.
 *
 * accept(point) := every precondition AND every postcondition holds at `point`.
 * Because the predicates are QF-LIA, scoring is DECIDABLE and solver-free
 * (evalExpr) — no LLM in the grading loop. The only LLM use is the optional
 * round-trip (paraphrase → re-formalize → Z3-equivalence), which degrades to
 * `needs-llm` offline.
 *
 * Failure modes this catches:
 *   too-weak   — accepts an illegal sample (a vacuous `true` spec maximizes this);
 *   too-strong — rejects a legal sample (a contradictory spec maximizes this).
 */
import { parseExpr, evalExpr } from './smt-dsl.js'
import { checkContract } from './smt-bridge.js'

const holds = (predicates, env) => (predicates || []).every((p) => Boolean(evalExpr(parseExpr(p), env)))

/** Conjoin a spec's pre+post into ONE predicate string, parenthesizing each
 * clause so an inner `||` can't escape its precedence under the `&&` join. */
export function conjoin(spec) {
  const clauses = [...(spec.pre || []), ...(spec.post || [])]
  return clauses.length ? clauses.map((p) => `(${p})`).join(' && ') : 'true'
}

/** A spec ACCEPTS a concrete point iff all its pre- AND post-conditions hold there. */
export function accepts(spec, point) {
  return holds(spec.pre, point) && holds(spec.post, point)
}

/**
 * Grade a spec against labeled samples. Decidable, no solver/LLM.
 * @param spec    { name?, vars?, pre?:string[], post?:string[] }
 * @param samples Array<{ label:'legal'|'illegal', point:Record<string,number|boolean> }>
 */
export function scoreFaithfulness(spec, samples = []) {
  const overAccepted = [] // illegal but accepted → spec too weak
  const overRejected = [] // legal but rejected   → spec too strong
  let legal = 0, illegal = 0, legalAccepted = 0, illegalRejected = 0
  for (const s of samples) {
    const acc = accepts(spec, s.point)
    if (s.label === 'legal') { legal++; acc ? legalAccepted++ : overRejected.push(s.point) }
    else { illegal++; acc ? overAccepted.push(s.point) : illegalRejected++ }
  }
  const faithful = overAccepted.length === 0 && overRejected.length === 0
  const mode = faithful ? 'faithful'
    : overAccepted.length && overRejected.length ? 'inconsistent'
      : overAccepted.length ? 'too-weak' : 'too-strong'
  return {
    name: spec.name || 'spec',
    faithful, mode,
    score: samples.length ? (legalAccepted + illegalRejected) / samples.length : 1,
    recall: legal ? legalAccepted / legal : 1, // legal-acceptance rate
    specificity: illegal ? illegalRejected / illegal : 1, // illegal-rejection rate
    total: samples.length, overAccepted, overRejected,
  }
}

/**
 * Decide whether two predicates are LOGICALLY EQUIVALENT over `vars` (Z3, both
 * directions). The backbone of the round-trip check — reuses checkContract.
 */
export async function equiv(vars, phiA, phiB) {
  const fwd = await checkContract({ vars, pre: [phiA], post: [phiB] }) // φA ⇒ φB
  const bwd = await checkContract({ vars, pre: [phiB], post: [phiA] }) // φB ⇒ φA
  return {
    equivalent: fwd.entailed && bwd.entailed,
    counterexample: fwd.entailed ? bwd.counterexample : fwd.counterexample,
  }
}

/**
 * Round-trip faithfulness: paraphrase the spec to NL, re-formalize that NL back
 * to a predicate, and check it is equivalent to the original (a lossy/ambiguous
 * spec drifts). LLM produces the paraphrase + re-formalization; Z3 is the judge.
 * Offline ⇒ { status:'needs-llm' } — never a fabricated verdict.
 */
export async function roundTrip(spec, { online = false } = {}) {
  void online
  const { hasLLM, callLLMText } = await import('../llm/index.js')
  const phi = conjoin(spec)
  if (!hasLLM()) return { status: 'needs-llm', original: phi }
  const messages = [{ role: 'user', content:
    `Paraphrase this refinement predicate to one plain-English sentence, then re-formalize THAT sentence back into a single predicate using only: + - * / %, comparisons, && || ! ->, integer literals, and the variables ${Object.keys(spec.vars || {}).join(', ') || '(none)'}.\nReply STRICT JSON: {"nl":"...","phi":"..."}\nPredicate: ${phi}` }]
  let parsed
  try { parsed = JSON.parse((await callLLMText(messages) || '').match(/\{[\s\S]*\}/)?.[0] || 'null') } catch { parsed = null }
  if (!parsed || typeof parsed.phi !== 'string') return { status: 'needs-llm', original: phi, note: 'no usable JSON' }
  const eq = await equiv(spec.vars || {}, phi, parsed.phi)
  return { status: eq.equivalent ? 'faithful' : 'drifted', original: phi, nl: parsed.nl, reformalized: parsed.phi, ...eq }
}
