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
 * CLI entry: read a loop-spec JSON (a single spec, an array, or `{loops:[...]}`),
 * discharge each, print, and return a process exit code (0 = all proved). A
 * raw project path is rejected with guidance — lifting invariants from code
 * (LLM autoformalization, docs/13 §五·二) is not wired yet, and we never pretend.
 */
export async function runProveFile(target) {
  let isFile = false
  try { isFile = fs.statSync(target).isFile() } catch { /* missing path */ }
  if (!isFile || !target.endsWith('.json')) {
    console.error('# prove expects a loop Hoare-spec JSON: { vars, pre, guard, invariant, body:[{var,expr}], post }.')
    console.error('# B-tier VCgen + built-in Z3 (docs/13 §五·一) discharges loop invariants WITHOUT Dafny/Lean; lifting')
    console.error('# invariants from a raw project path (LLM autoformalization, §五·二) is not wired yet.')
    console.log('example: formal-atlas prove examples/itp/sum-bound.loop.json')
    return 2
  }
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
  const specs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.loops) ? parsed.loops : [parsed])
  let allProved = true
  for (const s of specs) {
    const res = await proveLoop(s)
    allProved = allProved && res.proved
    console.log(formatProof(res))
  }
  return allProved ? 0 : 1
}
