# Formalization coverage — empirical proof formal-atlas lifts the whole codebase

> Reproduce: `node coverage-report.js [dir]` (offline, deterministic, zero external). For a fresh method breakdown first `rm -rf .cache .formal-atlas-cache` (the program cache otherwise short-circuits).

## What "formalize the whole code" means here
formal-atlas walks every source file and lifts it into **logical facts** — a scope-resolved call graph plus data/taint relations and declarations: `decl / node / calls / rcall / calleeVar / param / formalParam / argActual / alloc / isFunction / import_binding / imports / source / sink / dataflow / sanitizer / intent / pure / …`. *Coverage* = of all files walked, how many produced facts and by which strategy: **acorn full AST** (JS) and **tree-sitter grammar** (TS/Py/Go/Java/Rust) = strong structural formalization; **regex** = degraded fallback (no grammar wired, or the parser failed).

## Measured (2026-06-12, this repo)
| area | files | produced facts | full AST / grammar | facts |
|---|---|---|---|---|
| backend `../src` | 450 | **100%** | **99.6%** (444 acorn + 4 tree-sitter; **0 parse failures**) | 128,750 |
| packages `../packages` | 219 | **100%** | **100%** (123 acorn + 96 tree-sitter) | 35,353 |
| frontend `../frontend/src` | 536 | **100%** | 46.1% (247 acorn; **289 `.vue` SFCs → regex**) | 53,417 |
| **total** | **1,205** | **100%** | — | **~217,000** |

**`regex-fallback` = 0 everywhere**: no `.js/.ts/.py/.go/.java/.rs` file defeated its parser. The only non-full-AST files are `.vue` Single-File Components (no Vue grammar wired → regex; still produces facts) and 2 `.sql`/generic files.

## Efficacy — the analyses really run at scale (backend `../src`, zero-install semi-naive engine)
- functions / declarations **7,335**; resolved call edges (`rcall`) **19,700**
- **reaches** (transitive closure) **432,050**
- **dead code** (provably unreachable functions) **700**
- **cyclic** (recursion) **320**
- **taint** source→sink reachabilities **931** — RAW reachability; the ★3 content-type triage suppresses the JSON-response false XSS *inside* the `violation` rule (see `docs/08`), so the governance true-positive count is far lower.
- ★8 `prove ../src/store/services/rebac` → **19 iterator-bound loops + 10 array accesses all proved in bounds (0 possible-OOB)**, including the member-of-member `this.tree[Number(i)]`; CLI `prove` also discharges the C-tier induction / termination / strong-induction fixtures.

**Answer to "can formal-atlas formalize the whole codebase and does it really work?": yes** — 1,205 real files lifted with 0 parser failures, ~217k base facts, and the analyses derive 432k+ facts plus concrete findings (dead code, recursion, taint paths, machine-checked loop/array safety).

## Honest limits
- `.vue` SFCs get regex-level facts only (template / `<script setup>` call graph is partial) — a real next improvement would be a Vue extractor.
- The 931 taint number is *reachability*, not 931 confirmed bugs; `violation` (with ★3 suppression) is where the true-positive count lands.
- "Coverage" = *lifted into facts*, not *every property proven*. Proving properties is the `verify` / `prove` / `refine` layer built on top of these facts.
