% =====================================================================
% doc-consistency.pl — documentation-consistency rules.
%
% Document facts are emitted by the markdown extractor (src/extract/markdown.js):
%   heading(File, Level, Text, Line)     -- section headings
%   link(File, Target, Text, Line)       -- [text](target) and [text][ref]
%   code_block(File, Lang, Line)         -- fenced ``` blocks
%   code_defines(File, Symbol, Lang, Line) -- functions defined inside doc code blocks
%   todo(File, Tag, Text, Line)          -- TODO/FIXME/HACK/XXX/NOTE markers
%   frontmatter(File, Key, Value)        -- YAML frontmatter key: value
%   doc_ref(File, Target, Line)          -- [[wiki-link]]
%   bullet(File, Text, Line)
% =====================================================================

:- dynamic(heading/4).
:- dynamic(link/4).
:- dynamic(code_block/3).
:- dynamic(code_defines/4).
:- dynamic(todo/4).
:- dynamic(frontmatter/3).
:- dynamic(doc_ref/3).
:- dynamic(bullet/3).

% A link whose target doesn't name any project file (walked by the pipeline).
% file_exists/1 must be asserted by the pipeline from the file list.
% For now, flag external-looking URLs that 404 (deferred to an external checker).
% The actionable note: a link to a local file that doesn't exist.
violation(File, 'broken-internal-link') :-
    link(File, Target, _, _),
    \+ is_external(Target),
    Target \= '',
    Target \= '#',
    \+ file(Target, _).

% Open TODO markers — actionable.
violation(File, 'open-todo') :-
    todo(File, 'TODO', _, _).

violation(File, 'open-fixme') :-
    todo(File, 'FIXME', _, _).

violation(File, 'open-hack') :-
    todo(File, 'HACK', _, _).

% Helpers — tau-prolog may lack sub_atom/5; use atom_concat for prefix match.
is_external(S) :- atom_concat('http://', _, S).
is_external(S) :- atom_concat('https://', _, S).
