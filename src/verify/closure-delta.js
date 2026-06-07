/**
 * ★5 incremental transitive closure — ported from the parent project's ReBAC
 * `ClosureService` (src/store/services/rebac/closure.service.js), the in-memory
 * twin of its O(affected) DB algorithm. When an edge u→v is added, the only new
 * reachable pairs are ancestors(u) × descendants(v); we patch the closure in
 * that product instead of recomputing it. This is the watch-mode building block
 * (docs/11 §五): a file change re-extracts a few edges, and the closure is
 * maintained in O(affected) rather than O(whole graph).
 *
 * `reach`: Map<a, Set<b>>  — b reachable from a in 1+ steps (the closure).
 * `succ`:  Map<a, Set<b>>  — direct edges a→b.
 * ADD is exact and cheap. DELETE needs DRed (over-delete dependents, re-derive
 * the still-supported) — see ClosureService.removeEdge; deferred (docs/11 §五·一).
 */

/** Apply edge u→v to an existing closure, ReBAC ancestors×descendants style. */
export function addEdge(reach, succ, u, v) {
  if (succ.get(u)?.has(v)) return // already an edge — closure unchanged
  // ancestors(u) ∪ {u}: every a that already reaches u, plus u itself.
  const ancestors = [u]
  for (const [a, ra] of reach) if (ra.has(u)) ancestors.push(a)
  // descendants(v) ∪ {v}: v and everything v already reaches.
  const descendants = [v, ...(reach.get(v) || [])]
  if (!succ.has(u)) succ.set(u, new Set())
  succ.get(u).add(v)
  for (const a of ancestors) {
    if (!reach.has(a)) reach.set(a, new Set())
    const ra = reach.get(a)
    for (const d of descendants) ra.add(d) // a now reaches v and all of v's descendants
  }
}

/** Build a closure incrementally from an edge list (each add maintains the LFP). */
export function closureFromEdges(edges) {
  const reach = new Map()
  const succ = new Map()
  for (const [u, v] of edges) addEdge(reach, succ, u, v)
  return { reach, succ }
}
