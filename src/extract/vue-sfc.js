/**
 * Vue Single-File Component (SFC) extractor — closes the largest honest coverage gap
 * (~289 .vue files currently go through regex with only imports/defines, no call graph).
 *
 * A .vue file contains up to three blocks: <template>, <script setup> / <script>,
 * and <style>. We extract each <script> as JavaScript (acorn full AST, same as
 * extractJs), prefixing its fileId with the block tag so function names in a setup
 * block and a plain script block don't collide. The <template> may carry component
 * usage and event handlers (`@click`, `v-on:submit`, etc.) — we emit lightweight
 * facts for those (template-use, template-event) so the call graph sees the Vue-
 * component tree. <style> is ignored.
 *
 * Soundness: scripts are parsed with the SAME acorn extractor used for .js files,
 * so the call graph inside <script> blocks is as precise as the non-Vue JS. Template
 * facts are conservative (name-level only; no expression analysis) and purely additive.
 */
import { extractJs } from './js-ast.js'

const SCRIPT_RE = /<script\b[^>]*>/gi
const SCRIPT_END = /<\/script>/gi
const TEMPLATE_RE = /<template\b[^>]*>/gi
const TEMPLATE_END = /<\/template>/gi
const STYLE_RE = /<style\b[^>]*>/gi
const STYLE_END = /<\/style>/gi
const ATTRS = /\s+([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s>]+)))?/g

/** Find the content between a start-tag match and its end-tag match. */
function blockContent(code, startRe, endRe) {
  startRe.lastIndex = 0
  const sm = startRe.exec(code)
  if (!sm) return null
  const from = sm.index + sm[0].length
  endRe.lastIndex = from
  const em = endRe.exec(code)
  if (!em) return null
  return { content: code.slice(from, em.index), offset: from }
}

/** Parse a <script> block into its setup/plain kind. */
function scriptKind(tag) {
  // <script setup> or <script setup lang="ts"> → setup
  // <script> or <script lang="ts">          → plain
  return /\bsetup\b/.test(tag) ? 'setup' : 'script'
}

/**
 * Extract template-level component usage and event-handler references.
 * Returns additive facts (template-use, template-event).
 */
function extractTemplate(code, fileId) {
  const facts = []
  const b = blockContent(code, TEMPLATE_RE, TEMPLATE_END)
  if (!b) return facts
  const tpl = b.content
  // <SomeComponent ... /> or <some-component ...> → template-use
  const tagRe = /<\/?([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\b/gi
  const seen = new Set()
  let m
  while ((m = tagRe.exec(tpl)) !== null) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    facts.push({ pred: 'template_use', args: [fileId, name] })
  }
  // @event="handler" / v-on:event="handler" → template-event (synthetic calls3-like)
  const handlerRe = /(?:@|v-on:)(\w+)\s*=\s*"([^"]+)"/gi
  while ((m = handlerRe.exec(tpl)) !== null) {
    const handler = m[2].trim()
    // skip inline expressions (e.g. @click="count++") — only named handler refs
    if (/^[A-Za-z_$]\w*$/.test(handler)) facts.push({ pred: 'template_event', args: [fileId, handler, m[1]] })
  }
  return facts
}

/**
 * Extract a .vue SFC into structural facts.
 * Returns { facts, method: 'vue-sfc' } on success, or null on parse failure.
 */
export function extractVue(fileId, code) {
  const scriptBlocks = []
  const tagLocs = []
  // Find ALL <script ...> blocks (setup + plain)
  {
    const re = new RegExp(/<script\b[^>]*>/gi.source, 'gi')
    let sm
    while ((sm = re.exec(code)) !== null) {
      const from = sm.index + sm[0].length
      SCRIPT_END.lastIndex = from
      const em = SCRIPT_END.exec(code)
      if (!em) break
      scriptBlocks.push({ tag: sm[0], content: code.slice(from, em.index), offset: from })
      tagLocs.push({ start: sm.index, end: em.index + em[0].length })
    }
  }
  if (!scriptBlocks.length) return null // no script block → degenerative; regex is fine

  const templateFacts = extractTemplate(code, fileId)
  const allFacts = [...templateFacts]
  let anyBlockOk = false

  for (let i = 0; i < scriptBlocks.length; i++) {
    const { tag, content } = scriptBlocks[i]
    const kind = scriptKind(tag)
    const blockId = scriptBlocks.length === 1 ? fileId : `${fileId}::${kind}`
    // Treat the script content as JavaScript and extract full AST facts through the
    // same js-ast.js pipeline (acorn parse → alloc / isFunction / calls3 / params /
    // imports / intents / taint). The blockId keeps names scoped per-block.
    let ok = false
    try {
      const facts = extractJs(blockId, content)
      if (facts) {
        allFacts.push(...facts)
        ok = true
        anyBlockOk = true
      }
    } catch { /* acorn parse failed on this block — skip it */ }
    // If extractJs did not return (e.g. empty content), try regex as a fallback
    // for THIS block only — but better to just skip empty bodies.
    if (!ok && content.trim().length < 256) {
      // tiny script block, likely just an import — not worth regex
      const importRe = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*from\s*['"]([^'"]+)['"]/g
      let im
      while ((im = importRe.exec(content)) !== null) allFacts.push({ pred: 'imports', args: [blockId, im[1]] })
    }
  }

  if (!anyBlockOk && !templateFacts.length) return null // nothing useful extracted
  allFacts.push({ pred: 'file', args: [fileId, '.vue'] })
  allFacts.push({ pred: 'defines', args: [fileId, fileId] })
  return { facts: allFacts, method: 'vue-sfc' }
}
