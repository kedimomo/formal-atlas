/**
 * Refinement-type layer — roadmap ★2; math docs 05 §11 (Liquid Types), §10
 * (the decidable corner of the λ-cube).
 *
 * A refinement type is { v : T | φ(v) } — the values of T satisfying a
 * DECIDABLE predicate φ. We attach refinements to a routine's parameters
 * (kind=pre) and to its return value (the reserved variable `ret`, kind=post)
 * as facts:
 *
 *     refinement(Routine, Var, 'φ', pre|post).
 *
 * The core obligation "do the argument refinements guarantee the return
 * refinement?" is exactly a Hoare entailment φ_pre ⇒ φ_post — which the SMT
 * bridge's checkContract already decides (pre ∧ ¬post UNSAT ⇒ entailed, else a
 * concrete counterexample). So this module adds NO new solver logic; it
 *   (1) groups refinement/4 facts into one contract spec per routine,
 *   (2) types every variable as an integer (the decidable QF-LIA fragment),
 *   (3) calls checkContract, and
 *   (4) lowers each verdict BACK into a Prolog fact so rules/refinement.pl can
 *       fire violations on the SAME fact base as the structural layer.
 *
 * Honest boundary (05 §13): φ_pre ⇒ φ_post is a *contract-level* entailment.
 * A routine with a postcondition but NO precondition cannot be discharged from
 * the spec alone — proving the body establishes it needs per-path VC generation
 * (Dafny/Verus territory, roadmap ★8). We mark those `unchecked`, never
 * `broken` — we do not dress up what we cannot yet prove. Anything an LLM lifts
 * is a FACT that must pass this solver before it is reported as a conclusion.
 */
import { checkContract } from './smt-bridge.js'
import { varsOf } from './smt-dsl.js'
import { fact } from '../lift/fact-model.js'

/** Group refinement(R,Var,Phi,Kind) facts into one checkContract spec per routine. */
export function refinementsToSpecs(facts) {
  const byRoutine = new Map()
  for (const f of facts) {
    if (f.pred !== 'refinement') continue
    const [routine, , phi, kind] = f.args
    const key = String(routine)
    if (!byRoutine.has(key)) byRoutine.set(key, { name: key, vars: {}, pre: [], post: [] })
    const spec = byRoutine.get(key)
    for (const v of varsOf(String(phi))) spec.vars[v] = 'int' // QF-LIA: integers only
    ;(String(kind) === 'post' ? spec.post : spec.pre).push(String(phi))
  }
  return [...byRoutine.values()]
}

/** The verdict for one routine's refinement spec. */
function classify(spec, r) {
  if (r.preSat !== 'sat') return { status: 'vacuous' }
  if (!spec.post.length) return { status: 'ok' }
  if (!spec.pre.length) return { status: 'unchecked' } // post w/o pre ⇒ needs body VC (★8)
  return r.entailed ? { status: 'entailed' } : { status: 'broken', counterexample: r.counterexample }
}

/**
 * Decide every routine's refinement obligation with Z3 and lower the verdict
 * into Prolog facts (refinement_vacuous/1, refinement_broken/2,
 * refinement_ok/1, refinement_unchecked/1) for rules/refinement.pl.
 */
export async function checkRefinementFacts(facts) {
  const out = []
  for (const spec of refinementsToSpecs(facts)) {
    const c = classify(spec, await checkContract(spec))
    if (c.status === 'vacuous') out.push(fact('refinement_vacuous', spec.name))
    else if (c.status === 'broken') out.push(fact('refinement_broken', spec.name, c.counterexample || 'unknown'))
    else if (c.status === 'unchecked') out.push(fact('refinement_unchecked', spec.name))
    else out.push(fact('refinement_ok', spec.name))
  }
  return out
}

/** Full per-routine verdict objects for the CLI / MCP (not just Prolog facts). */
export async function checkRefinementsVerbose(facts) {
  const results = []
  for (const spec of refinementsToSpecs(facts)) {
    const r = await checkContract(spec)
    const c = classify(spec, r)
    results.push({ routine: spec.name, pre: spec.pre, post: spec.post, status: c.status, counterexample: c.counterexample || null })
  }
  return results
}
