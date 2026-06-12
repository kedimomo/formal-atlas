/**
 * ITP B-tier discharge (★8, docs/13 §五·一) — prove a loop Hoare-spec with the
 * BUILT-IN z3, zero external prover.
 *
 * Each of the three VCs from vcgen.js reduces to an UNSAT check, which is exactly
 * the shape the existing SMT bridge already speaks:
 *   - init / exit are plain entailments  →  reuse checkContract (pre ∧ ¬post UNSAT)
 *   - step is an inductive transition     →  checkInductive (primed next-state)
 *
 * generate-and-check, honestly: a spec is `proved` ONLY if z3 discharges ALL
 * three VCs and none is vacuous. A failing VC carries the concrete counterexample
 * (e.g. the pre-state where a non-inductive invariant breaks). We never dress up
 * what the solver did not actually prove — the same discipline as ★2/★3.
 *
 * This closes the gap `refine` flags as `unchecked` ("post with no pre — needs
 * body-level VC, ★8"): the loop body + invariant ARE that body-level VC.
 */
import { checkContract, checkInductive } from '../smt-bridge.js'
import { loopVCs } from './vcgen.js'
import fs from 'node:fs'

/** Discharge a single loop Hoare-spec's three VCs. Returns {name, proved, vcs}. */
export async function proveLoop(spec) {
  const vcs = []
  for (const vc of loopVCs(spec)) {
    if (vc.check === 'contract') {
      const r = await checkContract(vc.spec)
      // An UNSAT hypothesis set means the VC is only VACUOUSLY true (a dead
      // path / contradictory spec) — surfaced like the refinement `vacuous`
      // verdict, never counted as a real proof.
      vcs.push({ kind: vc.kind, why: vc.why, discharged: r.entailed, vacuous: r.preSat === 'unsat', counterexample: r.counterexample })
    } else {
      const r = await checkInductive(vc.spec)
      vcs.push({ kind: vc.kind, why: vc.why, discharged: r.inductive, vacuous: false, counterexample: r.counterexample })
    }
  }
  const proved = vcs.every((v) => v.discharged && !v.vacuous)
  return { name: spec.name || 'loop', proved, vcs }
}

/** Render a proof result for the CLI. */
export function formatProof(res) {
  const head = res.proved
    ? `✅ ${res.name}: PROVED — all 3 verification conditions discharged by Z3 (B-tier VCgen, no external prover)`
    : `❌ ${res.name}: NOT proved`
  const lines = [head]
  for (const v of res.vcs) {
    const tag = v.vacuous ? '⚠ vacuous (hypotheses UNSAT — dead path / contradictory spec)' : (v.discharged ? '✅' : '❌')
    lines.push(`   ${tag} VC-${v.kind}: ${v.why}`)
    if (!v.discharged && v.counterexample) lines.push(`        counterexample: ${v.counterexample}`)
  }
  return lines.join('\n')
}

/**
 * CLI entry: route a target to the right prover.
 *   <spec>.json          → discharge (with `invariant`) or synthesize (without) each spec
 *   <file>.js / <dir>/   → lift counting loops from code and prove iterator bound-safety
 * Returns a process exit code (0 = everything proved / nothing to prove).
 */
export async function runProveFile(target) {
  let stat = null
  try { stat = fs.statSync(target) } catch { /* missing path */ }
  if (stat && stat.isFile() && target.endsWith('.json')) return runProveSpecFile(target)
  if (stat && (stat.isDirectory() || /\.(js|mjs|cjs)$/.test(target))) return runProveCode(target)
  console.error('# prove takes a loop-spec JSON, or a .js file / directory to lift counting loops from.')
  console.error('# spec JSON: { vars, pre, guard, invariant, body:[{var,expr}], post } — with `invariant`')
  console.error('#   ⇒ z3 discharges it (docs/13 §五·一); without ⇒ synthesize one (§五·二; offline needs-llm).')
  console.error('# .js/dir: extract ascending counting loops and prove the iterator never overshoots its bound.')
  console.log('example: formal-atlas prove examples/itp/sum-bound.loop.json  |  formal-atlas prove examples/itp/loops.js')
  return 2
}

