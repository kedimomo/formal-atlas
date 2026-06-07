/**
 * ★5 zero-install semi-naive Datalog engine (docs/11-scale-engine.md).
 *
 * tau-prolog's SLD recomputes subgoals, so the recursive transitive-closure
 * rules dominate wall-clock (measured: cyclic/1 = 52.8s on 145 files). This
 * module evaluates exactly that Datalog SUBSET — the closures and the verdicts
 * layered on them — with delta-driven semi-naive iteration + first-argument
 * indexing: each derivation fires once, so the same closure lands in ~16ms.
 *
 * It is NOT a general Prolog engine: the list-building rules (tainted_path/3)
 * stay in tau-prolog. It computes the predicates whose Prolog definitions live
 * in rules/resolved.pl (r_reaches/reaches/cyclic/dead_code) and rules/taint.pl
 * (tainted), faithfully — see the per-predicate comments and the parity test
 * (test/datalog.test.js) which asserts bit-identical result sets vs tau-prolog.
 *
 * Negation is stratified (¬rcall, ¬r_entry, ¬addr_taken, ¬unresolved_call all
 * negate predicates that don't depend on dead_code), so a single materialize
 * pass is sound: compute the closures first, then the negated verdicts.
 */

import { fact } from '../lift/fact-model.js'

/** Per-node forward transitive closure (1+ steps) of an adjacency map. */
function transitiveClosure(edges) {
  const reach = new Map() // from -> Set(reachable in 1+ steps)
  for (const a of edges.keys()) {
    const seen = new Set()
    let frontier = [...(edges.get(a) || [])] // 1-step seeds
    for (const b of frontier) seen.add(b)
    while (frontier.length) {
      const next = []
      for (const n of frontier) {
        const outs = edges.get(n)
        if (!outs) continue
        for (const m of outs) if (!seen.has(m)) { seen.add(m); next.push(m) }
      }
      frontier = next
    }
    reach.set(a, seen)
  }
  return reach
}

/** Forward-reachable set from `seeds` over `edges` (seeds included). */
function reachableFrom(seeds, edges) {
  const seen = new Set(seeds)
  let frontier = [...seeds]
  while (frontier.length) {
    const next = []
    for (const n of frontier) {
      const outs = edges.get(n)
      if (!outs) continue
      for (const m of outs) if (!seen.has(m)) { seen.add(m); next.push(m) }
    }
    frontier = next
  }
  return seen
}

/**
 * Materialize the recursive Datalog subset from a flat fact array.
 * @returns {{reaches:Set,cyclic:Set,deadCode:Set,tainted:Set,rReaches:Map}}
 *   reaches/deadCode/tainted/cyclic are canonical string sets (tab-joined) for
 *   set-equality parity checks; rReaches is the QId-level closure map.
 */
