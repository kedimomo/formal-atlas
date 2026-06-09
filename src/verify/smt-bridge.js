/**
 * SMT bridge — the deductive-verification layer (path C in the math docs).
 *
 * Datalog/Prolog decide STRUCTURAL properties; SMT decides FUNCTIONAL and
 * COMBINATORIAL ones — "can preconditions ever violate the postcondition?",
 * "can the role grants ever let one principal both create AND approve?".
 * Those are questions you cannot grep or Datalog for. Powered by z3-solver
 * (WASM Z3, runs locally). Also emits Dafny skeletons for full proof later.
 */
import { init } from 'z3-solver'
import { parseExpr, compile } from './smt-dsl.js'

let ctx = null
async function z3() {
  if (ctx) return ctx
  const { Context } = await init()
  ctx = Context('main')
  return ctx
}

const orAll = (Z3, a) => (a.length ? a.reduce((x, y) => Z3.Or(x, y)) : Z3.Bool.val(false))
const andAll = (Z3, a) => (a.length ? a.reduce((x, y) => Z3.And(x, y)) : Z3.Bool.val(true))

/**
 * Hoare-style contract check: is the postcondition GUARANTEED by the
 * preconditions? Checks (a) preconditions satisfiable (not vacuous) and
 * (b) pre ∧ ¬post unsatisfiable (post entailed). A SAT for (b) is a concrete
 * counterexample input that satisfies the contract's pre but breaks its post.
 */
export async function checkContract(spec) {
  const Z3 = await z3()
  const vars = {}
  for (const [n, ty] of Object.entries(spec.vars || {})) vars[n] = ty === 'bool' ? Z3.Bool.const(n) : Z3.Int.const(n)
  const pre = (spec.pre || []).map((s) => compile(parseExpr(s), Z3, vars))
  const post = (spec.post || []).map((s) => compile(parseExpr(s), Z3, vars))

  const s1 = new Z3.Solver()
  pre.forEach((c) => s1.add(c))
  const preSat = await s1.check()

  const s2 = new Z3.Solver()
  pre.forEach((c) => s2.add(c))
  s2.add(Z3.Not(andAll(Z3, post)))
  const breakable = await s2.check()
  const counterexample = breakable === 'sat'
    ? Object.keys(vars).map((n) => `${n}=${s2.model().eval(vars[n]).toString().replace(/\(-\s*(\d+)\)/, '-$1')}`).join(', ')
    : null

  return { name: spec.name || 'contract', preSat, entailed: breakable === 'unsat', counterexample }
}

/**
 * Inductive-step VC (★8 B-tier, docs/13 §五·一). Is a loop invariant PRESERVED
 * by one body iteration? Encodes the transition relation with primed next-state
 * variables and asks Z3 whether  inv(x) ∧ guard(x) ∧ x' = body(x) ∧ ¬inv(x')  is
 * SAT. UNSAT ⇒ the invariant is inductive; SAT ⇒ a concrete pre-state where the
 * body breaks it (a non-inductive invariant). The prime suffix `'` cannot occur
 * in a DSL identifier, so next-state consts never collide with user variables.
 */
export async function checkInductive(spec) {
  const Z3 = await z3()
  const base = {}, next = {}
  for (const [n, ty] of Object.entries(spec.vars || {})) {
    base[n] = ty === 'bool' ? Z3.Bool.const(n) : Z3.Int.const(n)
    next[n] = ty === 'bool' ? Z3.Bool.const(`${n}'`) : Z3.Int.const(`${n}'`)
  }
  const C = (s, vmap) => compile(parseExpr(s), Z3, vmap)
  const assigned = new Set((spec.body || []).map((a) => a.var))
  const trans = (spec.body || []).map((a) => next[a.var].eq(C(a.expr, base)))
    .concat(Object.keys(spec.vars || {}).filter((v) => !assigned.has(v)).map((v) => next[v].eq(base[v]))) // frame: unassigned vars unchanged

  const s = new Z3.Solver()
  ;(spec.inv || []).forEach((i) => s.add(C(i, base)))
  if (spec.guard) s.add(C(spec.guard, base))
  trans.forEach((c) => s.add(c))
  s.add(Z3.Not(andAll(Z3, (spec.inv || []).map((i) => C(i, next)))))
  const r = await s.check()
  const counterexample = r === 'sat'
    ? Object.keys(base).map((n) => `${n}=${s.model().eval(base[n]).toString().replace(/\(-\s*(\d+)\)/, '-$1')}`).join(', ')
    : null
  return { name: spec.name || 'loop', inductive: r === 'unsat', counterexample }
}

