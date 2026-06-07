#!/usr/bin/env node
/**
 * formal-atlas MCP server — a dependency-free stdio MCP server.
 *
 * Speaks the Model Context Protocol over newline-delimited JSON-RPC 2.0 on
 * stdin/stdout (the stdio transport). Exposes the engine's structural/contract
 * queries as agent-callable tools: reaches / dead_code / impact / verify /
 * query / contract. See ./tools.js for the tool definitions.
 *
 * CRITICAL: stdout carries ONLY protocol messages. All diagnostics go to stderr.
 *
 * Register (local test):
 *   claude mcp add --scope local formal-atlas -- node <repo>/formal-atlas/mcp/server.js
 */
import { TOOLS, runTool } from './tools.js'
import { setMcpServer } from '../src/llm/index.js'

const SERVER = { name: 'formal-atlas', version: '0.1.0' }
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

// MCP sampling support: server object for outgoing requests (e.g. sampling/createMessage)
let nextReqId = 1
const pendingRequests = new Map()
const server = {
  info: SERVER,
  async requestSampling(params) {
    const id = nextReqId++
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method: 'sampling/createMessage', params })
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          reject(new Error('sampling request timed out'))
        }
      }, 30000)
    })
  },
}
setMcpServer(server)

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER,
      })
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call':
      try {
        // Send progress notifications for long-running tools to prevent client timeout
        const progressToken = params?.meta?.progressToken
        let progressSeq = 0
        const notifyProgress = (msg) => {
          if (progressToken) {
            send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++progressSeq, total: 0, message: msg } })
          }
        }
        // Wrap runTool with progress callbacks
        const text = await runTool(params?.name, params?.arguments || {}, notifyProgress)
        return reply(id, { content: [{ type: 'text', text }] })
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
      }
    case 'ping':
      return reply(id, {})
    default:
      if (method?.startsWith('notifications/')) return // notifications: no response
      if (id !== undefined) fail(id, -32601, `method not found: ${method}`)
  }
}

let buf = ''
let inFlight = 0
let ended = false
const drain = () => { if (ended && inFlight === 0) process.exit(0) }

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { log('parse error:', line.slice(0, 120)); continue }
    // Check for response to pending outgoing request (e.g. sampling)
    if (msg.id && !msg.method && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id)
      pendingRequests.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
      continue
    }
    inFlight++
    Promise.resolve(handle(msg))
      .catch((e) => log('handler error:', e.message))
      .finally(() => { inFlight--; drain() })
  }
})
process.stdin.on('end', () => { ended = true; drain() })

log(`formal-atlas MCP server ready — ${TOOLS.length} tools (stdio)`)
