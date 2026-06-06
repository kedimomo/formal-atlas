# formal-atlas MCP server

把 formal-atlas 的「定论层」暴露为 **Model Context Protocol** 工具,让 Claude Code（或任意 MCP 客户端）把可达性/死代码/影响面/契约**当工具调用**——给定论、省 token、绕开"读一堆文件再推"。

零额外依赖:手写的 stdio MCP server(newline-delimited JSON-RPC 2.0),复用已完成的引擎。

## 工具

| tool | 作用 | 关键参数 |
|---|---|---|
| `reaches` | A 能否传递到达 B(false = 穷举证明不可达) | `path, from, to` |
| `dead_code` | 全图、作用域感知的死代码(可删吗) | `path` |
| `impact` | 改某函数的波及面(blast radius) | `path, target` |
| `verify` | 治理违规(膜穿透/await-in-loop/硬编码/…) | `path` |
| `query` | 任意 Prolog/Datalog 目标(进阶) | `path, goal` |
| `contract` | z3 契约蕴含证明/反例 | `vars, pre, post` |

> `path` 相对启动 cwd 解析或用绝对路径。事实库**按 path 缓存**:抽取一次,之后每次查询都便宜。

## 注册到 Claude Code

**① 本机自用(local)**
```bash
claude mcp add --scope local formal-atlas -- node /绝对路径/formal-atlas/mcp/server.js
# 会话内 /mcp 查看工具；node 进程能读你的代码库(stdio 本地服务)
```

**② 给团队(project,提交进仓库)** — 在仓库根放 `.mcp.json`:
```json
{
  "mcpServers": {
    "formal-atlas": {
      "type": "stdio",
      "command": "node",
      "args": ["formal-atlas/mcp/server.js"]
    }
  }
}
```
队友 clone 后启动 Claude Code 会**弹窗批准**该 server,批一次即可。

**③ 广发(npm)** — 发布后:
```bash
claude mcp add --scope user formal-atlas -- npx @you/formal-atlas-mcp
```

> 想做成"一条命令装好 + 自带 slash 命令"的体验,把本 server 用 **Claude Code 插件**(plugin)bundle 起来,经 marketplace 分发(`/plugin install`)。插件根放上面那段 `.mcp.json`,用 `${CLAUDE_PLUGIN_ROOT}/mcp/server.js` 指向本文件即可。

## 自测(不需要 Claude Code)

```bash
npm run test:mcp     # spawn server + 跑完整 initialize→tools/list→tools/call 握手
```
