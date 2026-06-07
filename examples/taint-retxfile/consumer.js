// ★6d cross-file fixture — callers. A cross-file `const x = conduit(req)` taints
// x; x then flows to a sink WITHIN this file (the hard part: slice-1's effect
// feeds the caller's intra-procedural flow, resolved post-link). Conduits are
// resolved by import_binding — direct and `as` alias — see taint-link.js.

import { getName, rows } from './source.js'
import { getName as grab } from './source.js'

// TRUE positive (cross-file conduit): getName returns req.query.name → `name` is
// tainted across the call → the .innerHTML assignment is an XSS sink.
export function show(req) {
  const name = getName(req)
  document.getElementById('p').innerHTML = name
}

// NO false positive: rows() returns a db RESULT, not untrusted input, so it is
// not a conduit → `r` stays clean even though it reaches an .innerHTML sink.
export function safe() {
  const r = rows()
  document.getElementById('q').innerHTML = r
}

// TRUE positive (cross-file conduit via IMPORT ALIAS): `grab` is getName renamed
// on import — resolved through import_binding, exactly like slice-3's `paint`.
export function showAlias(req) {
  const v = grab(req)
  document.getElementById('z').innerHTML = v
}
