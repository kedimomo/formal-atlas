/**
 * ★3 repair feedback assembler.
 *
 * Packages a verified violation + its derivation (proof tree, src/verify/explain)
 * + any Z3 counterexample (★2) + the offending source snippet into a STRICT-JSON
 * prompt for the LLM. The model's reply is a CANDIDATE only — repair/loop.js
 * re-verifies it before acceptance (generate-and-check; never a conclusion here).
 */
import fs from 'node:fs'

/** Split a 'file:line:tag' node id (file is a posix-relative path → no colon). */
export function parseSinkId(id) {
  const m = String(id).match(/^(.*):(\d+):([^:]+)$/)
  return m ? { file: m[1], line: Number(m[2]), tag: m[3] } : null
}

/** Read a few lines of context around `line` (1-based) from a source file. */
export function readSnippet(absFile, line, ctx = 3) {
  let src
  try { src = fs.readFileSync(absFile, 'utf8') } catch { return null }
  const lines = src.split('\n')
  const from = Math.max(0, line - 1 - ctx)
  const to = Math.min(lines.length, line + ctx)
  return lines.slice(from, to)
    .map((t, i) => `${from + i + 1}${from + i + 1 === line ? ' →' : '  '} ${t}`)
    .join('\n')
}

/** Build the chat messages for callLLMText from an explanation + snippet. */
export function buildRepairPrompt(explanation, snippet) {
  const e = explanation
  const trace = e.because.map((b) => `  - ${b}`).join('\n')
  const ce = e.counterexample ? `\nZ3 counterexample: ${e.counterexample}` : ''
  const content = `A static analyzer derived this violation (machine-verified, not a guess):

rule: ${e.rule}
location: ${e.subject}
severity: ${e.severity}
derivation:
${trace}${ce}

source:
${snippet || '(unavailable)'}

Decide whether this is a FALSE POSITIVE or a REAL defect, then reply with STRICT JSON, exactly one of:
{"verdict":"false-positive","reason":"<why the analyzer is wrong here>","refinement":"<decidable predicate that justifies suppression, e.g. contentType==json>"}
{"verdict":"real","reason":"<the vulnerability>","patch":{"find":"<exact substring copied from the source above>","replace":"<minimal fix: same behavior, vulnerability removed>"}}

Constraints: "find" MUST be an exact substring of the shown source. Keep the patch minimal. Output ONLY the JSON.`
  return [{ role: 'user', content }]
}

/** Parse the model's STRICT-JSON reply into a validated candidate, or null. */
export function parseRepairResponse(text) {
  if (!text) return null
  const m = String(text).match(/\{[\s\S]*\}/)
  if (!m) return null
  let obj
  try { obj = JSON.parse(m[0]) } catch { return null }
  if (obj.verdict === 'false-positive') {
    return { verdict: 'false-positive', reason: obj.reason || '', refinement: obj.refinement || null }
  }
  if (obj.verdict === 'real' && obj.patch && typeof obj.patch.find === 'string' && typeof obj.patch.replace === 'string') {
    return { verdict: 'real', reason: obj.reason || '', patch: { find: obj.patch.find, replace: obj.patch.replace } }
  }
  return null
}
