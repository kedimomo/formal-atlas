// slice-8 fixture ("return-of-tainted-arg") — a param→return PASSTHROUGH summary
// composing with param-sinks. `id` returns its formal unchanged (param_return), so
// `id(tainted)` carries the taint to the call result; `swallow` returns a constant
// and must NOT (the sound-leaning control). The passthrough threads taint into a
// cross-file param-sink (render/replyJson, lib.js) and a within-file one (show).
import { render, replyJson } from './lib.js'

// A local PASSTHROUGH (return-of-tainted-arg) and a non-passthrough control.
function id(x) {
  return x
}
function swallow(x) {
  return 'constant'
}

// A LOCAL param-sink — its summary stays in this file (the within-file join).
function show(el, s) {
  el.innerHTML = s
}

// Cross-file TRUE positive: req.query.name → id passthrough → render's html sink.
export function handleHtml(req, el) {
  const name = req.query.name
  render(el, id(name))
  render(el, swallow(name)) // NO false positive: swallow drops its formal
}

// Within-file TRUE positive: the same passthrough threaded into a LOCAL param-sink.
export function handleLocal(req, el) {
  const name = req.query.name
  show(el, id(name))
}

// SUPPRESSED: a passthrough into a JSON param-sink — the ★3 content-type guard
// holds through the wrapper (Ct=json ⇒ not an HTML sink).
export function handleJson(req, reply) {
  const data = req.query.payload
  replyJson(reply, id(data))
}
