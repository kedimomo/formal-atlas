/**
 * Engine tests for the WASM-backed layers (tree-sitter, z3, FDRS bridge).
 * Requires `npm install` (web-tree-sitter, tree-sitter-wasms, z3-solver).
 * Run: node test/engines.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractProject } from '../src/pipeline.js'
import { checkContract, checkPolicy } from '../src/verify/smt-bridge.js'
import { lowerToFdrs } from '../src/integrations/fdrs-bridge.js'
import { checkRefinementsVerbose, checkRefinementFacts } from '../src/verify/refinement-check.js'

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
