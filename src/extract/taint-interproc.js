/**
 * ★6 interprocedural taint summaries (within-file, name-resolved) — the
 * function-summary approximation of IFDS (Reps–Horwitz–Sagiv POPL'95). Two
 * sound-leaning passes feed the emit pipeline in `taint.js`:
 *
 *   summarizeReturns(code)   → Set<Fn>            (tainted-RETURN conduits)
 *   summarizeParamSinks(code)→ Map<Fn, Sink[]>    (formal-param → internal sink)
 *
 * Both reset taint on the FN_DEF boundary to mirror the main loop's semantics.
 * Sound-leaning throughout: we record a summary ONLY when we can argue the flow,
 * so the interprocedural step adds true positives without reintroducing the ★3
 * false XSS (docs/10 §三, §六).
 */
import {
  SOURCE, SANITIZER, SINK, FN_DEF, RETURN,
  noStr, mentions, classifyXssCt, fnNameOf, calleeOf, paramsOf, sinkValueExpr,
} from './taint-patterns.js'

const isComment = (line) => !line || line.startsWith('//') || line.startsWith('*')

/**
 * Pass 1a — tainted-RETURN summaries. Returns `{ conduits, returnCalls }`:
 *   conduits     Set<Fn>          a function is a conduit iff it `return`s a BARE
 *                                 tainted variable or a direct SOURCE access.
 *   returnCalls  [[Fn, Callee]]   `return callee(..)` to a BARE callee — Fn is a
 *                                 conduit IFF Callee is (a transitive conduit,
 *                                 resolved against the conduit set post-link in
 *                                 taint-link.js — the ★6 slice-6 cross-file
 *                                 fixpoint). A method/dotted callee (`db.query`)
 *                                 is not bare → never a transitive conduit.
 * `return f(tainted)` alone is NOT a direct summary — it returns f's RESULT, not
 * the input — so the base case stays sound-leaning; transitivity only fires when
 * f is itself a proven conduit (docs/10 §三, §十).
 */
export function summarizeReturns(code) {
  const conduits = new Set()
  const returnCalls = []
  let taint = new Set()
  let fn = null
  for (const raw of code.split('\n')) {
    const line = raw.trim()
    if (isComment(line)) continue
    if (FN_DEF.test(line)) taint = new Set()
    const name = fnNameOf(line)
    if (name) fn = name
    const asg = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?);?$/)
    if (asg) {
      const rhs = noStr(asg[2])
      if (SANITIZER.test(rhs)) taint.delete(asg[1])
      else if (SOURCE.test(rhs) || [...taint].some((v) => mentions(rhs, v))) taint.add(asg[1])
    }
    const rm = line.match(RETURN)
    if (rm && fn) {
      const blanked = noStr(rm[1]) // strings → '' so a // inside one is not seen as a comment
      const ci = blanked.indexOf('//')
      const e = (ci >= 0 ? rm[1].slice(0, ci) : rm[1]).trim() // drop a trailing line comment
      if ((/^[A-Za-z_]\w*$/.test(e) && taint.has(e)) || (!e.includes('(') && SOURCE.test(noStr(e)))) conduits.add(fn)
      const callee = calleeOf(e)
      if (callee) returnCalls.push([fn, callee]) // transitive candidate (resolved post-link)
    }
  }
  return { conduits, returnCalls }
}

/**
 * Pass 1b — param-sink summaries (taint-INTO-callee). Tracks which FORMAL
 * PARAMETER indices reach the DANGEROUS-VALUE position of a sink inside the
 * function body, emitting `param_sink(Fn, Idx, Kind, Ct)`. Ct is the sink's
 * content-type for xss (so the call site can reuse the ★3 `html_safe`
 * suppression) or 'na' otherwise. Using sinkValueExpr (value, not receiver)
 * keeps receiver params (`db`/`res`/`reply`) OUT of the summary — the precision
 * guard that stops a JSON wrapper from being recorded as a param-sink (§六).
 */
export function summarizeParamSinks(code) {
  const sinks = new Map() // fn -> [{ idx, kind, ct }]
  let pt = new Map() // var -> Set(param index it derives from)
  let fn = null
  const add = (f, idx, kind, ct) => {
    if (!sinks.has(f)) sinks.set(f, [])
    const arr = sinks.get(f)
    if (!arr.some((s) => s.idx === idx && s.kind === kind)) arr.push({ idx, kind, ct })
  }
  for (const raw of code.split('\n')) {
    const line = raw.trim()
    if (isComment(line)) continue
    if (FN_DEF.test(line)) { // new function: reseed param-taint from its formals
      pt = new Map()
      paramsOf(line).forEach((p, i) => pt.set(p, new Set([i])))
    }
    const name = fnNameOf(line)
    if (name) fn = name
    const asg = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?);?$/)
    if (asg) {
      const rhs = noStr(asg[2])
      if (SANITIZER.test(rhs)) pt.delete(asg[1])
      else { // propagate param-derived taint by mention (a call RESULT carries none — sound)
        const idxs = new Set()
        for (const [v, s] of pt) if (mentions(rhs, v)) for (const i of s) idxs.add(i)
        if (idxs.size) pt.set(asg[1], idxs)
      }
    }
    if (!fn) continue
    const code2 = noStr(line)
    for (const { re, kind } of SINK) {
      if (!re.test(code2)) continue
      const val = sinkValueExpr(code2, kind)
      const ct = kind === 'xss' ? classifyXssCt(line) : 'na'
      for (const [v, s] of pt) if (mentions(val, v)) for (const i of s) add(fn, i, kind, ct)
      break
    }
  }
  return sinks
}

/**
 * The set of function names DEFINED in this file (decl / arrow-const / method).
 * Lets the ★6d cross-file returns-taint pass gate `ret_call` emission to
 * callees that are NOT local — i.e. genuine import / global candidates — so a
 * local non-conduit call adds nothing and the fact-base stays lean. A definition
 * `fnNameOf` misses just leaves its name off the set (the callee is treated as
 * external → resolved same-file by the linker → skipped: a harmless inert fact).
 */
export function localFnNames(code) {
  const names = new Set()
  for (const raw of code.split('\n')) {
    const n = fnNameOf(raw.trim())
    if (n) names.add(n)
  }
  return names
}
