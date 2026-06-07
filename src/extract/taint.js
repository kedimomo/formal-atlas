/**
 * Data-flow taint extraction (ported from the `logos` draft, hardened).
 * Line-level heuristic: tracks untrusted INPUT (req/argv/location/prompt)
 * flowing through assignments into dangerous SINKS (SQL/command/XSS), noting
 * SANITIZERS that neutralize it. Improvements over the draft:
 *   - taint does NOT cross function boundaries (reset on each function def),
 *   - string-literal contents are blanked before matching, so a variable name
 *     appearing inside a string (e.g. "WHERE name=") can't fake a flow.
 *
 * Emits for rules/taint.pl:
 *   source(Id) · sink(Id, Kind) · sanitizer(Id) · dataflow(A, B)   (Id='file:line:tag')
 *   sink_ct(Id, json|html|unknown)   (★3: content-type refinement for xss sinks)
 *   taint_returns(Fn)                (★6: within-file tainted-RETURN summary)
 * Intra-function by default; ★6 adds a sound-leaning interprocedural step — a
 * `const x = helper(..)` where `helper` returns untrusted data taints `x`.
 * Coarse on purpose (intra-file, name-based); the symbolic rules give the verdict.
 */
import { fact } from '../lift/fact-model.js'

const SOURCE = /\b(req|request)\.(query|body|params|headers)\b|\bprocess\.argv\b|\blocation\.(search|hash|href)\b|\bprompt\s*\(/
const SANITIZER = /\b(escape|sanitize|encodeURIComponent|parameterize|escapeId|DOMPurify\.sanitize|validator\.\w+|parseInt|Number)\s*\(/
const SINK = [
  { re: /\.(query|execute)\s*\(/, kind: 'sql' },
  { re: /\b(eval|execSync|exec|spawn)\s*\(/, kind: 'command' },
  { re: /\bnew\s+Function\s*\(/, kind: 'command' },
  { re: /\.innerHTML\s*=|\.(send|write|end)\s*\(/, kind: 'xss' },
]
const FN_DEF = /(?:^|\s)(?:async\s+)?function\b|=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/

const idOf = (file, line, tag) => `${file}:${line}:${tag}`
const noStr = (s) => s.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
const mentions = (expr, name) => new RegExp(`\\b${name}\\b`).test(expr)

// Explicit HTML-response signals at a sink site (Express/Fastify): an html
// content-type, a template render, or a redirect (reflected open-redirect).
const HTML_HINT = /\.type\s*\(\s*['"`][^'"`]*html|\.(?:render|redirect)\s*\(|content-?type['"`]?\s*[:=,]\s*['"`][^'"`]*html/i

/**
 * Structurally classify the response content-type of an xss-kind sink, so the
 * symbolic rule can suppress provably-JSON responses (Fastify `reply.send(obj)`
 * serializes to JSON — NOT an HTML/script sink). SOUND-leaning: we return
 * `json` ONLY when we can argue it; anything ambiguous stays `unknown` (kept).
 * Operates on the RAW line (string literals intact) so markup args are visible.
 */
function classifyXssCt(line) {
  if (/\.innerHTML\s*=/.test(line)) return 'html'
  if (HTML_HINT.test(line)) return 'html'
  const m = line.match(/\.(?:send|write|end)\s*\(\s*([\s\S]*)$/)
  const arg = (m ? m[1] : '').trim()
  if (/^['"`]/.test(arg)) return /</.test(arg) ? 'html' : 'unknown' // string arg: markup ⇒ html
  if (arg.startsWith('{') || arg.startsWith('[') || /^JSON\b/.test(arg)) return 'json' // object/array/JSON.*
  if (/\b(?:reply|rep)\b\s*\.|\.json\s*\(/.test(line)) return 'json' // Fastify reply.* (incl. chained .code().send()) ⇒ JSON
  return 'unknown' // e.g. Express res.send(identifier): genuinely ambiguous
}

const RETURN = /\breturn\s+(.+?);?$/
const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function'])

/** Best-effort name of the function a line defines (decl, arrow-const, or method). */
function fnNameOf(line) {
  let m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[\w,\s]*\)?\s*=>/)
  if (m) return m[1]
  m = line.match(/(?:async\s+)?function\s+(\w+)/)
  if (m) return m[1]
  m = line.match(/^(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/)
  if (m && !KW.has(m[1])) return m[1]
  return null
}

/** The callee name if `rhs` is `(await) f(...)` — a direct function call. */
function calleeOf(rhs) {
  const m = rhs.match(/^(?:await\s+)?(\w+)\s*\(/)
  return m ? m[1] : null
}

/**
 * ★6 pass 1 — within-file tainted-RETURN summaries. A function is a taint conduit
 * iff it `return`s a BARE tainted variable, or a direct SOURCE access (no call).
 * `return f(tainted)` is NOT a summary — it returns f's RESULT, not the input —
 * so interproc stays sound-leaning and adds no false positives (docs/10 §三).
 * Taint reset mirrors the main loop (FN_DEF boundary) for consistent semantics.
 */
function summarizeReturns(code) {
  const returns = new Set()
  let taint = new Set()
  let fn = null
  for (const raw of code.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('*')) continue
    if (FN_DEF.test(line)) taint = new Set()
    const name = fnNameOf(line)
    if (name) fn = name
    const asg = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?);?$/)
    if (asg) {
      const rhs = noStr(asg[2])
      if (SANITIZER.test(rhs)) taint.delete(asg[1])
      else if (SOURCE.test(rhs) || [...taint].some((v) => mentions(rhs, v))) taint.add(asg[1])
    }
    const rm = line.match(RETURN)
    if (rm && fn) {
      const e = rm[1].trim()
      if ((/^[A-Za-z_]\w*$/.test(e) && taint.has(e)) || (!e.includes('(') && SOURCE.test(noStr(e)))) returns.add(fn)
    }
  }
  return returns
}

export function extractTaintJs(fileId, code) {
  const facts = []
  const taint = new Map() // varName -> node id (currently tainted)
  const returnsTaint = summarizeReturns(code) // ★6: functions that return untrusted data
  for (const fn of returnsTaint) facts.push(fact('taint_returns', fn))
  code.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const ln = i + 1
    if (!line || line.startsWith('//') || line.startsWith('*')) return
    if (FN_DEF.test(line)) taint.clear() // taint does not cross function boundaries

    const asg = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?);?$/)
    if (asg) {
      const name = asg[1]
      const rhs = noStr(asg[2])
      const id = idOf(fileId, ln, name)
      if (SANITIZER.test(rhs)) {
        facts.push(fact('sanitizer', id))
        const up = [...taint].find(([v]) => mentions(rhs, v))
        if (up) facts.push(fact('dataflow', up[1], id))
        taint.delete(name)
        return
      }
      if (SOURCE.test(rhs)) { facts.push(fact('source', id)); taint.set(name, id) }
      else {
        const callee = calleeOf(rhs)
        const up = [...taint].find(([v]) => mentions(rhs, v))
        if (callee && returnsTaint.has(callee)) { facts.push(fact('source', id)); taint.set(name, id) } // ★6: tainted-return summary
        else if (up) { facts.push(fact('dataflow', up[1], id)); taint.set(name, id) }
      }
    }

    const code2 = noStr(line)
    for (const { re, kind } of SINK) {
      if (!re.test(code2)) continue
      const sinkId = idOf(fileId, ln, `sink_${kind}`)
      facts.push(fact('sink', sinkId, kind))
      if (kind === 'xss') facts.push(fact('sink_ct', sinkId, classifyXssCt(line))) // ★3: content-type refinement
      const tv = [...taint].find(([v]) => mentions(code2, v))
      if (tv) facts.push(fact('dataflow', tv[1], sinkId))
      else if (SOURCE.test(code2)) {
        const sId = idOf(fileId, ln, 'src_inline')
        facts.push(fact('source', sId), fact('dataflow', sId, sinkId))
      }
      break
    }
  })
  return facts
}
