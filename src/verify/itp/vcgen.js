/**
 * VCgen — the B-tier verification-condition generator (★8, docs/13 §五·一).
 *
 * From a loop Hoare-spec it constructs the THREE verification conditions a
 * program verifier emits (Dafny = VCgen + z3 — we build the same VCs and feed
 * the SAME built-in z3, so NO external prover is needed for this tier):
 *
 *   ① init : pre ⇒ inv               — the invariant holds on loop entry
 *   ② step : inv ∧ guard ∧ T ⇒ inv'  — the body preserves it (induction step)
 *   ③ exit : inv ∧ ¬guard ⇒ post     — on exit the postcondition follows
 *
 * This file is PURE logical construction — no solver call lives here. That
 * separation is the point: the VCgen is a math object ("the framework builds
 * itself"); discharging the VCs is z3's job, in prove.js.
 *
 * Loop Hoare-spec shape (JSON, hand- or LLM-written — see docs/13 §五·二):
 *   { name, vars:{n:'int'|'bool'}, pre:[expr], guard:expr,
 *     invariant:[expr], body:[{var,expr}], post:[expr] }
 */

/** Build the three loop VCs as dischargeable descriptors (data, not proofs). */
export function loopVCs(spec) {
  const name = spec.name || 'loop'
  const vars = spec.vars || {}
  const inv = spec.invariant || []
  const guard = spec.guard || 'true'
  // ¬guard via the DSL's unary ! — `'` would be illegal here, but guard is a
  // user expression, so parenthesise to negate the whole condition safely.
  const notGuard = `!(${guard})`
  return [
    {
      kind: 'init',
      why: 'invariant holds on loop entry (pre ⇒ inv)',
      check: 'contract',
      spec: { name: `${name}/init`, vars, pre: spec.pre || [], post: inv },
    },
    {
      kind: 'step',
      why: 'loop body preserves the invariant (inv ∧ guard ⇒ inv′)',
      check: 'inductive',
      spec: { name: `${name}/step`, vars, inv, guard, body: spec.body || [] },
    },
    {
      kind: 'exit',
      why: 'postcondition holds when the loop exits (inv ∧ ¬guard ⇒ post)',
      check: 'contract',
      spec: { name: `${name}/exit`, vars, pre: [...inv, notGuard], post: spec.post || [] },
    },
  ]
}

/**
 * Emit a Dafny method+loop skeleton from the same spec. The B-tier above proves
 * the loop with the built-in z3; this skeleton is the hand-off to the C-tier
 * (docs/13 §五·一 row C: unbounded induction / full functional correctness needs
 * an external trusted kernel). The "VC-gen half" Dafny needs is therefore ready.
 */
export function toDafnyLoop(spec) {
  const ps = Object.entries(spec.vars || {}).map(([n, t]) => `${n}: ${t === 'bool' ? 'bool' : 'int'}`).join(', ')
  const req = (spec.pre || []).map((s) => `  requires ${s}`).join('\n')
  const ens = (spec.post || []).map((s) => `  ensures ${s}`).join('\n')
  const invs = (spec.invariant || []).map((s) => `    invariant ${s}`).join('\n')
  const upd = (spec.body || []).map((a) => `    ${a.var} := ${a.expr};`).join('\n')
  return `method ${spec.name || 'M'}(${ps})\n${req}\n${ens}\n{\n  while ${spec.guard || 'true'}\n${invs}\n  {\n${upd}\n  }\n}`
}
