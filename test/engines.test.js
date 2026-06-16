/**
 * Engine tests for the WASM-backed layers (tree-sitter, z3, FDRS bridge).
 * Requires `npm install` (web-tree-sitter, tree-sitter-wasms, z3-solver).
 * Run: node test/engines.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractProject, buildProgram } from '../src/pipeline.js'
import { checkContract, checkPolicy } from '../src/verify/smt-bridge.js'
import { lowerToFdrs } from '../src/integrations/fdrs-bridge.js'
import { checkRefinementsVerbose, checkRefinementFacts } from '../src/verify/refinement-check.js'
import { runQuery } from '../src/verify/prolog-engine.js'
import { explainAll } from '../src/verify/explain.js'
import { repairViolations, verifyPatch } from '../src/repair/loop.js'
import { scoreFaithfulness, equiv } from '../src/verify/faithfulness.js'
import { parseExpr, evalExpr } from '../src/verify/smt-dsl.js'
import { evaluate } from '../src/verify/datalog.js'
import { pointsTo } from '../src/verify/pointsto/andersen.js'
import { closureFromEdges, deleteEdge } from '../src/verify/closure-delta.js'
import { proveLoop } from '../src/verify/itp/prove.js'
import { loopVCs } from '../src/verify/itp/vcgen.js'
import { synthesizeInvariant, parseInvariantResponse } from '../src/verify/itp/synth.js'
import { extractLoopSpecs } from '../src/extract/loop/counter.js'
import fs from 'node:fs'

const ref = (routine, v, phi, kind) => ({ pred: 'refinement', args: [routine, v, phi, kind] })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = (p) => path.join(__dirname, '..', p)

test('tree-sitter: multi-language extraction (Python + Go)', async () => {
  const { facts } = await extractProject(root('examples/polyglot'), { lift: 'none' })
  const calls = facts.filter((f) => f.pred === 'calls')
  const langs = new Set(facts.filter((f) => f.pred === 'file').map((f) => f.args[1]))
  assert.ok(langs.has('python') && langs.has('go'), 'both languages extracted')
  assert.ok(calls.some((f) => f.args[0] === 'handle_request' && f.args[1] === 'authenticate'), 'python call edge')
  assert.ok(calls.some((f) => f.args[0] === 'HandleRequest' && f.args[1] === 'authenticate'), 'go call edge')
})

test('SMT: valid contract is proven entailed', async () => {
  const r = await checkContract({ vars: { x: 'int', y: 'int' }, pre: ['x > 0', 'y > 0'], post: ['x + y > 0'] })
  assert.equal(r.preSat, 'sat')
  assert.equal(r.entailed, true)
})

test('SMT: buggy contract yields a counterexample', async () => {
  const r = await checkContract({ vars: { x: 'int', r: 'int' }, pre: ['r == x'], post: ['r >= 0'] })
  assert.equal(r.entailed, false)
  assert.ok(r.counterexample.includes('x='))
})

test('SMT: RBAC separation-of-duty (no safe assignment, violation reachable)', async () => {
  const r = await checkPolicy(JSON.parse((await import('node:fs')).readFileSync(root('examples/policy/rbac-sod.json'), 'utf8')))
  assert.equal(r.safe, 'unsat')
  assert.equal(r.violationReachable, 'sat')
})

test('FDRS bridge: deep facts lower to six-pillar concept facts', async () => {
  const { facts } = await extractProject(root('examples/sample-project'), { lift: 'none' })
  const lines = lowerToFdrs(facts)
  assert.ok(lines.some((l) => l.includes('contains_sync_crypto_in_loop')), 'crypto-in-loop lowered')
  assert.ok(lines.some((l) => l.includes('uses_hardcoded_id')), 'hardcoded id lowered')
})

test('refinement ★2: multi-var precondition entails the return refinement', async () => {
  const facts = [
    ref('transfer', 'amount', 'amount > 0', 'pre'),
    ref('transfer', 'balance', 'balance >= amount', 'pre'),
    ref('transfer', 'balance', 'balance - amount >= 0', 'post'),
  ]
  const [r] = await checkRefinementsVerbose(facts)
  assert.equal(r.status, 'entailed')
})

test('refinement ★2: unprovable postcondition yields a counterexample', async () => {
  const facts = [ref('withdraw', 'amount', 'amount > 0', 'pre'), ref('withdraw', 'amount', 'amount > 100', 'post')]
  const [r] = await checkRefinementsVerbose(facts)
  assert.equal(r.status, 'broken')
  assert.ok(r.counterexample && r.counterexample.includes('amount='))
})

test('refinement ★2: contradictory preconditions are vacuous', async () => {
  const facts = [ref('badspec', 'x', 'x > 0', 'pre'), ref('badspec', 'x', 'x < 0', 'pre')]
  const [r] = await checkRefinementsVerbose(facts)
  assert.equal(r.status, 'vacuous')
})

test('refinement ★2: a post with no pre is unchecked, not broken (honest boundary)', async () => {
  const [r] = await checkRefinementsVerbose([ref('getCount', 'ret', 'ret >= 0', 'post')])
  assert.equal(r.status, 'unchecked')
})

test('refinement ★2: verdicts lower into Prolog facts for the rule layer', async () => {
  const facts = [ref('withdraw', 'amount', 'amount > 0', 'pre'), ref('withdraw', 'amount', 'amount > 100', 'post')]
  const out = await checkRefinementFacts(facts)
  assert.ok(out.some((f) => f.pred === 'refinement_broken' && f.args[0] === 'withdraw'), 'broken fact emitted')
})

// ===================== ★3 closed loop: triage / explain / repair =====================

test('★3 triage: Fastify reply.send(json) FP suppressed, real .innerHTML kept', async () => {
  const program = buildProgram(await extractProject(root('examples/repair'), { lift: 'none' }))
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const suppressed = await runQuery(program, 'suppressed_xss(N).')
  assert.equal(vios.length, 1, 'only the real DOM xss survives')
  assert.ok(String(vios[0].N).includes('sink_xss'), 'survivor is an xss sink')
  assert.equal(suppressed.length, 1, 'the reply.send(json) FP is suppressed by the content-type refinement')
})

test('★3 explain: derivation trace shows untrusted source → sink + content-type', async () => {
  const program = buildProgram(await extractProject(root('examples/repair'), { lift: 'none' }))
  const expls = await explainAll(program, { rule: 'taint-reaches-sink' })
  assert.equal(expls.length, 1)
  const e = expls[0]
  assert.equal(e.contentType, 'html', 'innerHTML sink classified html (not suppressed)')
  assert.ok(e.witnesses.source, 'a concrete untrusted source is named')
  assert.ok(e.because[0].startsWith('untrusted source'), 'proof tree starts at the source')
  assert.ok(e.because.some((b) => b.includes('xss sink')), 'proof tree reaches the sink')
})

test('★3 repair gate: an analyzer-visible fix is accepted, a cosmetic patch rejected', async () => {
  const file = root('examples/repair/handlers.js')
  // .innerHTML interprets markup; .textContent does not — a real fix the analyzer sees.
  const good = await verifyPatch(file, { find: '.innerHTML = bio', replace: '.textContent = bio' }, 'taint-reaches-sink')
  assert.equal(good.accepted, true, `expected accept, got: ${good.detail}`)
  // renaming the element id changes nothing about the taint flow → must be rejected.
  const noop = await verifyPatch(file, { find: "getElementById('bio')", replace: "getElementById('bio2')" }, 'taint-reaches-sink')
  assert.equal(noop.accepted, false, 'cosmetic patch must not be accepted')
})

test('★3 repair offline: honest boundary — needs-llm with a structured prompt, never a fabricated patch', async () => {
  const run = await repairViolations(root('examples/repair'))
  assert.ok(run.results.length >= 1)
  if (run.llm === 'offline') {
    assert.ok(run.results.every((r) => r.status === 'needs-llm'), 'no LLM ⇒ no fabricated patches')
    assert.ok(run.results.some((r) => (r.prompt || '').includes('STRICT JSON')), 'carries the repair prompt')
  } else {
    assert.ok(run.results.every((r) => ['applied', 'verified', 'rejected', 'false-positive', 'needs-llm'].includes(r.status)))
  }
})

// ===================== ★4 spec-faithfulness evaluation =====================

const ABS_SAMPLES = [
  { label: 'legal', point: { x: 5, ret: 5 } },
  { label: 'legal', point: { x: -7, ret: 7 } },
  { label: 'illegal', point: { x: 5, ret: -5 } },
  { label: 'illegal', point: { x: 5, ret: 4 } },
]

test('★4 evalExpr: concrete QF-LIA evaluation (arith, unary minus, implication)', () => {
  assert.equal(evalExpr(parseExpr('ret == x || ret == -x'), { x: -7, ret: 7 }), true)
  assert.equal(evalExpr(parseExpr('x >= 0 -> ret == x'), { x: -3, ret: 99 }), true) // vacuously true
  assert.equal(evalExpr(parseExpr('(a + b) * 2 > 10'), { a: 3, b: 4 }), true)
})

test('★4 faithfulness: a correct abs spec accepts legal + rejects illegal', () => {
  const r = scoreFaithfulness({ name: 'abs', post: ['ret >= 0', 'ret == x || ret == -x'] }, ABS_SAMPLES)
  assert.equal(r.faithful, true)
  assert.equal(r.recall, 1)
  assert.equal(r.specificity, 1)
})

test('★4 faithfulness: a vacuous post is flagged too-weak (accepts an illegal sample)', () => {
  const r = scoreFaithfulness({ post: ['ret >= 0'] }, ABS_SAMPLES)
  assert.equal(r.mode, 'too-weak')
  assert.ok(r.overAccepted.some((p) => p.x === 5 && p.ret === 4), 'abs(5)=4 wrongly accepted')
  assert.ok(r.specificity < 1)
})

test('★4 faithfulness: an over-constrained post is flagged too-strong (rejects a legal sample)', () => {
  const r = scoreFaithfulness({ post: ['ret >= 0', 'ret == x'] }, ABS_SAMPLES)
  assert.equal(r.mode, 'too-strong')
  assert.ok(r.overRejected.some((p) => p.x === -7), 'abs(-7)=7 wrongly rejected')
})

test('★4 round-trip: Z3 equivalence (equivalent ↔, else a counterexample)', async () => {
  const vars = { x: 'int', ret: 'int' }
  const eq = await equiv(vars, '(ret >= 0) && (ret == x || ret == -x)', '(ret >= 0) && (x >= 0 -> ret == x) && (x < 0 -> ret == -x)')
  assert.equal(eq.equivalent, true)
  const neq = await equiv(vars, 'ret == x', 'ret >= x')
  assert.equal(neq.equivalent, false)
  assert.ok(neq.counterexample, 'inequivalence yields a witness')
})

// ===================== ★6 interprocedural taint (tainted-return summary) =====================

test('★6 interprocedural taint: a tainted-return helper propagates across a call; a db-query wrapper does not', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-interproc'), { lift: 'none' }))
  const summaries = (await runQuery(program, 'taint_returns(F).')).map((r) => r.F).sort()
  assert.deepEqual(summaries, ['getName'], 'only getName returns untrusted data (rows() returns a query RESULT)')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  // show(): getName → name tainted → innerHTML fires (1). consume(): r is a db result → no FP.
  assert.equal(vios.length, 1, 'exactly the interprocedural true positive, no db-wrapper FP')
  assert.ok(String(vios[0].N).includes('sink_xss'))
})

test('★6 slice-2 taint-into-callee: html/sql wrappers flagged, json wrapper suppressed by content-type, receiver not flagged', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-paramsink'), { lift: 'none' }))
  // Summaries name the VALUE param (QId-keyed), never the receiver (el/reply/db at idx 0).
  const psinks = (await runQuery(program, 'param_sink(F, I, K, C).')).map((r) => `${r.F}/${r.I}/${r.K}/${r.C}`).sort()
  assert.deepEqual(psinks, ['handlers.js::render/1/xss/html', 'handlers.js::runSql/1/sql/na', 'handlers.js::sendJson/1/xss/json'])
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  // handleHtml → render(html-sink) and handleSql → runSql(sql-sink) are true positives;
  // handleJson → sendJson is a JSON wrapper (Ct=json), suppressed by the ★3 content-type guard.
  assert.equal(vios.length, 2, 'html-wrapper + sql-wrapper calls flagged; json-wrapper not')
  const subjects = vios.map((v) => String(v.N)).sort()
  assert.ok(subjects.some((s) => s.includes('psink_render')) && subjects.some((s) => s.includes('psink_runSql')))
  assert.ok(subjects.every((s) => !s.includes('sendJson')), 'the JSON wrapper is not a true positive')
  const suppressed = await runQuery(program, 'suppressed_xss(N).')
  assert.ok(suppressed.some((r) => String(r.N).includes('psink_sendJson')), 'json-wrapper flow is suppressed, not silently dropped')
})

test('★6 slice-3 cross-file taint: param-sink wrappers in another file are joined (incl. import alias); json wrapper stays suppressed', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-xfile'), { lift: 'none' }))
  // param_sink summaries are QId-keyed to the DEFINING file (wrappers.js), the
  // tainted args originate in handlers.js — a genuine cross-file join.
  const psinks = (await runQuery(program, 'param_sink(F, I, K, C).')).map((r) => `${r.F}/${r.I}/${r.K}/${r.C}`).sort()
  assert.deepEqual(psinks, ['wrappers.js::renderHtml/1/xss/html', 'wrappers.js::replyJson/1/xss/json'].sort())
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const subjects = vios.map((v) => String(v.N)).sort()
  // renderHtml (direct import) + paint (import ALIAS of renderHtml) are both true positives;
  // replyJson is a JSON wrapper (Ct=json), suppressed by the ★3 content-type guard.
  assert.equal(vios.length, 2, 'two cross-file html flows flagged (direct import + import alias)')
  assert.ok(subjects.some((s) => s.includes('xsink_renderHtml')), 'direct-import wrapper resolved')
  assert.ok(subjects.some((s) => s.includes('xsink_paint')), 'import-aliased wrapper resolved via import_binding')
  const suppressed = await runQuery(program, 'suppressed_xss(N).')
  assert.ok(suppressed.some((r) => String(r.N).includes('xsink_replyJson')), 'the cross-file json wrapper is suppressed, not flagged')
})

test('★6 slice-4 cross-file returns-taint: a tainted-RETURN conduit in another file taints the caller (incl. import alias); a db-result wrapper does not', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-retxfile'), { lift: 'none' }))
  // The conduit summary is QId-keyed to the DEFINING file (source.js::getName);
  // rows() returns a db RESULT, so it is NOT a conduit — the slice-1 precision
  // guard carried across the file boundary.
  const conduits = (await runQuery(program, 'taint_returns_q(Q).')).map((r) => r.Q).sort()
  assert.deepEqual(conduits, ['source.js::getName'], 'only getName is a cross-file conduit (rows returns a result)')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const subjects = vios.map((v) => String(v.N)).sort()
  // show() (direct import) + showAlias() (import ALIAS `grab`) consume getName's tainted
  // return → two true positives; safe() consumes rows() (non-conduit) → no false positive.
  assert.equal(vios.length, 2, 'two cross-file return-taint flows flagged (direct import + import alias)')
  assert.ok(subjects.includes('consumer.js:13:sink_xss'), 'direct-import conduit result reaches the sink')
  assert.ok(subjects.includes('consumer.js:27:sink_xss'), 'import-aliased conduit result reaches the sink (via import_binding)')
  assert.ok(!subjects.includes('consumer.js:20:sink_xss'), 'the db-result wrapper is not a conduit → no false positive')
})

test('★6 slice-5 cross-file 2-hop: a returns-taint conduit result passed to a cross-file param-sink composes; the JSON guard holds across both hops', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-2hop'), { lift: 'none' }))
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const subjects = vios.map((v) => String(v.N)).sort()
  // show(): getName (conduit, slice-4 sources it) → render (param-sink, slice-3 virtual sink) = TP.
  // send(): same chain into replyJson (Ct=json) → suppressed by the ★3 content-type guard, 2 hops deep.
  assert.equal(vios.length, 1, 'the html 2-hop chain is a true positive; the json 2-hop chain is suppressed')
  assert.ok(subjects.some((s) => s.includes('xsink_render')), 'returns→param-sink composes into a cross-file virtual sink')
  assert.ok(subjects.every((s) => !s.includes('replyJson')), 'the json wrapper is not a true positive')
  const suppressed = (await runQuery(program, 'suppressed_xss(N).')).map((r) => String(r.N))
  assert.ok(suppressed.some((s) => s.includes('xsink_replyJson')), 'the 2-hop json flow is suppressed, not silently dropped')
})

test('★6 slice-6 transitive conduit: `return callee(..)` makes a function a conduit iff callee is (A→B→C cross-file fixpoint)', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-transitive'), { lift: 'none' }))
  // getName (file C) is a direct conduit; fetchName (file B) `return getName(req)`
  // becomes one via the fixpoint; show (file A) consumes fetchName's result.
  const conduits = (await runQuery(program, 'taint_returns_q(Q).')).map((r) => r.Q).sort()
  assert.deepEqual(conduits, ['delegate.js::fetchName', 'source.js::getName'], 'the fixpoint surfaces the transitive conduit')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  assert.equal(vios.length, 1, 'the A→B→C transitive chain is a single true positive')
  assert.ok(String(vios[0].N).includes('consumer.js:10:sink_xss'), 'the sink two hops down the chain fires')
})

test('★6 slice-7 within-file transitive conduit: `return localConduit(..)` is a conduit too (same-file fixpoint)', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-localtransitive'), { lift: 'none' }))
  // getName is a direct conduit; fetchName `return getName(req)` becomes one via
  // the within-file fixpoint (same-file callee resolved by name), so a same-file
  // consumer is flagged — the case slice 6's cross-file return-join skips.
  const conduits = (await runQuery(program, 'taint_returns(F).')).map((r) => r.F).sort()
  assert.deepEqual(conduits, ['fetchName', 'getName'], 'the within-file fixpoint promotes the transitive delegate')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  assert.equal(vios.length, 1, 'the same-file 2-hop chain is a true positive')
  assert.ok(String(vios[0].N).includes('handlers.js:18:sink_xss'))
})

test('★6 slice-8 passthrough (return-of-tainted-arg): a param→return identity wrapper threads taint into a param-sink (within + cross-file); the JSON guard and a non-passthrough control hold', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-passthrough'), { lift: 'none' }))
  // Only `id` returns its formal unchanged → a passthrough. swallow (returns a
  // constant) and the param-sinks/handlers are NOT passthroughs (sound-leaning).
  const passthrough = (await runQuery(program, 'param_return(F, I).')).map((r) => `${r.F}/${r.I}`).sort()
  assert.deepEqual(passthrough, ['app.js::id/0'], 'only the identity wrapper is a passthrough')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const subjects = vios.map((v) => String(v.N)).sort()
  // render(el, id(name)) — cross-file param-sink (lib.js) reached through a local
  // passthrough; show(el, id(name)) — the same passthrough into a within-file
  // param-sink. render(el, swallow(name)) adds NO false positive.
  assert.equal(vios.length, 2, 'passthrough threads taint into both a cross-file and a within-file param-sink; swallow adds no FP')
  assert.ok(subjects.some((s) => s.includes('xsink_render')), 'cross-file passthrough→param-sink composes into a virtual sink')
  assert.ok(subjects.some((s) => s.includes('psink_show')), 'within-file passthrough→param-sink composes too')
  assert.ok(subjects.every((s) => !s.includes('swallow')), 'a non-passthrough (returns a constant) carries no taint')
  // replyJson(reply, id(data)) — passthrough into a JSON param-sink: the ★3
  // content-type guard holds THROUGH the passthrough (Ct=json ⇒ not an HTML sink).
  const suppressed = (await runQuery(program, 'suppressed_xss(N).')).map((r) => String(r.N))
  assert.ok(suppressed.some((s) => s.includes('xsink_replyJson')), 'the passthrough→json flow is suppressed, not flagged or silently dropped')
})

test('★6 slice-9 cross-file passthrough: an identity wrapper in ANOTHER file composes with a param-sink (cross-file + same-file outer); the JSON guard holds across files', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-passthrough-xfile'), { lift: 'none' }))
  // The passthrough is QId-keyed to its DEFINING file (util.js::id), the tainted
  // args originate in app.js, the param-sinks live in lib.js / app.js.
  const passthrough = (await runQuery(program, 'param_return(F, I).')).map((r) => `${r.F}/${r.I}`).sort()
  assert.deepEqual(passthrough, ['util.js::id/0'], 'the cross-file identity wrapper is the only passthrough')
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  const subjects = vios.map((v) => String(v.N)).sort()
  // handleHtml: id (util.js) → render (lib.js) = cross-file passthrough INTO a
  // cross-file param-sink. handleLocal: id (util.js) → show (local) = cross-file
  // passthrough into a SAME-FILE param-sink (the synthesized-taint_arg path the
  // extractor cannot reach). Both true positives.
  assert.equal(vios.length, 2, 'cross-file passthrough composes with both a cross-file and a same-file param-sink')
  assert.ok(subjects.some((s) => s.includes('xsink_render')), 'cross-file passthrough → cross-file param-sink')
  assert.ok(subjects.some((s) => s.includes('xsink_show')), 'cross-file passthrough → same-file param-sink (synthesized join)')
  // handleJson: id → replyJson (Ct=json) — the content-type guard holds across the
  // file boundary AND the passthrough.
  const suppressed = (await runQuery(program, 'suppressed_xss(N).')).map((r) => String(r.N))
  assert.ok(suppressed.some((s) => s.includes('xsink_replyJson')), 'the cross-file passthrough → json flow is suppressed, not flagged')
})

test('★5 semi-naive Datalog engine: bit-identical parity with tau-prolog (reaches/cyclic/dead_code/tainted/impact)', async () => {
  const canon = (rows, fn) => new Set(rows.map(fn))
  const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
  // sample-project exercises reaches+dead_code; taint-xfile exercises tainted+reaches.
  for (const target of ['examples/sample-project', 'examples/taint-xfile']) {
    const proj = await extractProject(root(target), { lift: 'none' })
    const program = buildProgram(proj)
    const eng = evaluate(proj.facts)
    const cases = [
      ['reaches', 'reaches(A,B).', (r) => `${r.A}\t${r.B}`, eng.reaches],
      ['cyclic', 'cyclic(N).', (r) => String(r.N), eng.cyclic],
      ['dead_code', 'dead_code(F,N).', (r) => `${r.F}\t${r.N}`, eng.deadCode],
      ['tainted', 'tainted(N).', (r) => String(r.N), eng.tainted],
      ['impact', 'impact(T,C).', (r) => `${r.T}\t${r.C}`, eng.impact],
    ]
    for (const [name, goal, fn, engSet] of cases) {
      const pl = canon(await runQuery(program, goal), fn)
      assert.ok(eqSet(pl, engSet), `${target} ${name}: engine result set (${engSet.size}) must equal tau-prolog (${pl.size})`)
    }
  }
})

test('★7 points-to: Andersen pts/resolvedCall engine — least-fixpoint correctness (dynamic dispatch + interproc arg flow)', () => {
  const f = (pred, ...args) => ({ pred, args })
  // Scenario: function realHandler(x){}; const fn = realHandler; fn(userData).
  // A dynamic dispatch (call through a variable) + interprocedural arg flow.
  // points-to is engine-ONLY: its pts↔assignEdge↔resolvedCall mutual recursion
  // loops tau-prolog's SLD (no tabling), so we assert the engine against the
  // hand-computed Andersen least fixpoint — the engine is cycle-safe by design.
  const facts = [
    f('alloc', 'realHandler', 'fn:realHandler'),
    f('isFunction', 'fn:realHandler'),
    f('assign', 'fn', 'realHandler'),
    f('calleeVar', 's1', 'fn'),
    f('argActual', 's1', '0', 'userData'),
    f('formalParam', 'fn:realHandler', '0', 'x'),
    f('alloc', 'userData', 'obj:data'),
  ]
  const { pts, resolved } = pointsTo(facts)
  const engPts = []
  for (const [v, os] of pts) for (const o of os) engPts.push(`${v}\t${o}`)
  // Hand-computed least fixpoint: fn aliases realHandler; the call resolves; the
  // actual userData flows to formal x across the resolved call.
  assert.deepEqual(engPts.sort(), ['fn\tfn:realHandler', 'realHandler\tfn:realHandler', 'userData\tobj:data', 'x\tobj:data'])
  assert.deepEqual([...resolved].sort(), ['s1\tfn:realHandler'])
  assert.ok(resolved.has('s1\tfn:realHandler'), 'fn() resolves to realHandler via points-to')
  assert.ok(pts.get('x')?.has('obj:data'), 'userData flowed to formal x interprocedurally')
})

test('★7 points-to: cycle-safe — an assign cycle terminates (where tau-prolog SLD would loop)', () => {
  const f = (pred, ...args) => ({ pred, args })
  // a = b; b = a; a = obj  — a cyclic assign graph. Andersen LFP: pts(a)=pts(b)={obj}.
  const { pts } = pointsTo([f('assign', 'a', 'b'), f('assign', 'b', 'a'), f('alloc', 'a', 'obj:o')])
  assert.deepEqual([...(pts.get('a') || [])], ['obj:o'])
  assert.deepEqual([...(pts.get('b') || [])], ['obj:o'], 'cycle propagates to fixpoint, no infinite loop')
})

test('★7 points-to: AST extraction resolves a var-aliased dynamic call end-to-end', async () => {
  const proj = await extractProject(root('examples/points-to'), { lift: 'none' })
  // The extractor emits alloc(fn,fn)/assign(h,realHandler)/calleeVar(dispatch,h);
  // the engine resolves h() — which the name-based linker cannot (h is a variable).
  const { pts, resolved } = pointsTo(proj.facts)
  assert.deepEqual([...(pts.get('h') || [])], ['realHandler'], 'h points to realHandler via the alias')
  assert.ok(resolved.has('dispatch\trealHandler'), 'the dynamic call h() resolves to realHandler')
})

test('★7 points-to link: --points-to lowers the resolved dynamic call into the call graph', async () => {
  // With --points-to the resolved call becomes a synthetic calls3 edge → the
  // linker QId-resolves it → reaches/dead_code see the dynamic-dispatch edge.
  const withPT = await extractProject(root('examples/points-to'), { lift: 'none', pointsToEnabled: true })
  const withoutPT = await extractProject(root('examples/points-to'), { lift: 'none' })
  assert.ok(evaluate(withPT.facts).reaches.has('dispatch\trealHandler'), 'points-to lowers dispatch→realHandler into reaches')
  assert.ok(!evaluate(withoutPT.facts).reaches.has('dispatch\trealHandler'), 'the name-based linker alone cannot resolve the var-call (parity: off = unchanged)')
})

test('★7 points-to interproc arg flow: a callback passed through a dynamic dispatch is resolved (argActual/formalParam, second-order)', async () => {
  const withPT = await extractProject(root('examples/points-to-arg'), { lift: 'none', pointsToEnabled: true })
  const withoutPT = await extractProject(root('examples/points-to-arg'), { lift: 'none' })
  // run: `fn = invoke; fn(target)`. The extractor emits argActual(run,0,target) +
  // formalParam(invoke,0,cb); the engine flows target→cb across the resolved
  // var-call, then resolves cb()→target — a callback handed through a dispatch.
  const { pts, resolved } = pointsTo(withPT.facts)
  assert.ok(pts.get('cb')?.has('target'), "the actual `target` flows to invoke's formal `cb` interprocedurally")
  assert.ok(resolved.has('invoke\ttarget'), 'cb() resolves to target after the interprocedural arg flow (second-order)')
  // Lowered into the call graph: run→invoke→target→done all become reachable.
  assert.ok(evaluate(withPT.facts).reaches.has('invoke\ttarget'), 'the callback dispatch lowers into reaches')
  assert.ok(evaluate(withPT.facts).reaches.has('run\tdone'), 'the full chain run→invoke→target→done resolves through the dispatch')
  assert.ok(!evaluate(withoutPT.facts).reaches.has('invoke\ttarget'), 'the name-based linker alone cannot (parity: off = unchanged)')
})

test('★7 points-to higher-order builtin: a bare-name callback passed to .map/.forEach is resolved into the call graph', async () => {
  const withPT = await extractProject(root('examples/points-to-hof'), { lift: 'none', pointsToEnabled: true })
  const withoutPT = await extractProject(root('examples/points-to-hof'), { lift: 'none' })
  // `users.map(formatUser)` / `users.forEach(logIt)` — the callbacks are invoked by
  // the builtin, never called by their own name; the name-based linker sees `.map(`.
  // points-to emits calleeVar(run, formatUser/logIt) → resolves them into reaches.
  assert.ok(evaluate(withPT.facts).reaches.has('run\tformatUser'), 'the .map callback is resolved into the call graph')
  assert.ok(evaluate(withPT.facts).reaches.has('run\tlogIt'), 'the .forEach callback is resolved into the call graph')
  assert.ok(!evaluate(withoutPT.facts).reaches.has('run\tformatUser'), 'the name-based linker alone cannot (parity: off = unchanged)')
})

test('★7 points-to field-sensitive: an object-literal dispatch table indexed by a computed key resolves to all its handlers', async () => {
  const withPT = await extractProject(root('examples/points-to-fields'), { lift: 'none', pointsToEnabled: true })
  const withoutPT = await extractProject(root('examples/points-to-fields'), { lift: 'none' })
  // const handlers = { create: createHandler, delete: deleteHandler }; handlers[k]()
  // — a computed dispatch the name-based linker can't connect. Field-sensitivity
  // stores each fn at its field and resolves the [k] call to ALL of them.
  const r = evaluate(withPT.facts).reaches
  assert.ok(r.has('dispatch\tcreateHandler') && r.has('dispatch\tdeleteHandler'), 'both dispatch-table handlers resolved into the call graph')
  assert.ok(r.has('direct\trunOp'), 'a non-computed member call `ops.run()` on an object-literal var resolves too')
  assert.ok(!evaluate(withoutPT.facts).reaches.has('dispatch\tcreateHandler'), 'the name-based linker alone cannot resolve the computed dispatch (parity: off = unchanged)')
})

test('stage-1 framework model: Fastify route handlers become reachable from the registration entry (--framework)', async () => {
  const on = buildProgram(await extractProject(root('examples/framework-fastify'), { lift: 'none', frameworkEnabled: true }))
  const off = buildProgram(await extractProject(root('examples/framework-fastify'), { lift: 'none' }))
  // app.get('/items', async(req)=>dbWrite(..)) + app.post('/items', {..}, namedHandler).
  // Handlers are invoked by the framework; without a model dbWrite/audit aren't
  // reachable from registerRoutes. --framework emits calls3(registerRoutes→handler).
  const httpEntry = (await runQuery(on, 'http_entry(H).')).map((r) => String(r.H)).sort()
  assert.equal(httpEntry.length, 2, 'both route handlers (inline + named) are HTTP entries')
  assert.ok(httpEntry.includes('namedHandler'), 'the named handler is marked an HTTP entry')
  assert.equal((await runQuery(on, "reaches('registerRoutes', 'dbWrite').")).length, 1, 'with --framework the inline handler reaches dbWrite from the registration entry')
  assert.equal((await runQuery(off, "reaches('registerRoutes', 'dbWrite').")).length, 0, 'without --framework the handler is unreachable (parity: off = unchanged)')
  assert.equal((await runQuery(on, "reaches('registerRoutes', 'audit').")).length, 1, 'the named handler reaches audit too')
})

test('刀2 framework hooks + req entry source: preHandler hooks reachable + bare req flows into sql sinks (--framework)', async () => {
  const on = buildProgram(await extractProject(root('examples/framework-hooks'), { lift: 'none', frameworkEnabled: true }))
  const off = buildProgram(await extractProject(root('examples/framework-hooks'), { lift: 'none' }))
  // Hook chains: a preHandler (auth/rebac) is framework-invoked before the handler,
  // so the model makes it reachable from the handler and a call-graph entry — its
  // body (the security core) now enters the analyzed graph. Both opts forms work:
  // an array `{ preHandler: [requireAuth, rebacCheck] }` and a single fn `requireAuth`.
  assert.equal((await runQuery(on, "reaches('listHandler', 'requireAuth').")).length, 1, 'array-form preHandler reachable from its handler')
  assert.equal((await runQuery(on, "reaches('listHandler', 'rebacCheck').")).length, 1, 'the second array-form preHandler is reachable too')
  assert.equal((await runQuery(on, "reaches('sendHandler', 'requireAuth').")).length, 1, 'single-fn-form preHandler reachable from its handler')
  assert.ok((await runQuery(on, "entry('requireAuth').")).length >= 1, 'the hook is a call-graph entry (not dead)')
  assert.equal((await runQuery(off, "reaches('listHandler', 'requireAuth').")).length, 0, 'parity: without --framework there is no handler→hook edge')
  // req entry source: the handler's bare `req` reaches both sql param-sinks (local
  // writeDb + cross-file externalSink) ONLY when the model sources it — req is the
  // whole untrusted request object, a flow the body-level req.query/body patterns miss.
  const von = await runQuery(on, "violation(N, 'taint-reaches-sink').")
  const voff = await runQuery(off, "violation(N, 'taint-reaches-sink').")
  assert.equal(von.length, 2, 'with --framework: bare req reaches writeDb (local) + externalSink (cross-file)')
  assert.equal(voff.length, 0, 'parity: without --framework req is not a source ⇒ no taint violations')
})

// ===================== ★8 ITP B-tier: self-built VCgen + built-in z3 =====================

test('★8 ITP B-tier: a sound loop invariant discharges all 3 VCs via the built-in z3 (no external prover)', async () => {
  const spec = JSON.parse(fs.readFileSync(root('examples/itp/sum-bound.loop.json'), 'utf8'))
  // VCgen is a pure construction: ① pre⇒inv, ② the inductive step, ③ inv∧¬guard⇒post.
  const vcs = loopVCs(spec)
  assert.deepEqual(vcs.map((v) => v.kind), ['init', 'step', 'exit'])
  assert.equal(vcs[1].check, 'inductive', 'the step VC is the transition-relation (primed next-state) check')
  assert.ok(vcs[2].spec.pre.includes('!(i < n)'), 'the exit VC assumes the negated loop guard')
  // Discharge: the coupling invariant sum==i proves the functional postcondition sum==n.
  const r = await proveLoop(spec)
  assert.equal(r.proved, true, 'all three verification conditions discharged by z3 — a machine-checked loop proof')
  assert.ok(r.vcs.every((v) => v.discharged && !v.vacuous), 'init/step/exit all entailed, none vacuous')
})

test('★8 ITP B-tier: a non-inductive invariant fails the STEP VC with a concrete counterexample (generate-and-check)', async () => {
  const spec = JSON.parse(fs.readFileSync(root('examples/itp/noninductive.loop.json'), 'utf8'))
  const r = await proveLoop(spec)
  assert.equal(r.proved, false, 'a bad invariant is never reported proved')
  const init = r.vcs.find((v) => v.kind === 'init')
  const step = r.vcs.find((v) => v.kind === 'step')
  // The invariant IS true on entry — the bug is preservation, not initiation. z3
  // returns a pre-state (e.g. i=0, sum=0) where one iteration breaks `sum <= i`.
  assert.equal(init.discharged, true, 'the invariant holds on loop entry')
  assert.equal(step.discharged, false, 'the induction step is refuted by z3')
  assert.ok(step.counterexample && /\bsum=/.test(step.counterexample), 'the counterexample names the breaking pre-state')
})

test('★8 ITP autoformalization: invariant synthesis is honest offline (needs-llm) and z3-gated when online', async () => {
  const spec = JSON.parse(fs.readFileSync(root('examples/itp/sum-bound.synth.json'), 'utf8'))
  assert.equal(spec.invariant, undefined, 'the synthesis fixture omits the invariant on purpose')
  const r = await synthesizeInvariant(spec)
  if (r.status === 'needs-llm') {
    // No LLM ⇒ no invented invariant, but a structured prompt carrying the obligation.
    assert.ok(r.prompt.includes(spec.guard) && /STRICT JSON/.test(r.prompt), 'the prompt carries the loop spec + the output contract')
  } else {
    // LLM present ⇒ the verdict is z3-gated: a `proved` must really discharge all 3 VCs.
    assert.ok(['proved', 'unproven'].includes(r.status))
    if (r.status === 'proved') assert.equal((await proveLoop({ ...spec, invariant: r.invariant })).proved, true, 'a synthesized invariant claimed proved must really pass all 3 VCs')
  }
})

test('★8 ITP autoformalization: generate-and-check — a parsed candidate is accepted iff z3 discharges it (LLM proposes, z3 disposes)', async () => {
  const spec = JSON.parse(fs.readFileSync(root('examples/itp/sum-bound.synth.json'), 'utf8'))
  // The "LLM proposes" half: tolerate noise around the STRICT-JSON object.
  const good = parseInvariantResponse('here you go {"invariant": ["0 <= i", "i <= n", "sum == i"]} done')
  assert.deepEqual(good, ['0 <= i', 'i <= n', 'sum == i'])
  assert.equal(parseInvariantResponse('no json here'), null, 'a non-JSON reply yields no candidate')
  // The "z3 disposes" half: the correct invariant discharges; a non-inductive one is refuted.
  assert.equal((await proveLoop({ ...spec, invariant: good })).proved, true, 'the correct invariant proves the loop')
  assert.equal((await proveLoop({ ...spec, invariant: ['sum <= i'] })).proved, false, 'a non-inductive candidate is rejected by z3')
})

test('★8 ITP loop-lift: sound extraction of counting loops from code + iterator bound-safety (safe proved, overshoot refuted, unsound-to-model skipped)', async () => {
  const code = fs.readFileSync(root('examples/itp/loops.js'), 'utf8')
  const specs = extractLoopSpecs('loops.js', code)
  // Lifted: sumTo (i<n), offByOne (i<=n), sumArr (i<arr.length), readPastEnd (i<=arr.length).
  // Skipped: tricky (reassigns counter), withBreak (early exit), growing (arr.push mutates
  // the bound's base) — never modeled, never guessed.
  assert.equal(specs.length, 4, 'four soundly-modelable counting loops are lifted; the three unsound ones are skipped')
  const byGuard = (g) => specs.find((s) => s.guard === g)
  // plain-identifier bound: the auto-invariant 0<=i<=n discharges OFFLINE (no LLM).
  assert.equal((await proveLoop(byGuard('i < n'))).proved, true, 'bound-safety PROVED for the step-1 `< n` loop')
  const rN = await proveLoop(byGuard('i <= n'))
  assert.equal(rN.proved, false, 'the off-by-one `<= n` loop is flagged')
  assert.ok(rN.vcs.find((v) => v.kind === 'step' && !v.discharged && v.counterexample), 'z3 returns the overshoot counterexample')
  // array-length bound: for(i=0;i<arr.length;i++) — every arr[i] read is in bounds.
  assert.equal((await proveLoop(byGuard('i < arr_length'))).proved, true, 'iteration to arr.length is bound-safe (arr[i] in bounds)')
  // off-by-one on a length: i <= arr.length reads arr[arr.length] — a real OOB, refuted.
  assert.equal((await proveLoop(byGuard('i <= arr_length'))).proved, false, 'i <= arr.length is a real out-of-bounds → not proved')
})

test('★8 ITP per-access OOB: counter-indexed reads proved in-bounds; unguarded overshoot flagged; guarded (Merkle pattern) + step-2 proved safe', async () => {
  const { extractAccessObligations } = await import('../src/extract/loop/oob.js')
  const code = fs.readFileSync(root('examples/itp/access.js'), 'utf8')
  const obs = extractAccessObligations('access.js', code)
  const verdict = (o) => checkContract({ vars: o.vars, pre: o.pre, post: o.post })
  // every arr[i] (index == the counter) is in bounds under its guard — including the step-2 loop.
  const arrI = obs.filter((o) => o.idxDsl === 'i')
  assert.ok(arrI.length >= 3, 'arr[i] accesses across all three loops are collected (incl. the step-2 loop)')
  for (const o of arrI) assert.equal((await verdict(o)).entailed, true, `${o.name} proved in bounds`)
  // arr[i+1]: the UNGUARDED read is possible-OOB; the ternary-GUARDED one (Merkle) is safe.
  const next = obs.filter((o) => o.idxDsl === '(i + 1)')
  assert.equal(next.length, 2, 'both arr[i+1] reads collected (unguarded + guarded)')
  const guarded = next.find((o) => o.pre.some((p) => p.includes('(i + 1) < arr_length')))
  const unguarded = next.find((o) => !o.pre.some((p) => p.includes('(i + 1) < arr_length')))
  assert.ok(guarded && unguarded && guarded.fullyModeled && unguarded.fullyModeled, 'both fully modeled (sound OOB verdict allowed)')
  assert.equal((await verdict(guarded)).entailed, true, 'guarded arr[i+1] (i+1<len ? …) proved safe via the path condition')
  const u = await verdict(unguarded)
  assert.equal(u.entailed, false, 'unguarded arr[i+1] is a possible out-of-bounds')
  assert.ok(u.counterexample, 'z3 returns the OOB witness')
})

test('★8 affine bounds + escape tolerance: arr.length-1 proves arr[i+1]; escape loops are prove-only (no false OOB)', async () => {
  const { extractAccessObligations } = await import('../src/extract/loop/oob.js')
  const code = fs.readFileSync(root('examples/itp/affine.js'), 'utf8')
  const verdict = (o) => checkContract({ vars: o.vars, pre: o.pre, post: o.post })

  // Iterator-bound: only the escape-FREE affine loop (pairSums, `i < arr.length - 1`) is
  // lifted; the two escape loops (early return / break) are skipped, as for any escape loop.
  const specs = extractLoopSpecs('affine.js', code)
  assert.equal(specs.length, 1, 'only the no-escape affine loop gets an iterator-bound spec')
  assert.equal(specs[0].guard, 'i < arr_length - 1', 'the affine bound is lifted verbatim into the spec')
  assert.equal((await proveLoop(specs[0])).proved, true, 'the iterator stays within arr.length - 1 (affine bound proved)')

  const obs = extractAccessObligations('affine.js', code)
  // Every arr[i] is in bounds — including indexOf's, whose loop has an early `return`
  // (escape-tolerant PROVE: proving safe never needs the escape).
  const arrI = obs.filter((o) => o.idxDsl === 'i')
  assert.ok(arrI.length >= 2, 'arr[i] from pairSums and the early-return loop are both collected')
  for (const o of arrI) assert.equal((await verdict(o)).entailed, true, `${o.name} proved in bounds`)

  // arr[i+1] appears twice: pairSums (affine-safe, fullyModeled) and guardedByBreak
  // (safe only via the break we don't model → must be prove-only, never flagged).
  const next = obs.filter((o) => o.idxDsl === '(i + 1)')
  assert.equal(next.length, 2, 'both arr[i+1] reads collected (affine-safe + break-guarded)')
  const affineSafe = next.find((o) => o.fullyModeled)
  const escapeOnly = next.find((o) => !o.fullyModeled)
  assert.ok(affineSafe && escapeOnly, 'one is fully-modeled (pairSums), one is escape-only (guardedByBreak)')
  assert.equal((await verdict(affineSafe)).entailed, true, 'arr[i+1] proved safe directly by the affine arr.length-1 bound')
  // The soundness gate: the break-guarded access is NOT provable from the bound alone,
  // and because its loop has an escape it is reported "not analyzed" (fullyModeled=false),
  // NEVER flagged as OOB — the break could be exactly what keeps it safe (误报 0).
  assert.equal((await verdict(escapeOnly)).entailed, false, 'break-guarded arr[i+1] is not provable from the bound alone')
  assert.equal(escapeOnly.fullyModeled, false, 'an escape-loop access is prove-only → not-analyzed, never a false positive')
})

test('★8 member-of-member bounds: this.X.length-1 proves this.X[i]/[i+1]; plain-bound overshoot flagged; base-mutating loop skipped', async () => {
  const { extractAccessObligations } = await import('../src/extract/loop/oob.js')
  const code = fs.readFileSync(root('examples/itp/member-bound.js'), 'utf8')
  const verdict = (o) => checkContract({ vars: o.vars, pre: o.pre, post: o.post })

  // The bound/access base is the member chain `this.rows` — normalized to the stable key
  // `this_rows`, so the affine bound and its accesses line up exactly as a bare identifier
  // would (the merkle-tree.js getProof shape). pairs()/shiftBad() lift; grow() is skipped.
  const specs = extractLoopSpecs('member-bound.js', code)
  const affineSpec = specs.find((s) => s.guard === 'i < this_rows_length - 1')
  assert.ok(affineSpec, 'the member-of-member affine bound `this.rows.length - 1` normalizes into an iterator-bound spec')
  assert.equal((await proveLoop(affineSpec)).proved, true, 'the iterator stays within this.rows.length - 1')

  const obs = extractAccessObligations('member-bound.js', code)
  assert.ok(obs.length >= 3, 'this.rows[i] + this.rows[i+1] (pairs) and this.rows[i+1] (shiftBad) collected; grow() yields none (skipped)')
  assert.ok(obs.every((o) => o.arr === 'this_rows'), 'every member-of-member access is keyed to the stable base `this_rows`')

  // this.rows[Number(i)] (pairs) — Number() modeled as identity on the counter; proved in bounds.
  const idxI = obs.filter((o) => o.idxDsl === 'i')
  assert.ok(idxI.length >= 1, 'this.rows[Number(i)] is collected (Number() is the identity on the integer counter)')
  for (const o of idxI) assert.equal((await verdict(o)).entailed, true, `${o.name} (this.rows[i]) proved in bounds`)

  // this.rows[i+1] appears twice: pairs (affine `length-1` → safe) and shiftBad (plain
  // `length` → real overshoot). Both are fully-modeled (neither loop escapes), so they are
  // told apart by the PROOF itself — the affine one entails, the plain one is flagged + witness.
  const next = obs.filter((o) => o.idxDsl === '(i + 1)')
  assert.equal(next.length, 2, 'both this.rows[i+1] reads collected (affine-safe + plain-bound overshoot)')
  const verdicts = await Promise.all(next.map(async (o) => ({ o, r: await verdict(o) })))
  const safe = verdicts.find((v) => v.r.entailed)
  const oob = verdicts.find((v) => !v.r.entailed)
  assert.ok(safe, 'this.rows[i+1] proved safe directly by the affine this.rows.length - 1 bound')
  assert.ok(oob && oob.o.fullyModeled, 'this.rows[i+1] under the plain this.rows.length bound is a fully-modeled possible-OOB (real finding, flagged — not a false positive)')
  assert.ok(oob.r.counterexample, 'z3 returns the OOB witness (i = this.rows.length - 1) for the plain-bound overshoot')
})

test('★8 ITP C-tier self-built induction kernel: ∀n.P(f(n)) discharged by z3 base+step (no external prover); false/non-inductive claims rejected', async () => {
  const { proveByInduction } = await import('../src/verify/itp/induction.js')
  // sum(0)=0, sum(n+1)=sum(n)+(n+1) — a recursive function z3 treats as uninterpreted.
  const sum = { name: 'sum', n: 'n', fn: 's', f0: '0', step: '(s + (n + 1))' }

  // TRUE — ∀n≥0. sum(n) >= n, provable ONLY by induction (z3 alone can't reason about the
  // recursive sum). base 0>=0 ✓; step: s>=n ∧ n>=0 ⊢ s+(n+1) >= n+1 (i.e. s>=0) ✓.
  const ok = await proveByInduction({ ...sum, property: 's >= n' })
  assert.equal(ok.proved, true, 'sum(n) >= n proved by the induction rule')
  assert.ok(ok.base.ok && ok.step.ok && !ok.vacuous, 'both base and step discharged by z3, non-vacuous')

  // FALSE at the base — sum(n) > n is false at n=0 (sum(0)=0). The kernel must REJECT it
  // (it never asserts ∀ without z3 proving P(0)); z3 returns the base counterexample.
  const fb = await proveByInduction({ ...sum, property: 's > n' })
  assert.equal(fb.proved, false, 'sum(n) > n is NOT proved (base fails)')
  assert.equal(fb.base.ok, false, 'base P(0): 0 > 0 refuted by z3')
  assert.ok(fb.base.counterexample, 'z3 gives the base counterexample')

  // NON-INDUCTIVE — sum(n) <= n holds at 0 but the inductive step breaks (sum grows faster).
  // base ✓ but step ✗ → REJECTED: the kernel only certifies ∀ when BOTH lemmas hold.
  const ni = await proveByInduction({ ...sum, property: 's <= n' })
  assert.equal(ni.proved, false, 'sum(n) <= n is NOT proved (step fails)')
  assert.equal(ni.base.ok, true, 'base 0 <= 0 holds')
  assert.equal(ni.step.ok, false, 'step P(n) ⇒ P(n+1) refuted by z3 — no false ∀ escapes')
})

test('Phase 2: markdown extractor lifts documentation into facts', async () => {
  const { extractMarkdown } = await import('../src/extract/markdown.js')
  const code = fs.readFileSync(root('examples/markdown/doc.md'), 'utf8')
  const r = extractMarkdown('doc.md', code)
  assert.equal(r.method, 'markdown-regex')
  assert.ok(r.facts.length >= 20, 'rich doc should produce 20+ facts')
  assert.ok(r.facts.some(f => f.pred === 'heading' && f.args.length >= 4), 'headings extracted')
  assert.ok(r.facts.some(f => f.pred === 'link' && f.args[1] === 'src/pipeline.js'), 'inline link [text](url) extracted')
  assert.ok(r.facts.some(f => f.pred === 'code_block' && f.args[1] === 'js'), 'fenced ```js block extracted')
  assert.ok(r.facts.some(f => f.pred === 'code_defines'), 'JS function defined inside doc code block → code_defines')
  assert.ok(r.facts.some(f => f.pred === 'todo' && f.args[1] === 'TODO'), 'TODO marker extracted')
  assert.ok(r.facts.some(f => f.pred === 'frontmatter' && f.args[1] === 'title'), 'YAML frontmatter extracted')
  assert.ok(r.facts.some(f => f.pred === 'doc_ref' && f.args[1] === '技术路线图'), '[[wiki-link]] extracted')
  assert.ok(r.facts.some(f => f.pred === 'link' && f.args[1] === 'https://github.com/kedimomo/formal-atlas'), 'auto-link <url> extracted')
})

test('★8 recurrence auto-extraction from source code: lifts depth/bases/step mechanically', async () => {
  const { extractRecurrence } = await import('../src/extract/loop/recurrence.js')
  // fib: depth-2, two self-calls
  const fib = extractRecurrence('function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); }', 'fib')
  assert.ok(fib, 'fib recurrence extracted')
  assert.equal(fib.depth, 2, 'two self-calls → depth 2')
  assert.ok(fib.step.includes('fib_1') && fib.step.includes('fib_2'), 'step normalised to fib_1 + fib_2')
  // sum: depth-1, explicit base
  const sum = extractRecurrence('function sum(n) { if (n == 0) return 0; return n + sum(n-1); }', 'sum')
  assert.ok(sum, 'sum recurrence extracted')
  assert.equal(sum.depth, 1, 'one self-call → depth 1')
  assert.equal(sum.bases[0], '0', 'explicit base case n==0 → 0')
  // non-recursive: null
  const nr = extractRecurrence('function add(a,b) { return a + b; }', 'add')
  assert.equal(nr, null, 'non-recursive function → null')
})

test('★8 ITP C-tier strong induction (depth-d recurrence, e.g. Fibonacci): IH at the d used points + d base cases, all z3-discharged; false claim rejected', async () => {
  const { proveByStrongInduction } = await import('../src/verify/itp/strong-induction.js')
  // fib(0)=0, fib(1)=1, fib(n)=fib(n-1)+fib(n-2) — needs P(n-1) AND P(n-2), so weak induction can't.
  const fib = { name: 'fib', n: 'n', fn: 'f', depth: 2, bases: ['0', '1'], step: '(f_1 + f_2)' }

  // TRUE — ∀n≥0. fib(n) >= 0 by strong induction: bases 0>=0, 1>=0; step f_1>=0 ∧ f_2>=0 ⇒ f_1+f_2>=0.
  const ok = await proveByStrongInduction({ ...fib, property: 'f >= 0' })
  assert.equal(ok.proved, true, 'fib(n) >= 0 proved by depth-2 strong induction')
  assert.ok(ok.bases.every((b) => b.ok) && ok.step.ok && !ok.vacuous, 'both base cases and the step discharged by z3')
  assert.equal(ok.bases.length, 2, 'depth-2 ⇒ exactly two base cases (n=0, n=1)')

  // FALSE — ∀n≥0. fib(n) >= n is false (fib(2)=1 < 2). The step is not entailed → REJECTED with a witness.
  const bad = await proveByStrongInduction({ ...fib, property: 'f >= n' })
  assert.equal(bad.proved, false, 'fib(n) >= n is NOT proved')
  assert.equal(bad.step.ok, false, 'z3 refutes the strong-induction step — no false ∀ escapes')
})

test('★8 ITP C-tier termination (ranking function): measure ≥0 + strictly-decreasing proves termination; wrong measure / infinite loop rejected', async () => {
  const { proveTermination } = await import('../src/verify/itp/termination.js')
  const countUp = { vars: { i: 'int', n: 'int' }, guard: 'i < n', body: [{ var: 'i', expr: '(i + 1)' }] }

  // TERMINATES — (n - i) is >= 0 under i<n and drops by 1 each iteration (well-founded descent).
  const ok = await proveTermination({ ...countUp, name: 'count-up', measure: '(n - i)' })
  assert.equal(ok.terminates, true, 'count-up terminates via ranking function n - i')
  assert.ok(ok.bound.ok && ok.decreasing.ok && !ok.vacuous, 'both bound and strict-decrease discharged by z3')

  // WRONG MEASURE — (n + i) does not decrease; the kernel must REJECT (no termination without descent).
  const wrong = await proveTermination({ ...countUp, name: 'count-up-bad', measure: '(n + i)' })
  assert.equal(wrong.terminates, false, 'a non-decreasing measure is rejected')
  assert.equal(wrong.decreasing.ok, false, 'z3 refutes the strict-decrease lemma for n + i')

  // INFINITE LOOP — i := i+1 under i>=0 never stops; no measure we give can decrease, so it is REJECTED.
  const inf = await proveTermination({ vars: { i: 'int' }, guard: 'i >= 0', body: [{ var: 'i', expr: '(i + 1)' }], name: 'forever', measure: 'i' })
  assert.equal(inf.terminates, false, 'an infinite loop cannot be proved terminating')
  assert.equal(inf.decreasing.ok, false, 'i increases → strict-decrease refuted by z3 (no false termination)')
})

test('★5 incremental closure (ReBAC ClosureService port): add-edge maintenance == full recompute', () => {
  // A graph WITH a cycle (a→b→c→a) plus c→d and x→a — stresses ancestors×descendants.
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd'], ['x', 'a']]
  const { reach } = closureFromEdges(edges) // incremental, edge by edge
  // Reference: brute-force full transitive closure (per-node BFS).
  const succ = new Map()
  for (const [u, v] of edges) { if (!succ.has(u)) succ.set(u, new Set()); succ.get(u).add(v) }
  const full = new Map()
  for (const u of new Set(edges.flat())) {
    const seen = new Set()
    let fr = [...(succ.get(u) || [])]
    for (const x of fr) seen.add(x)
    while (fr.length) { const nx = []; for (const n of fr) for (const m of (succ.get(n) || [])) if (!seen.has(m)) { seen.add(m); nx.push(m) } fr = nx }
    if (seen.size) full.set(u, seen)
  }
  const canon = (m) => { const s = new Set(); for (const [a, r] of m) for (const b of r) s.add(`${a}\t${b}`); return s }
  const ci = canon(reach); const cf = canon(full)
  assert.equal(ci.size, cf.size, `incremental ${ci.size} vs full ${cf.size}`)
  assert.ok([...cf].every((x) => ci.has(x)), 'incremental closure equals full recompute (cycle included)')
  // sanity: each cycle node reaches all of {a,b,c,d} (incl. itself via the cycle)
  for (const n of ['a', 'b', 'c']) for (const t of ['a', 'b', 'c', 'd']) assert.ok(reach.get(n)?.has(t), `${n}→${t}`)
})

test('★5 incremental closure DELETE (DRed): remove-edge maintenance == full recompute (cycle break + re-derivation)', () => {
  const fullClosure = (es) => {
    const succ = new Map()
    for (const [u, v] of es) { if (!succ.has(u)) succ.set(u, new Set()); succ.get(u).add(v) }
    const m = new Map()
    for (const u of new Set(es.flat())) {
      const seen = new Set(); const fr = [...(succ.get(u) || [])]
      for (const x of fr) seen.add(x)
      while (fr.length) { const n = fr.pop(); for (const w of (succ.get(n) || [])) if (!seen.has(w)) { seen.add(w); fr.push(w) } }
      if (seen.size) m.set(u, seen)
    }
    return m
  }
  const canon = (m) => { const s = new Set(); for (const [a, r] of m) for (const b of r) s.add(`${a}\t${b}`); return s }
  // a→b→c→a cycle + c→d + x→a + b→e. Build incrementally, then delete the back-edge c→a.
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd'], ['x', 'a'], ['b', 'e']]
  const { reach, succ } = closureFromEdges(edges)
  deleteEdge(reach, succ, 'c', 'a') // breaks the cycle; a/b/c lose self-reach, x still reaches all
  const ref = canon(fullClosure(edges.filter(([u, v]) => !(u === 'c' && v === 'a'))))
  const got = canon(reach)
  assert.equal(got.size, ref.size, `delta ${got.size} vs full ${ref.size}`)
  assert.ok([...ref].every((x) => got.has(x)), 'DRed delete equals full recompute (cycle broken, alternate paths re-derived)')
  assert.ok(!reach.get('a')?.has('a'), 'cycle broken: a no longer reaches itself')
  assert.ok(!reach.get('c')?.has('a'), 'the removed edge target is gone from c')
  for (const t of ['a', 'b', 'c', 'd', 'e']) assert.ok(reach.get('x')?.has(t), `x still reaches ${t}`)
  const before = canon(reach).size
  deleteEdge(reach, succ, 'd', 'a') // absent edge
  assert.equal(canon(reach).size, before, 'deleting a non-existent edge is a no-op')
})
