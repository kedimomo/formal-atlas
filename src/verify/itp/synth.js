/**
 * ★8 invariant synthesis — the neurosymbolic loop for LOOP INVARIANTS (docs/13
 * §五·二). The genuinely hard part of deductive verification is INVENTING an
 * inductive invariant; checking one is decidable. So the division of labour is:
 * the LLM PROPOSES candidate invariant clauses for a loop spec, and z3 (via
 * proveLoop) DISPOSES — a candidate is accepted ONLY if all three VCs discharge.
 * On failure the failing VC + its z3 counterexample are fed back for a bounded
 * number of refinement rounds (the same generate-and-check discipline as ★3
 * repair). Offline ⇒ `needs-llm` + a structured prompt; we never invent an
 * invariant we cannot machine-check, and "proved" always means z3 confirmed it.
 *
 * NOTE on faithfulness: the loop spec (vars/pre/guard/body/post) is assumed a
 * faithful transcription of the code — lifting THAT from raw source is deferred
 * (RESUME / docs/13). Here the checked artifact is the invariant: z3 guarantees
 * it is inductive and discharges the post FOR THE GIVEN SPEC.
 */
import { hasLLM, callLLMText } from '../../llm/index.js'
import { proveLoop } from './prove.js'

const SYNTH_SYS = 'You are a program-verification assistant. You propose LOOP INVARIANTS for Hoare triples. Reply with STRICT JSON only — no prose, no markdown, no code fences.'
const OPS = '&& || ! -> == != < <= > >= + - * / % , parentheses, and integer literals'

/** Build the chat messages: the loop obligation, plus optional failure feedback. */
export function buildSynthPrompt(spec, feedback) {
  const vars = Object.entries(spec.vars || {}).map(([n, t]) => `${n}: ${t}`).join(', ')
  const body = (spec.body || []).map((a) => `  ${a.var} := ${a.expr}`).join('\n')
  const fb = feedback
    ? `\n\nYour previous candidate {"invariant": ${JSON.stringify(feedback.invariant)}} FAILED VC-${feedback.kind} (${feedback.why}).${feedback.counterexample ? ` z3 counterexample (a pre-state that breaks it): ${feedback.counterexample}.` : ''} Propose a CORRECTED invariant — strengthen or fix the failing clause.`
    : ''
  const content = `Find a loop invariant for this Hoare triple so ALL THREE verification conditions hold:
  ① pre ⇒ inv                 (the invariant holds on loop entry)
  ② inv ∧ guard ∧ body ⇒ inv  (one iteration of the body preserves it)
  ③ inv ∧ ¬guard ⇒ post       (on exit it yields the postcondition)

vars:   ${vars}
pre:    ${JSON.stringify(spec.pre || [])}
guard:  ${spec.guard}
body:
${body}
post:   ${JSON.stringify(spec.post || [])}${fb}

The invariant is a conjunction of decidable predicate clauses over the vars, using ONLY: ${OPS}.
Reply with STRICT JSON, exactly: {"invariant": ["clause1", "clause2", ...]}. Output ONLY the JSON.`
  return [{ role: 'user', content }]
}

/** Parse the model's STRICT-JSON reply into a list of invariant clauses, or null. */
export function parseInvariantResponse(text) {
  if (!text) return null
  const m = String(text).match(/\{[\s\S]*\}/)
  if (!m) return null
  let obj
  try { obj = JSON.parse(m[0]) } catch { return null }
  if (!Array.isArray(obj.invariant)) return null
  const inv = obj.invariant.filter((c) => typeof c === 'string' && c.trim())
  return inv.length ? inv : null
}

/**
 * Synthesize an inductive invariant for a loop spec (LLM proposes, z3 disposes).
 * @returns {{status:'proved'|'unproven'|'needs-llm', name, invariant?, vcs?, prompt?}}
 */
export async function synthesizeInvariant(spec, { attempts = 3 } = {}) {
  const name = spec.name || 'loop'
  const base = buildSynthPrompt(spec)
  if (!hasLLM()) return { status: 'needs-llm', name, prompt: base[0].content }

  let feedback = null
  let last = null
  for (let i = 0; i < attempts; i++) {
    const messages = feedback ? buildSynthPrompt(spec, feedback) : base
    const inv = parseInvariantResponse(await callLLMText(messages, { systemPrompt: SYNTH_SYS }))
    if (!inv) {
      if (i === 0) return { status: 'needs-llm', name, prompt: base[0].content, note: 'LLM returned no usable JSON' }
      break
    }
    const res = await proveLoop({ ...spec, invariant: inv })
    last = { invariant: inv, vcs: res.vcs }
    if (res.proved) return { status: 'proved', name: res.name, invariant: inv, vcs: res.vcs }
    // Feed the first failing VC (and its counterexample) back for a refined try.
    const failed = res.vcs.find((v) => !v.discharged || v.vacuous)
    feedback = { invariant: inv, kind: failed?.kind, why: failed?.why, counterexample: failed?.counterexample }
  }
  return { status: 'unproven', name, invariant: last?.invariant || null, vcs: last?.vcs || [] }
}

/** Render a synthesis result for the CLI. */
export function formatSynth(res) {
  if (res.status === 'needs-llm') {
    return [
      `… ${res.name}: needs-llm — no LLM available, so no invariant was invented (honest boundary).`,
      '   Provide an LLM (ANTHROPIC_API_KEY / OPENAI_API_KEY, or an MCP-sampling IDE) to synthesize, then z3 checks it.',
      '   --- synthesis prompt ---',
      res.prompt.split('\n').map((l) => `   ${l}`).join('\n'),
    ].join('\n')
  }
  if (res.status === 'proved') {
    const inv = res.invariant.map((c) => `\`${c}\``).join(' ∧ ')
    return `✅ ${res.name}: invariant SYNTHESIZED and z3-verified — ${inv}\n   all 3 VCs discharged (LLM proposed, z3 disposed — a machine-checked invariant).`
  }
  return `❌ ${res.name}: no invariant found within the attempt budget (never claimed proved). Last candidate: ${JSON.stringify(res.invariant)}`
}
