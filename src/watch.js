#!/usr/bin/env node
/**
 * formal-atlas watch — monitor file changes, auto-extract and verify.
 *
 * Watches a project directory for file changes, incrementally re-extracts
 * changed files, and re-runs governance verification. New violations are
 * printed to stderr.
 */
import fs from 'node:fs'
import path from 'node:path'
import { walkFiles, extractProject, buildProgram } from './pipeline.js'
import { runQuery } from './verify/prolog-engine.js'
import { getCached, setCache, invalidate } from './cache.js'

const EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.c', '.h', '.cpp', '.cc', '.cs', '.scala', '.swift',
])

let lastViolations = new Set()

function violationKey(v) {
  return `${v.Subject}::${v.Rule}`
}

export async function watch(root, { debounce = 1000 } = {}) {
  const abs = path.resolve(root)
  console.error(`[formal-atlas] watching ${abs} ...`)

  // Initial extraction
  console.error('[formal-atlas] initial extraction ...')
  const proj = await extractProject(abs, { lift: 'offline' })
  const program = buildProgram(proj)
  const rows = await runQuery(program, 'violation(Subject, Rule).')
  lastViolations = new Set(rows.map(violationKey))
  console.error(`[formal-atlas] ${proj.fileCount} files, ${rows.length} violations found`)

  // Watch
  let timer = null
  const changed = new Set()

  const watcher = fs.watch(abs, { recursive: true }, (event, filename) => {
    if (!filename) return
    const ext = path.extname(filename)
    if (!EXTS.has(ext)) return
    changed.add(path.join(abs, filename))
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      const files = [...changed]
      changed.clear()
      console.error(`[formal-atlas] ${files.length} file(s) changed, re-extracting ...`)

      // Invalidate cache for changed files
      for (const f of files) invalidate(f)

      try {
        const proj2 = await extractProject(abs, { lift: 'offline' })
        const program2 = buildProgram(proj2)
        const rows2 = await runQuery(program2, 'violation(Subject, Rule).')
        const newViolations = new Set(rows2.map(violationKey))

        // Find newly appeared violations
        const added = rows2.filter(v => !lastViolations.has(violationKey(v)))
        const removed = [...lastViolations].filter(k => !newViolations.has(k))

        if (added.length > 0) {
          console.error(`[formal-atlas] ⚠ ${added.length} NEW violation(s):`)
          for (const v of added) console.error(`  ${v.Subject}: ${v.Rule}`)
        }
        if (removed.length > 0) {
          console.error(`[formal-atlas] ✓ ${removed.length} violation(s) resolved`)
        }
        if (added.length === 0 && removed.length === 0) {
          console.error('[formal-atlas] no new violations')
        }

        lastViolations = newViolations
      } catch (e) {
        console.error(`[formal-atlas] error: ${e.message}`)
      }
    }, debounce)
  })

  watcher.on('error', (e) => console.error(`[formal-atlas] watch error: ${e.message}`))

  // Keep process alive
  return new Promise(() => {})
}
