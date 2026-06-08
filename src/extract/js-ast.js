/**
 * JavaScript/JSX fact extractor via the `acorn` parser (true AST, not regex).
 *
 * Emits a relational call-graph + structural facts that downstream Prolog rules
 * reason over. `calls/2` uses bare callee names for backward-compatible queries;
 * `calls3/3` additionally records the CALLER's file so the linker (src/link)
 * can resolve each callee to a file-qualified target via `import_binding/4` —
 * which is what eliminates cross-file same-name merging.
 *
 * Predicates produced:
 *   file/2 defines/4 method/1 async_fn/1 param/3 calls/2 calls3/3
 *   import_binding/4 imports/2 exports/2 has_loop/2 awaits_in_loop/1
 *   crypto_in_loop/1 calls_external/2 string_lit/3 addr_taken/2
 */
import * as acorn from 'acorn'
import { fact } from '../lift/fact-model.js'

const LOOP_TYPES = new Set([
  'ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForOfStatement', 'ForInStatement',
])
const FN_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
])
const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range'])
const CRYPTO = /^(sha256|sha512|md5|createHash|createHmac|hashBytes|pbkdf2|scrypt|encrypt|decrypt|sign|verify)$/
const EXTERNAL = /^(fetch|axios|request|got|XMLHttpRequest|ajax)$/
const SENSITIVE = /tenant-\d+|^system$|password|secret|api[_-]?key|private[_-]?key|access[_-]?token/i
// ★7 points-to: higher-order builtins that INVOKE a function-valued arg (arr.map(cb), p.then(cb)).
const HIGHER_ORDER = new Set(['map', 'forEach', 'filter', 'reduce', 'reduceRight', 'flatMap',
  'find', 'findIndex', 'findLast', 'some', 'every', 'sort', 'then', 'catch', 'finally'])

function calleeName(node) {
  const c = node.callee
  if (!c) return null
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression') {
    if (c.property?.type === 'Identifier') return c.property.name
    if (c.property?.type === 'Literal') return String(c.property.value)
  }
  return null
}

function parse(code) {
  for (const sourceType of ['module', 'script']) {
    try {
      return acorn.parse(code, { ecmaVersion: 'latest', sourceType, locations: true, allowReturnOutsideFunction: true })
    } catch { /* try next mode */ }
  }
  return null
}

// Is this identifier used as a VALUE (function reference) rather than called
// by name? Drives the lightweight address-taken / points-to analysis.
function isValueRef(node, parent) {
  if (!parent) return false
  switch (parent.type) {
    case 'CallExpression':
    case 'NewExpression': return parent.arguments?.includes(node)
    case 'VariableDeclarator': return parent.init === node
    case 'AssignmentExpression': return parent.right === node
    case 'ArrayExpression': return parent.elements?.includes(node)
    case 'Property': return parent.value === node
    case 'ReturnStatement': return parent.argument === node
    default: return false
  }
}

function nameForFn(node, parent) {
  if (node.id?.name) return node.id.name
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name
  if (parent?.type === 'MethodDefinition' && parent.key) return parent.key.name || String(parent.key.value)
  if (parent?.type === 'Property' && parent.key) return parent.key.name || String(parent.key.value)
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'MemberExpression' && parent.left.property?.name) {
    return parent.left.property.name
  }
  return `anon@${node.loc?.start?.line ?? 0}`
}

