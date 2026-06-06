% =====================================================================
% governance.pl — example PROPERTY rules expressed as violation/2.
%
% This is the pluggable layer: drop in your own .pl file with more
% violation/2 clauses and formal-atlas will load it automatically.
% Each clause is a machine-checked specification of an anti-pattern,
% directly analogous to the FDRS six-pillar assertions — but now over a
% DEEP fact base (call graph + semantics), not whole-file regex flags.
%
% Convention: violation(Subject, RuleId) where Subject is a file id or a
% routine name, and RuleId is a kebab-case atom naming the rule.
% =====================================================================

% P1 (membrane): synchronous crypto inside a loop, no isolation hint.
violation(Scope, 'crypto-in-loop') :-
    crypto_in_loop(Scope).

% Serial awaits inside a loop (often an N+1 / latency anti-pattern).
violation(Scope, 'await-in-loop') :-
    awaits_in_loop(Scope).

% Network egress from a routine (review for proxy/allowlist boundary).
violation(Scope, 'external-call') :-
    calls_external(Scope, _).

% Hardcoded sensitive literal (tenant id / secret / token) in source.
violation(File, 'hardcoded-sensitive') :-
    string_lit(File, _, _).

% Dead code is a (low-severity) maintainability violation.
violation(Name, 'dead-code') :-
    dead_code(_, Name).

% A routine the lifter marked with a STATE-CHANGING effect but whose name
% claims read-only intent — a semantic contradiction worth a human's eyes.
% Plain DB *reads* (findMany/findUnique) and filesystem reads / crypto /
% logging do NOT count: a "read" that reads from a database or file is not a
% contradiction. Fires only on egress (network) or a real state MUTATION
% (bulk/raw DB writes, setState/dispatch/commit/emit/publish).
violation(Name, 'intent-effect-mismatch') :-
    intent(Name, read),
    side_effect(Name, Effect),
    member(Effect, [network, mutation]).
