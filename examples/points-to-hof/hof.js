// ★7 points-to fixture — HIGHER-ORDER BUILTIN callbacks. `formatUser`/`logIt` are
// passed by bare name to `.map`/`.forEach` — invoked by the builtin, never called
// by their own name. The name-based linker sees `.map(`/`.forEach(` (method calls),
// so it marks them dead-code (FP). points-to resolves the callback into the call
// graph: calleeVar(run, formatUser) → resolvedCall(run, formatUser).
function formatUser(u) {
  return u.name
}

function logIt(x) {
  record(x)
}

export function run(users) {
  users.map(formatUser)
  users.forEach(logIt)
}
