// slice-9 fixture (3 files) — a CROSS-FILE passthrough composing with param-sinks.
// `id` (util.js) returns its formal unchanged; passing a tainted value through it
// must still reach a param-sink, whether that sink is in another file (render /
// replyJson, lib.js) or local (show). The ★3 content-type guard holds through the
// cross-file passthrough (JSON wrapper stays suppressed).
import { id } from './util.js'
import { render, replyJson } from './lib.js'

// A LOCAL param-sink — exercises a cross-file passthrough → SAME-FILE param-sink.
function show(el, s) {
  el.innerHTML = s
}

// Cross-file passthrough → cross-file param-sink: req.query.name → id → render html.
export function handleHtml(req, el) {
  const name = req.query.name
  render(el, id(name))
}

// Cross-file passthrough → within-file param-sink (the same-file-outer synthesized path).
export function handleLocal(req, el) {
  const name = req.query.name
  show(el, id(name))
}

// SUPPRESSED: cross-file passthrough → JSON param-sink (Ct=json holds across files).
export function handleJson(req, reply) {
  const data = req.query.payload
  replyJson(reply, id(data))
}
