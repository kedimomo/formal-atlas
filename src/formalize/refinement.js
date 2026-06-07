/**
 * Refinement lifter — emits refinement(R, Var, 'φ', pre|post) facts where φ is
 * a DECIDABLE QF-LIA predicate (linear integer arithmetic). Mirrors hoare.js:
 *
 *   Online path: LLM reads the routine list + structural facts and proposes
 *     refinement predicates (generate side). They are FACTS, not conclusions —
 *     verify/refinement-check.js discharges them with Z3 (check side).
 *   Offline path: deliberately conservative. Structural facts carry no
 *     parameter names or return types, so offline can only emit name-based
 *     *assumptions* on the return value (var `ret`). The checker reports these
 *     as `unchecked` (need body VC), never as proven — the primary decidable
 *     entry points are the spec.json path and the online lift.
 */
import { fact } from '../lift/fact-model.js'
import { callLLM } from '../llm/index.js'

// Routine-name stems that idiomatically return a non-negative quantity.
const NONNEG_RET = /^(get)?(count|size|length|len|total|sum|num|quantity|qty|amount|balance|age|index|level|depth|width|height|score|priority|weight|distance|duration|offset|capacity|rank)/i

/** Offline: name-based non-negative return assumptions (reported as `unchecked`). */
export function generateRefinementsOffline(facts) {
  const out = []
  const seen = new Set()
  for (const f of facts) {
    if (f.pred === 'defines' && f.args[2] === 'routine') {
      const name = String(f.args[1])
      if (!seen.has(name) && NONNEG_RET.test(name)) {
        seen.add(name)
        out.push(fact('refinement', name, 'ret', 'ret >= 0', 'post'))
      }
    }
  }
  return out
}

/** Online: LLM proposes decidable refinement predicates over integer vars. */
export async function generateRefinementsOnline(facts) {
  const routines = [...new Set(
    facts.filter((f) => f.pred === 'defines' && f.args[2] === 'routine').map((f) => String(f.args[1])),
  )]
  if (!routines.length) return []

  const messages = [{
    role: 'user',
    content: `You are a refinement-type formalizer. For each routine, emit Prolog facts giving DECIDABLE refinement predicates over INTEGER variables (linear arithmetic ONLY: + - *, comparisons < <= > >= == !=, and && || ! ->). Use the reserved variable "ret" for the return value.

Allowed predicate ONLY (one per line, ending with a period):
  refinement(Routine, Var, 'PHI', pre).   % constraint argument Var must satisfy on entry
  refinement(Routine, Var, 'PHI', post).  % constraint the return value (Var = ret) satisfies, GIVEN the preconditions

Hard rules: integers only — NO strings, NO quotes inside PHI, NO function calls. A post you emit must be ENTAILED by the pres you emit (it will be machine-checked by Z3). Routine names EXACTLY as given. No prose, no code fences.

Routines: ${routines.slice(0, 30).join(', ')}
`,
  }]

  const lines = await callLLM(messages, { maxTokens: 2048 })
  if (!lines) return []
  const out = []
  for (const line of lines) {
    const m = line.match(/^refinement\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*'([^']+)'\s*,\s*(pre|post)\s*\)\.$/)
    if (m) out.push(fact('refinement', m[1], m[2], m[3], m[4]))
  }
  return out
}
