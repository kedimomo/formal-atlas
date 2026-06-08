/**
 * ★7 Andersen (inclusion-based) points-to — the cycle-safe engine half of
 * docs/12. Field- and context-insensitive first cut, evaluated as a worklist
 * least fixpoint (each (var, obj) edge added once), so it terminates on assign
 * cycles that would loop tau-prolog's SLD — which is exactly why points-to needs
 * this engine, not the Prolog reference rules (rules/points-to.pl is the parity
 * oracle on small ACYCLIC inputs only).
 *
 * Base relations (emitted by the extractor under --points-to):
 *   alloc(Var,Obj) · assign(To,From) · calleeVar(Site,Var) · isFunction(Obj)
 *   argActual(Site,Idx,Actual) · formalParam(Fn,Idx,Formal)
 *   field_store(Base,Key,Val) · field_call(Site,Base,Key)   (★7 field-sensitive, docs/14)
 * Computes:
 *   pts:      Map<Var, Set<Obj>>       — what each var may point to
 *   resolved: Set<'Site\tFn'>          — resolvedCall: a var-call resolved to Fn
 */

function pushNested(m, k1, k2, v) {
  if (!m.has(k1)) m.set(k1, new Map())
  const inner = m.get(k1)
  if (!inner.has(k2)) inner.set(k2, new Set())
  inner.get(k2).add(v)
}

export function pointsTo(facts) {
  const alloc = []
  const isFn = new Set()
  const sitesOfVar = new Map() // var -> Set(site)   (calleeVar, indexed)
  const argActual = new Map() // site -> Map(idx -> Set(actual))
  const formalParam = new Map() // fn -> Map(idx -> Set(formal))
  const storesByBase = new Map() // ★7 field: base -> Map(key -> Set(valVar))   (`const h={k:fn}`)
  const fieldCalls = [] // ★7 field: { site, base, key } — `h[k]()` / `h.foo()` dispatch-table call
  const fwd = new Map() // assignEdge: From -> Set(To)
  const addEdge = (to, from) => {
    if (!fwd.has(from)) fwd.set(from, new Set())
    if (fwd.get(from).has(to)) return false
    fwd.get(from).add(to)
    return true
  }

  for (const { pred, args } of facts) {
    const a = args.map(String)
    if (pred === 'alloc') alloc.push([a[0], a[1]])
    else if (pred === 'assign') addEdge(a[0], a[1])
    else if (pred === 'isFunction') isFn.add(a[0])
    else if (pred === 'calleeVar') {
      if (!sitesOfVar.has(a[1])) sitesOfVar.set(a[1], new Set())
      sitesOfVar.get(a[1]).add(a[0])
    } else if (pred === 'argActual') pushNested(argActual, a[0], a[1], a[2])
    else if (pred === 'formalParam') pushNested(formalParam, a[0], a[1], a[2])
    else if (pred === 'field_store') pushNested(storesByBase, a[0], a[1], a[2])
    else if (pred === 'field_call') fieldCalls.push({ site: a[0], base: a[1], key: a[2] })
  }

  const pts = new Map()
  const resolved = new Set()
  const work = []
  const addPts = (v, o) => {
    if (!pts.has(v)) pts.set(v, new Set())
    if (pts.get(v).has(o)) return
    pts.get(v).add(o)
    work.push([v, o])
  }
  for (const [v, o] of alloc) addPts(v, o)

  while (work.length) {
    const [v, o] = work.pop()
    const tos = fwd.get(v) // propagate along assignEdge To <- v
    if (tos) for (const to of tos) addPts(to, o)
    if (!isFn.has(o)) continue
    const sites = sitesOfVar.get(v) // v-call resolves to function o
    if (!sites) continue
    for (const site of sites) {
      const key = `${site}\t${o}`
      if (resolved.has(key)) continue
      resolved.add(key)
      // interprocedural: assignEdge(formal, actual) for matching arg/param index
      const aMap = argActual.get(site)
      const pMap = formalParam.get(o)
      if (!aMap || !pMap) continue
      for (const [idx, actuals] of aMap) {
        const formals = pMap.get(idx)
        if (!formals) continue
        for (const actual of actuals) for (const formal of formals) {
          if (!addEdge(formal, actual)) continue
          const pa = pts.get(actual) // seed the new edge with actual's current pts
          if (pa) for (const oo of pa) addPts(formal, oo)
        }
      }
    }
  }
  // ★7 field-sensitive dispatch tables (docs/14, first cut — alias-unaware on the
  // base, value resolved through pts): `const h={k:fn}` (field_store) + `h[k]()`
  // (field_call) → resolve every function the matching field(s) may hold. Runs after
  // the base fixpoint so pts(val) is final. '*' key (computed `h[k]`) matches all fields.
  for (const { site, base, key } of fieldCalls) {
    const fields = storesByBase.get(base)
    if (!fields) continue
    const keys = key === '*' ? [...fields.keys()] : [key]
    for (const k of keys) for (const val of (fields.get(k) || [])) for (const fn of (pts.get(val) || [])) if (isFn.has(fn)) resolved.add(`${site}\t${fn}`)
  }
  return { pts, resolved }
}
