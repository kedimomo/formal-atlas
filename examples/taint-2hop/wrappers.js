// ★6 slice-5 fixture (2-hop) — the sink wrappers (param-sink summaries live here).
// render's formal `html` (idx 1) reaches an .innerHTML sink (Ct=html); replyJson's
// formal `obj` (idx 1) reaches a Fastify reply.send (Ct=json) — the content-type
// guard must hold even when the tainted value arrives via a 2-hop chain.
export function render(el, html) {
  el.innerHTML = html
}

export function replyJson(reply, obj) {
  reply.send(obj)
}
