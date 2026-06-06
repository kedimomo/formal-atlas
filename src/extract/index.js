/**
 * Extractor dispatch: choose a strategy by file extension, with a graceful
 * fallback chain (acorn AST → tree-sitter → regex) so one bad file never
 * aborts a whole-project run. Async because tree-sitter loads WASM grammars.
 */
import { extractJs } from './js-ast.js'
import { extractGeneric, langOf } from './generic.js'
import { extractTreeSitter, TS_LANGS } from './treesitter.js'

const JS_EXT = new Set(['.js', '.mjs', '.cjs'])

export async function extractFile(fileId, code, ext) {
  if (JS_EXT.has(ext)) {
    const f = extractJs(fileId, code)
    if (f) return { facts: f, method: 'acorn-ast' }
    return { facts: extractGeneric(fileId, code, 'javascript'), method: 'regex-fallback' }
  }
  if (TS_LANGS[ext]) {
    const f = await extractTreeSitter(fileId, code, TS_LANGS[ext])
    if (f) return { facts: f, method: 'tree-sitter' }
    return { facts: extractGeneric(fileId, code, TS_LANGS[ext]), method: 'regex-fallback' }
  }
  return { facts: extractGeneric(fileId, code, langOf(ext)), method: 'regex' }
}

export { langOf }
