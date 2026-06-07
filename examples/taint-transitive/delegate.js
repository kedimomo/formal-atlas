// ★6 slice-6 fixture (file B of A→B→C) — a TRANSITIVE conduit. fetchName just
// forwards getName's result. `return getName(req)` is NOT a direct conduit (it
// returns a call's result, not a bare source) — it becomes a conduit ONLY because
// getName resolves to one, computed by the cross-file fixpoint in taint-link.js.
// (A plain `return db.query(..)` would never qualify — db.query is no conduit.)
import { getName } from './source.js'

export function fetchName(req) {
  return getName(req)
}
