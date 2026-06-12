/**
 * Sound counting-loop header parsing (★8 autoformalization, docs/13 §五·二). Normalizes
 * a `for` header into a loop context — the SOUND, conservative recognizer shared by the
 * iterator-bound spec builder (counter.js) and the per-access OOB analysis (oob.js).
 *
 * SOUNDNESS IS THE WHOLE GAME: a misread loop would let z3 "prove" something about code
 * that does not exist (false confidence — worse than no proof). So we model ONLY the
 * canonical ascending counting loop and return NOTHING for anything else:
 *
 *   for (let i = INIT; i </<= BOUND; i++ | i+=K | i=i+K)  { body }
 *
 * INIT is an int literal or identifier; BOUND is an int literal, an identifier, a
 * non-computed member `arr.length`, OR an AFFINE shift `BASE ± K` (K a non-negative int
 * literal) — `arr.length - 1` being the adjacent-pairs idiom that makes the neighbour
 * read `arr[i+1]` provably in range. The body must NOT (anywhere, incl. closures)
 * reassign the counter or an identifier bound, must NOT mutate the bound's base array
 * (`arr.push`, `arr[x]=`, `arr.f()`), and must contain NO nested loop. A
 * break/continue/return/throw is TOLERATED but recorded (`hasEscape`) — an early exit
 * cannot push the counter past the bound or make an in-guard access go out of range, so
 * it is sound to ignore; callers set policy (the iterator-bound spec refuses escape
 * loops, per-access OOB proves-only). Calls, conditionals and array READS are fine.
 */
import * as acorn from 'acorn'

const LOOP_TYPES = new Set(['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForOfStatement', 'ForInStatement'])
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range'])
const ASC = new Set(['<', '<='])

export function parse(code) {
  for (const sourceType of ['module', 'script']) {
    try { return acorn.parse(code, { ecmaVersion: 'latest', sourceType, locations: true, allowReturnOutsideFunction: true }) } catch { /* try next */ }
  }
  return null
}

/** An integer literal or a bare identifier → a DSL term; else null. */
function intTerm(node) {
  if (!node) return null
  if (node.type === 'Literal' && Number.isInteger(node.value)) return { str: String(node.value), name: null, value: node.value }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'Literal' && Number.isInteger(node.argument.value)) return { str: String(-node.argument.value), name: null, value: -node.argument.value }
  if (node.type === 'Identifier') return { str: node.name, name: node.name, value: null }
  return null
}

/** for-init → { counter, init } for `let i = E` or `i = E`, else null. */
function parseInit(init) {
  if (init?.type === 'VariableDeclaration' && init.declarations.length === 1) {
    const d = init.declarations[0]
    if (d.id?.type === 'Identifier') { const t = intTerm(d.init); if (t) return { counter: d.id.name, init: t } }
  }
  if (init?.type === 'AssignmentExpression' && init.operator === '=' && init.left?.type === 'Identifier') {
    const t = intTerm(init.right); if (t) return { counter: init.left.name, init: t }
  }
  return null
}

/**
 * Normalize an array-base expression — a bare `Identifier`, `this`, or a non-computed
 * member chain (`this.tree`, `a.b.c`) — into a stable string key (`arr`, `this_tree`,
 * `a_b_c`), or null for anything else (computed member, call, literal). Exported so the
 * per-access OOB collector (oob.js) keys an access `base[i]` the SAME way a bound's base
 * is keyed, letting the two line up (`a.arr === bound.base`, shared `${key}_length` var).
 * For a plain `Identifier` this is just the name → identifier and `arr.length` bounds
 * behave EXACTLY as before; only member-of-member bases (`this.tree.length`) are new.
 */
export function baseKey(node) {
  if (node?.type === 'ThisExpression') return 'this'
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
    const o = baseKey(node.object); return o == null ? null : `${o}_${node.property.name}`
  }
  return null
}

/** A literal / bare identifier / non-computed member `<chain>.prop` → base bound term, else null. */
function baseBoundTerm(node) {
  if (node?.type === 'Literal' && Number.isInteger(node.value)) return { expr: String(node.value), varName: null, name: null, base: null }
  if (node?.type === 'Identifier') return { expr: node.name, varName: node.name, name: node.name, base: null }
  if (node?.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
    const bk = baseKey(node.object) // arr / this.tree / a.b  →  arr / this_tree / a_b
    if (bk == null) return null
    const v = `${bk}_${node.property.name}` // arr_length / this_tree_length
    return { expr: v, varName: v, name: null, base: bk }
  }
  return null
}

/**
 * A loop bound → DSL term: a base term (int literal, bare identifier, or `arr.length`),
 * OR an AFFINE shift of one — `BASE - K` / `BASE + K` for a non-negative int literal K.
 * The `± K` only changes `expr` (the DSL string z3 reasons over); `varName`, `name`
 * (identifier-reassignment guard) and `base` (member-mutation guard) stay the BASE's, so
 * the body-safety checks still protect whatever the bound depends on. We only shift a
 * REAL var/array base (not a literal) — `arr.length - 1` is the point; `5 - 1` is not.
 */
