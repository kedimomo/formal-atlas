// Fixture for ★6 slice 2: parameter → formal-parameter taint (taint-INTO-callee),
// with the content-type precision guard from docs/10 §六.
//
// Each wrapper's FORMAL parameter flows into an internal sink, so the extractor
// records param_sink(Fn, Idx, Kind, Ct). At a within-file call site that passes
// untrusted data into that index, a VIRTUAL sink fires — and the ★3
// content-type refinement still suppresses the provably-JSON wrapper, so the
// interprocedural step does NOT reintroduce the false XSS ★3 removed.

// HTML wrapper: formal `html` (idx 1) → .innerHTML (Ct=html). param_sink(render,1,xss,html).
function render(el, html) {
  el.innerHTML = html
}

// JSON wrapper: formal `obj` (idx 1) → Fastify reply.send (Ct=json). param_sink(sendJson,1,xss,json).
// `reply` (idx 0) is the RECEIVER, not the value — it must NOT become a param-sink.
function sendJson(reply, obj) {
  reply.send(obj)
}

// SQL wrapper: formal `sql` (idx 1) → db.execute (no content-type). param_sink(runSql,1,sql,na).
// `db` (idx 0) is the receiver — passing a tainted handle must not be flagged.
function runSql(db, sql) {
  return db.execute(sql)
}

// TRUE positive: req.query.name → render's html-sink across the call.
export function handleHtml(req) {
  const name = req.query.name
  render(document.getElementById('x'), name)
}

// SUPPRESSED: sendJson serializes to JSON (Ct=json) — the content-type guard
// keeps this interprocedural flow out of the violation set (reported as a
// suppressed FP, not a true positive).
export function handleJson(req, reply) {
  const data = req.query.data
  sendJson(reply, data)
}

// TRUE positive: req.query.id → runSql's sql-sink; the receiver `db` is untouched.
export function handleSql(req, db) {
  const id = req.query.id
  runSql(db, id)
}