/** Discharge/synthesize the loop spec(s) in a JSON file. */
async function runProveSpecFile(target) {
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
  const specs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.loops) ? parsed.loops : [parsed])
  let synth = null
  let allProved = true
  for (const s of specs) {
    if (s && s.kind === 'induction') {
      // C-tier: ∀n≥0. P(f(n)) by the self-built ℕ-induction rule (z3 discharges base+step).
      const ind = await import('./induction.js')
      const res = await ind.proveByInduction(s)
      allProved = allProved && res.proved
      console.log(ind.formatInduction(res))
    } else if (s && s.invariant === undefined) {
      // No invariant supplied ⇒ synthesize one (LLM proposes, z3 disposes — §五·二).
      // Dynamic import keeps synth.js → prove.js a one-way edge (no static cycle).
      synth = synth || await import('./synth.js')
      const res = await synth.synthesizeInvariant(s)
      allProved = allProved && res.status === 'proved'
      console.log(synth.formatSynth(res))
    } else {
      const res = await proveLoop(s)
      allProved = allProved && res.proved
      console.log(formatProof(res))
    }
  }
  return allProved ? 0 : 1
}

/**
 * Lift counting loops from real code (a .js file or a directory) and prove, with the
 * built-in z3 (docs/13 §五·二): (1) each unit-stride loop's iterator bound-safety, and
 * (2) the in-bounds-ness of every counter-indexed `arr[idx]` access (per-access OOB,
 * any step, with the access's guarding path conditions). The extractors are
 * conservative — what they cannot model precisely is SKIPPED, never guessed — and a
 * `possible OOB` is only reported for a fully-modeled access.
 */
async function runProveCode(target) {
  const { walkFiles } = await import('../../pipeline.js')
  const { extractLoopSpecs } = await import('../../extract/loop/counter.js')
  const { extractAccessObligations } = await import('../../extract/loop/oob.js')
  const { checkContract } = await import('../smt-bridge.js')
  const files = walkFiles(target).filter((f) => /\.(js|mjs|cjs)$/.test(f.ext))
  const specs = []
  const obligations = []
  for (const { abs, fileId } of files) {
    let code
    try { code = fs.readFileSync(abs, 'utf8') } catch { continue }
    for (const s of extractLoopSpecs(fileId, code)) specs.push(s)
    for (const o of extractAccessObligations(fileId, code)) obligations.push(o)
  }
  if (!specs.length && !obligations.length) {
    console.error(`# prove ${target}: no soundly-modelable counting loops or array accesses found (anything not precisely modelable is skipped, not guessed).`)
    return 0
  }
  let ok = true

  if (specs.length) {
    console.error(`# prove ${target}: ${specs.length} unit-stride loop(s) — iterator bound-safety`)
    for (const s of specs) { const res = await proveLoop(s); ok = ok && res.proved; console.log(formatProof(res)) }
  }

  if (obligations.length) {
    console.error(`# prove ${target}: ${obligations.length} counter-indexed array access(es) — bounds (0 <= idx < length)`)
    for (const o of obligations) {
      const r = await checkContract({ vars: o.vars, pre: o.pre, post: o.post, name: o.name })
      if (r.preSat === 'unsat') { console.log(`○ ${o.name}: unreachable (path condition is infeasible) — no access`); continue }
      if (r.entailed) { console.log(`✅ ${o.name}: in bounds — 0 <= idx < ${o.arr}.length proved by z3`); continue }
      if (o.fullyModeled) { ok = false; console.log(`❌ ${o.name}: POSSIBLE out-of-bounds — not provably in bounds${r.counterexample ? ` (e.g. ${r.counterexample})` : ''}`) }
      else console.log(`○ ${o.name}: not analyzed — a guarding condition could not be modeled (no claim, to avoid a false positive)`)
    }
  }
  return ok ? 0 : 1
}
