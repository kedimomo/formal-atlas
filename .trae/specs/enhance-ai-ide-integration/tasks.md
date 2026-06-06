# Tasks

- [x] Task 1: 新增 `.mcp.json` 到项目根目录，实现 clone 即可用
  - [x] 创建 `.mcp.json`，配置 `npx -y formal-atlas-mcp`
  - [x] 验证 Claude Code 打开项目后自动发现 MCP server

- [x] Task 2: 新增增量缓存模块 `src/cache.js`
  - [x] 实现基于文件内容 SHA-256 的缓存（内存 Map，key = absPath:contentHash）
  - [x] 修改 `pipeline.js` 的 `extractProject`，先查缓存再抽取，合并结果
  - [x] 修改 `mcp/tools.js` 的 `programFor`，使用新缓存模块替代简单 Map

- [x] Task 3: 新增 `map` MCP 工具
  - [x] 在 `mcp/tools.js` 添加 `map` 工具定义（overview/file/symbol 三种模式）
  - [x] 实现 `map` 工具逻辑：overview 返回文件+导出概览，file 返回单文件详情，symbol 返回符号调用关系
  - [x] 利用已有 facts（defines/calls/imports）组装结果，不引入新依赖

- [x] Task 4: 新增 `search` MCP 工具
  - [x] 在 `mcp/tools.js` 添加 `search` 工具定义（pattern/calls/calledBy 参数）
  - [x] 实现基于调用图的符号搜索：按名称模糊匹配、按调用关系过滤
  - [x] 返回匹配符号的文件、行号、调用者/被调用者数量

- [x] Task 5: 新增 `review` MCP 工具
  - [x] 在 `mcp/tools.js` 添加 `review` 工具定义（focus 参数：all/quick/security）
  - [x] 实现自动编排：依次调用 verify → dead_code → taint → impact 热点
  - [x] 合并结果，按严重度排序返回

- [x] Task 6: 增强 MCP 工具描述
  - [x] 为每个工具的 description 添加具体触发场景示例（中文+英文）
  - [x] 确保 AI IDE 能从自然语言准确匹配到工具

- [x] Task 7: 新增 `watch` CLI 命令
  - [x] 在 `src/watch.js` 实现文件监听（`fs.watch` + 防抖）
  - [x] 文件变更时增量抽取 + 重新校验
  - [x] 新 violation 输出到 stderr
  - [x] 在 `cli.js` 注册 `watch` 子命令

- [x] Task 8: 更新 `package.json`
  - [x] 添加 `watch` 脚本
  - [x] 确保 `files` 字段包含 `.mcp.json`

# Task Dependencies
- Task 2 (缓存) → Task 3/4/5 (新工具依赖缓存加速)
- Task 1 (.mcp.json) 无依赖，可并行
- Task 6 (描述增强) 无依赖，可并行
- Task 7 (watch) 依赖 Task 2 (缓存)
