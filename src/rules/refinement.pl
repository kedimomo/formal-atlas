% =====================================================================
% refinement.pl — refinement-type obligations (roadmap ★2; math docs 05 §11).
%
% Refinements are DECIDABLE predicates { v:T | φ(v) } attached to a routine's
% arguments (kind=pre) and return value (reserved var `ret`, kind=post) as
% refinement/4 facts. An out-of-band Z3 pass (verify/refinement-check.js)
% discharges the entailment φ_pre ⇒ φ_post and lowers its verdict back into the
% facts below, which then fire violations on the SAME fact base as the
% structural and taint layers.
%
% These predicates are dynamic: the rule file is always loaded, but the verdict
% facts only exist after `refine` runs — so verify/query stay unaffected when
% the refinement pass is off (upgrade/rollback-safe).
% =====================================================================

:- dynamic(refinement/4).
:- dynamic(refinement_vacuous/1).
:- dynamic(refinement_broken/2).
:- dynamic(refinement_unchecked/1).
:- dynamic(refinement_ok/1).

% A refinement spec whose preconditions are mutually contradictory (UNSAT):
% the contract can never be satisfied — a vacuous/dead spec, always a defect.
violation(Routine, 'refinement-vacuous') :-
    refinement_vacuous(Routine).

% Preconditions do NOT entail the declared return refinement — Z3 produced a
% concrete input satisfying every pre but breaking the post. The spec is unsound.
violation(Routine, 'refinement-not-entailed') :-
    refinement_broken(Routine, _).

% NOTE: refinement_unchecked/1 (a post with no pre, needing body-level VC) is
% intentionally NOT a violation — we report it as an assumption, never as proof.
