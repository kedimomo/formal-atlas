/**
 * Extractor dispatch: choose a strategy by file extension, with a graceful
 * fallback chain (acorn AST → tree-sitter → regex) so one bad file never
 * aborts a whole-project run. Async because tree-sitter loads WASM grammars.
 * For JS-family files we also append data-flow taint facts (see ./taint.js).
 */
import { extractJs } from './js-ast.js'
import { extractGeneric, langOf } from './generic.js'
import { extractTreeSitter, TS_LANGS } from './treesitter.js'
import { extractTaintJs } from './taint.js'
import { extractVue } from './vue-sfc.js'

const JS_EXT = new Set(['.js', '.mjs', '.cjs'])
const TAINT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'])

export async function extractFile(fileId, code, ext) {
  let result
  if (ext === '.vue') {
    const v = await extractVue(fileId, code)
    result = v ? v : { facts: extractGeneric(fileId, code, 'vue'), method: 'regex-fallback' }
  } else if (JS_EXT.has(ext)) {
    const f = extractJs(fileId, code)
    result = f ? { facts: f, method: 'acorn-ast' } : { facts: extractGeneric(fileId, code, 'javascript'), method: 'regex-fallback' }
  } else if (TS_LANGS[ext]) {
    const f = await extractTreeSitter(fileId, code, TS_LANGS[ext])
    result = f ? { facts: f, method: 'tree-sitter' } : { facts: extractGeneric(fileId, code, TS_LANGS[ext]), method: 'regex-fallback' }
  } else {
    result = { facts: extractGeneric(fileId, code, langOf(ext)), method: 'regex' }
  }
  // Data-flow taint facts (source/sink/sanitizer/dataflow) for JS-family files.
  // The framework model (刀2) needs a route handler's first param marked an entry
  // taint source; pass the file's http_route handler names so the taint extractor
  // seeds them (emitting inert entry_param/3 — the model activates it as source).
  if (TAINT_EXT.has(ext)) {
    const handlers = new Set(result.facts.filter((f) => f.pred === 'http_route').map((f) => String(f.args[3])))
    result.facts = result.facts.concat(extractTaintJs(fileId, code, handlers))
  }
  return result
}

export { langOf }
