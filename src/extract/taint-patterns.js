/**
 * Lexical atoms + pure parse helpers shared by the taint extractor
 * (`taint.js`, the emit pipeline) and the interprocedural summaries
 * (`taint-interproc.js`). Kept dependency-free so both can import it without a
 * cycle. Coarse on purpose (line/regex level); the symbolic rules give the
 * verdict — see `rules/taint.pl`.
 */

export const SOURCE = /\b(req|request)\.(query|body|params|headers)\b|\bprocess\.argv\b|\blocation\.(search|hash|href)\b|\bprompt\s*\(/
export const SANITIZER = /\b(escape|sanitize|encodeURIComponent|parameterize|escapeId|DOMPurify\.sanitize|validator\.\w+|parseInt|Number)\s*\(/
export const SINK = [
  { re: /\.(query|execute)\s*\(/, kind: 'sql' },
  { re: /\b(eval|execSync|exec|spawn)\s*\(/, kind: 'command' },
  { re: /\bnew\s+Function\s*\(/, kind: 'command' },
  { re: /\.innerHTML\s*=|\.(send|write|end)\s*\(/, kind: 'xss' },
]
export const FN_DEF = /(?:^|\s)(?:async\s+)?function\b|=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/
export const RETURN = /\breturn\s+(.+?);?$/
export const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function'])

// Explicit HTML-response signals at a sink site (Express/Fastify): an html
// content-type, a template render, or a redirect (reflected open-redirect).
const HTML_HINT = /\.type\s*\(\s*['"`][^'"`]*html|\.(?:render|redirect)\s*\(|content-?type['"`]?\s*[:=,]\s*['"`][^'"`]*html/i

export const idOf = (file, line, tag) => `${file}:${line}:${tag}`
export const noStr = (s) => s.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
export const mentions = (expr, name) => new RegExp(`\\b${name}\\b`).test(expr)

/**
 * Structurally classify the response content-type of an xss-kind sink, so the
 * symbolic rule can suppress provably-JSON responses (Fastify `reply.send(obj)`
 * serializes to JSON — NOT an HTML/script sink). SOUND-leaning: we return
 * `json` ONLY when we can argue it; anything ambiguous stays `unknown` (kept).
 * Operates on the RAW line (string literals intact) so markup args are visible.
 */
export function classifyXssCt(line) {
  if (/\.innerHTML\s*=/.test(line)) return 'html'
  if (HTML_HINT.test(line)) return 'html'
  const m = line.match(/\.(?:send|write|end)\s*\(\s*([\s\S]*)$/)
  const arg = (m ? m[1] : '').trim()
  if (/^['"`]/.test(arg)) return /</.test(arg) ? 'html' : 'unknown' // string arg: markup ⇒ html
  if (arg.startsWith('{') || arg.startsWith('[') || /^JSON\b/.test(arg)) return 'json' // object/array/JSON.*
  if (/\b(?:reply|rep)\b\s*\.|\.json\s*\(/.test(line)) return 'json' // Fastify reply.* (incl. chained .code().send()) ⇒ JSON
  return 'unknown' // e.g. Express res.send(identifier): genuinely ambiguous
}

/** Best-effort name of the function a line defines (decl, arrow-const, or method). */
export function fnNameOf(line) {
  let m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[\w,\s]*\)?\s*=>/)
  if (m) return m[1]
  m = line.match(/(?:async\s+)?function\s+(\w+)/)
  if (m) return m[1]
  m = line.match(/^(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/)
  if (m && !KW.has(m[1])) return m[1]
  return null
}

/** The callee name if `rhs` is `(await) f(...)` — a direct function call. */
export function calleeOf(rhs) {
  const m = rhs.match(/^(?:await\s+)?(\w+)\s*\(/)
  return m ? m[1] : null
}

/**
 * Ordered formal-parameter names of the function a line defines (best-effort).
 * Destructured/unparseable params drop out (→ no param-sink summary for them):
 * a false negative, never a false positive — the ★6 sound-leaning stance.
 */
export function paramsOf(line) {
  let m = line.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(\w+)\s*=>/) // arrow, single bare param
  if (m) return [m[1]]
  m = line.match(/(?:function\s*\*?\s*\w*|=\s*(?:async\s*)?|^(?:async\s+)?\w+)\s*\(([^)]*)\)/)
  if (!m) m = line.match(/\(([^)]*)\)\s*(?:=>|\{)/) // bare `function (...)` / `(...) =>`
  if (!m) return []
  return m[1].split(',').map((s) => (s.trim().match(/^\.{0,3}\s*(\w+)/) || [])[1]).filter(Boolean)
}

/**
 * The DANGEROUS-VALUE portion of a sink line for a given kind (the assigned RHS
 * or the call arguments) — NOT the receiver object. Lets the param-sink
 * summarizer attribute taint to the value param (`obj` in `res.send(obj)`),
 * never the receiver param (`res`/`db`/`reply`). Expects a string-blanked line.
 */
export function sinkValueExpr(code2, kind) {
  if (kind === 'xss') {
    const a = code2.match(/\.innerHTML\s*=\s*(.+)$/)
    if (a) return a[1]
    const b = code2.match(/\.(?:send|write|end)\s*\(([\s\S]*)$/)
    return b ? b[1] : ''
  }
  if (kind === 'sql') { const m = code2.match(/\.(?:query|execute)\s*\(([\s\S]*)$/); return m ? m[1] : '' }
  if (kind === 'command') { const m = code2.match(/\b(?:eval|execSync|exec|spawn|Function)\s*\(([\s\S]*)$/); return m ? m[1] : '' }
  return ''
}

/**
 * Top-level argument expressions of the FIRST bare call to `callee` on a
 * string-blanked line, or null if absent. Splits on commas at paren/bracket/
 * brace depth 1, so nested calls/arrays stay intact (`f(a, g(b), [c,d])`).
 */
export function callSiteArgs(code2, callee) {
  const m = new RegExp(`(?:^|[^\\w.])${callee}\\s*\\(`).exec(code2)
  if (!m) return null
  const args = []
  let depth = 1
  let cur = ''
  for (let i = m.index + m[0].length; i < code2.length; i++) {
    const ch = code2[i]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) { if (--depth === 0) break }
    if (depth === 1 && ch === ',') { args.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) args.push(cur.trim())
  return args
}
