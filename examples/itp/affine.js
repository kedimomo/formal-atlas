// ★8 affine-bound + escape-tolerance fixture (docs/13 §五·二, ①a continued).
// Run:  node src/cli.js prove examples/itp/affine.js

// SAFE — adjacent pairs. The AFFINE bound `arr.length - 1` makes BOTH arr[i] and
// arr[i + 1] provably in range (at the last iteration i = arr.length - 2, so
// i + 1 = arr.length - 1 < arr.length). This is the canonical place arr[i + 1] is
// safe, and the `- 1` in the bound is exactly what proves it. No escape → also gets
// an iterator-bound spec (i stays within arr.length - 1).
export function pairSums(arr) {
  const out = []
  for (let i = 0; i < arr.length - 1; i++) {
    out.push(arr[i] + arr[i + 1])
  }
  return out
}

// SAFE despite an early `return` — the bound `arr.length` alone proves arr[i] in
// range; the escape only cuts iterations short, so per-access OOB still PROVES the
// access (escape-tolerant prove). The iterator-bound check skips this loop (escape).
export function indexOf(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) return i
  }
  return -1
}

// NOT-ANALYZED (never flagged) — arr[i + 1] is made safe ONLY by the `break` guard,
// which we do not model. The plain bound `arr.length` does not prove i + 1 < length,
// and because the loop has an escape we must NOT flag it: the break could be exactly
// what keeps it safe. The honest verdict is "not analyzed", never a false positive.
export function guardedByBreak(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    if (i + 1 >= arr.length) break
    s += arr[i + 1]
  }
  return s
}
