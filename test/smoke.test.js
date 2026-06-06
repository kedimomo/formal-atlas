/**
 * Smoke test — runs the whole pipeline on the sample project with no network.
 * Run: node test/smoke.test.js   (uses Node's built-in test runner)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractProject, buildProgram } from '../src/pipeline.js'
import { runQuery } from '../src/verify/prolog-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE = path.join(__dirname, '..', 'examples', 'sample-project')
const SCOPED = path.join(__dirname, '..', 'examples', 'scoped')
const INTENT = path.join(__dirname, '..', 'examples', 'intent')
const TAINT = path.join(__dirname, '..', 'examples', 'taint')

test('extract produces a real call graph', async () => {
  const { facts } = await extractProject(SAMPLE, { lift: 'offline' })
  const calls = facts.filter((f) => f.pred === 'calls')
  assert.ok(calls.length >= 10, 'should extract many call edges')
  const has = (a, b) => calls.some((f) => f.args[0] === a && f.args[1] === b)
  assert.ok(has('handleRequest', 'validateUser'))
  assert.ok(has('handleRequest', 'dbQuery'))
})

test('transitive reachability (least-fixpoint closure) works', async () => {
  const proj = await extractProject(SAMPLE, { lift: 'offline' })
  const rows = await runQuery(buildProgram(proj), 'reaches(handleRequest, connect).')
  assert.equal(rows.length, 1, 'handleRequest should transitively reach connect')
})

test('dead-code detection ignores lambdas, finds named orphans', async () => {
  const proj = await extractProject(SAMPLE, { lift: 'offline' })
  const rows = await runQuery(buildProgram(proj), 'dead_code(_, N).')
  const names = rows.map((r) => r.N).sort()
  assert.deepEqual(names, ['formatBytes', 'legacyCheck'])
})

test('governance violations fire as expected', async () => {
  const proj = await extractProject(SAMPLE, { lift: 'offline' })
  const rows = await runQuery(buildProgram(proj), 'violation(S, R).')
  const rules = new Set(rows.map((r) => r.R))
  for (const r of ['crypto-in-loop', 'hardcoded-sensitive', 'await-in-loop', 'external-call', 'dead-code']) {
    assert.ok(rules.has(r), `expected violation: ${r}`)
  }
})

test('cross-layer join: AI semantic facts are queryable', async () => {
  const proj = await extractProject(SAMPLE, { lift: 'offline' })
  const rows = await runQuery(buildProgram(proj), 'side_effect(R, network).')
  assert.ok(rows.some((r) => r.R === 'reportMetric'))
})

test('scope-aware resolution de-merges same-name functions across files', async () => {
  const proj = await extractProject(SCOPED, { lift: 'none' })
  // `format` is defined in BOTH alpha.js and beta.js. The linker must keep
  // them distinct (two decl nodes), not merge them into one.
  const decls = proj.facts.filter((f) => f.pred === 'decl' && f.args[2] === 'format')
  assert.equal(decls.length, 2, 'format should be two distinct file-qualified nodes')
  // alpha.js::format is used locally (alive); beta.js::format is dead.
  // Pre-resolution this was hidden — alpha's call made the merged node look alive.
  const dead = await runQuery(buildProgram(proj), 'dead_code(File, format).')
  const files = dead.map((r) => r.File).sort()
  assert.deepEqual(files, ['beta.js'], 'only beta.js::format is dead')
})

test('resolved recursion stays local: each walker reaches only its own callees', async () => {
  const proj = await extractProject(SCOPED, { lift: 'none' })
  // alpha.start must reach alpha.format, but beta has no path to alpha.format.
  const rows = await runQuery(buildProgram(proj), 'rcall(QC, QT).')
  const has = (qc, qt) => rows.some((r) => r.QC === qc && r.QT === qt)
  assert.ok(has('alpha.js::start', 'alpha.js::format'), 'start resolves to local format')
})

test('intent-effect-mismatch flags read-named mutators, not plain DB reads', async () => {
  const proj = await extractProject(INTENT, { lift: 'offline' })
  const rows = await runQuery(buildProgram(proj), "violation(N, 'intent-effect-mismatch').")
  const names = rows.map((r) => r.N).sort()
  // getThings reads (findMany) → no contradiction; getAndPurge writes (deleteMany) → flagged.
  assert.deepEqual(names, ['getAndPurge'])
})

test('taint analysis flags unsanitized source→sink, not the sanitized path', async () => {
  const proj = await extractProject(TAINT, { lift: 'none' })
  const rows = await runQuery(buildProgram(proj), "violation(N, 'taint-reaches-sink').")
  // searchUsers: req.query → db.query unsanitized (vulnerable). searchSafe: db.escape'd (clean).
  assert.equal(rows.length, 1, 'exactly one vulnerable sink')
  assert.ok(String(rows[0].N).includes('sink_sql'), 'the SQL sink is the flagged one')
})
