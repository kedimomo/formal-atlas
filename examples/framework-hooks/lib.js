// Cross-file SQL param-sink for the 刀2 fixture: formal `s` (idx 0) → db.execute.
// param_sink(externalSink, 0, sql, na). A bare `req` passed from app.js's
// sendHandler is resolved post-link (import binding) and is a TRUE positive once
// the framework model sources the handler's req.
export function externalSink(s) {
  db.execute(s)
}
