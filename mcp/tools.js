/**
 * formal-atlas MCP tools — thin wrappers over the verification engine.
 *
 * "Extract once, query many": the built Prolog program is cached per resolved
 * path, so repeated structural questions about the same repo cost ONE
 * extraction (0 LLM tokens) instead of re-reading files every time. Each tool
 * returns a small JSON verdict the agent can act on without loading source.
 */
import path from 'node:path'
import { extractProject, buildProgram } from '../src/pipeline.js'
import { runQuery } from '../src/verify/prolog-engine.js'
import { checkContract } from '../src/verify/smt-bridge.js'
import { termOf } from '../src/lift/fact-model.js'

const cache = new Map() // absPath -> { program, files }

async function programFor(p) {
  const abs = path.resolve(process.cwd(), String(p))
  if (!cache.has(abs)) {
    const proj = await extractProject(abs, { lift: 'offline' })
    cache.set(abs, { program: buildProgram(proj), files: proj.fileCount })
  }
  return cache.get(abs)
}

async function ask(p, goal) {
  const { program } = await programFor(p)
  const g = goal.trim().endsWith('.') ? goal.trim() : `${goal.trim()}.`
  return runQuery(program, g)
}

const j = (o) => JSON.stringify(o, null, 2)
const P = { path: { type: 'string', description: 'Dir or file to analyze (relative to cwd, or absolute).' } }

export const TOOLS = [
  {
    name: 'reaches',
    description: 'Definitively decide whether function `from` can transitively reach `to` in the call graph. A FALSE result is an exhaustive proof of unreachability (not "I did not find a path"). Use instead of reading the call chain across files.',
    inputSchema: { type: 'object', properties: { ...P, from: { type: 'string' }, to: { type: 'string' } }, required: ['path', 'from', 'to'] },
  },
  {
    name: 'dead_code',
    description: 'List functions provably never called (whole-graph, scope-aware — NOT a grep of one file; same-name functions across files are not merged). Use to answer "is this safe to delete?".',
    inputSchema: { type: 'object', properties: { ...P }, required: ['path'] },
  },
  {
    name: 'impact',
    description: 'Blast radius: every routine that transitively reaches `target`. Use BEFORE refactoring a function to see exactly who is affected.',
    inputSchema: { type: 'object', properties: { ...P, target: { type: 'string' } }, required: ['path', 'target'] },
  },
  {
    name: 'verify',
    description: 'Run the governance rule base; return violations (crypto-in-loop, await-in-loop, external-call, hardcoded-sensitive, dead-code, intent-effect-mismatch).',
    inputSchema: { type: 'object', properties: { ...P }, required: ['path'] },
  },
  {
    name: 'query',
    description: 'Run an arbitrary Prolog/Datalog goal over the fact base, e.g. "cyclic(N).", "caller_of(foo, C).". Power-user escape hatch.',
    inputSchema: { type: 'object', properties: { ...P, goal: { type: 'string' } }, required: ['path', 'goal'] },
  },
  {
    name: 'contract',
    description: 'SMT (Z3) Hoare-style check: does the precondition ENTAIL the postcondition? Returns a machine-checked verdict or a concrete counterexample. vars maps name -> "int"|"bool"; pre/post are arrays of expression strings.',
    inputSchema: { type: 'object', properties: { vars: { type: 'object' }, pre: { type: 'array', items: { type: 'string' } }, post: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['vars', 'pre', 'post'] },
  },
]

export async function runTool(name, a = {}) {
  switch (name) {
    case 'reaches': {
      const rows = await ask(a.path, `reaches(${termOf(a.from)}, ${termOf(a.to)}).`)
      return j({ from: a.from, to: a.to, reachable: rows.length > 0, derivations: rows.length })
    }
    case 'dead_code': {
      const rows = await ask(a.path, 'dead_code(File, Name).')
      return j({ count: rows.length, items: rows.slice(0, 500).map((r) => ({ file: r.File, name: r.Name })) })
    }
    case 'impact': {
      const rows = await ask(a.path, `impact(${termOf(a.target)}, Caller).`)
      return j({ target: a.target, callers: [...new Set(rows.map((r) => r.Caller))] })
    }
    case 'verify': {
      const rows = await ask(a.path, 'violation(Subject, Rule).')
      return j({ count: rows.length, violations: rows.slice(0, 500).map((r) => ({ subject: r.Subject, rule: r.Rule })) })
    }
    case 'query': {
      const rows = await ask(a.path, String(a.goal))
      return j({ goal: a.goal, count: rows.length, rows: rows.slice(0, 500) })
    }
    case 'contract': {
      return j(await checkContract({ vars: a.vars, pre: a.pre, post: a.post, name: a.name }))
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
