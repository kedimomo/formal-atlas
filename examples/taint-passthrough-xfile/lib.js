// slice-9 fixture — the cross-file param-sink wrappers (summaries live HERE).
// render's `html` (idx 1) reaches an .innerHTML sink (Ct=html); replyJson's `obj`
// (idx 1) reaches a Fastify reply.send (Ct=json). The slice-9 join must compose a
// cross-file passthrough (util.js::id) with these cross-file param-sinks, with the
// ★3 content-type guard intact — html flagged, json suppressed.
export function render(el, html) {
  el.innerHTML = html
}

export function replyJson(reply, obj) {
  reply.send(obj)
}
