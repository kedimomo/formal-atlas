/**
 * ★3 counterexample-driven repair loop — the neurosymbolic closed loop.
 *
 * For each surviving violation: hand the LLM the proof tree (verify/explain) +
 * any Z3 counterexample (★2), get a candidate verdict/patch, then RE-VERIFY
 * symbolically and accept ONLY if it holds up. The LLM proposes; the solver
 * disposes — an LLM output is never a conclusion until it passes re-check.
 *
 *   false-positive + refinement → reported as a triage verdict (the decidable
 *       contentType==json case is already encoded structurally by sink_ct).
 *   real + patch → applied to a SCRATCH copy, re-extracted + re-verified;
 *       accepted iff the target rule's count drops AND no NEW violation appears.
 *
 * Honest boundary: with no LLM available every violation comes back as
 * `needs-llm`, carrying the prompt + explanation — never a fabricated patch.
 * Disk writes are opt-in (apply:true); the default is a dry run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { extractProject, buildProgram } from '../pipeline.js'
import { runQuery } from '../verify/prolog-engine.js'
import { explainViolation } from '../verify/explain.js'
import { hasLLM, callLLMText } from '../llm/index.js'
import { buildRepairPrompt, parseRepairResponse, parseSinkId, readSnippet } from './feedback.js'

/** Count violations per rule for one extracted program (robust to line shifts). */
async function ruleCounts(program) {
  const rows = await runQuery(program, 'violation(Subject, Rule).')
  const byRule = {}
  for (const r of rows) byRule[r.Rule] = (byRule[r.Rule] || 0) + 1
  return { total: rows.length, byRule }
}

/**
 * Apply a candidate patch to a scratch copy and re-verify. Accept iff the target
 * rule's count strictly drops AND total violations do not increase (no regression).
 * Exported as the generate-and-check GATE — deterministic, no LLM involved.
 */
export async function verifyPatch(absFile, patch, targetRule) {
  if (!absFile) return { accepted: false, detail: 'cannot locate source file (scan a directory to enable patching)' }
  let src
  try { src = fs.readFileSync(absFile, 'utf8') } catch { return { accepted: false, detail: 'source unreadable' } }
  if (!src.includes(patch.find)) return { accepted: false, detail: 'patch.find is not an exact substring of the source (stale)' }
  const patchedSrc = src.replace(patch.find, patch.replace)

  const before = await ruleCounts(buildProgram(await extractProject(absFile, { lift: 'offline' })))
  const scratch = `${absFile}.fa-repair-tmp${path.extname(absFile)}`
  fs.writeFileSync(scratch, patchedSrc)
  try {
    const after = await ruleCounts(buildProgram(await extractProject(scratch, { lift: 'offline' })))
    const cleared = (after.byRule[targetRule] || 0) < (before.byRule[targetRule] || 0)
    const noRegress = after.total <= before.total
    return {
      accepted: cleared && noRegress,
      patchedSrc,
      detail: `${targetRule}: ${before.byRule[targetRule] || 0}→${after.byRule[targetRule] || 0}, total: ${before.total}→${after.total}`,
    }
  } finally {
    try { fs.unlinkSync(scratch) } catch { /* ignore */ }
  }
}

/** Generate→check a patch for one violation, with bounded retries on rejection. */
async function repairReal(absFile, rule, candidate, messages, attempts) {
  let cand = candidate
  const convo = [...messages]
  let outcome = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    outcome = await verifyPatch(absFile, cand.patch, rule)
    if (outcome.accepted || attempt === attempts) break
    convo.push({ role: 'assistant', content: JSON.stringify(cand) })
    convo.push({ role: 'user', content: `That patch did NOT clear the violation (${outcome.detail}). Propose a different minimal fix in the same STRICT-JSON format.` })
    const next = parseRepairResponse(await callLLMText(convo))
    if (!next || next.verdict !== 'real') break
    cand = next
  }
  return { outcome, candidate: cand }
}

/**
 * Run the closed-loop repair over a target path.
 * @returns {{target, total, considered, llm, results}}
 */
export async function repairViolations(target, { online = false, apply = false, max = 20, attempts = 2 } = {}) {
  void online // reserved: the online lift is wired via env/MCP in the LLM layer
  const root = path.resolve(process.cwd(), String(target))
  const isDir = (() => { try { return fs.statSync(root).isDirectory() } catch { return false } })()
  const program = buildProgram(await extractProject(root, { lift: 'offline' }))
  const vios = await runQuery(program, 'violation(Subject, Rule).')
  const llm = hasLLM()
  const results = []

  for (const v of vios.slice(0, max)) {
    const explanation = await explainViolation(program, v.Subject, v.Rule)
    const parsed = parseSinkId(v.Subject)
    const absFile = parsed ? (isDir ? path.join(root, parsed.file) : root) : null
    const snippet = absFile && parsed ? readSnippet(absFile, parsed.line) : null
    const messages = buildRepairPrompt(explanation, snippet)

    if (!llm) { results.push({ subject: v.Subject, rule: v.Rule, status: 'needs-llm', explanation, prompt: messages[0].content }); continue }

    const candidate = parseRepairResponse(await callLLMText(messages))
    if (!candidate) { results.push({ subject: v.Subject, rule: v.Rule, status: 'needs-llm', explanation, note: 'LLM returned no usable JSON' }); continue }

    if (candidate.verdict === 'false-positive') {
      results.push({ subject: v.Subject, rule: v.Rule, status: 'false-positive', reason: candidate.reason, refinement: candidate.refinement, explanation })
      continue
    }

    const { outcome, candidate: used } = await repairReal(absFile, v.Rule, candidate, messages, attempts)
    if (outcome.accepted && apply && absFile) fs.writeFileSync(absFile, outcome.patchedSrc)
    results.push({
      subject: v.Subject, rule: v.Rule,
      status: outcome.accepted ? (apply ? 'applied' : 'verified') : 'rejected',
      verifiedClean: outcome.accepted, reason: used.reason, patch: used.patch, detail: outcome.detail, explanation,
    })
  }
  return { target, total: vios.length, considered: Math.min(vios.length, max), llm: llm ? 'available' : 'offline', results }
}

const ICON = { applied: '🔧', verified: '✅', rejected: '❌', 'false-positive': '○', 'needs-llm': '…' }

/** Compact human summary of a repair run. */
export function formatRepair(run) {
  const lines = [`# repair ${run.target} — ${run.total} violation(s), LLM ${run.llm}`]
  for (const r of run.results) {
    lines.push(`\n${ICON[r.status] || '?'} [${r.status}] ${r.rule} — ${r.subject}`)
    if (r.reason) lines.push(`    reason: ${r.reason}`)
    if (r.refinement) lines.push(`    refinement: ${r.refinement}`)
    if (r.detail) lines.push(`    re-verify: ${r.detail}`)
    if (r.patch) lines.push(`    patch: ${JSON.stringify(r.patch.find)} → ${JSON.stringify(r.patch.replace)}`)
  }
  return lines.join('\n')
}
