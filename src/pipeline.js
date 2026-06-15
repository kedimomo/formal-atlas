/**
 * Pipeline orchestration: walk a target, extract facts from every file,
 * optionally run the semantic lift, and assemble a complete Prolog program
 * (rules + facts) ready for the engine.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { extractFile } from './extract/index.js'
import { dedupe, factsToProlog } from './lift/fact-model.js'
import { liftOffline, liftOnline } from './lift/ai-lifter.js'
import { link } from './link/linker.js'
import { linkTaint } from './link/taint-link.js'
import { materialize } from './verify/datalog.js'
import { pointsTo } from './verify/pointsto/andersen.js'
import { applyModels } from './models/index.js'
import { getCached, setCache } from './cache.js'
import { generateHoareOffline, generateHoareOnline } from './formalize/hoare.js'
import { generateInvariantsOffline, generateInvariantsOnline } from './formalize/invariant.js'
import { generateRefinementsOffline, generateRefinementsOnline } from './formalize/refinement.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const RULES_DIR = path.join(__dirname, 'rules')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.formal-atlas-cache', 'vendor', '__pycache__'])
const EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.c', '.h', '.cpp', '.cc', '.cs', '.scala', '.swift', '.prisma', '.sql',
])

export function walkFiles(root, ignoredExts = null) {
  const out = []
  const st = fs.statSync(root)
  if (st.isFile()) return [{ abs: root, fileId: path.basename(root), ext: path.extname(root) }]
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(abs)
      } else {
        const ext = path.extname(e.name)
        if (EXTS.has(ext)) {
          out.push({ abs, fileId: path.relative(root, abs).replace(/\\/g, '/'), ext })
        } else if (ignoredExts && ext) {
          ignoredExts.set(ext, (ignoredExts.get(ext) || 0) + 1)
        }
      }
    }
  }
  return out
}

/** How-to-fix hint for an unrecognized file extension. */
function addLangHint(ext) {
  const stem = GRAMMAR_STEMS[ext]
  if (stem) return [stem]
  // Heuristic: try to guess the tree-sitter grammar name
  const guess = EXT_TO_GRAMMAR[ext]
  if (guess && !TS_LANGS[ext]) return [guess]
  return null
}

// Grammar-stem lookup for the hint (documented, not used by extraction).
const GRAMMAR_STEMS = {
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.c': 'c', '.h': 'c',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.scala': 'scala', '.swift': 'swift', '.kt': 'kotlin',
  '.sh': 'bash', '.bash': 'bash', '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown',
  '.lua': 'lua', '.r': 'r', '.hs': 'haskell', '.ml': 'ocaml', '.elm': 'elm', '.zig': 'zig',
}
const EXT_TO_GRAMMAR = {
  '.cpp': 'cpp', '.cc': 'cpp', '.c': 'c', '.h': 'c', '.cs': 'csharp',
  '.rb': 'ruby', '.php': 'php', '.scala': 'scala', '.swift': 'swift', '.kt': 'kotlin',
}

// ---- 程序级缓存（仿 fdrs-mcp 的 ensureDir + fs 直接读写）----

function programCacheDir() {
  // Use same CACHE_ROOT logic as src/cache.js
  const MODE = process.env.FORMAL_ATLAS_MODE || 'standalone'
  const root = MODE === 'mcp'
    ? path.join(process.env.FORMAL_ATLAS_PROJECT_ROOT || process.cwd(), '.formal-atlas-cache')
    : path.join(__dirname, '..', '.cache')
  const d = path.join(root, 'programs')
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  return d
}

function computeStatManifest(files, opts) {
  // Lightweight manifest from file mtimes + sizes (no content read).
  // Serves as a sentinel: if unchanged, content-based extract caches are all valid.
  const parts = files.map(f => {
    try {
      const s = fs.statSync(f.abs)
      return `${f.fileId}:${s.mtimeMs}:${s.size}`
    } catch { return `${f.fileId}:0:0` }
  }).sort()
  parts.push(`eg=${opts.engine},pt=${opts.pointsToEnabled ? 1 : 0},fw=${opts.frameworkEnabled ? 1 : 0}`)
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex')
}

// Clean old manifests; keep the last N
function cleanOldPrograms(keep = 3) {
  try {
    const dir = programCacheDir()
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({
      name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    })).sort((a, b) => b.mtime - a.mtime)
    for (const f of files.slice(keep)) {
      try { fs.unlinkSync(path.join(dir, f.name)) } catch { /* skip */ }
    }
  } catch { /* dir may not exist yet */ }
}

