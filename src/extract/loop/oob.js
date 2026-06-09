/**
 * Per-access array out-of-bounds (OOB) obligations — the real array-safety check
 * (★8 autoformalization, docs/13 §五·二; CWE-125/787). For each counter-indexed
 * array read `arr[idx]` inside a recognized counting loop, prove
 *     0 <= idx  AND  idx < arr.length
 * under the facts that hold AT THE ACCESS: the loop's lower bound `INIT <= counter`,
 * the loop guard, the non-negativity of the length, and every CONDITION guarding the
 * access (enclosing `if` / ternary / `&&`/`||` tests). Each obligation is a contract
 * the existing z3 bridge discharges.
 *
 * This is strictly more precise than the iterator-bound check (counter.js): it works
 * for ANY step (it reasons about the access, not the iterator's exit value) and it
 * uses path conditions, so a guarded access like the Merkle pattern
 *     right = i + 1 < arr.length ? arr[i + 1] : arr[i]
 * is PROVEN safe, while an unguarded `arr[i + 1]` is flagged. With an AFFINE bound
 * `for (i=0; i < arr.length - 1; i++)` (the adjacent-pairs idiom), `arr[i + 1]` is
 * proven directly from the bound.
 *
 * SOUNDNESS / "误报 0": we only build an obligation for an access whose index is a
 * decidable expression MENTIONING THE COUNTER (the loop-iteration question), and only
 * for the array whose `.length` the loop bound rests on (so the guard relates them). A
 * `possible-OOB` verdict is only TRUSTED (`fullyModeled`) when the index AND all path
 * conditions were modeled AND the loop has no ignored control-flow escape: if a guard
 * could not be modeled, or a break/return could itself be the missing guard, the caller
 * must NOT report OOB. Proving an access SAFE is always sound (ignored escapes only
 * remove hypotheses); only the flag direction needs the `fullyModeled` gate.
 */
import { parse, parseLoop } from './header.js'

const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range'])
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const BINOP = { '+': '+', '-': '-', '*': '*', '<': '<', '<=': '<=', '>': '>', '>=': '>=', '==': '==', '===': '==', '!=': '!=', '!==': '!=' }

/** AST integer/boolean expression → DSL string (registering vars), or null if not modelable. */
function exprToDsl(node, vars) {
  if (!node) return null
  if (node.type === 'Literal' && Number.isInteger(node.value)) return String(node.value)
  if (node.type === 'Literal' && typeof node.value === 'boolean') return String(node.value)
  if (node.type === 'Identifier') { vars[node.name] = 'int'; return node.name }
  if (node.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier' && node.property?.type === 'Identifier') {
    const v = `${node.object.name}_${node.property.name}`; vars[v] = 'int'; return v // arr.length → arr_length
  }
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '!')) {
    const a = exprToDsl(node.argument, vars); return a == null ? null : `${node.operator}(${a})`
  }
  if (node.type === 'BinaryExpression' && BINOP[node.operator]) {
    const l = exprToDsl(node.left, vars), r = exprToDsl(node.right, vars)
    return (l == null || r == null) ? null : `(${l} ${BINOP[node.operator]} ${r})`
  }
  if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
    const l = exprToDsl(node.left, vars), r = exprToDsl(node.right, vars)
    return (l == null || r == null) ? null : `(${l} ${node.operator} ${r})`
  }
  // Number(x) is the identity on an integer index (a common explicit coercion, e.g.
  // `arr[Number(i)]`) — model it as its argument. Sound for the integer counter.
  if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'Number' && node.arguments?.length === 1) {
    return exprToDsl(node.arguments[0], vars)
  }
  return null
}

/**
 * Walk a loop body collecting counter-indexed `arr[idx]` reads, threading the
 * path-condition stack through if/ternary/logical guards. Pushes raw access records.
 */
