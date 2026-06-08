// slice-9 fixture — the PASSTHROUGH lives in its own file (the case slice-8's
// within-file argSource cannot resolve: `id` is imported, not local). `id`
// returns its formal unchanged → param_return('util.js::id', 0); the post-link
// pass_arg join threads a caller's tainted arg through it into a param-sink.
export function id(x) {
  return x
}
