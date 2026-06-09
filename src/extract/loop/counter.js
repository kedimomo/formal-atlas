/**
 * Iterator-bound-safety spec builder (★8 autoformalization, the "front half" —
 * docs/13 §五·二). Lifts a Hoare-spec from REAL code so `prove` runs on a project,
 * not just hand-written specs. The sound `for`-header recognizer lives in header.js;
 * this module turns each UNIT-STRIDE, escape-free ascending counting loop into an
 * iterator-bound spec and proves it offline.
 *
 * The property proved is ITERATOR BOUND-SAFETY: with the auto-invariant
 * `INIT <= i <= BOUND` (mechanically known for counting loops, so it discharges
 * OFFLINE — no LLM), z3 proves the counter never overshoots BOUND. An off-by-one
 * (`i <= n`) makes that invariant non-inductive → z3 REFUTES it with a counterexample
 * (a real overshoot finding). Per-access array-bounds safety is oob.js's job.
 *
 * Scope (v1, deliberately narrow): ascending integer for-loops only. Descending loops,
 * while-loops, and annotation-driven functional postconditions are future.
 */
import { parse, parseLoop } from './header.js'

const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range'])

/** Recognize one ForStatement as a UNIT-STRIDE, escape-free ascending counting loop → bound-safety spec, or null. */
function recognize(node, fileId) {
  const ctx = parseLoop(node)
  if (!ctx) return null
  if (ctx.step !== 1) return null // v1 iterator-bound: step-1 only. For step>1 the bound `i<=BOUND`
  // is mechanically false (i reaches BOUND+1 on the last stride) even when every array access
  // is safely guarded — flagging those would be a false positive. Strided loops go to the
  // per-access OOB analysis (oob.js) instead, which reasons per access (sound for any step).
  if (ctx.hasEscape) return null // an early break/return can legitimately prevent an apparent
  // overshoot, so the iterator-bound claim would be a false positive on escape loops; oob.js
  // still analyses them, but PROVE-ONLY (it never flags an escape loop). See docs/13 §五·二.
  const { counter, init, bound, op } = ctx
  const vars = { [counter]: 'int' }
  if (init.name) vars[init.name] = 'int'
  if (bound.varName) vars[bound.varName] = 'int'
  const ln = node.loc?.start?.line ?? 0
  return {
    name: `${fileId}:${ln} (${counter} ${op} ${bound.expr})`,
    vars,
    pre: [`${counter} == ${init.str}`, `${init.str} <= ${bound.expr}`], // counter init + loop-entered well-formedness (for arr.length this is the always-true 0 <= len)
    guard: `${counter} ${op} ${bound.expr}`,
    body: [{ var: counter, expr: `${counter} + 1` }],
    invariant: [`${init.str} <= ${counter}`, `${counter} <= ${bound.expr}`], // mechanical bound invariant → discharges offline
    post: [`${counter} <= ${bound.expr}`], // iterator never overshoots the bound
    loc: ln,
  }
}

/** Extract iterator-bound-safety specs for every soundly-modelable counting loop. */
export function extractLoopSpecs(fileId, code) {
  const ast = parse(code)
  if (!ast) return []
  const specs = []
  function visit(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ForStatement') { const s = recognize(node, fileId); if (s) specs.push(s) }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c) }
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return specs
}
