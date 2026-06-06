/**
 * Token-savings benchmark — concrete numbers for "does the tool save tokens?".
 *
 * Honest framing: for whole-graph questions (reachability / dead-code / impact /
 * governance) an agent CANNOT shortcut by reading one file — it needs the call
 * graph, i.e. it must hold the subsystem's source in context. The context
 * window is re-sent every turn, so that source costs input tokens on EVERY model
 * call. An MCP verdict is a tiny JSON the agent holds instead.
 *
 * Extraction itself is deterministic COMPUTE (0 LLM tokens) and is cached, so it
 * does not enter the token comparison. tokens ≈ chars/4 (rough, model-agnostic).
 *
 * Run: node mcp/bench.js [target]   (default: examples/sample-project)
 */
import fs from 'node:fs'
import path from 'node:path'
import { walkFiles } from '../src/pipeline.js'
import { runTool, TOOLS } from './tools.js'

const estTokens = (s) => Math.ceil(String(s).length / 4)

async function main() {
  const target = process.argv[2] || 'examples/sample-project'
  const abs = path.resolve(process.cwd(), target)

  // Baseline: source an agent must read to reason about the call graph.
  const files = walkFiles(abs)
  let srcChars = 0
  for (const f of files) { try { srcChars += fs.readFileSync(f.abs, 'utf8').length } catch { /* skip */ } }
  const baseline = Math.ceil(srcChars / 4)

  // Whole-graph questions that are EXPENSIVE without a graph (all real on any dir).
  const qs = [
    ['dead_code', { path: target }],
    ['verify', { path: target }],
    ['query', { path: target, goal: 'cyclic(N).' }],
  ]
  const schema = estTokens(JSON.stringify(TOOLS)) // tools/list, once per session

  console.log(`target: ${target}  —  ${files.length} files, ~${baseline} ctx tokens of source`)
  console.log(`\nBASELINE (read the subsystem to answer ANY graph question, held every turn): ~${baseline} tokens\n`)
  console.log(`per MCP query (args + JSON verdict):`)
  let total = 0
  for (const [name, args] of qs) {
    const out = await runTool(name, args)
    const t = estTokens(JSON.stringify(args)) + estTokens(out)
    total += t
    console.log(`  ${name.padEnd(9)} ~${String(t).padStart(4)} tokens   →  ${Math.round(baseline / Math.max(t, 1))}× smaller than holding the source`)
  }
  console.log(`\none-time tool schema: ~${schema} tokens (sent once/session)`)
  console.log(`→ first query ≈ ${schema + Math.ceil(total / qs.length)} tokens vs ${baseline} read  (${Math.round((1 - (schema + total / qs.length) / baseline) * 100)}% less)`)
  console.log(`→ each follow-up ≈ ${Math.ceil(total / qs.length)} tokens vs re-holding ${baseline}  (~${Math.round(baseline / Math.max(total / qs.length, 1))}× less)`)
  console.log(`→ extraction = compute, 0 LLM tokens, cached. The per-query cost is FLAT as the codebase grows; the read cost grows with it.`)
}
main()
