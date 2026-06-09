/**
 * Call-argument taint resolution (★6b/slice-8/slice-9). Given a call-site
 * argument expression and the current per-function taint state, decide whether
 * the argument carries taint and, if so, the originating node. Split out of
 * `taint.js` to keep each extractor file ≤200 lines. Coarse on purpose
 * (name-based, intra-file); the symbolic rules + cross-file linker give the
 * verdict. Pure w.r.t. its inputs — state (taint/retTaint maps) is passed in.
 */
import { fact } from '../lift/fact-model.js'
import { SOURCE, idOf, calleeOf, callSiteArgs } from './taint-patterns.js'

/**
 * Resolve a call argument to its taint-source node (or null if clean). A bare
 * tainted variable carries its existing node; an inline SOURCE or a tainted-
 * RETURN call (★6a) introduces a fresh source at the call site; a PASSTHROUGH
 * call `id(innerArg)` (slice-8) carries the taint of the inner arg it returns —
 * recurse into that arg so nested wrappers compose.
 */
export function argSource(arg, ctx) {
  const { taint, entryParam, returnsTaint, paramReturns, facts, fileId, ln, tag } = ctx
  const bare = arg.trim()
  if (/^[A-Za-z_]\w*$/.test(bare) && taint.has(bare)) return taint.get(bare)
  // 刀2: a route handler's first param (req), seeded as an entry source by the
  // framework model — its node is inert until the model emits source(node).
  if (/^[A-Za-z_]\w*$/.test(bare) && entryParam?.has(bare)) return entryParam.get(bare)
  const callee = calleeOf(bare)
  if (callee && paramReturns.has(callee)) { // slice-8: a local passthrough call carries its inner arg's taint
    const inner = callSiteArgs(bare, callee)
    for (const idx of paramReturns.get(callee)) {
      const a = inner && inner[idx]
      if (a != null) { const n = argSource(a, { ...ctx, tag: `${tag}_pt${idx}` }); if (n) return n }
    }
  }
  const isReturnsTaintCall = callee && returnsTaint.has(callee)
  if (SOURCE.test(arg) || isReturnsTaintCall) {
    const src = idOf(fileId, ln, tag)
    facts.push(fact('source', src))
    return src
  }
  return null
}

/**
 * slice-8 — the existing tainted node behind a local passthrough call `id(v)`,
 * where `v` is a bare tainted/retTaint variable that `id` returns unchanged.
 * Lets a CROSS-FILE param-sink (the taint_arg join) connect from v's node through
 * a local identity wrapper. Returns null when the arg is not such a passthrough.
 */
export function passthroughVarNode(expr, taint, retTaint, paramReturns) {
  const callee = calleeOf(expr)
  if (!callee || !paramReturns.has(callee)) return null
  const inner = callSiteArgs(expr, callee)
  for (const idx of paramReturns.get(callee)) {
    const v = inner && inner[idx] && inner[idx].trim()
    if (v && /^[A-Za-z_]\w*$/.test(v)) {
      if (taint.has(v)) return taint.get(v)
      if (retTaint.has(v)) return retTaint.get(v)
    }
  }
  return null
}

/**
 * slice-9 — cross-file passthrough candidates. When an outer arg is a NON-LOCAL
 * call `pc(innerArgs)` carrying tainted inner vars, emit one pass_arg per tainted
 * inner position. The post-link join (taint-link.js) keeps only those where pc
 * resolves to a param_return at that index (a real passthrough in another file),
 * then threads the inner node into the outer callee's param-sink. Local
 * passthroughs are handled eagerly by passthroughVarNode; clean / non-call args
 * and local callees produce nothing.
 */
export function crossFilePassArgs(expr, taint, retTaint, localFns, fileId, outer, oidx) {
  const pc = calleeOf(expr)
  if (!pc || localFns.has(pc)) return [] // local pc → handled by passthroughVarNode / same-file
  const out = []
  ;(callSiteArgs(expr, pc) || []).forEach((ia, iidx) => {
    const v = ia.trim()
    const node = /^[A-Za-z_]\w*$/.test(v) && (taint.get(v) || retTaint.get(v))
    if (node) out.push(fact('pass_arg', fileId, outer, oidx, pc, iidx, node))
  })
  return out
}
