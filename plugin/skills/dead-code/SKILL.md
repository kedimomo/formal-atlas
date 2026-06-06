---
description: List provably-uncalled functions, safe to delete (formal-atlas)
---

The user wants to know which functions are dead (safe to delete).

Call the **`dead_code`** tool from the `formal-atlas` MCP server with `path` = "$ARGUMENTS" (or the current project root if empty). Present the `file : name` list.

This is a whole-graph, **scope-aware** result — same-name functions across files are NOT merged, so it is far more reliable than grepping for "no callers". Still, reflection / dynamic dispatch is not resolved, so ask the user to confirm before deleting anything surprising.
