/**
 * Data-flow taint extraction (ported from the `logos` draft, hardened).
 * Line-level heuristic: tracks untrusted INPUT (req/argv/location/prompt)
 * flowing through assignments into dangerous SINKS (SQL/command/XSS), noting
 * SANITIZERS that neutralize it. String-literal contents are blanked before
 * matching, so a variable name inside a string can't fake a flow. Taint does
 * NOT cross function boundaries (reset on each function def) — the
 * interprocedural reach is added by the ★6 summaries below.
 *
 * Emits for rules/taint.pl:
 *   source(Id) · sink(Id, Kind) · sanitizer(Id) · dataflow(A, B)   (Id='file:line:tag')
 *   sink_ct(Id, json|html|unknown)   (★3: content-type refinement for xss sinks)
 *   taint_returns(Fn)                (★6a: within-file tainted-RETURN summary)
 *   param_sink(Fn, Idx, Kind, Ct)    (★6b: formal-param → internal sink summary)
 * ★6 interprocedural steps (sound-leaning, always-on — they add true positives
 * without reintroducing the ★3 false XSS, see docs/10):
 *   a) `const x = helper(..)` where `helper` returns untrusted data taints `x`.
 *   b) `helper(.., tainted, ..)` where `helper`'s formal at that index reaches a
 *      sink injects a VIRTUAL sink at the call site — reusing the SAME
 *      violation/html_safe rules, so a JSON wrapper (Ct=json) stays suppressed.
 * Coarse on purpose (intra-file, name-based); the symbolic rules give the verdict.
 */
import { fact } from '../lift/fact-model.js'
import {
  SOURCE, SANITIZER, SINK, FN_DEF,
  idOf, noStr, mentions, classifyXssCt, calleeOf, callSiteArgs,
} from './taint-patterns.js'
import { summarizeReturns, summarizeParamSinks } from './taint-interproc.js'

/**
 * ★6b — resolve a call argument to its taint-source node (or null if clean).
 * A bare tainted variable carries its existing node; an inline SOURCE or a
 * tainted-RETURN call (★6a) introduces a fresh source at the call site.
 */
function argSource(arg, taint, returnsTaint, facts, fileId, ln, tag) {
  const bare = arg.trim()
  if (/^[A-Za-z_]\w*$/.test(bare) && taint.has(bare)) return taint.get(bare)
  const isReturnsTaintCall = (() => { const c = calleeOf(bare); return c && returnsTaint.has(c) })()
  if (SOURCE.test(arg) || isReturnsTaintCall) {
    const src = idOf(fileId, ln, tag)
    facts.push(fact('source', src))
    return src
  }
  return null
}

export function extractTaintJs(fileId, code) {
  const facts = []
  const taint = new Map() // varName -> node id (currently tainted)
  const returnsTaint = summarizeReturns(code) // ★6a: functions that return untrusted data
  const paramSinks = summarizeParamSinks(code) // ★6b: fn -> [{idx, kind, ct}] reaching a sink
  for (const fn of returnsTaint) facts.push(fact('taint_returns', fn))
  for (const [fn, list] of paramSinks) for (const { idx, kind, ct } of list) facts.push(fact('param_sink', fn, idx, kind, ct))

  code.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const ln = i + 1
    if (!line || line.startsWith('//') || line.startsWith('*')) return
    if (FN_DEF.test(line)) taint.clear() // taint does not cross function boundaries
    const code2 = noStr(line)

    // ★6b: within-file call to a param-sink helper with a tainted argument →
    // a virtual sink at the call site (reuses the existing violation rules, so
    // a provably-JSON wrapper stays suppressed by the ★3 content-type guard).
    for (const [callee, list] of paramSinks) {
      const args = callSiteArgs(code2, callee)
      if (!args) continue
      for (const { idx, kind, ct } of list) {
        if (args[idx] == null) continue
        const src = argSource(args[idx], taint, returnsTaint, facts, fileId, ln, `psrc_${callee}_${idx}`)
        if (!src) continue
        const site = idOf(fileId, ln, `psink_${callee}_${idx}`)
        facts.push(fact('sink', site, kind))
        if (kind === 'xss') facts.push(fact('sink_ct', site, ct))
        facts.push(fact('dataflow', src, site))
      }
    }

    const asg = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+?);?$/)
    if (asg) {
      const name = asg[1]
      const rhs = noStr(asg[2])
      const id = idOf(fileId, ln, name)
      if (SANITIZER.test(rhs)) {
        facts.push(fact('sanitizer', id))
        const up = [...taint].find(([v]) => mentions(rhs, v))
        if (up) facts.push(fact('dataflow', up[1], id))
        taint.delete(name)
        return
      }
      if (SOURCE.test(rhs)) { facts.push(fact('source', id)); taint.set(name, id) }
      else {
        const callee = calleeOf(rhs)
        const up = [...taint].find(([v]) => mentions(rhs, v))
        if (callee && returnsTaint.has(callee)) { facts.push(fact('source', id)); taint.set(name, id) } // ★6a: tainted-return summary
        else if (up) { facts.push(fact('dataflow', up[1], id)); taint.set(name, id) }
      }
    }

    for (const { re, kind } of SINK) {
      if (!re.test(code2)) continue
      const sinkId = idOf(fileId, ln, `sink_${kind}`)
      facts.push(fact('sink', sinkId, kind))
      if (kind === 'xss') facts.push(fact('sink_ct', sinkId, classifyXssCt(line))) // ★3: content-type refinement
      const tv = [...taint].find(([v]) => mentions(code2, v))
      if (tv) facts.push(fact('dataflow', tv[1], sinkId))
      else if (SOURCE.test(code2)) {
        const sId = idOf(fileId, ln, 'src_inline')
        facts.push(fact('source', sId), fact('dataflow', sId, sinkId))
      }
      break
    }
  })
  return facts
}
