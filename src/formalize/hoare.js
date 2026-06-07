/**
 * Hoare triple generator — produces precondition/2 and postcondition/2 facts.
 *
 * Online path: LLM analyzes function code + structural facts.
 * Offline path: heuristic inference from parameter names and call patterns.
 */
import { fact } from '../lift/fact-model.js'
import { callLLM } from '../llm/index.js'

// --- Offline heuristics ---

const PARAM_HINTS = [
  [/^(id|userId|itemId|orderId)$/, 'is a valid identifier'],
  [/^(email|mail)$/, 'is a valid email address'],
  [/^(password|passwd|secret)$/, 'is a non-empty string'],
  [/^(count|limit|offset|page|size|num)$/, 'is a non-negative integer'],
  [/^(url|uri|href|link)$/, 'is a valid URL'],
  [/^(path|filepath|dir|directory)$/, 'is a valid file path'],
  [/^(data|body|payload|input)$/, 'is a non-null object'],
  [/^(callback|cb|handler|fn)$/, 'is a function'],
  [/^(options|opts|config|settings)$/, 'is a configuration object'],
]

const RETURN_HINTS = {
  read: 'returns the requested data or null if not found',
  write: 'returns the updated or created resource',
  validate: 'returns a boolean or validation result',
  compute: 'returns the computed result',
}

function inferPreconditions(name, callees) {
  const pres = []
  // Infer from leading verb + call patterns
  for (const [re, desc] of PARAM_HINTS) {
    // Match parameter-like substrings in the routine name
    const lower = name.toLowerCase()
    for (const [, hint] of PARAM_HINTS) {
      // Simple: if the name contains common param words
    }
  }
  // If routine calls database, precondition: database is available
  for (const c of callees) {
    if (/^(findMany|findUnique|findFirst|findAll|execute|upsert|deleteMany|updateMany)/.test(c)) {
      pres.push('database connection is available')
      break
    }
    if (/^(fetch|axios|request|got)/.test(c)) {
      pres.push('network access is available')
      break
    }
  }
  return pres
}

function inferPostconditions(name, intent) {
  if (intent && RETURN_HINTS[intent]) return [RETURN_HINTS[intent]]
  return []
}

/** Offline: infer basic Hoare triples from structural facts */
export function generateHoareOffline(facts) {
  const out = []
  const byScope = new Map()
  for (const f of facts) {
    if (f.pred === 'calls') {
      const [scope, callee] = f.args
      if (!byScope.has(scope)) byScope.set(scope, new Set())
      byScope.get(scope).add(callee)
    }
  }
  const intents = new Map()
  for (const f of facts) {
    if (f.pred === 'intent') intents.set(f.args[0], f.args[1])
  }

  for (const [name, callees] of byScope) {
    const intent = intents.get(name)
    const pres = inferPreconditions(name, callees)
    const posts = inferPostconditions(name, intent)
    for (const p of pres) out.push(fact('precondition', name, p))
    for (const q of posts) out.push(fact('postcondition', name, q))
  }
  return out
}

/** Online: use LLM to generate Hoare triples */
export async function generateHoareOnline(facts, codeByFile) {
  const routines = new Map()
  for (const f of facts) {
    if (f.pred === 'defines' && f.args[2] === 'routine') {
      routines.set(f.args[1], f.args[0])
    }
  }
  if (routines.size === 0) return []

  const factText = facts.filter(f => ['calls', 'intent', 'side_effect', 'pure'].includes(f.pred))
    .map(f => `${f.pred}(${f.args.join(', ')}).`).join('\n')

  const routineList = [...routines.keys()].slice(0, 30).join(', ')
  const messages = [{
    role: 'user',
    content: `You are a code-to-logic formalizer. For each routine listed below, emit Prolog ground facts for its preconditions and postconditions.

Allowed predicates ONLY:
  precondition(Routine, 'natural-language condition').
  postcondition(Routine, 'natural-language condition').

Use the routine NAMES exactly as given. One fact per line, ending with a period. No prose, no code fences.

Routines: ${routineList}

Known structural facts:
${factText.slice(0, 4000)}
`
  }]

  const lines = await callLLM(messages, { maxTokens: 2048 })
  if (!lines) return []

  // Parse lines into fact objects
  const out = []
  for (const line of lines) {
    const m = line.match(/^(precondition|postcondition)\(([^,]+),\s*'([^']+)'\)\.$/)
    if (m) out.push(fact(m[1], m[2], m[3]))
  }
  return out
}
