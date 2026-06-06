# formal-atlas — Claude Code plugin

Bundles the formal-atlas **MCP server** (tools `reaches / dead_code / impact / verify / query / contract`) plus slash commands, so a Claude Code user gets "definitive code answers as tools" with one install — no manual `.mcp.json`.

## Slash commands (provided as skills)

| invoke | does | calls tool |
|---|---|---|
| `/formal-atlas:impact <fn>` | blast radius before a change | `impact` |
| `/formal-atlas:dead-code [path]` | provably-uncalled functions | `dead_code` |
| `/formal-atlas:verify [path]` | governance / anti-pattern scan | `verify` |

(The MCP tools are also callable directly by the model; the skills are sugar.)

## Distribute to others — **one `npm publish`, then `/plugin install` just works**

The bundled `.mcp.json` already uses the npm form (`npx -y -p formal-atlas formal-atlas-mcp`), so once the engine is on npm, installing this plugin auto-fetches it — no further edits.

```bash
cd formal-atlas && npm publish      # name `formal-atlas` is free; prepublishOnly runs the tests
```
Then anyone:
```
/plugin marketplace add <your-org>/<this-repo>
/plugin install formal-atlas@formal-atlas
```
Installing auto-wires the MCP server (via `npx`) + the slash commands — zero manual config. (`/plugin install` copies the plugin out of the repo, which is why the server must come from npm, not a repo-relative path.)

## Test locally BEFORE publishing

Until the package is on npm, `npx` can't fetch it, so for in-repo testing either:
- use the already-registered MCP directly (`claude mcp add ... node …/mcp/server.js` — see `../mcp/README.md`), or
- temporarily point this plugin's `.mcp.json` at the repo copy and run in place:
  ```json
  { "mcpServers": { "formal-atlas": {
      "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/../mcp/server.js"] } } }
  ```
  ```bash
  claude --plugin-dir U:/trae/todo_list/formal-atlas/plugin
  claude plugin validate U:/trae/todo_list/formal-atlas/plugin
  ```

## Why it's worth installing

For whole-graph questions (reachability / dead-code / impact / governance) the agent otherwise has to read the subsystem into context and reason — that source is re-sent every turn. These tools return a small JSON verdict instead. Measured on real code (`src/auth/policy`, 20 files ≈ 16k ctx tokens): **~55–200 tokens per query, 83–298× smaller**, and flat as the codebase grows. Run `npm run bench -- <path>` to reproduce on your own code.
