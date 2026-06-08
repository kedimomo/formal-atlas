% =====================================================================
% structural.pl — base-relation declarations + shared helpers.
%
% Declares every EXTRACTED relation dynamic so queries never raise an
% existence_error on a project that happens to have an empty relation.
% The DERIVED structural rules (reaches/dead_code/cyclic/impact/...) now
% live in resolved.pl, where they reason over the SCOPE-RESOLVED call
% graph (decl/node/rcall) instead of bare names — see resolved.pl.
% Mathematically each derived rule is still a Horn clause and the set of
% derivable facts is the least fixpoint of the immediate-consequence
% operator (Datalog / Knaster–Tarski); resolution just makes the EDB
% nodes file-qualified so the closure is computed per-scope, not per-name.
% =====================================================================

% Extracted (EDB) relations:
:- dynamic(file/2).
:- dynamic(defines/4).
:- dynamic(method/1).
:- dynamic(async_fn/1).
:- dynamic(param/3).
:- dynamic(calls/2).
:- dynamic(calls3/3).
:- dynamic(import_binding/4).
:- dynamic(imports/2).
:- dynamic(exports/2).
:- dynamic(has_loop/2).
:- dynamic(awaits_in_loop/1).
:- dynamic(crypto_in_loop/1).
:- dynamic(calls_external/2).
:- dynamic(string_lit/3).
:- dynamic(loop_count/2).
:- dynamic(entry/1).
:- dynamic(http_entry/1).   % stage-1 framework model: a route handler (HTTP entry point)
% Semantic relations from the AI lifter (may be absent):
:- dynamic(side_effect/2).
:- dynamic(pure/1).
:- dynamic(intent/2).
:- dynamic(contract/3).
% Formalization relations from the formalize module (may be absent):
:- dynamic(precondition/2).
:- dynamic(postcondition/2).
:- dynamic(invariant/2).

% Local member/2 (avoid depending on library(lists) being loaded).
% Shared by resolved.pl's cycle-safe reachability.
member(X, [X|_]).
member(X, [_|T]) :- member(X, T).