function boundTerm(node) {
  const direct = baseBoundTerm(node)
  if (direct) return direct
  if (node?.type === 'BinaryExpression' && (node.operator === '+' || node.operator === '-')) {
    const lit = (n) => (n?.type === 'Literal' && Number.isInteger(n.value) && n.value >= 0) ? n.value : null
    let base = null, k = null
    if (node.operator === '-') { base = baseBoundTerm(node.left); k = lit(node.right) }
    else { // BASE + K  or  K + BASE
      const rk = lit(node.right), lk = lit(node.left)
      if (rk != null) { base = baseBoundTerm(node.left); k = rk }
      else if (lk != null) { base = baseBoundTerm(node.right); k = lk }
    }
    if (base && k != null && (base.varName != null || base.base != null)) {
      return { expr: `${base.expr} ${node.operator} ${k}`, varName: base.varName, name: base.name, base: base.base }
    }
  }
  return null
}

/** for-update → positive integer step for `i++` / `i += k` / `i = i + k`, else null. */
function parseStep(upd, counter) {
  if (upd?.type === 'UpdateExpression' && upd.operator === '++' && upd.argument?.name === counter) return 1
  if (upd?.type === 'AssignmentExpression' && upd.left?.name === counter) {
    if (upd.operator === '+=') { const t = intTerm(upd.right); if (t && t.value > 0) return t.value }
    if (upd.operator === '=' && upd.right?.type === 'BinaryExpression' && upd.right.operator === '+') {
      const { left, right } = upd.right
      if (left?.name === counter) { const t = intTerm(right); if (t && t.value > 0) return t.value }
      if (right?.name === counter) { const t = intTerm(left); if (t && t.value > 0) return t.value }
    }
  }
  return null
}

/**
 * Scan a loop body for modelling safety. Returns `{ safe, hasEscape }`:
 *  - `safe` is false (loop NOT modelable) on a nested loop, a reassignment of the
 *    counter or an identifier bound, or — for a member bound `base.prop` — a mutation
 *    of `base` (reassign / member-write / method call) that could change the bound.
 *  - `hasEscape` is true if the body has a direct break/continue/return/throw. This is
 *    NOT a soundness problem to ignore (an early exit only cuts iterations short — it
 *    cannot push the counter past the bound or make an in-guard access go out of range),
 *    so it is tolerated and merely recorded; callers decide policy (recognize refuses it,
 *    per-access OOB switches to prove-only). A `continue` in a for-loop still runs the
 *    update clause, so the `i := i+1` model stays exact.
 */
function bodySafe(body, counter, boundName, boundBase) {
  let safe = true
  let hasEscape = false
  function scan(node, inFn) {
    if (!safe || !node || typeof node.type !== 'string') return
    if (LOOP_TYPES.has(node.type)) { safe = false; return }
    if (inFn === 0 && /^(Break|Continue|Return|Throw)Statement$/.test(node.type)) hasEscape = true // tolerated — see jsdoc
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && (node.left.name === counter || node.left.name === boundName || node.left.name === boundBase)) { safe = false; return }
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier' && (node.argument.name === counter || node.argument.name === boundName || node.argument.name === boundBase)) { safe = false; return }
    if (boundBase) {
      // The bound rests on `boundBase`'s length; any mutation of that base array makes it
      // non-loop-invariant → skip. Covers an identifier base (`arr`) AND a member chain
      // (`this.tree`): a member/element write `base.x=`/`base[x]=`, a method call `base.f()`,
      // or a reassignment of the chain itself (`this.tree = …`). baseKey() keys each the same
      // way the bound's base was keyed (an identifier base reduces to the prior behavior).
      if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' && (baseKey(node.left.object) === boundBase || baseKey(node.left) === boundBase)) { safe = false; return }
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && baseKey(node.callee.object) === boundBase) { safe = false; return }
    }
    const next = inFn + (FN_TYPES.has(node.type) ? 1 : 0)
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') scan(c, next) }
      else if (v && typeof v.type === 'string') scan(v, next)
    }
  }
  scan(body, 0)
  return { safe, hasEscape }
}

/**
 * Parse a ForStatement header into a loop context { counter, init, bound, step, op,
 * hasEscape }, verifying the body is safe to model (no counter/bound mutation, no nested
 * loop). Accepts ANY positive step and TOLERATES break/continue/return/throw (recording
 * it in `hasEscape`) — the per-access OOB analysis (oob.js) handles step>1 and escape
 * loops by reasoning per access; the iterator-bound caller (counter.js) additionally
 * requires step===1 and no escape. Returns null if the loop is not soundly modelable.
 */
export function parseLoop(node) {
  if (node?.type !== 'ForStatement') return null
  const initR = parseInit(node.init)
  if (!initR) return null
  const { counter, init } = initR
  const test = node.test
  if (test?.type !== 'BinaryExpression' || !ASC.has(test.operator) || test.left?.type !== 'Identifier' || test.left.name !== counter) return null
  const bound = boundTerm(test.right)
  if (!bound) return null
  const step = parseStep(node.update, counter)
  if (step == null) return null
  const { safe, hasEscape } = bodySafe(node.body, counter, bound.name, bound.base)
  if (!safe) return null
  return { counter, init, bound, step, op: test.operator, hasEscape }
}
