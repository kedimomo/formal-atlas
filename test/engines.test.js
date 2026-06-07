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