export async function extractProject(root, { lift = 'offline', formalize = 'off', maxFiles = 5000, engine = 'prolog', pointsToEnabled = false, frameworkEnabled = false } = {}) {
  const ignoredExts = new Map()
  const files = walkFiles(root, ignoredExts).slice(0, maxFiles)

  // --- 程序级缓存检查（仿 fdrs-mcp: fs.existsSync → fs.readFileSync → JSON.parse）---
  const statManifest = computeStatManifest(files, { engine, pointsToEnabled, frameworkEnabled })
  const progPath = path.join(programCacheDir(), `${statManifest}.json`)
  if (fs.existsSync(progPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(progPath, 'utf8'))
      if (cached.v === 1 && Array.isArray(cached.facts)) {
        return { facts: cached.facts, rawLines: cached.rawLines || [], fileCount: cached.fileCount, methods: { program_cache: 1 }, ignoredExts: new Map() }
      }
    } catch { /* 损坏 → 重建 */ }
  }

  let facts = []
  const rawLines = []
  const methods = {}
  for (const { abs, fileId, ext } of files) {
    let code
    try { code = fs.readFileSync(abs, 'utf8') } catch { continue }
    let ff, method
    const cached = getCached(abs, code)
    if (cached) {
      ff = cached
      method = 'cache'
    } else {
      const result = await extractFile(fileId, code, ext)
      ff = result.facts
      method = result.method
      setCache(abs, code, ff)
    }
    methods[method] = (methods[method] || 0) + 1
    facts.push(...ff)
    // ★7 points-to: run Andersen per-file (so bare base-relation names can't
    // collide across files), and lower each resolved variable-call into a
    // SYNTHETIC calls3 edge — the linker then QId-resolves it exactly like a real
    // call, so reaches/dead_code see the dynamic-dispatch edge. Opt-in (--points-to).
    if (pointsToEnabled) {
      for (const r of pointsTo(ff).resolved) {
        const [scope, fn] = r.split('\t')
        facts.push({ pred: 'calls3', args: [fileId, scope, fn] })
      }
    }
    if (lift === 'online') {
      const online = await liftOnline(fileId, code, ff)
      if (online) rawLines.push(...online)
    }
  }
  if (lift !== 'none') facts.push(...liftOffline(facts))
  // AI formalization: Hoare triples + loop invariants
  if (formalize !== 'off') {
    const hoareFacts = formalize === 'online'
      ? (await generateHoareOnline(facts)).length > 0 ? await generateHoareOnline(facts) : generateHoareOffline(facts)
      : generateHoareOffline(facts)
    facts.push(...hoareFacts)
    const invFacts = formalize === 'online'
      ? (await generateInvariantsOnline(facts)).length > 0 ? await generateInvariantsOnline(facts) : generateInvariantsOffline(facts)
      : generateInvariantsOffline(facts)
    facts.push(...invFacts)
    // Refinement predicates { v:T | φ } over args/return (decidable QF-LIA, ★2).
    let refFacts = formalize === 'online' ? await generateRefinementsOnline(facts) : []
    if (!refFacts.length) refFacts = generateRefinementsOffline(facts)
    facts.push(...refFacts)
  }
  // stage-1 framework models (docs/15): map http_route signals → entry/calls3 so
  // route handlers become reachable from their registering scope. Before link() so
  // the synthetic calls3 is QId-resolved. Opt-in (--framework); off ⇒ bit-identical.
  if (frameworkEnabled) facts.push(...applyModels(facts))
  // Scope-aware linking: resolve bare-name call edges into a file-qualified
  // graph (decl/node/rcall) so downstream rules stop merging same-name funcs.
  facts.push(...link(facts))
  // ★6c cross-file taint: resolve taint_arg call sites against param_sink
  // summaries in other files (needs decl/4 from link above) → virtual sinks.
  facts.push(...linkTaint(facts))
  facts = dedupe(facts)
  // ★5 scale engine (docs/11): materialize the expensive closures (dead_code,
  // tainted) with the zero-install semi-naive engine and assert engine_materialized,
  // so tau-prolog's recursive rules short-circuit and violation/2 reads the facts.
  // Opt-in (engine='datalog'); default 'prolog' leaves the fact base untouched.
  if (engine === 'datalog') facts.push(...materialize(facts))

  // --- 保存程序缓存（仿 fdrs-mcp: ensureDir → fs.writeFileSync）---
  try {
    fs.writeFileSync(progPath, JSON.stringify({ v: 1, facts, rawLines, fileCount: files.length }))
    cleanOldPrograms(3)
  } catch { /* 写盘失败不阻塞 */ }

  return { facts, rawLines, fileCount: files.length, methods, ignoredExts }
}

export function loadRules(rulesDir = RULES_DIR) {
  return fs.readdirSync(rulesDir).filter((f) => f.endsWith('.pl')).sort()
    .map((f) => `% ==== ${f} ====\n${fs.readFileSync(path.join(rulesDir, f), 'utf8')}`)
    .join('\n\n')
}

export function buildProgram({ facts, rawLines = [] }, rulesDir = RULES_DIR) {
  const rules = loadRules(rulesDir)
  const factText = factsToProlog(facts, ['EXTRACTED FACTS'])
  const ai = rawLines.length ? `\n% ===== AI SEMANTIC FACTS =====\n${rawLines.join('\n')}\n` : ''
  return `${rules}\n\n${factText}${ai}`
}
