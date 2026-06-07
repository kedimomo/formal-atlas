// ★6 slice-6 fixture (transitive conduit, file C of A→B→C) — the BASE conduit.
// getName returns req.query.name → a directly-detected tainted-RETURN conduit
// (taint_returns_q('source.js::getName')).
export function getName(req) {
  const n = req.query.name
  return n
}
