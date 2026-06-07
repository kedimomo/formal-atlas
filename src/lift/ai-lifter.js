/**
 * AI lifter — the "neuro" half of the neurosymbolic pipeline.
 *
 * Turns code into SEMANTIC facts that no parser can recover: a routine's
 * intent, purity, side effects, and (optionally) pre/post-conditions.
 *
 *   - ONLINE  : if ANTHROPIC_API_KEY / OPENAI_API_KEY is set, ask an LLM to
 *               emit ground Prolog facts (strictly validated before use).
 *   - OFFLINE : otherwise derive sound, conservative facts from the structural
 *               fact base via deterministic heuristics. Always runs.
 *
 * Either way the OUTPUT is the same shape — Prolog facts — so the symbolic
 * verifier downstream never knows or cares which path produced them.
 */
import { fact } from './fact-model.js'
import { callLLM } from '../llm/index.js'

const EFFECT_HINTS = [
  [/^(fetch|axios|request|got|ajax|XMLHttpRequest)$/, 'network'],
  [/^(readFile|writeFile|readFileSync|writeFileSync|open|unlink|mkdir|rmdir|appendFile)$/, 'filesystem'],
  // ORM/SQL names that are unambiguous (bare create/update/delete are too overloaded
  // — e.g. hash.update() — so we match only the distinctive method names).
  [/^(execute|findMany|findUnique|findFirst|findAll|upsert|deleteMany|updateMany|\$queryRaw|\$executeRaw)$/, 'database'],
  // DB WRITE-class ops ALSO count as a state mutation. This is what lets
  // intent-effect-mismatch fire on a read-named routine that bulk-writes /
  // raw-executes, while a plain DB *read* (findMany) does NOT trip it — a
  // "get" that reads from the database is still a read, not a contradiction.
  [/^(upsert|deleteMany|updateMany|createMany|\$executeRaw)$/, 'mutation'],
  [/^(sha256|sha512|createHash|createHmac|encrypt|decrypt|sign|verify|pbkdf2|scrypt|randomBytes)$/, 'crypto'],
  [/^(log|info|warn|error|debug|trace)$/, 'logging'],
  [/^(setState|dispatch|commit|emit|publish)$/, 'mutation'],
]

// Map the LEADING verb of a routine name to an intent. Extracting the leading
// lowercase run avoids substring false positives (e.g. "has" inside "hashAll").
const INTENT_BY_VERB = {
  read: 'read', get: 'read', fetch: 'read', load: 'read', find: 'read', list: 'read',
  query: 'read', select: 'read', view: 'read', show: 'read', is: 'read', has: 'read',
  can: 'read', count: 'read', exists: 'read',
  set: 'write', update: 'write', save: 'write', write: 'write', put: 'write', patch: 'write',
  modify: 'write', insert: 'write', create: 'write', add: 'write', register: 'write',
  delete: 'write', remove: 'write', drop: 'write', seal: 'write',
  validate: 'validate', check: 'validate', verify: 'validate', ensure: 'validate',
  assert: 'validate', guard: 'validate',
  compute: 'compute', calc: 'compute', calculate: 'compute', build: 'compute', derive: 'compute',
  transform: 'compute', hash: 'compute', encode: 'compute', decode: 'compute', parse: 'compute',
}

function leadingVerb(name) {
  const m = String(name).match(/^[a-z]+/)
  return m ? m[0] : null
}

/** Group calls/2 facts by caller scope. */
function callsByScope(facts) {
  const m = new Map()
  for (const f of facts) {
    if (f.pred !== 'calls') continue
    const [scope, callee] = f.args
    if (!m.has(scope)) m.set(scope, new Set())
    m.get(scope).add(callee)
  }
  return m
}

function routineNames(facts) {
  const names = new Set()
  for (const f of facts) if (f.pred === 'defines' && f.args[2] === 'routine') names.add(f.args[1])
  return names
}

/** Deterministic, offline semantic lift from the structural facts. */
export function liftOffline(facts) {
  const out = []
  const byScope = callsByScope(facts)
  const routines = routineNames(facts)
  const awaitsLoop = new Set(facts.filter((f) => f.pred === 'awaits_in_loop').map((f) => f.args[0]))

  for (const name of routines) {
    // intent from the leading verb of the name
    const verb = leadingVerb(name)
    if (verb && INTENT_BY_VERB[verb]) out.push(fact('intent', name, INTENT_BY_VERB[verb]))
    // side effects from what the routine calls
    const callees = byScope.get(name) || new Set()
    const effects = new Set()
    for (const c of callees) {
      for (const [re, eff] of EFFECT_HINTS) if (re.test(c)) effects.add(eff)
    }
    for (const eff of effects) out.push(fact('side_effect', name, eff))
    // purity: no observable effects, no calls at all beyond pure helpers
    const impureEffects = [...effects].filter((e) => e !== 'logging')
    if (impureEffects.length === 0 && !awaitsLoop.has(name)) out.push(fact('pure', name))
  }
  return out
}

/** Build the strict prompt used for the optional LLM path. */
function buildPrompt(fileId, code, structuralFacts) {
  const factText = structuralFacts.map((f) => `${f.pred}(${f.args.join(', ')})`).join('\n')
  return `You are a code-to-logic formalizer. Read the source file and emit ONLY Prolog ground facts (one per line, ending with a period) describing SEMANTICS the parser cannot see.
Allowed predicates ONLY:
  intent(Routine, read|write|validate|compute).
  side_effect(Routine, network|filesystem|database|crypto|logging|mutation|none).
  pure(Routine).
  contract(Routine, pre|post, 'short natural-language condition').
Use the routine NAMES exactly as they appear below. No prose, no code fences.

File: ${fileId}
Structural facts already known:
${factText}

Source:
${code.slice(0, 8000)}
`
}

const FACT_LINE = /^[a-z][a-zA-Z0-9_]*\([^\n]*\)\.\s*$/

/** Optional online lift via Anthropic Messages API (no SDK dependency). */
export async function liftOnline(fileId, code, structuralFacts) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const body = {
    model: process.env.FORMAL_ATLAS_MODEL || 'claude-opus-4-8',
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(fileId, code, structuralFacts) }],
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const text = (json.content || []).map((c) => c.text || '').join('\n')
    // Validate: keep only well-formed fact lines (defense against hallucinated syntax).
    return text.split('\n').map((l) => l.trim()).filter((l) => FACT_LINE.test(l))
  } catch {
    return null
  }
}
