/**
 * ★6c/★6d cross-file taint join — the post-link half of the interprocedural
 * slices. The per-file extractor cannot see another file's summaries, so it
 * emits resolvable facts instead of joining eagerly:
 *   param_sink('File::Fn', Idx, Kind, Ct)   a formal that reaches an internal sink
 *   taint_arg(File, Callee, Idx, ArgNode)    a tainted value passed at a call site
 *   taint_returns_q('File::Fn')              a tainted-RETURN conduit (QId-keyed)
 *   ret_call(File, Callee, Xnode)            `const x = callee(..)` to a non-local callee
 *
 * This pass (run AFTER `link()`, so `decl/4` exists) resolves each call's bare
 * callee to a file-qualified definition. Two joins, both SOUND-leaning:
 *   ★6c param-sink: when the callee carries a matching param_sink in a DIFFERENT
 *     file, emit a VIRTUAL sink at the call site — exactly the shape the
 *     within-file step emits, so the unchanged violation/html_safe rules fire
 *     (and a Ct=json wrapper stays suppressed).
 *   ★6d return-taint: when the callee resolves to a conduit (taint_returns_q) in
 *     a DIFFERENT file, source the assigned var Xnode — the within-file edge from
 *     Xnode to its sink is already present, so the tainted/2 closure carries it.
 *
 * Resolution mirrors the linker's order: (1) an ES import_binding (resolve the
 * module specifier to a project file, honoring `import { x as y }` aliases), (2)
 * a same-file definition, (3) a project-global UNIQUE definition. An ambiguous
 * name (>1 home, no import) is left unresolved — a false negative, never a
 * cross-file false positive. Same-file resolutions are skipped here — the
 * extractor already handled them.
 */
import { fact } from '../lift/fact-model.js'
import { resolveModule } from './linker.js'

export function linkTaint(facts) {
  const fileSet = new Set()
  const localOf = new Map() // 'file name' -> qid
  const globalByName = new Map() // name -> Set(qid)
  const fileOfQid = new Map() // qid -> defining file
  const paramSinkByQid = new Map() // qid -> [{ idx, kind, ct }]
  const conduitQids = new Set() // ★6d qid of a tainted-RETURN conduit (taint_returns_q)
  const retCalls = [] // ★6d { file, callee, xnode } — `const x = callee(..)` to a non-local callee
  const imports = new Map() // file -> Map(local -> { mod, imported })

  for (const { pred, args } of facts) {
    if (pred === 'file') fileSet.add(String(args[0]))
    else if (pred === 'decl') {
      const [qid, file, name] = args.map(String)
      localOf.set(`${file} ${name}`, qid)
      if (!globalByName.has(name)) globalByName.set(name, new Set())
      globalByName.get(name).add(qid)
      fileOfQid.set(qid, file)
    } else if (pred === 'import_binding') {
      const [file, local, mod, imported] = args.map(String)
      if (!imports.has(file)) imports.set(file, new Map())
      imports.get(file).set(local, { mod, imported })
    } else if (pred === 'param_sink') {
      const qid = String(args[0])
      if (!paramSinkByQid.has(qid)) paramSinkByQid.set(qid, [])
      paramSinkByQid.get(qid).push({ idx: Number(args[1]), kind: String(args[2]), ct: String(args[3]) })
    } else if (pred === 'taint_returns_q') {
      conduitQids.add(String(args[0]))
    } else if (pred === 'ret_call') {
      retCalls.push({ file: String(args[0]), callee: String(args[1]), xnode: String(args[2]) })
    }
  }

  const localOfFn = (file, name) => localOf.get(`${file} ${name}`)
  const resolve = (file, callee) => {
    const ib = imports.get(file)?.get(callee) // (1) import binding → defining file
    if (ib) {
      const tgt = resolveModule(file, ib.mod, fileSet)
      const tgtName = (ib.imported === 'default' || ib.imported === '*') ? callee : ib.imported
      if (tgt) return localOfFn(tgt, tgtName) || null
    }
    const l = localOfFn(file, callee) // (2) same-file
    if (l) return l
    const set = globalByName.get(callee) // (3) project-global-unique
    return set && set.size === 1 ? [...set][0] : null
  }

  const out = []
  for (const { pred, args } of facts) {
    if (pred !== 'taint_arg') continue
    const file = String(args[0])
    const qid = resolve(file, String(args[1]))
    if (!qid || fileOfQid.get(qid) === file) continue // unresolved, or same-file (extractor did it)
    const list = paramSinkByQid.get(qid)
    if (!list) continue
    const idx = Number(args[2])
    const argNode = String(args[3])
    for (const s of list) {
      if (s.idx !== idx) continue
      const site = `${argNode}:xsink_${String(args[1])}_${idx}`
      out.push(fact('sink', site, s.kind))
      if (s.kind === 'xss') out.push(fact('sink_ct', site, s.ct))
      out.push(fact('dataflow', argNode, site))
    }
  }

  // ★6d cross-file RETURN join: a `const x = callee(..)` whose callee resolves to
  // a tainted-RETURN conduit in ANOTHER file sources x — the within-file edge from
  // x to its sink was already laid down, so the tainted/2 closure now carries it.
  // Same-file is skipped (the extractor's ★6a step already sourced it).
  for (const { file, callee, xnode } of retCalls) {
    const qid = resolve(file, callee)
    if (qid && fileOfQid.get(qid) !== file && conduitQids.has(qid)) out.push(fact('source', xnode))
  }
  return out
}
