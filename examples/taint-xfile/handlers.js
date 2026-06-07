// ★6c cross-file fixture — callers. Untrusted req.query.* flows, across a file
// boundary, into the wrappers defined in wrappers.js. Resolution is by
// project-global-unique definition (renderHtml/replyJson each have one home),
// so the post-link pass joins them without needing import-alias resolution.

import { renderHtml, replyJson } from './wrappers.js'
import { renderHtml as paint } from './wrappers.js'

// TRUE positive (cross-file): req.query.name → renderHtml's html-sink.
export function showProfile(req) {
  const name = req.query.name
  renderHtml(document.getElementById('p'), name)
}

// SUPPRESSED (cross-file): replyJson serializes to JSON (Ct=json), so the
// content-type guard keeps this interprocedural flow out of the violation set.
export function sendProfile(req, reply) {
  const data = req.query.data
  replyJson(reply, data)
}

// TRUE positive (cross-file via IMPORT ALIAS): `paint` is renderHtml renamed on
// import — resolved through import_binding, not the global-unique fallback.
export function paintProfile(req) {
  const bio = req.query.bio
  paint(document.getElementById('b'), bio)
}
