// ★8 per-access OOB fixture (docs/13 §五·二): `prove` proves each counter-indexed
// `arr[idx]` read is in bounds (0 <= idx < arr.length), using the access's guard.
// Run:  node src/cli.js prove examples/itp/access.js

// SAFE — arr[i] under the guard i < arr.length is always in bounds. PROVED.
export function readEach(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
  }
  return s
}

// POSSIBLE OOB — arr[i + 1] is NOT guarded; at i = arr.length-1 it reads
// arr[arr.length]. The obligation i+1 < arr.length is not provable from i < arr.length.
export function readNext(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i] + arr[i + 1]
  }
  return s
}

// SAFE via the guard (the Merkle odd-layer pattern), and a STEP-2 loop — per-access
// reasoning proves arr[i] (guard gives i < arr.length) AND arr[i + 1] (its ternary
// guard i + 1 < arr.length) in bounds, which the iterator-bound check could not.
export function pairwise(arr) {
  const out = []
  for (let i = 0; i < arr.length; i += 2) {
    const left = arr[i]
    const right = i + 1 < arr.length ? arr[i + 1] : left
    out.push(left + right)
  }
  return out
}
