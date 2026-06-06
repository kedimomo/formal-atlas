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

% A node is tainted if it is a source, or untrusted data flows into it.
tainted(N) :- tainted_(N, [N]).
tainted_(N, _) :- source(N).
tainted_(N, Visited) :-
    dataflow(M, N),
    \+ member(M, Visited),
    tainted_(M, [M|Visited]).

% A node is sanitized if a sanitizer sits directly upstream of it.
sanitized_into(N) :- dataflow(S, N), sanitizer(S).

% VIOLATION: untrusted data reaches a sink and was not sanitized.
violation(N, 'taint-reaches-sink') :-
    sink(N, _),
    tainted(N),
    \+ sanitized_into(N).
