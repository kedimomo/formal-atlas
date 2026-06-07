% =====================================================================
% suggestions.pl — fix suggestions for each violation type.
%
% These are queried after a violation is found to provide the AI agent
% with actionable repair direction. Loaded alongside governance.pl and
% correctness.pl by the Prolog engine.
% =====================================================================

:- dynamic(suggestion/2).

suggestion('crypto-in-loop', 'Move crypto outside the loop, or isolate with Web Worker').
suggestion('await-in-loop', 'Use Promise.all() or batch queries instead of sequential awaits').
suggestion('external-call', 'Add allowlist/proxy boundary check before the call').
suggestion('hardcoded-sensitive', 'Replace with env variable or config lookup').
suggestion('dead-code', 'Remove or mark as entry point if intentionally unused').
suggestion('intent-effect-mismatch', 'Rename function to reflect side effect, or remove mutation').
suggestion('taint-reaches-sink', 'Add input validation or parameterized query between source and sink').
suggestion('postcondition-contradiction', 'Fix postcondition or remove mutation side effect').
suggestion('precondition-not-checked', 'Add precondition assertion at call site').
suggestion('invariant-crypto-contradiction', 'Fix loop invariant to account for crypto, or move crypto out').
suggestion('invariant-await-contradiction', 'Fix loop invariant to account for async, or parallelize').
suggestion('refinement-vacuous', 'Preconditions are contradictory (UNSAT) — the contract can never hold; fix or remove a precondition').
suggestion('refinement-not-entailed', 'Preconditions do not guarantee the return refinement — strengthen the precondition or weaken the postcondition (see Z3 counterexample)').
