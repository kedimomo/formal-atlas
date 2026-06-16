/**
 * Markdown document extractor — lifts documentation into logical facts so the
 * same Prolog rules (and closure analyses) reason over documents alongside code.
 * Zero-install regex path (tree-sitter-markdown WASM is available later).
 *
 * Facts emitted:
 *   file(FileId, 'markdown')
 *   defines(FileId, SectionName, 'section', Line)   ← from headings
 *   heading(FileId, Level, Text, Line)
 *   link(FileId, Target, Text, Line)                 ← [text](target) and [text][ref]
 *   code_block(FileId, Lang, Line)
 *   code_defines(FileId, Symbol, Lang, Line)         ← from extracted fenced JS/Python
 *   todo(FileId, Tag, Text, Line)                    ← TODO/FIXME/HACK/XXX/NOTE
 *   frontmatter(FileId, Key, Value)
 *   doc_ref(FileId, Target, Line)                   ← [[wiki-link]]
 *   bullet(FileId, Text, Line)                     ← list items
 *   string_lit(FileId, Text, Line)                 ← sensitive-looking strings
 */
import { fact } from '../lift/fact-model.js'
import { extractGeneric } from './generic.js'

const SENSITIVE = /(password|secret|api[_-]?key|private[_-]?key|access[_-]?token|tenant-\w{8,})/i

export function extractMarkdown(fileId, code) {
  const facts = []
  const lines = code.split('\n')
  let inFront = false, inCode = false, codeLang = '', codeFrom = 0, codeBuf = []
  const linkDefs = new Map() // [ref]: url

  const add = (p, ...args) => facts.push(fact(p, ...args))

  add('file', fileId, 'markdown')

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const ln = i + 1
    const t = raw.trim()

    // --- frontmatter (YAML, must start at line 1) ---
    if (ln === 1 && t === '---') { inFront = true; continue }
    if (inFront) {
      if (t === '---') { inFront = false; continue }
      const fm = t.match(/^(\w[\w-]*)\s*:\s*(.+)$/)
      if (fm) add('frontmatter', fileId, fm[1], fm[2].trim())
      continue
    }

    // --- fenced code block ---
    if (/^```/.test(t)) {
      if (!inCode) {
        codeLang = t.slice(3).trim().toLowerCase() || 'text'
        inCode = true; codeFrom = ln; codeBuf = []
      } else {
        inCode = false
        add('code_block', fileId, codeLang, codeFrom)
        // If it's a JavaScript/Python/etc block, run generic extraction on the content
        // so definitions inside doc code blocks link into the call graph.
        const src = codeBuf.join('\n')
        if (['js','javascript','mjs'].includes(codeLang) || ['py','python'].includes(codeLang)) {
          const langName = ['py','python'].includes(codeLang) ? 'python' : 'javascript'
          const inner = extractGeneric(`${fileId}:${codeFrom}`, src, langName)
          for (const f of inner) {
            if (f.pred === 'defines') add('code_defines', fileId, f.args[2], codeLang, codeFrom)
          }
        }
      }
      continue
    }
    if (inCode) { codeBuf.push(raw); continue }

    // --- heading ---
    const h = t.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const text = h[2].replace(/\s*\{#[\w-]+\}\s*$/, '').trim()
      add('heading', fileId, level, text.replace(/[|]/g, ' '), ln)
      add('defines', fileId, text.replace(/[|]/g, ' '), 'section', ln)
      continue
    }

    // --- TODO / FIXME markers ---
    const td = t.match(/\b(TODO|FIXME|HACK|XXX|NOTE)\b[:\-]?\s*(.*)/i)
    if (td) {
      add('todo', fileId, td[1].toUpperCase(), td[2].trim() || td[1], ln)
      // don't continue — still extract links from the same line
    }

    // --- link definitions [ref]: url ---
    const ld = t.match(/^\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+["'(].*["')])?\s*$/)
    if (ld) { linkDefs.set(ld[1].toLowerCase(), ld[2] || ld[3]); continue }

    // --- inline links [text](url) ---
    let linkM
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
    while ((linkM = linkRe.exec(t)) !== null) {
      add('link', fileId, linkM[2], linkM[1].replace(/[|]/g, ' '), ln)
    }

    // --- reference links [text][ref] or [text][] ---
    const refRe = /\[([^\]]+)\]\[([^\]]*)\]/g
    while ((linkM = refRe.exec(t)) !== null) {
      const target = linkM[2] || linkM[1]
      const resolved = linkDefs.get(target.toLowerCase())
      if (resolved) add('link', fileId, resolved, linkM[1].replace(/[|]/g, ' '), ln)
    }

    // --- auto-links (bare URLs in angle brackets) ---
    const auto = t.match(/<(https?:\/\/[^>]+)>/)
    if (auto) add('link', fileId, auto[1], auto[1], ln)

    // --- wiki-style [[link]] ---
    const wiki = /\[\[([^\]]+)\]\]/g
    while ((linkM = wiki.exec(t)) !== null) {
      add('doc_ref', fileId, linkM[1], ln)
    }

    // --- bullet points ---
    const bu = t.match(/^\s*[-*+]\s+(.+)$/)
    if (bu && !td) add('bullet', fileId, bu[1].replace(/[|]/g, ' '), ln)

    // --- sensitive strings (reuse governance concept) ---
    const ss = t.match(SENSITIVE)
    if (ss) add('string_lit', fileId, ss[1], ln)
  }

  return { facts, method: 'markdown-regex' }
}
