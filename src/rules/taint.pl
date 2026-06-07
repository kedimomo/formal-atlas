% =====================================================================
% taint.pl — data-flow taint analysis (CWE-89 / CWE-79 family).
%
% Ported & adapted from the `logos` draft and folded into formal-atlas.
% Untrusted input that reaches a dangerous sink WITHOUT passing through a
% sanitizer is a vulnerability. Facts (source/sink/sanitizer/dataflow) come
% from src/extract/taint.js; member/2 is shared from structural.pl.
%
% Semantics: least fixpoint of the immediate-consequence operator; the
% backward `tainted_/2` walk is cycle-safe via a Visited accumulator.
% =====================================================================

:- dynamic(source/1).
:- dynamic(sink/2).
:- dynamic(sanitizer/1).
:- dynamic(dataflow/2).
:- dynamic(sink_ct/2).
:- dynamic(taint_returns/1).
:- dynamic(taint_returns_q/1).
:- dynamic(ret_call/3).
:- dynamic(param_sink/4).

% ★6b param-sink summaries: param_sink(Fn, Idx, Kind, Ct) records that Fn's
% formal parameter at Idx reaches an internal sink of Kind (Ct = xss
% content-type, or 'na'). The extractor joins this at within-file call sites by
% emitting a VIRTUAL sink (sink/2 + sink_ct/2 + dataflow/2) — so the violation
% and html_safe rules below fire on interprocedural flows UNCHANGED, and a
% provably-JSON wrapper (Ct=json) is suppressed exactly as a direct one is.
% Declared dynamic for query safety; no separate rule needed (docs/10 §六).

% ★6d cross-file RETURN summaries: taint_returns_q('File::Fn') is the QId-keyed
% conduit fact, and ret_call(File, Callee, Xnode) records `const x = callee(..)`
% to a non-local callee. The post-link pass (src/link/taint-link.js) resolves
% Callee to a QId and, when it is a conduit in ANOTHER file, emits source(Xnode)
% — so the SAME tainted/2 closure carries it to a sink (the within-file edge from
% Xnode was already laid down). No new rule: the join reuses source/1.

% A node is tainted if it is a source, or untrusted data flows into it.
tainted(N) :- tainted_(N, [N]).
tainted_(N, _) :- source(N).
tainted_(N, Visited) :-
    dataflow(M, N),
    \+ member(M, Visited),
    tainted_(M, [M|Visited]).

% Witness flow: the source and the dataflow chain Source → ... → Sink that
% taints N (cycle-safe via the Visited accumulator). Used by the ★3 explainer
% to expose WHY a sink is tainted, not just THAT it is.
tainted_path(N, Source, Path) :- tainted_path_(N, [N], Source, [N], Path).
tainted_path_(N, _, N, Acc, Acc) :- source(N).
tainted_path_(N, Visited, Source, Acc, Path) :-
    dataflow(M, N),
    \+ member(M, Visited),
    tainted_path_(M, [M|Visited], Source, [M|Acc], Path).

% A node is sanitized if a sanitizer sits directly upstream of it.
sanitized_into(N) :- dataflow(S, N), sanitizer(S).

% ★3 content-type refinement: an xss sink whose response body is JSON-serialized
% (Fastify `reply.send(obj)` → application/json) is NOT an HTML/script sink — the
% framework escapes it. Only a PROVABLY-json content-type suppresses; `html` and
% `unknown` stay flagged (we suppress only what we can argue). When no sink_ct/2
% facts exist (extractor older / pass off), html_safe never holds ⇒ behavior is
% bit-identical to before (upgrade/rollback-safe).
html_safe(N) :- sink(N, xss), sink_ct(N, json).

% VIOLATION: untrusted data reaches a sink, was not sanitized, and the sink is
% not a provably-JSON response.
violation(N, 'taint-reaches-sink') :-
    sink(N, _),
    tainted(N),
    \+ sanitized_into(N),
    \+ html_safe(N).

% Auditing: xss sinks that WOULD have fired but are suppressed as JSON responses
% (★3 content-type refinement). Lets `verify` report the FP-suppression count.
suppressed_xss(N) :-
    sink(N, xss), tainted(N), \+ sanitized_into(N), sink_ct(N, json).
