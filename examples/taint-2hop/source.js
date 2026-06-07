// ★6 slice-5 fixture (2-hop: returns-taint → param-sink) — the conduit.
// getName returns req.query.name → a tainted-RETURN conduit (taint_returns_q).
export function getName(req) {
  const n = req.query.name
  return n
}
