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
    if (s && s.invariant === undefined) {
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
 * Lift counting loops from real code (a .js file or a directory) and prove each
 * one's iterator bound-safety with the built-in z3 (docs/13 §五·二, front half).
 * The extractor is conservative — loops it cannot model precisely are SKIPPED,
 * never guessed — so a `proved` here is a genuine machine-checked safety result
 * and a `NOT proved` is a real overshoot (off-by-one / stride-skips-bound).
 */
async function runProveCode(target) {
  const { walkFiles } = await import('../../pipeline.js')
  const { extractLoopSpecs } = await import('../../extract/loop/counter.js')
  const specs = []
  for (const { abs, fileId } of walkFiles(target).filter((f) => /\.(js|mjs|cjs)$/.test(f.ext))) {
    let code
    try { code = fs.readFileSync(abs, 'utf8') } catch { continue }
    for (const s of extractLoopSpecs(fileId, code)) specs.push(s)
  }
  if (!specs.length) {
    console.error(`# prove ${target}: no soundly-modelable counting loops found (only simple ascending for-loops are lifted; anything else is skipped, not guessed).`)
    return 0
  }
  console.error(`# prove ${target}: ${specs.length} counting loop(s) lifted — checking iterator bound-safety with z3`)
  let allProved = true
  for (const s of specs) {
    const res = await proveLoop(s)
    allProved = allProved && res.proved
    console.log(formatProof(res))
  }
  return allProved ? 0 : 1
}
