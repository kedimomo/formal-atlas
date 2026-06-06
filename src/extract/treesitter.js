/**
 * Multi-language fact extractor via web-tree-sitter (WASM grammars — no native
 * build). Emits the SAME relational schema as the JS/acorn adapter, so every
 * downstream Prolog rule works uniformly across Python/Go/Java/Rust/TypeScript.
 *
 * (Address-taken points-to is currently JS-only; non-JS dead-code is therefore
 * a looser over-approximation — see docs/02-architecture.md §5.)
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fact } from '../lift/fact-model.js'

const require = createRequire(import.meta.url)
let Parser = null
const langCache = new Map()

const GRAMMAR_DIR = (() => {
  try { return path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out') } catch { return null }
})()

// file extension -> grammar stem shipped by tree-sitter-wasms
export const TS_LANGS = {
  '.py': 'python', '.go': 'go', '.java': 'java', '.rs': 'rust', '.ts': 'typescript', '.tsx': 'tsx', '.jsx': 'tsx',
}

const CRYPTO = /^(sha256|sha512|md5|hash|hmac|encrypt|decrypt|sign|verify|pbkdf2|scrypt|bcrypt)$/i
const EXTERNAL = /^(fetch|urlopen|axios|HttpClient|RequestBuilder)$/
const SENSITIVE = /tenant-\d+|password|secret|api[_-]?key|private[_-]?key|access[_-]?token/i

// Per-language node-type vocabulary (tree-sitter grammars).
const SPEC = {
  python: { fn: ['function_definition'], lam: ['lambda'], cls: ['class_definition'], call: ['call'], callField: 'function', imp: ['import_statement', 'import_from_statement'], loop: ['for_statement', 'while_statement'] },
  go: { fn: ['function_declaration', 'method_declaration'], lam: ['func_literal'], cls: ['type_declaration'], call: ['call_expression'], callField: 'function', imp: ['import_spec'], loop: ['for_statement'] },
  java: { fn: ['method_declaration', 'constructor_declaration'], lam: ['lambda_expression'], cls: ['class_declaration', 'interface_declaration', 'enum_declaration'], call: ['method_invocation'], callField: 'name', imp: ['import_declaration'], loop: ['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement'] },
  rust: { fn: ['function_item'], lam: ['closure_expression'], cls: ['struct_item', 'enum_item', 'trait_item'], call: ['call_expression', 'macro_invocation'], callField: 'function', imp: ['use_declaration'], loop: ['for_expression', 'while_expression', 'loop_expression'] },
  typescript: { fn: ['function_declaration', 'method_definition'], lam: ['arrow_function', 'function_expression'], cls: ['class_declaration', 'interface_declaration'], call: ['call_expression'], callField: 'function', imp: ['import_statement'], loop: ['for_statement', 'for_in_statement', 'while_statement', 'do_statement'] },
}
SPEC.tsx = SPEC.typescript

async function getLang(lang) {
  if (!GRAMMAR_DIR) return null
  if (!Parser) { const m = await import('web-tree-sitter'); Parser = m.default || m; await Parser.init() }
  if (langCache.has(lang)) return langCache.get(lang)
  const L = await Parser.Language.load(path.join(GRAMMAR_DIR, `tree-sitter-${lang}.wasm`))
  langCache.set(lang, L)
  return L
}

// Rightmost identifier inside a call target: bar from foo.bar / pkg.Bar / a::b::c.
function lastName(node) {
  if (!node) return null
  const t = node.type
  if (t === 'identifier' || t.endsWith('_identifier')) return node.text
  const kids = node.namedChildren || []
  for (let i = kids.length - 1; i >= 0; i--) { const r = lastName(kids[i]); if (r) return r }
  return /^[A-Za-z_]\w*$/.test(node.text || '') ? node.text : null
}

function nameField(node) {
  const n = node.childForFieldName && node.childForFieldName('name')
  if (n) return n.text
  for (const k of node.namedChildren || []) if (`${k.type}`.endsWith('identifier')) return k.text
  return null
}

function importName(node) {
  const txt = (node.text || '').trim()
  const str = txt.match(/['"]([^'"]+)['"]/)
  if (str) return str[1]
  return txt.replace(/^(import|use|from|package)\s+/, '').split(/[\s;]+/)[0]
}

// Language-specific visibility → entry-point detection (so dead-code is sane).
function isExported(node, lang, name, topLevel) {
  switch (lang) {
    case 'go': return /^[A-Z]/.test(name)
    case 'python': return topLevel && !name.startsWith('_')
    case 'rust': return (node.namedChildren || []).some((k) => k.type === 'visibility_modifier')
    case 'java': { const m = (node.namedChildren || []).find((k) => k.type === 'modifiers'); return !!(m && /\bpublic\b/.test(m.text || '')) }
    case 'typescript': case 'tsx': return node.parent?.type === 'export_statement'
    default: return false
  }
}

export async function extractTreeSitter(fileId, code, lang) {
  const grammar = await getLang(lang).catch(() => null)
  const spec = SPEC[lang]
  if (!grammar || !spec || !Parser) return null
  const parser = new Parser()
  parser.setLanguage(grammar)
  let tree
  try { tree = parser.parse(code) } catch { return null }

  const facts = [fact('file', fileId, lang)]
  const has = (set) => { const s = new Set(set); return (t) => s.has(t) }
  const isFn = has(spec.fn), isLam = has(spec.lam), isCls = has(spec.cls)
  const isCall = has(spec.call), isImp = has(spec.imp), isLoop = has(spec.loop)
  const scope = [`module:${fileId}`]
  const cur = () => scope[scope.length - 1]
  let loopDepth = 0

  function walk(node) {
    const t = node.type
    const row = (node.startPosition?.row ?? 0) + 1
    let pushed = false; let loop = false

    if (isFn(t)) {
      const nm = nameField(node) || `anon@${row}`
      facts.push(fact('defines', fileId, nm, nm.startsWith('anon@') ? 'lambda' : 'routine', row))
      if (!nm.startsWith('anon@') && isExported(node, lang, nm, scope.length === 1)) facts.push(fact('exports', fileId, nm))
      scope.push(nm); pushed = true
    } else if (isLam(t)) {
      facts.push(fact('defines', fileId, `anon@${row}`, 'lambda', row))
      scope.push(`anon@${row}`); pushed = true
    }
    if (isCls(t)) { const nm = nameField(node); if (nm) facts.push(fact('defines', fileId, nm, 'class', row)) }
    if (isCall(t)) {
      const target = node.childForFieldName(spec.callField) || node.childForFieldName('macro') || node.childForFieldName('function')
      const cn = lastName(target)
      if (cn) {
        facts.push(fact('calls', cur(), cn))
        facts.push(fact('calls3', fileId, cur(), cn))
        if (loopDepth > 0 && CRYPTO.test(cn)) facts.push(fact('crypto_in_loop', cur()))
        if (EXTERNAL.test(cn)) facts.push(fact('calls_external', cur(), cn))
      }
    }
    if (isImp(t)) { const m = importName(node); if (m) facts.push(fact('imports', fileId, m)) }
    if (isLoop(t)) { facts.push(fact('has_loop', cur(), row)); loopDepth++; loop = true }
    if (/string/.test(t) && !node.namedChildren?.length) {
      const v = (node.text || '').replace(/^[bru]*['"`]|['"`]$/gi, '')
      if (SENSITIVE.test(v)) facts.push(fact('string_lit', fileId, v, row))
    }

    for (const k of node.namedChildren || []) walk(k)
    if (pushed) scope.pop()
    if (loop) loopDepth--
  }

  walk(tree.rootNode)
  return facts
}
