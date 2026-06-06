---
description: Governance / anti-pattern violations over the call graph (formal-atlas)
---

The user wants a governance / anti-pattern scan.

Call the **`verify`** tool from the `formal-atlas` MCP server with `path` = "$ARGUMENTS" (or the current project root if empty). Summarize the violations grouped by rule:
- `crypto-in-loop`, `await-in-loop`, `external-call`, `hardcoded-sensitive`, `dead-code`, `intent-effect-mismatch`.

For deeper questions (reachability, cycles, contracts) suggest the `reaches`, `query`, or `contract` tools from the same server.
