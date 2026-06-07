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
 *   taint_returns_q('File::Fn')      (★6d: same, QId-keyed for the cross-file join)
 *   param_sink('File::Fn', Idx, Kind, Ct)  (★6b: formal-param → internal sink, QId-keyed)
 *   taint_arg(File, Callee, Idx, ArgNode)  (★6c: a tainted arg at a call site, for the
 *                                           cross-file join in src/link/taint-link.js)
 *   ret_call(File, Callee, Xnode)    (★6d: `const x = callee(..)` to a non-local callee —
 *                                           the post-link join sources Xnode iff Callee
 *                                           resolves to a tainted-RETURN conduit elsewhere)
 *   ret_returns_call('File::Fn', Callee)   (★6 slice-6: `return callee(..)` — Fn is a
 *                                           transitive conduit iff Callee is, via the
 *                                           cross-file fixpoint in taint-link.js)
 * ★6 interprocedural steps (sound-leaning, always-on — they add true positives
 * without reintroducing the ★3 false XSS, see docs/10):
 *   a) `const x = helper(..)` where `helper` returns untrusted data taints `x`.
 *   b) `helper(.., tainted, ..)` where `helper`'s formal at that index reaches a
 *      sink injects a VIRTUAL sink at the call site — reusing the SAME
 *      violation/html_safe rules, so a JSON wrapper (Ct=json) stays suppressed.
 *   c) the same join across files: the call site emits taint_arg/4 and the
 *      post-link pass resolves the callee to a param_sink in another file.
 *   d) the RETURN summary (a) joined across files: a cross-file `const x =
 *      conduit(..)` taints x via ret_call/3 + the post-link conduit resolution.
 * Coarse on purpose (intra-file, name-based); the symbolic rules give the verdict.
 */
import { fact } from '../lift/fact-model.js'
import {
  SOURCE, SANITIZER, SINK, FN_DEF,
  idOf, noStr, mentions, classifyXssCt, calleeOf, callSiteArgs, bareCalleesOf,
} from './taint-patterns.js'
import { summarizeReturns, summarizeParamSinks, localFnNames } from './taint-interproc.js'

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
  const retTaint = new Map() // ★6d varName -> node id (assigned a non-local call result; sourced cross-file)
  const { conduits: returnsTaint, returnCalls } = summarizeReturns(code) // ★6a + slice-6: conduits + transitive return-calls
  const paramSinks = summarizeParamSinks(code) // ★6b: fn -> [{idx, kind, ct}] reaching a sink
  const localFns = localFnNames(code) // ★6d: functions defined here (gate ret_call to non-local callees)
  for (const fn of returnsTaint) { facts.push(fact('taint_returns', fn)); facts.push(fact('taint_returns_q', `${fileId}::${fn}`)) }
  for (const [fn, callee] of returnCalls) facts.push(fact('ret_returns_call', `${fileId}::${fn}`, callee)) // ★6 slice-6: transitive conduit, resolved post-link
  for (const [fn, list] of paramSinks) for (const { idx, kind, ct } of list) facts.push(fact('param_sink', `${fileId}::${fn}`, idx, kind, ct))

  code.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const ln = i + 1
    if (!line || line.startsWith('//') || line.startsWith('*')) return
    if (FN_DEF.test(line)) { taint.clear(); retTaint.clear() } // taint does not cross function boundaries
    const code2 = noStr(line)

    // ★6b/c: scan call sites. A tainted-variable argument emits taint_arg/4 (for
    // the cross-file post-link join). When the callee is a LOCAL param-sink, the
    // arg is additionally resolved into a virtual sink right here (reusing the
    // existing violation rules, so a provably-JSON wrapper stays suppressed).
    for (const callee of bareCalleesOf(code2)) {
      const args = callSiteArgs(code2, callee)
      if (!args) continue
      const local = paramSinks.get(callee)
      args.forEach((arg, idx) => {
        const bare = arg.trim()
        if (/^[A-Za-z_]\w*$/.test(bare)) {
          if (taint.has(bare)) facts.push(fact('taint_arg', fileId, callee, idx, taint.get(bare)))
          else if (retTaint.has(bare)) facts.push(fact('taint_arg', fileId, callee, idx, retTaint.get(bare))) // ★6 slice-5: cross-file conduit result, 2-hop into a param-sink
        }
        const ps = local && local.find((s) => s.idx === idx)
        if (!ps) return
        const src = argSource(arg, taint, returnsTaint, facts, fileId, ln, `psrc_${callee}_${idx}`)
        if (!src) return
        const site = idOf(fileId, ln, `psink_${callee}_${idx}`)
        facts.push(fact('sink', site, ps.kind))
        if (ps.kind === 'xss') facts.push(fact('sink_ct', site, ps.ct))
        facts.push(fact('dataflow', src, site))
      })
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
        if (callee && returnsTaint.has(callee)) { facts.push(fact('source', id)); taint.set(name, id) } // ★6a: within-file tainted-return summary
        else if (up) { facts.push(fact('dataflow', up[1], id)); taint.set(name, id) }
        else if (callee && !localFns.has(callee)) { retTaint.set(name, id); facts.push(fact('ret_call', fileId, callee, id)) } // ★6d: x = nonLocal(..) — sourced cross-file iff a conduit
        else { const rup = [...retTaint].find(([v]) => mentions(rhs, v)); if (rup) { facts.push(fact('dataflow', rup[1], id)); retTaint.set(name, id) } } // ★6d: relabel a candidate downstream
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
      const rtv = [...retTaint].find(([v]) => mentions(code2, v))
      if (rtv) facts.push(fact('dataflow', rtv[1], sinkId)) // ★6d: inert until the cross-file conduit join sources rtv
      break
    }
  })
  return facts
}
