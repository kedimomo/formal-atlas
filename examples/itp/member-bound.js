// ★8 member-of-member bound fixture (docs/13 §五·二, item ①d). The base of the bound /
// access is a non-computed member chain (`this.rows`), not a bare identifier — the exact
// shape of the ReBAC SPV verification core (src/store/services/rebac/verification/
// merkle-tree.js:69, `for (i < this.tree.length - 1) { … this.tree[Number(i)] … }`).
// Run:  node src/cli.js prove examples/itp/member-bound.js
export class Layered {
  constructor(rows) { this.rows = rows }

  // SAFE — the AFFINE member-of-member bound `this.rows.length - 1` proves BOTH this.rows[i]
  // and this.rows[i + 1] in range (the adjacent-pairs / Merkle getProof idiom: at the last
  // iteration i = length - 2, so i + 1 = length - 1 < length). No escape → also gets an
  // iterator-bound spec. `Number(i)` is modeled as the identity on the integer counter.
  pairs() {
    const out = []
    for (let i = 0; i < this.rows.length - 1; i++) {
      out.push(this.rows[Number(i)] + this.rows[i + 1])
    }
    return out
  }

  // POSSIBLE OOB (flagged) — the plain bound `this.rows.length` does NOT prove i + 1 < length,
  // and the loop has no guard/escape, so this.rows[i + 1] is a fully-modeled overshoot; z3
  // returns the witness i = length - 1. (The iterator-bound spec still holds — i < length —
  // proving the flag is per-ACCESS, not about the iterator.) Demonstrates the flag direction
  // works for a member-of-member base, same as access.js does for a bare identifier.
  shiftBad() {
    const out = []
    for (let i = 0; i < this.rows.length; i++) {
      out.push(this.rows[i + 1])
    }
    return out
  }

  // SKIPPED — the body mutates `this.rows` (push changes its length → the bound is not
  // loop-invariant), so the loop is never modeled and never guessed (sound). bodySafe keys
  // the call `this.rows.push(...)` to `this_rows` and refuses the loop.
  grow() {
    for (let i = 0; i < this.rows.length; i++) this.rows.push(i)
  }
}
