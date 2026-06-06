/**
 * FDRS reflow bridge.
 *
 * Lowers formal-atlas DEEP facts (calls/2, crypto_in_loop/1, string_lit/3, …)
 * into the SHALLOW concept facts (`fact('file', concept[, N]).`) that the repo's
 * existing tools/lint/prolog-check.js consumes — so the FDRS six-pillar rules
 * fire on PRECISE deep-extracted facts instead of regex-extracted ones.
 *
 * Mapping is intentionally conservative; see the per-concept comments.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractProject } from '../pipeline.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const PROLOG_CHECK = path.join(REPO_ROOT, 'tools', 'lint', 'prolog-check.js')

const ATOM = /^[a-z][a-zA-Z0-9_]*$/
const q = (s) => (typeof s === 'number' ? String(s) : (ATOM.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, "\\'")}'`))
const hasAny = (set, re) => { for (const v of set) if (re.test(v)) return true; return false }

/** Build a per-file rollup of the deep facts, joining scope→file via defines/4. */
function indexByFile(facts) {
  const scopeFile = new Map()
  const byFile = new Map()
  const ensure = (f) => {
    if (!byFile.has(f)) byFile.set(f, { imports: new Set(), strings: new Set(), calls: new Set(), loop: false, crypto: false, awaitLoop: false, lang: 'unknown' })
    return byFile.get(f)
  }
  for (const { pred, args } of facts) {
    if (pred === 'file') ensure(args[0]).lang = args[1]
    else if (pred === 'defines') { scopeFile.set(args[1], args[0]); ensure(args[0]) }
    else if (pred === 'imports') ensure(args[0]).imports.add(args[1])
    else if (pred === 'string_lit') ensure(args[0]).strings.add(args[1])
  }
  for (const { pred, args } of facts) {
    const f = scopeFile.get(args[0])
    if (!f) continue
    const e = ensure(f)
    if (pred === 'calls') e.calls.add(args[1])
    else if (pred === 'has_loop') e.loop = true
    else if (pred === 'crypto_in_loop') { e.crypto = true; e.loop = true }
    else if (pred === 'awaits_in_loop') e.awaitLoop = true
  }
  return byFile
}

/** @returns {string[]} FDRS `fact(...)` lines. */
export function lowerToFdrs(facts) {
  const byFile = indexByFile(facts)
  const lines = []
  const add = (...a) => lines.push(`fact(${a.map(q).join(', ')}).`)
  for (const [file, e] of byFile) {
    const isolation = e.calls.has('Worker') || hasAny(e.imports, /worker_threads|worker/i)
    // P1: crypto inside a loop with no isolation == membrane breach. N is
    // heuristic (runtime iteration count is not recoverable from structure).
    if (e.crypto) { add(file, 'contains_loop', 50000); add(file, 'contains_sync_crypto_in_loop') }
    else if (e.loop) add(file, 'contains_loop', 2000)
    if (isolation) add(file, 'has_compute_isolation')
    if (e.awaitLoop) add(file, 'has_yield_fallback')
    // P6: hardcoded tenant/system id (FDRS's uses_hardcoded_id is id-specific).
    if (hasAny(e.strings, /tenant-\d+|^system$/)) {
      add(file, 'uses_hardcoded_id')
      if (hasAny(e.imports, /config/) || hasAny(e.calls, /getSystemTenantId|tenantRegistry/)) add(file, 'resolves_id_from_registry')
    }
    if (e.lang === 'typescript' || e.lang === 'tsx') add(file, 'contains_typescript')
    if (hasAny(e.imports, /^pinia$/) || e.calls.has('defineStore') || e.calls.has('createPinia')) add(file, 'contains_pinia')
    if (e.calls.has('sealString') || hasAny(e.imports, /data-crypto/)) add(file, 'uses_seal_string')
    if (e.calls.has('CircuitBreaker')) add(file, 'has_circuit_breaker')
    if (e.calls.has('race') || e.calls.has('setTimeout')) add(file, 'has_startup_timeout')
    if (e.calls.has('loadOrCompute')) { add(file, 'has_checkpoint'); add(file, 'loads_from_checkpoint') }
  }
  return lines
}

export async function runFdrsBridge(target, { run = true, out } = {}) {
  const { facts, fileCount } = await extractProject(target, { lift: 'none' })
  const lines = lowerToFdrs(facts)
  const text = [
    `% FDRS concept facts lowered from formal-atlas deep extraction of ${target}`,
    `% ${fileCount} files -> ${lines.length} FDRS facts`,
    '% NOTE: contains_loop counts are heuristic (runtime N is not a structural property).',
    '', ...lines, '',
  ].join('\n')
  const outFile = out || path.join(os.tmpdir(), 'formal-atlas-fdrs-facts.pl')
  fs.writeFileSync(outFile, text)
  let checkOutput = null
  if (run) {
    checkOutput = fs.existsSync(PROLOG_CHECK)
      ? ((r) => (r.stdout || '') + (r.stderr || ''))(spawnSync('node', [PROLOG_CHECK, outFile], { encoding: 'utf8' }))
      : `(skipped: ${PROLOG_CHECK} not found — bridge only runs --run inside the parent repo)`
  }
  return { outFile, factCount: lines.length, fileCount, text, checkOutput }
}
