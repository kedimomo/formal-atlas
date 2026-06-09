/**
 * Sound counting-loop → loop-spec extraction (★8 autoformalization, the "front
 * half" — docs/13 §五·二). Lifts a Hoare-spec from REAL code so `prove` runs on
 * a project, not just hand-written specs.
 *
 * SOUNDNESS IS THE WHOLE GAME here: a misread loop would let z3 "prove" something
 * about code that does not exist (false confidence — worse than no proof). So the
 * recognizer is deliberately CONSERVATIVE — it models ONLY the canonical ascending
 * counting loop and emits NOTHING for anything it cannot capture exactly:
 *
 *   for (let i = INIT; i </<= BOUND; i++ | i+=1 | i=i+1)  { body with no … }
 *
 * where INIT is an int literal or identifier, BOUND is an int literal, an
 * identifier, or a non-computed member like `arr.length` (array iteration — the
 * most common real shape). v1 models the unit stride only: for step>1 the bound
 * `i<=BOUND` is mechanically false on the last stride even when the code is safe,
 * so strided loops are skipped (they need per-access OOB obligations to be useful).
 * The body must NOT (anywhere, incl. closures) reassign the counter or an
 * identifier bound, and — when the bound is `arr.length` — must NOT mutate `arr`
 * (reassign it, write a member/element, or call a method on it), since that would
 * change the bound. It must contain NO break/continue/return/throw (directly) and
 * NO nested loop. Calls, conditionals, and array READS (`arr[i]`) are fine — they
 * cannot change the integer counter or an unmutated length.
 *
 * The property proved is ITERATOR BOUND-SAFETY: with the auto-invariant
 * `INIT <= i <= BOUND` (mechanically known for counting loops, so it discharges
 * OFFLINE — no LLM), z3 proves the counter never overshoots BOUND. An off-by-one
 * (`i <= n`) or a stride that skips the bound (`i += 2`) makes that invariant
 * non-inductive → z3 REFUTES it with a counterexample (a real overshoot finding).
 *
 * Scope (v1, deliberately narrow): ascending integer for-loops only. Descending
 * loops, while-loops, and annotation-driven functional postconditions are future.
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
 * A loop bound → DSL term. Accepts an int literal, a bare identifier, or a
 * non-computed member like `arr.length` (mapped to the synthetic int var
 * `arr_length`). `name` is set only for an identifier bound (reassignment guard);
 * `base` is set only for a member bound (the object whose mutation would change
 * the bound — guarded against in the body).
 */
function boundTerm(node) {
  if (node?.type === 'Literal' && Number.isInteger(node.value)) return { expr: String(node.value), varName: null, name: null, base: null }
  if (node?.type === 'Identifier') return { expr: node.name, varName: node.name, name: node.name, base: null }
  if (node?.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier' && node.property?.type === 'Identifier') {
    return { expr: `${node.object.name}_${node.property.name}`, varName: `${node.object.name}_${node.property.name}`, name: null, base: node.object.name }
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

/** True iff the body is safe to model: no control-flow escape (directly), no
 *  nested loop, no reassignment of the counter or an identifier bound, and — for
 *  a member bound `base.prop` — no mutation of `base` (reassign / member-write /
 *  method call) that could change the bound. */
function bodySafe(body, counter, boundName, boundBase) {
  let safe = true
  function scan(node, inFn) {
    if (!safe || !node || typeof node.type !== 'string') return
    if (LOOP_TYPES.has(node.type)) { safe = false; return }
    if (inFn === 0 && /^(Break|Continue|Return|Throw)Statement$/.test(node.type)) { safe = false; return }
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && (node.left.name === counter || node.left.name === boundName || node.left.name === boundBase)) { safe = false; return }
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier' && (node.argument.name === counter || node.argument.name === boundName || node.argument.name === boundBase)) { safe = false; return }
    if (boundBase) {
      // base.x = … / base[x] = … (member/element write), or base.method(…) — any of
      // these could change base's length, so the bound is not loop-invariant → skip.
      if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' && node.left.object?.type === 'Identifier' && node.left.object.name === boundBase) { safe = false; return }
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.type === 'Identifier' && node.callee.object.name === boundBase) { safe = false; return }
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
  return safe
}

/**
 * Parse a ForStatement header into a loop context { counter, init, bound, step, op },
 * verifying the body is safe to model (no counter/bound mutation, no escape, no nested
 * loop). Accepts ANY positive step — the per-access OOB analysis (oob.js) handles step>1
 * by reasoning per access; the iterator-bound caller below additionally requires step===1.
 * Returns null if the loop is not soundly modelable.
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
  if (!bodySafe(node.body, counter, bound.name, bound.base)) return null
  return { counter, init, bound, step, op: test.operator }
}

/** Recognize one ForStatement as a UNIT-STRIDE ascending counting loop → bound-safety spec, or null. */
function recognize(node, fileId) {
  const ctx = parseLoop(node)
  if (!ctx) return null
  if (ctx.step !== 1) return null // v1 iterator-bound: step-1 only. For step>1 the bound `i<=BOUND`
  // is mechanically false (i reaches BOUND+1 on the last stride) even when every array access
  // is safely guarded — flagging those would be a false positive. Strided loops go to the
  // per-access OOB analysis (oob.js) instead, which reasons per access (sound for any step).
  const { counter, init, bound, op } = ctx
  const vars = { [counter]: 'int' }
  if (init.name) vars[init.name] = 'int'
  if (bound.varName) vars[bound.varName] = 'int'
  const ln = node.loc?.start?.line ?? 0
  return {
    name: `${fileId}:${ln} (${counter} ${op} ${bound.expr})`,
    vars,
    pre: [`${counter} == ${init.str}`, `${init.str} <= ${bound.expr}`], // counter init + loop-entered well-formedness (for arr.length this is the always-true 0 <= len)
    guard: `${counter} ${op} ${bound.expr}`,
    body: [{ var: counter, expr: `${counter} + 1` }],
    invariant: [`${init.str} <= ${counter}`, `${counter} <= ${bound.expr}`], // mechanical bound invariant → discharges offline
    post: [`${counter} <= ${bound.expr}`], // iterator never overshoots the bound
    loc: ln,
  }
}

/** Extract iterator-bound-safety specs for every soundly-modelable counting loop. */
export function extractLoopSpecs(fileId, code) {
  const ast = parse(code)
  if (!ast) return []
  const specs = []
  function visit(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ForStatement') { const s = recognize(node, fileId); if (s) specs.push(s) }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c) }
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return specs
}
