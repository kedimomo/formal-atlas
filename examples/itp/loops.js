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

// SAFE (array-length bound) — read-only iteration to arr.length: the index `i`
// provably stays in [0, arr.length], so every `arr[i]` read is in bounds. PROVED.
export function sumArr(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
  }
  return s
}

// OOB (off-by-one on a length) — `i <= arr.length` reads arr[arr.length], one past
// the end. The bound invariant `i <= arr.length` is not inductive → z3 REFUTES it.
export function readPastEnd(arr) {
  let s = 0
  for (let i = 0; i <= arr.length; i++) {
    s += arr[i]
  }
  return s
}

// SKIPPED — the body mutates the bound's base (`arr.push` grows arr.length every
// iteration), so the bound is not loop-invariant; the extractor refuses to model it.
export function growing(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr.push(i)
  }
}

function record() { /* opaque side-effect — cannot mutate the integer counter */ }
