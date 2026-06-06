---
description: Blast radius — who is affected if I change a function (formal-atlas)
---

The user wants the impact / blast-radius of a function before changing it.

Call the **`impact`** tool from the `formal-atlas` MCP server with:
- `path`: the directory/file to analyze — the path the user names, else the current project root.
- `target`: the function name in question, taken from "$ARGUMENTS".

Report the callers that transitively reach it. If the list is empty, say it has no in-graph callers (safe to change in isolation — modulo reflection/dynamic dispatch, which the analysis does not resolve). This is a solver verdict over the whole call graph, not a grep.
