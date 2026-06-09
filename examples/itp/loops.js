// ★8 autoformalization fixture (docs/13 §五·二, front half): `prove` lifts these
// loops from code and proves each one's ITERATOR BOUND-SAFETY (the counter never
// overshoots its bound). Run:  node src/cli.js prove examples/itp/loops.js

// SAFE — ascending step-1 `i < n`: the iterator provably stays in [0, n].
// The accumulator and the call are part of the body but cannot change the integer
// counter, so they are allowed; bound-safety is PROVED.
export function sumTo(n) {
  let total = 0
  for (let i = 0; i < n; i++) {
    total += i
    record(i)
  }
  return total
}

// OVERSHOOT — `i <= n` reaches i = n+1 (the classic off-by-one). `arr[i]` would
// read one past the end when arr.length === n. The bound invariant `i <= n` is
// NOT inductive, so z3 REFUTES it with the counterexample i = n.
export function offByOne(arr, n) {
  let s = 0
  for (let i = 0; i <= n; i++) {
    s += arr[i]
  }
  return s
}

// SKIPPED — the body reassigns the counter (`i = n`). We cannot model the counter
// as `i := i + 1`, so the extractor emits NOTHING (sound: never guess).
export function tricky(n) {
  for (let i = 0; i < n; i++) {
    if (i === 5) i = n
  }
}

// SKIPPED — an early `break` changes the control flow. Conservatively not modeled.
export function withBreak(n) {
  for (let i = 0; i < n; i++) {
    if (i > 3) break
  }
}

function record() { /* opaque side-effect — cannot mutate the integer counter */ }
