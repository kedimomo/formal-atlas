/**
 * MCP smoke test — spawns server.js and drives it over stdio exactly like an
 * MCP client (initialize → tools/list → tools/call), asserting the verdicts.
 * Run: node mcp/test-mcp.js
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE = path.join(__dirname, '..', 'examples', 'sample-project')

const srv = spawn('node', [path.join(__dirname, 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'] })
const guard = setTimeout(() => { console.error('TIMEOUT'); srv.kill(); process.exit(1) }, 60000)

let buf = ''
const responses = []
srv.stdout.setEncoding('utf8')
srv.stdout.on('data', (c) => {
  buf += c
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
    if (!l) continue
    const msg = JSON.parse(l)
    // The server may request sampling (the §五·二 invariant-synthesis loop). Act as
    // the IDE's LLM: propose the correct loop invariant — the server's z3 then checks it.
    if (msg.method === 'sampling/createMessage') {
      send({ jsonrpc: '2.0', id: msg.id, result: { role: 'assistant', content: { type: 'text', text: '{"invariant": ["0 <= i", "i <= n", "sum == i"]}' } } })
    } else {
      responses.push(msg)
    }
  }
})

const send = (m) => srv.stdin.write(`${JSON.stringify(m)}\n`)
const waitFor = (id) => new Promise((res) => {
  const t = setInterval(() => { const r = responses.find((x) => x.id === id); if (r) { clearInterval(t); res(r) } }, 20)
})
const call = async (id, name, args) => {
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  return JSON.parse((await waitFor(id)).result.content[0].text)
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
assert.equal((await waitFor(1)).result.serverInfo.name, 'formal-atlas')

send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
assert.ok((await waitFor(2)).result.tools.length >= 6, 'expose >=6 tools')

const reach = await call(3, 'reaches', { path: SAMPLE, from: 'handleRequest', to: 'connect' })
assert.equal(reach.reachable, true)

const dead = await call(4, 'dead_code', { path: SAMPLE })
assert.deepEqual(dead.items.map((x) => x.name).sort(), ['formatBytes', 'legacyCheck'])

const impact = await call(5, 'impact', { path: SAMPLE, target: 'validateUser' })
assert.deepEqual(impact.callers, ['handleRequest'])

const ver = await call(6, 'verify', { path: SAMPLE })
assert.ok(ver.count >= 5, 'governance violations present')

const con = await call(7, 'contract', { vars: { x: 'int', y: 'int' }, pre: ['x > 0', 'y > 0'], post: ['x + y > 0'] })
assert.equal(con.entailed, true)

// ★8 prove — discharge a loop invariant (with `invariant`) via the built-in z3.
const sumSpec = { name: 'sum', vars: { i: 'int', n: 'int', sum: 'int' }, pre: ['i == 0', 'sum == 0', 'n >= 0'], guard: 'i < n', body: [{ var: 'i', expr: 'i + 1' }, { var: 'sum', expr: 'sum + 1' }], post: ['sum == n'] }
const prv = await call(8, 'prove', { ...sumSpec, invariant: ['0 <= i', 'i <= n', 'sum == i'] })
assert.equal(prv.proved, true, 'prove discharges a sound loop invariant (all 3 VCs) via z3')

// ★8 prove — NO invariant ⇒ synthesize via MCP sampling (the client above plays the
// LLM), then z3 verifies. End-to-end neurosymbolic loop through MCP (docs/13 §五·二).
const syn = await call(9, 'prove', sumSpec)
assert.equal(syn.status, 'proved', 'prove without an invariant synthesizes one via MCP sampling, then z3 confirms it')
assert.deepEqual(syn.invariant, ['0 <= i', 'i <= n', 'sum == i'], 'the sampled invariant is the one z3 verified')

clearTimeout(guard)
console.log('MCP smoke OK — initialize, tools/list(6+), reaches=true, dead_code=[formatBytes,legacyCheck], impact=[handleRequest], verify>=5, contract entailed, prove proved + synthesized-via-sampling')
srv.stdin.end()
srv.kill()
process.exit(0)