/**
 * RBAC / separation-of-duty consistency. Encodes role→permission grants and
 * conflicting-permission pairs, then asks Z3 two questions:
 *   1. Does a role assignment exist that meets all `require` AND respects SoD?
 *   2. Under the grants, can SoD be VIOLATED (one principal holds a conflict)?
 */
export async function checkPolicy(spec) {
  const Z3 = await z3()
  const roles = spec.roles || {}
  const conflicts = spec.conflicts || []
  const principals = spec.principals || {}
  const a = {}
  const roleset = {}
  const fixed = []
  for (const [P, info] of Object.entries(principals)) {
    roleset[P] = [...new Set([...(info.assigned || []), ...(info.candidates || [])])]
    a[P] = {}
    for (const R of roleset[P]) a[P][R] = Z3.Bool.const(`assign_${P}_${R}`)
    for (const R of info.assigned || []) fixed.push(a[P][R])
  }
  const holds = (P, perm) => orAll(Z3, roleset[P].filter((R) => (roles[R] || []).includes(perm)).map((R) => a[P][R]))
  const sodFor = (P) => andAll(Z3, conflicts.map(([x, y]) => Z3.Not(Z3.And(holds(P, x), holds(P, y)))))
  const violFor = (P) => orAll(Z3, conflicts.map(([x, y]) => Z3.And(holds(P, x), holds(P, y))))
  const coverage = andAll(Z3, (spec.require || []).map((r) => holds(r.principal, r.permission)))
  const assignStr = (m) => {
    const out = []
    for (const P of Object.keys(a)) for (const R of Object.keys(a[P])) if (m.eval(a[P][R]).toString() === 'true') out.push(`${P}:${R}`)
    return out.join(', ') || '(none)'
  }

  const s1 = new Z3.Solver()
  fixed.forEach((c) => s1.add(c))
  s1.add(coverage)
  for (const P of Object.keys(principals)) s1.add(sodFor(P))
  const safe = await s1.check()
  const safeModel = safe === 'sat' ? assignStr(s1.model()) : null

  const s2 = new Z3.Solver()
  fixed.forEach((c) => s2.add(c))
  s2.add(coverage)
  s2.add(orAll(Z3, Object.keys(principals).map(violFor)))
  const violationReachable = await s2.check()
  const violModel = violationReachable === 'sat' ? assignStr(s2.model()) : null

  return { safe, safeModel, violationReachable, violModel }
}

/** Emit a Dafny method skeleton from a contract spec (for full proof later). */
export function toDafny(spec) {
  const ps = (spec.params || Object.entries(spec.vars || {}).map(([name, type]) => ({ name, type }))).map((p) => `${p.name}: ${dty(p.type)}`).join(', ')
  const req = (spec.pre || []).map((s) => `  requires ${s}`).join('\n')
  const ens = (spec.post || []).map((s) => `  ensures ${s}`).join('\n')
  return `method ${spec.name || 'M'}(${ps})\n${req}\n${ens}\n{\n  // TODO: implementation — Dafny's SMT backend discharges the proof obligation\n}`
}
const dty = (t) => (t === 'bool' ? 'bool' : 'int')
