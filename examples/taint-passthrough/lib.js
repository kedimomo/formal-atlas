// slice-8 fixture — the cross-file param-sink wrappers (their summaries live HERE).
// render's `html` (idx 1) reaches an .innerHTML sink (Ct=html); replyJson's `obj`
// (idx 1) reaches a Fastify reply.send (Ct=json). The slice-8 join must thread a
// LOCAL identity passthrough (defined in app.js) into these cross-file param-sinks
// with the ★3 content-type guard intact — html flagged, json suppressed.
export function render(el, html) {
  el.innerHTML = html
}

export function replyJson(reply, obj) {
  reply.send(obj)
}
