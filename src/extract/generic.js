/**
 * Language-agnostic regex/heuristic fact extractor.
 *
 * Used for non-JS files and as a fallback when acorn cannot parse a JS file.
 * It is intentionally coarse: it recovers definitions, imports, loops and
 * sensitive literals — enough to seed the fact base. Deep semantics for
 * arbitrary languages are the job of the AI lifter (see lift/ai-lifter.js).
 */
import { fact } from '../lift/fact-model.js'

const LANG_BY_EXT = {
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
  '.rb': 'ruby', '.php': 'php', '.ts': 'typescript', '.tsx': 'typescript',
  '.jsx': 'javascript', '.vue': 'vue', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
  '.cc': 'cpp', '.cs': 'csharp', '.scala': 'scala', '.swift': 'swift',
  '.prisma': 'prisma', '.sql': 'sql',
}

export function langOf(ext) {
  return LANG_BY_EXT[ext] || 'unknown'
}

const DEF_PATTERNS = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,            // js/php
  /\bdef\s+([A-Za-z_][\w]*)/g,                    // python/ruby
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/g,  // go
  /\bfn\s+([A-Za-z_][\w]*)/g,                      // rust
  /\bsub\s+([A-Za-z_][\w]*)/g,                     // perl
]
const CLASS_PATTERNS = [
  /\bclass\s+([A-Za-z_]\w*)/g,
  /\bstruct\s+([A-Za-z_]\w*)/g,
  /\binterface\s+([A-Za-z_]\w*)/g,
  /\btrait\s+([A-Za-z_]\w*)/g,
  /\bmodel\s+([A-Za-z_]\w*)\s*\{/g,               // prisma
]
const IMPORT_PATTERNS = [
  /\bimport\s+[^'"\n]*['"]([^'"]+)['"]/g,
  /\bfrom\s+([A-Za-z_.][\w.]*)\s+import\b/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+"([^"]+)"/gm,                      // go
  /^\s*use\s+([A-Za-z_:][\w:]*)/gm,               // rust
]
const LOOP_PATTERN = /\b(for|while|foreach|loop)\b/g
const SENSITIVE = /tenant-\d+|password|secret|api[_-]?key|private[_-]?key|access[_-]?token/i

export function extractGeneric(fileId, code, lang) {
  const facts = [fact('file', fileId, lang)]
  const lineAt = (idx) => code.slice(0, idx).split('\n').length

  for (const re of DEF_PATTERNS) {
    for (const m of code.matchAll(re)) facts.push(fact('defines', fileId, m[1], 'routine', lineAt(m.index)))
  }
  for (const re of CLASS_PATTERNS) {
    for (const m of code.matchAll(re)) facts.push(fact('defines', fileId, m[1], 'class', lineAt(m.index)))
  }
  for (const re of IMPORT_PATTERNS) {
    for (const m of code.matchAll(re)) facts.push(fact('imports', fileId, m[1]))
  }
  let loops = 0
  for (const _m of code.matchAll(LOOP_PATTERN)) loops++
  if (loops) facts.push(fact('loop_count', fileId, loops))

  for (const m of code.matchAll(/['"]([^'"\n]{2,80})['"]/g)) {
    if (SENSITIVE.test(m[1])) facts.push(fact('string_lit', fileId, m[1], lineAt(m.index)))
  }
  return facts
}
