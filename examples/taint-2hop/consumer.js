// ★6 slice-5 fixture (2-hop chain across THREE files): a tainted-RETURN conduit
// in source.js feeds a param-sink wrapper in wrappers.js, joined in consumer.js.
// returns-taint (slice 4) sources the conduit result; param-sink (slice 3) turns
// passing it to a wrapper into a virtual sink — the two cross-file joins compose.

import { getName } from './source.js'
import { render, replyJson } from './wrappers.js'

// 2-hop TRUE positive: getName's tainted return → render's html param-sink.
export function show(req) {
  const name = getName(req)
  render(el, name)
}

// 2-hop SUPPRESSED: getName's tainted return → replyJson's JSON param-sink. The
// ★3 content-type guard holds across both hops (Ct=json ⇒ not an HTML sink).
export function send(req, reply) {
  const data = getName(req)
  replyJson(reply, data)
}
