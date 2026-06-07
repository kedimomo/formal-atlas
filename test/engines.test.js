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

test('★6 slice-3 cross-file taint: a param-sink wrapper in another file is joined; the json wrapper stays suppressed', async () => {
  const program = buildProgram(await extractProject(root('examples/taint-xfile'), { lift: 'none' }))
  // param_sink summaries are QId-keyed to the DEFINING file (wrappers.js), the
  // tainted args originate in handlers.js — a genuine cross-file join.
  const psinks = (await runQuery(program, 'param_sink(F, I, K, C).')).map((r) => `${r.F}/${r.I}/${r.K}/${r.C}`).sort()
  assert.deepEqual(psinks, ['wrappers.js::renderHtml/1/xss/html', 'wrappers.js::replyJson/1/xss/json'].sort())
  const vios = await runQuery(program, "violation(N, 'taint-reaches-sink').")
  assert.equal(vios.length, 1, 'the cross-file html wrapper is the only true positive')
  assert.ok(String(vios[0].N).includes('xsink_renderHtml'), 'subject names the cross-file sink')
  const suppressed = await runQuery(program, 'suppressed_xss(N).')
  assert.ok(suppressed.some((r) => String(r.N).includes('xsink_replyJson')), 'the cross-file json wrapper is suppressed, not flagged')
})
