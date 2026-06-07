/**
 * Unified LLM calling layer.
 *
 * Priority:
 *   1. MCP sampling (IDE provides LLM, zero-config for user)
 *   2. API key (ANTHROPIC_API_KEY or OPENAI_API_KEY env vars)
 *   3. Offline fallback (returns null, caller must handle)
 *
 * MCP configuration:
 *   In .mcp.json, add "env" to pass API keys to the MCP server process:
 *   {
 *     "mcpServers": {
 *       "formal-atlas": {
 *         "command": "npx",
 *         "args": ["-y", "formal-atlas-mcp"],
 *         "env": {
 *           "ANTHROPIC_API_KEY": "sk-ant-...",
 *           "OPENAI_API_KEY": "sk-...",
 *           "FORMAL_ATLAS_MODEL": "claude-opus-4-8"
 *         }
 *       }
 *     }
 *   }
 *
 *   Or set environment variables globally before launching the IDE.
 */
import { fact } from '../lift/fact-model.js'

const FACT_LINE = /^[a-z][a-zA-Z0-9_]*\([^\n]*\)\.\s*$/

// --- MCP sampling support ---
let _mcpServer = null

export function setMcpServer(server) { _mcpServer = server }
export function getMcpServer() { return _mcpServer }

async function callMcpSampling(messages, { maxTokens = 2048 } = {}) {
  if (!_mcpServer) return null
  try {
    const result = await _mcpServer.requestSampling({
      messages,
      maxTokens,
      systemPrompt: 'You are a code-to-logic formalizer. Emit ONLY Prolog ground facts (one per line, ending with a period). No prose, no code fences.',
    })
    if (!result || !result.content) return null
    const text = typeof result.content === 'string' ? result.content : result.content.text || ''
    return text.split('\n').map(l => l.trim()).filter(l => FACT_LINE.test(l))
  } catch { return null }
}

// --- Anthropic API ---
async function callAnthropic(userMsg, { maxTokens = 2048 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.FORMAL_ATLAS_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const text = (json.content || []).map(c => c.text || '').join('\n')
    return text.split('\n').map(l => l.trim()).filter(l => FACT_LINE.test(l))
  } catch { return null }
}

// --- OpenAI API ---
async function callOpenAI(userMsg, { maxTokens = 2048 } = {}) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'You are a code-to-logic formalizer. Emit ONLY Prolog ground facts (one per line, ending with a period). No prose, no code fences.' },
          { role: 'user', content: userMsg },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const text = (json.choices || []).map(c => c.message?.content || '').join('\n')
    return text.split('\n').map(l => l.trim()).filter(l => FACT_LINE.test(l))
  } catch { return null }
}

// --- API key path: try Anthropic first, then OpenAI ---
async function callWithApiKey(messages, { maxTokens = 2048 } = {}) {
  const userMsg = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.text || '').join('\n')
  // Try Anthropic first
  const anthropicResult = await callAnthropic(userMsg, { maxTokens })
  if (anthropicResult && anthropicResult.length > 0) return anthropicResult
  // Then OpenAI
  const openaiResult = await callOpenAI(userMsg, { maxTokens })
  if (openaiResult && openaiResult.length > 0) return openaiResult
  return null
}

/**
 * Call LLM with automatic fallback: MCP sampling → API key → null.
 * @param {Array} messages - Chat messages array
 * @param {Object} opts - { maxTokens }
 * @returns {string[]|null} Array of validated Prolog fact lines, or null if no LLM available
 */
export async function callLLM(messages, opts = {}) {
  // Priority 1: MCP sampling
  const mcpResult = await callMcpSampling(messages, opts)
  if (mcpResult && mcpResult.length > 0) return mcpResult

  // Priority 2: API key (Anthropic → OpenAI)
  const apiKeyResult = await callWithApiKey(messages, opts)
  if (apiKeyResult && apiKeyResult.length > 0) return apiKeyResult

  // Priority 3: offline — return null
  return null
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
