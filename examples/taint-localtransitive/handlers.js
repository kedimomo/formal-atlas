// ★6 slice-7 fixture (WITHIN-FILE transitive conduit). getName is a direct
// conduit; fetchName `return getName(req)` becomes a conduit via the within-file
// fixpoint in summarizeReturns (the same-file callee is resolved by name). show()
// consumes fetchName's result in the SAME file → a true positive that slice 6's
// cross-file fixpoint misses on purpose (its return-join skips same-file).

export function getName(req) {
  const n = req.query.name
  return n
}

export function fetchName(req) {
  return getName(req) // within-file transitive: a conduit iff getName is
}

export function show(req) {
  const name = fetchName(req)
  document.getElementById('p').innerHTML = name // TRUE positive (same-file 2-hop)
}
