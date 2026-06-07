/**
 * Unified LLM calling layer.
 *
 * Priority:
 *   1. MCP sampling (IDE provides LLM, zero-config for user)
 *   2. API key (ANTHROPIC_API_KEY or OPENAI_API_KEY env vars)
 *   3. Offline fallback (returns null, caller must handle)
 *
 * Two surfaces share the same transport:
 *   - callLLM(messages)     → string[] of validated Prolog FACT lines (or null).
 *                             The neurosymbolic GENERATE side: facts only, each
 *                             must still pass the solver before it is a conclusion.
 *   - callLLMText(messages) → RAW assistant text (or null). For the ★3 repair
 *                             loop, whose output is a JSON triage/patch, not facts.
 *
 * MCP configuration: in .mcp.json add "env" to pass API keys to the server, e.g.
 *   { "mcpServers": { "formal-atlas": { "command": "npx",
 *       "args": ["-y", "formal-atlas-mcp"],
 *       "env": { "ANTHROPIC_API_KEY": "sk-ant-...", "FORMAL_ATLAS_MODEL": "claude-opus-4-8" } } } }
 *   Or set the environment variables globally before launching the IDE.
 */

const FACT_LINE = /^[a-z][a-zA-Z0-9_]*\([^\n]*\)\.\s*$/
const FACT_SYS = 'You are a code-to-logic formalizer. Emit ONLY Prolog ground facts (one per line, ending with a period). No prose, no code fences.'
const REPAIR_SYS = 'You are a precise code-repair assistant for a static analyzer. You are given a machine-verified violation, its derivation (proof tree), and any solver counterexample. Respond with STRICT JSON only — no prose, no markdown, no code fences.'

// --- MCP sampling support ---
let _mcpServer = null
export function setMcpServer(server) { _mcpServer = server }
export function getMcpServer() { return _mcpServer }

const userText = (messages) => messages
  .filter((m) => m.role === 'user')
  .map((m) => (typeof m.content === 'string' ? m.content : m.content?.text || ''))
  .join('\n')

// --- per-provider RAW-text transports (return assistant text, or null) ---
async function mcpSamplingText(messages, { maxTokens, systemPrompt }) {
  if (!_mcpServer) return null
  try {
    const r = await _mcpServer.requestSampling({ messages, maxTokens, systemPrompt })
    if (!r || !r.content) return null
    return typeof r.content === 'string' ? r.content : r.content.text || ''
  } catch { return null }
}

async function anthropicText(userMsg, { maxTokens, systemPrompt }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.FORMAL_ATLAS_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens, system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json.content || []).map((c) => c.text || '').join('\n')
  } catch { return null }
}

async function openaiText(userMsg, { maxTokens, systemPrompt }) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o', max_tokens: maxTokens,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json.choices || []).map((c) => c.message?.content || '').join('\n')
  } catch { return null }
}

/** Shared transport: MCP sampling → Anthropic → OpenAI → null. Returns RAW text. */
async function callText(messages, { maxTokens = 2048, systemPrompt } = {}) {
  const u = userText(messages)
  const viaMcp = await mcpSamplingText(messages, { maxTokens, systemPrompt })
  if (viaMcp && viaMcp.trim()) return viaMcp
  const viaAnthropic = await anthropicText(u, { maxTokens, systemPrompt })
  if (viaAnthropic && viaAnthropic.trim()) return viaAnthropic
  const viaOpenAI = await openaiText(u, { maxTokens, systemPrompt })
  if (viaOpenAI && viaOpenAI.trim()) return viaOpenAI
  return null
}

/**
 * Fact mode. Tries each transport in priority order and returns the first that
 * yields ≥1 valid Prolog fact line (so a transport that responds with non-fact
 * text falls through to the next, preserving the original semantics).
 */
export async function callLLM(messages, { maxTokens = 2048 } = {}) {
  const u = userText(messages)
  const transports = [
    () => mcpSamplingText(messages, { maxTokens, systemPrompt: FACT_SYS }),
    () => anthropicText(u, { maxTokens, systemPrompt: FACT_SYS }),
    () => openaiText(u, { maxTokens, systemPrompt: FACT_SYS }),
  ]
  for (const t of transports) {
    const text = await t()
    if (text == null) continue
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => FACT_LINE.test(l))
    if (lines.length) return lines
  }
  return null
}

/** Free-text mode (★3 repair): returns RAW assistant text, or null if no LLM. */
export async function callLLMText(messages, opts = {}) {
  return callText(messages, { maxTokens: 2048, systemPrompt: REPAIR_SYS, ...opts })
}

/** Check if any LLM path is available */
export function hasLLM() {
  return _mcpServer != null || !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY
}

/** Get current LLM provider info for diagnostics */
export function getLLMInfo() {
  if (_mcpServer) return { provider: 'mcp-sampling', model: 'IDE-provided' }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: process.env.FORMAL_ATLAS_MODEL || 'claude-sonnet-4-20250514' }
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' }
  return { provider: 'offline', model: 'heuristic' }
}