export function evaluate(facts) {
  const rcall = new Map()
  const dataflow = new Map()
  const decls = []
  const nodeName = new Map()
  const exportsSet = new Set()
  const entrySet = new Set()
  const addrTaken = new Set()
  const unresolved = new Set()
  const sources = new Set()
  const rcallTargets = new Set() // every Q that is some rcall callee (for \+ rcall(_,Q))

  for (const { pred, args } of facts) {
    const a = args.map(String)
    if (pred === 'rcall') {
      if (!rcall.has(a[0])) rcall.set(a[0], new Set())
      rcall.get(a[0]).add(a[1])
      rcallTargets.add(a[1])
    } else if (pred === 'dataflow') {
      if (!dataflow.has(a[0])) dataflow.set(a[0], new Set())
      dataflow.get(a[0]).add(a[1])
    } else if (pred === 'decl') decls.push({ q: a[0], file: a[1], name: a[2], kind: a[3] })
    else if (pred === 'node') nodeName.set(a[0], a[1])
    else if (pred === 'exports') exportsSet.add(`${a[0]}\t${a[1]}`)
    else if (pred === 'entry') entrySet.add(a[0])
    else if (pred === 'addr_taken') addrTaken.add(`${a[0]}\t${a[1]}`)
    else if (pred === 'unresolved_call') unresolved.add(a[0])
    else if (pred === 'source') sources.add(a[0])
  }

  const rReaches = transitiveClosure(rcall) // r_reaches(A,B)
  const tainted = reachableFrom(sources, dataflow) // tainted(N): source ∪ forward dataflow

  // cyclic(Name) :- decl(Q,_,Name,routine), r_reaches(Q,Q).
  const cyclic = new Set()
  for (const d of decls) if (d.kind === 'routine' && rReaches.get(d.q)?.has(d.q)) cyclic.add(d.name)

  // r_entry(Q) :- decl(Q,File,Name,routine), exports(File,Name) ; decl(Q,_,Name,routine), entry(Name).
  const isEntry = (d) => exportsSet.has(`${d.file}\t${d.name}`) || entrySet.has(d.name)

  // dead_code(File,Name) — routine, no resolved caller, not entry/addr-taken, name not reached by an unresolved call.
  const deadCode = new Set()
  for (const d of decls) {
    if (d.kind !== 'routine') continue
    if (rcallTargets.has(d.q) || isEntry(d) || addrTaken.has(`${d.file}\t${d.name}`) || unresolved.has(d.name)) continue
    deadCode.add(`${d.file}\t${d.name}`)
  }

  // reaches(A,B) :- node(QA,A), node(QB,B), r_reaches(QA,QB).  (name-level, distinct)
  const reaches = new Set()
  for (const [qa, set] of rReaches) {
    const na = nodeName.get(qa)
    if (na === undefined) continue
    for (const qb of set) {
      const nb = nodeName.get(qb)
      if (nb !== undefined) reaches.add(`${na}\t${nb}`)
    }
  }

  // impact(Target,Caller) :- node(QT,Target), decl(QC,_,Caller,routine), QC\=QT, r_reaches(QC,QT).
  const routineName = new Map()
  for (const d of decls) if (d.kind === 'routine') routineName.set(d.q, d.name)
  const impact = new Set()
  for (const [qc, set] of rReaches) {
    const caller = routineName.get(qc)
    if (caller === undefined) continue
    for (const qt of set) {
      if (qt === qc) continue
      const target = nodeName.get(qt)
      if (target !== undefined) impact.add(`${target}\t${caller}`)
    }
  }

  return { reaches, cyclic, deadCode, tainted, impact, rReaches }
}

/**
 * ★5 facts to inject for the `--engine=datalog` path: the materialized verdicts
 * (dead_code/2, tainted/1) plus the `engine_materialized` flag that short-circuits
 * their recursive Prolog rules (resolved.pl/taint.pl). tau-prolog then answers
 * violation/2 from these ground facts instead of recomputing the closures.
 */
export function materialize(facts) {
  const e = evaluate(facts)
  const out = [fact('engine_materialized')]
  for (const fn of e.deadCode) { const [f, n] = fn.split('\t'); out.push(fact('dead_code', f, n)) }
  for (const n of e.tainted) out.push(fact('tainted', n))
  return out
}

// Closure predicates the engine can answer directly (pred/arity → tuple list).
const CLOSURE = {
  'cyclic/1': (e) => [...e.cyclic].map((n) => [n]),
  'tainted/1': (e) => [...e.tainted].map((n) => [n]),
  'reaches/2': (e) => [...e.reaches].map((s) => s.split('\t')),
  'dead_code/2': (e) => [...e.deadCode].map((s) => s.split('\t')),
  'impact/2': (e) => [...e.impact].map((s) => s.split('\t')),
}

/**
 * ★5 fast-path: answer a pure closure query (cyclic/reaches/dead_code/tainted/
 * impact) straight from the semi-naive engine — where the 110–1238× lives. Only
 * an ALL-VARIABLE goal of a supported predicate is routed (e.g. `cyclic(N).`,
 * `reaches(A,B).`); a bound-argument or unsupported goal returns null so the
 * caller falls back to tau-prolog. Returns runQuery-shaped binding rows.
 */
export function queryEngine(facts, goal) {
  const m = String(goal).match(/^\s*([a-z]\w*)\(([^)]*)\)\s*\.?\s*$/)
  if (!m) return null
  const vars = m[2].split(',').map((s) => s.trim())
  if (!vars.every((v) => /^[A-Z_]\w*$/.test(v))) return null // only unbound-variable goals
  const gen = CLOSURE[`${m[1]}/${vars.length}`]
  if (!gen) return null
  return gen(evaluate(facts)).map((tuple) => Object.fromEntries(vars.map((v, i) => [v, tuple[i]])))
}
