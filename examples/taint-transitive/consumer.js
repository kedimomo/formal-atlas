// ★6 slice-6 fixture (file A of A→B→C) — the consumer two hops down the chain.
// fetchName (file B) transitively returns untrusted input that originates in
// getName (file C), so `name` is tainted across the A→B→C boundary and the
// .innerHTML assignment is a TRUE positive — only the transitive-conduit fixpoint
// makes this reachable.
import { fetchName } from './delegate.js'

export function show(req) {
  const name = fetchName(req)
  document.getElementById('p').innerHTML = name
}
