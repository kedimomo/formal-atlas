// ★7 points-to fixture — INTERPROCEDURAL ARG FLOW (argActual/formalParam).
// `run` calls `invoke` THROUGH a variable (`fn = invoke; fn(target)`) — a dynamic
// dispatch — passing `target` as the actual. points-to must (1) resolve fn() to
// invoke, (2) flow the actual `target` to invoke's formal `cb`, then (3) resolve
// cb() to target (second-order: a callback handed through a dispatch). The
// name-based linker sees none of this (fn and cb are variables, not bare names).
function target() {
  done()
}

function invoke(cb) {
  cb()
}

function run() {
  const fn = invoke
  fn(target)
}
