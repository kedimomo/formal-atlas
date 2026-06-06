% =====================================================================
% resolved.pl — structural rules over the SCOPE-RESOLVED call graph.
%
% The linker (src/link/linker.js) turns bare-name call edges into
% file-qualified ones:
%   decl(QId, File, Name, Kind)  — each definition gets a unique node id
%                                  (QId = 'File::Name'),
%   node(QId, Name)              — names every node (incl. externs/scopes),
%   rcall(QCaller, QCallee)      — the resolved call edge,
%   unresolved_call(Name)        — a defined name reached only by an
%                                  unresolved (extern/dynamic) call.
%
% Reasoning over QIds (not bare names) eliminates cross-file same-name
% MERGING: `walk` in two files are two nodes, so reaches/impact/cyclic
% stop conflating them and dead-code stops hiding a truly-dead routine
% behind a same-named sibling. The public predicates keep their BARE-NAME
% interface (projecting QIds back to names via node/2) for compatibility.
% =====================================================================

:- dynamic(decl/4).
:- dynamic(node/2).
:- dynamic(rcall/2).
:- dynamic(addr_taken/2).
:- dynamic(unresolved_call/1).

% ----- Transitive reachability over the RESOLVED graph (cycle-safe) -----
r_reaches(A, B) :- r_reaches_(A, B, [A]).
r_reaches_(A, B, _) :- rcall(A, B).
r_reaches_(A, B, Visited) :-
    rcall(A, Mid),
    \+ member(Mid, Visited),
    r_reaches_(Mid, B, [Mid|Visited]).

% ----- Entry points: exported routines, or explicitly configured ones -----
r_entry(Q) :- decl(Q, File, Name, routine), exports(File, Name).
r_entry(Q) :- decl(Q, _, Name, routine), entry(Name).

% ----- Dead code: a routine no resolved edge targets, not an entry point,
% not address-taken, AND whose name is not reached by any UNRESOLVED call.
% The last conjunct keeps false positives near zero: if a dynamic/ambiguous
% call mentions the name, we conservatively decline to call it dead.
dead_code(File, Name) :-
    decl(Q, File, Name, routine),
    \+ rcall(_, Q),
    \+ r_entry(Q),
    \+ addr_taken(File, Name),
    \+ unresolved_call(Name).

% ----- Public bare-name views (project QIds back to names via node/2) -----
reaches(A, B) :- node(QA, A), node(QB, B), r_reaches(QA, QB).

cyclic(Name) :-
    decl(Q, _, Name, routine),
    r_reaches(Q, Q).

impact(Target, Caller) :-
    node(QT, Target),
    decl(QC, _, Caller, routine),
    QC \= QT,
    r_reaches(QC, QT).

caller_of(Target, Caller) :-
    node(QT, Target),
    node(QC, Caller),
    rcall(QC, QT).
