/**
 * Recurrence extractor — the "front half" of induction auto-formalization (★8 C-tier,
 * docs/13 §五·三). Lifts a recursive function's STRUCTURE from code so the induction
 * rules need only a human-written PROPERTY (the part that requires intent).
 *
 * This closes the gap the user identified: the loop-safety path is FULLY automatic
 * (counter.js + oob.js lift specs from code → z3 proves them with zero human input);
 * the induction path currently needs a hand-written JSON. The recurrence (depth,
 * bases, step) CAN be extracted — it's just pattern-matching on the function body.
 * What you CANNOT extract is the intended property (e.g. "f >= 0" vs "f >= n").
 *
 * extractRecurrence(code, fnName) returns { depth, bases, step } or null.
 */
import { parse } from './header.js'

/**
 * Walk the return statement of `fnName` to detect a self-call recurrence.
 * Recognizes patterns like:
 *   return f(n-1) + f(n-2);           → depth 2, step "(f_1 + f_2)"
 *   return f(n-1) + n;                → depth 1, step "(f_1 + n)"
 *   if (n <= 1) return n;             → detected as base
 *   const a = f(n-1); return a + 1;   → depth 1, alias-resolved
 */
function extractOne(ast, fnName) {
  const param = []
  const baseVals = [] // explicit base case VALUES (collected by analyzeBody)
  const stepRefs = [] // which depths appear in the recurrence
  let stepExpr = null

  // Find the function (recursive descent — the ast root may be Program / ExpressionStatement).
  const SKIP_KEYS = new Set(['type','loc','start','end','range'])
  function findFn(node) {
    if (!node || typeof node.type !== 'string') return null
    if (node.type === 'FunctionDeclaration' && node.id?.name === fnName) {
      for (const p of node.params) param.push(p.name)
      analyzeBody(node.body)
      // Only return a recurrence if we found actual SELF-CALLS (stepRefs non-empty).
      // stepExpr alone is NOT enough — a plain return a+b is not a recurrence.
      if (stepRefs.length) {
        const step = stepExpr || stepRefs.join(' + ')
        let depth = Math.max(...stepRefs.map(r => Math.abs(r)))
        if (depth < 1) depth = 1
        return { depth, bases: baseVals.length ? baseVals : null, step, param: param[0] || 'n' }
      }
    }
    // Traverse into children to find the target function anywhere in the tree
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) { const r = findFn(c); if (r) return r } }
      else { const r = findFn(v); if (r) return r }
    }
    return null
  }

  function analyzeBody(node) {
    if (!node || typeof node.type !== 'string') return
    const SKIP = new Set(['type','loc','start','end','range'])
    // Base case: if (n == K) return V; or if (n <= K) return V;
    if (node.type === 'IfStatement') {
      const cons = node.consequent
      const retNode = cons?.type === 'BlockStatement' && cons.body?.length === 1 ? cons.body[0] : cons
      if (retNode?.type === 'ReturnStatement' && retNode.argument) {
        if (!containsCall(retNode.argument, fnName)) {
          const val = exprStr(retNode.argument)
          // For `n == K` we can extract an explicit single base value
          if (node.test?.type === 'BinaryExpression' && node.test.operator === '==' &&
              node.test.left?.name === param[0] && node.test.right?.type === 'Literal') {
            baseVals.push(val)
          } else {
            // For `n <= K` / `n < K` etc., record all V as the base, but we can't
            // infer the individual n=0,n=1,... values (those need human input)
            baseVals.push(val) // at least record the last base value
          }
          if (node.alternate) analyzeBody(node.alternate)
          return
        }
      }
      if (node.alternate) analyzeBody(node.alternate)
      if (node.consequent) analyzeBody(node.consequent)
      return
    }
    // Recursive return: return f(n-1) + f(n-2);
    if (node.type === 'ReturnStatement' && node.argument) {
      const calls = findSelfCalls(node.argument, fnName)
      if (calls) {
        stepRefs.push(...calls.offsets)
        stepExpr = normaliseStep(node.argument, fnName)
        return
      }
      // const a = f(n-1); return a + 1; — alias (fallback to raw expr str)
      stepExpr = exprStr(node.argument)
    }
    // Recurse into children
    for (const k of Object.keys(node)) {
      if (SKIP.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === 'string') analyzeBody(c)
      if (v && typeof v.type === 'string') analyzeBody(v)
    }
  }

  function containsCall(node, name) {
    if (!node || typeof node.type !== 'string') return false
    if (node.type === 'CallExpression' && node.callee?.name === name) return true
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) { for (const c of v) if (containsCall(c, name)) return true }
      else if (containsCall(v, name)) return true
    }
    return false
  }

  // Find ALL self-calls f(n-k) in an expression; returns { offsets: [k...] } (merged).
  function findSelfCalls(node, name) {
    const offsets = []
    function walk(n) {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'CallExpression' && n.callee?.name === name) {
        for (const a of n.arguments || []) {
          const o = offset(a)
          if (o !== null) offsets.push(o)
        }
        return
      }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) for (const c of v) walk(c)
        else walk(v)
      }
    }
    walk(node)
    return offsets.length ? { offsets: [...new Set(offsets)].sort((a,b)=>a-b) } : null
  }
  // Normalise a recurrence expression: replace each f(n-k) with f_k (canonical).
  function normaliseStep(node, name) {
    if (!node || typeof node.type !== 'string') return null
    if (node.type === 'CallExpression' && node.callee?.name === name) {
      const k = node.arguments?.[0] ? offset(node.arguments[0]) : null
      return k !== null ? `${name}_${k}` : null
    }
    // Flatten: binary op → (lhs op rhs); literal/identifier → itself
    if (node.type === 'BinaryExpression') {
      const l = normaliseStep(node.left, name)
      const r = normaliseStep(node.right, name)
      if (l && r) return `(${l} ${node.operator} ${r})`
    }
    if (node.type === 'Literal') return String(node.value)
    if (node.type === 'Identifier') return node.name
    return null
  }

  // Parse `(n - k)` or `n - k` → k, else null
  function offset(node) {
    if (node?.type === 'BinaryExpression' && node.operator === '-' && node.left?.name === param[0] && node.right?.type === 'Literal') return node.right.value
    if (node?.name === param[0]) return 0
    return null
  }

  function exprStr(node) {
    if (!node) return '?'
    if (node.type === 'Literal') return String(node.value)
    if (node.type === 'Identifier') return node.name
    if (node.type === 'BinaryExpression') return `(${exprStr(node.left)} ${node.operator} ${exprStr(node.right)})`
    if (node.type === 'CallExpression' && node.callee?.name === fnName) {
      const args = (node.arguments || []).map(exprStr).join(', ')
      return `${fnName}(${args})`
    }
    return '?'
  }

  return findFn(ast)
}

/**
 * Given source code and a recursive function name, extract a { depth, bases, step,
 * param } skeleton suitable for feeding into proveBy*Induction. Returns null if the
 * function's recurrence cannot be mechanically recognized.
 */
export function extractRecurrence(code, fnName) {
  const ast = parse(code)
  if (!ast) return null
  return extractOne(ast, fnName)
}
