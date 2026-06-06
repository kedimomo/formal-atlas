// alpha.js — defines a LOCAL `format` that IS used here.
// (Same name `format` also exists in beta.js — before scope-aware resolution
// the two merged into one call-graph node.)
export function start() {
  return format(41)
}

function format(x) {
  return x + 1
}
