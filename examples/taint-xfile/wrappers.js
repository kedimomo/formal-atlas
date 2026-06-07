// ★6c cross-file fixture — the sink wrappers live HERE; the callers that feed
// them untrusted data live in handlers.js. The param_sink summaries are emitted
// for this file; the post-link pass resolves the cross-file calls.

// HTML wrapper: formal `html` (idx 1) → .innerHTML (Ct=html). A tainted arg from
// another file is a TRUE positive.
export function renderHtml(el, html) {
  el.innerHTML = html
}

// JSON wrapper: formal `obj` (idx 1) → Fastify reply.send (Ct=json). A tainted
// arg from another file must be SUPPRESSED by the content-type guard — not
// reintroduced as the false XSS ★3 removed.
export function replyJson(reply, obj) {
  reply.send(obj)
}
