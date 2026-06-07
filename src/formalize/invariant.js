/**
 * Loop invariant inference — produces invariant/2 facts.
 *
 * Online path: LLM analyzes loop body.
 * Offline path: heuristic inference from loop structure.
 */
import { fact } from '../lift/fact-model.js'
import { callLLM } from '../llm/index.js'

/** Offline: infer basic invariants from structural facts */
export function generateInvariantsOffline(facts) {
  const out = []
  // For each loop, infer a basic range invariant
  for (const f of facts) {
    if (f.pred === 'has_loop') {
      const scope = f.args[0]
      out.push(fact('invariant', scope, 'loop iterator remains within bounds'))
    }
    if (f.pred === 'crypto_in_loop') {
      const scope = f.args[0]
      out.push(fact('invariant', scope, 'crypto operation is deterministic per iteration'))
    }
    if (f.pred === 'awaits_in_loop') {
      const scope = f.args[0]
      out.push(fact('invariant', scope, 'each awaited operation completes before next iteration'))
    }
  }
  return out
}

/** Online: use LLM to generate loop invariants */
export async function generateInvariantsOnline(facts) {
  const loops = []
  for (const f of facts) {
    if (f.pred === 'has_loop' || f.pred === 'crypto_in_loop' || f.pred === 'awaits_in_loop') {
      loops.push(f.args[0])
    }
  }
  if (loops.length === 0) return []

  const uniqueLoops = [...new Set(loops)].slice(0, 20)
  const factText = facts.filter(f => ['has_loop', 'crypto_in_loop', 'awaits_in_loop', 'calls'].includes(f.pred))
    .map(f => `${f.pred}(${f.args.join(', ')}).`).join('\n')

  const messages = [{
    role: 'user',
    content: `You are a code-to-logic formalizer. For each loop scope listed below, emit a Prolog ground fact for its loop invariant.

Allowed predicate ONLY:
  invariant(Scope, 'natural-language invariant description').

Use the scope NAMES exactly as given. One fact per line, ending with a period. No prose, no code fences.

Loop scopes: ${uniqueLoops.join(', ')}

Known loop facts:
${factText.slice(0, 3000)}
`
  }]

  const lines = await callLLM(messages, { maxTokens: 1024 })
  if (!lines) return []

  const out = []
  for (const line of lines) {
    const m = line.match(/^invariant\(([^,]+),\s*'([^']+)'\)\.$/)
    if (m) out.push(fact('invariant', m[1], m[2]))
  }
  return out
}