function collectAccesses(node, counter, vars, conds, dropped, out) {
  if (!node || typeof node.type !== 'string') return
  if (FN_TYPES.has(node.type)) return // a nested function's accesses run in another context, not this iteration
  if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
    collectAccesses(node.test, counter, vars, conds, dropped, out)
    const t = exprToDsl(node.test, vars)
    const drop = dropped || t == null
    collectAccesses(node.consequent, counter, vars, t != null ? [...conds, t] : conds, drop, out)
    if (node.alternate) collectAccesses(node.alternate, counter, vars, t != null ? [...conds, `!(${t})`] : conds, drop, out)
    return
  }
  if (node.type === 'LogicalExpression') {
    collectAccesses(node.left, counter, vars, conds, dropped, out)
    const t = exprToDsl(node.left, vars)
    const drop = dropped || t == null
    const guard = node.operator === '&&' ? t : (t != null ? `!(${t})` : null)
    collectAccesses(node.right, counter, vars, guard != null ? [...conds, guard] : conds, drop, out)
    return
  }
  // arr[idx] read — record iff index is decidable AND mentions the counter.
  if (node.type === 'MemberExpression' && node.computed && node.object?.type === 'Identifier') {
    const idx = exprToDsl(node.property, { ...vars }) // probe without polluting vars yet
    if (idx != null && new RegExp(`\\b${counter}\\b`).test(idx)) {
      exprToDsl(node.property, vars) // commit the index's vars
      const arrLen = `${node.object.name}_length`; vars[arrLen] = 'int'
      out.push({ arr: node.object.name, idxDsl: idx, arrLen, conds: [...conds], dropped, loc: node.loc?.start?.line ?? 0 })
    }
  }
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') collectAccesses(c, counter, vars, conds, dropped, out) }
    else if (v && typeof v.type === 'string') collectAccesses(v, counter, vars, conds, dropped, out)
  }
}

/** Extract an OOB obligation (a contract) for every counter-indexed array read in every loop. */
export function extractAccessObligations(fileId, code) {
  const ast = parse(code)
  if (!ast) return []
  const obligations = []
  function visit(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ForStatement') {
      const ctx = parseLoop(node)
      if (ctx) {
        const { counter, init, bound, op, hasEscape } = ctx
        const vars = { [counter]: 'int' }
        if (init.name) vars[init.name] = 'int'
        if (bound.varName) vars[bound.varName] = 'int'
        const guard = `${counter} ${op} ${bound.expr}`
        const accesses = []
        collectAccesses(node.body, counter, vars, [], false, accesses)
        for (const a of accesses) {
          // SOUND / no-false-positive scope: only verify accesses to the array whose
          // .length the loop bound RESTS ON (a.arr === bound.base). Then the guard
          // `i </<= base.length [± K]` directly bounds the index (both reference the same
          // synthetic `${base}_length` var). For an access to a DIFFERENT array we have no
          // relation between its length and the bound, so we can neither prove safety nor
          // flag it (the array may be sized to fit by construction) — skip it. (Identifier
          // / literal bounds have no base array, so they yield no access obligations.)
          if (!bound.base || a.arr !== bound.base) continue
          obligations.push({
            name: `${fileId}:${a.loc} ${a.arr}[${a.idxDsl}]`,
            vars: { ...vars },
            pre: [`${init.str} <= ${counter}`, guard, `${a.arrLen} >= 0`, ...a.conds],
            post: [`0 <= ${a.idxDsl}`, `${a.idxDsl} < ${a.arrLen}`],
            // fullyModeled gates the `possible-OOB` verdict (a trusted flag). It requires
            // BOTH that no guarding condition was dropped (a.dropped) AND that the loop has
            // no ignored control-flow escape (hasEscape): a break/return could be exactly
            // what makes a non-bound-provable access safe, so in an escape loop we PROVE
            // ONLY — an access we cannot prove is reported "not analyzed", never flagged.
            arr: a.arr, idxDsl: a.idxDsl, loc: a.loc, fullyModeled: !a.dropped && !hasEscape,
          })
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c) }
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return obligations
}