/** @returns {Array|null} facts, or null if the file could not be parsed as JS. */
export function extractJs(fileId, code) {
  const ast = parse(code)
  if (!ast) return null

  const facts = [fact('file', fileId, 'javascript')]
  const line = (n) => n.loc?.start?.line ?? 0
  const scopeStack = [`module:${fileId}`]
  const cur = () => scopeStack[scopeStack.length - 1]
  let loopDepth = 0
  const definedRoutines = new Set()
  const valueRefs = new Set()

  function visit(node, parent) {
    let poppedScope = false
    let enteredLoop = false

    if (FN_TYPES.has(node.type)) {
      const nm = nameForFn(node, parent)
      // 'routine' = callable by bare name (subject to dead-code/impact).
      // 'lambda'  = anonymous OR an object-literal property fn — invoked
      // INDIRECTLY (callback / dispatch table), never by bare name.
      const kind = (nm.startsWith('anon@') || parent?.type === 'Property') ? 'lambda' : 'routine'
      facts.push(fact('defines', fileId, nm, kind, line(node)))
      if (kind === 'routine') definedRoutines.add(nm)
      // ★7 points-to: a function definition is its own allocation site (the name
      // points to the function-object). Lets a var aliased to it resolve calls.
      facts.push(fact('alloc', nm, nm), fact('isFunction', nm))
      if (parent?.type === 'MethodDefinition') facts.push(fact('method', nm))
      if (node.async) facts.push(fact('async_fn', nm))
      ;(node.params || []).forEach((p, i) => {
        const pn = p.type === 'Identifier' ? p.name
          : (p.type === 'RestElement' && p.argument?.name) ? p.argument.name
            : (p.type === 'AssignmentPattern' && p.left?.name) ? p.left.name
              : `arg${i}`
        // ★7 points-to: formalParam keys the interprocedural arg→formal flow by the
        // function-object id (= nm, matching alloc(nm,nm)). Additive+inert without --points-to.
        facts.push(fact('param', nm, i, pn), fact('formalParam', nm, i, pn))
      })
      scopeStack.push(nm)
      poppedScope = true
    }

    if (node.type === 'ClassDeclaration' && node.id) {
      facts.push(fact('defines', fileId, node.id.name, 'class', line(node)))
    }
    if (LOOP_TYPES.has(node.type)) {
      facts.push(fact('has_loop', cur(), line(node)))
      loopDepth++
      enteredLoop = true
    }
    if (node.type === 'CallExpression') {
      const cn = calleeName(node)
      if (cn) {
        facts.push(fact('calls', cur(), cn))
        facts.push(fact('calls3', fileId, cur(), cn))
        if (CRYPTO.test(cn) && loopDepth > 0) facts.push(fact('crypto_in_loop', cur()))
        if (EXTERNAL.test(cn)) facts.push(fact('calls_external', cur(), cn))
      }
      // ★7 points-to: a call through a bare identifier (incl. a variable holding a
      // function) — resolved to its points-to set, catching dynamic dispatch. The
      // identifier ARGUMENTS are the actuals for the interprocedural arg→formal flow.
      if (node.callee?.type === 'Identifier') {
        facts.push(fact('calleeVar', cur(), node.callee.name))
        ;(node.arguments || []).forEach((arg, i) => { if (arg.type === 'Identifier') facts.push(fact('argActual', cur(), i, arg.name)) })
      }
      // ★7 points-to: a higher-order builtin (`x.map(cb)`) invokes its callback arg —
      // emit calleeVar per bare-identifier arg (the engine's isFunction gate drops non-fns).
      if (node.callee?.type === 'MemberExpression' && HIGHER_ORDER.has(node.callee.property?.name)) {
        for (const arg of node.arguments || []) if (arg.type === 'Identifier') facts.push(fact('calleeVar', cur(), arg.name))
      }
    }
    // ★7 points-to: `const x = y` identifier aliasing → assign edge.
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.type === 'Identifier') {
      facts.push(fact('assign', node.id.name, node.init.name))
    }
    if (node.type === 'AwaitExpression' && loopDepth > 0) facts.push(fact('awaits_in_loop', cur()))
    if (node.type === 'ImportDeclaration') {
      const mod = String(node.source.value)
      facts.push(fact('imports', fileId, mod))
      for (const s of node.specifiers || []) {
        if (s.type === 'ImportDefaultSpecifier') facts.push(fact('import_binding', fileId, s.local.name, mod, 'default'))
        else if (s.type === 'ImportNamespaceSpecifier') facts.push(fact('import_binding', fileId, s.local.name, mod, '*'))
        else if (s.type === 'ImportSpecifier') facts.push(fact('import_binding', fileId, s.local.name, mod, s.imported?.name || s.imported?.value || s.local.name))
      }
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id?.name) facts.push(fact('exports', fileId, node.declaration.id.name))
      for (const d of node.declaration?.declarations || []) {
        if (d.id?.name) facts.push(fact('exports', fileId, d.id.name))
      }
      for (const s of node.specifiers || []) facts.push(fact('exports', fileId, s.exported?.name || s.exported?.value))
    }
    if (node.type === 'ExportDefaultDeclaration') facts.push(fact('exports', fileId, 'default'))
    if (node.type === 'Literal' && typeof node.value === 'string' && SENSITIVE.test(node.value)) {
      facts.push(fact('string_lit', fileId, node.value, line(node)))
    }
    if (node.type === 'Identifier' && isValueRef(node, parent)) valueRefs.add(node.name)

    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') visit(c, node)
      } else if (v && typeof v.type === 'string') {
        visit(v, node)
      }
    }

    if (poppedScope) scopeStack.pop()
    if (enteredLoop) loopDepth--
  }

  visit(ast, null)
  // Lightweight points-to: a defined routine whose name appears as a VALUE
  // (passed as arg / assigned / returned / put in an array or object) is
  // "address-taken" — reachable indirectly, so NOT dead even if never called
  // by bare name. This removes the dead-code false positives for callbacks
  // and dispatch-table functions. File-scoped so the linker keys it precisely.
  for (const name of definedRoutines) if (valueRefs.has(name)) facts.push(fact('addr_taken', fileId, name))
  return facts
}
