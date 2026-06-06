# formal-atlas AI IDE 集成增强 Spec

## Why
formal-atlas 目前是一个"被动工具"——用户必须主动提问或手动调用 MCP 工具才能获得分析结果。对于日常编码和 AI IDE 工作流，它的价值不够直观：用户不知道什么时候该用它、怎么让它自动参与编码过程、以及它和 chiasmus 相比该选哪个。需要让 formal-atlas 从"偶尔调用的工具"变成"编码时自动守护的引擎"。

## What Changes
- 新增 `watch` 模式：文件变更时自动增量抽取 + 自动校验，主动推送结果给 IDE
- 新增 `map` 工具：代码库概览，让 AI IDE 不读文件就能了解项目结构（省 token）
- 新增 `search` 工具：基于调用图的符号搜索，替代 grep
- 新增 `review` 工具：一键代码审查配方，自动编排多工具调用
- 增强 MCP 工具描述：让 AI IDE 更准确匹配调用场景
- 新增 `.mcp.json` 到项目根目录：开箱即用，clone 即可用
- 增量缓存：基于文件内容 hash 的缓存，避免重复抽取

## Impact
- Affected code: `mcp/tools.js`、`mcp/server.js`、`src/pipeline.js`、`package.json`
- 新增文件: `src/watch.js`、`src/cache.js`、`.mcp.json`

## ADDED Requirements

### Requirement: Watch 模式 — 文件变更自动校验
系统 SHALL 提供 `formal-atlas watch <path>` 命令，监听文件变更，自动增量抽取并校验，将新发现的 violation 推送到 stderr。

#### Scenario: 文件保存后自动检测
- **WHEN** 用户在项目目录运行 `formal-atlas watch .`
- **AND** 用户保存了一个 JS 文件
- **THEN** 系统在 2 秒内自动增量抽取该文件的事实
- **AND** 重新运行 governance 校验
- **AND** 如果发现新 violation，输出到 stderr

#### Scenario: MCP 集成
- **WHEN** AI IDE 通过 MCP 调用 `watch` 工具
- **THEN** 返回当前所有 violation 状态 + 自上次查询以来的变更

### Requirement: Map 工具 — 代码库概览
系统 SHALL 在 MCP 中提供 `map` 工具，返回项目结构概览（文件列表、导出符号、入口点），让 AI IDE 不读源文件就能了解项目。

#### Scenario: 获取项目概览
- **WHEN** AI IDE 调用 `map` 工具，传入项目路径
- **THEN** 返回紧凑的 JSON：每个文件的导出函数/类、入口点、文件大小
- **AND** 总 token 量不超过 2000（远小于读全部文件）

#### Scenario: 查看单个文件
- **WHEN** AI IDE 调用 `map` 工具，传入 `mode=file` 和 `path`
- **THEN** 返回该文件的导出、导入、顶层符号

#### Scenario: 查看单个符号
- **WHEN** AI IDE 调用 `map` 工具，传入 `mode=symbol` 和 `name`
- **THEN** 返回该符号的定义位置、调用者、被调用者

### Requirement: Search 工具 — 调用图符号搜索
系统 SHALL 在 MCP 中提供 `search` 工具，基于调用图搜索符号（函数/方法），返回匹配结果及其调用关系。

#### Scenario: 按名称搜索
- **WHEN** AI IDE 调用 `search` 工具，传入 `pattern`
- **THEN** 返回所有匹配的符号：文件、行号、调用者数、被调用者数

#### Scenario: 按调用关系搜索
- **WHEN** AI IDE 调用 `search` 工具，传入 `calls` 或 `calledBy`
- **THEN** 返回调用/被调用指定符号的所有函数

### Requirement: Review 工具 — 一键代码审查
系统 SHALL 在 MCP 中提供 `review` 工具，自动编排多工具调用，返回分阶段审查结果。

#### Scenario: 完整审查
- **WHEN** AI IDE 调用 `review` 工具，传入项目路径
- **THEN** 自动执行：结构概览 → 治理校验 → 死代码 → 影响面热点 → 污点分析
- **AND** 返回按严重度排序的发现列表

#### Scenario: 快速审查
- **WHEN** AI IDE 调用 `review` 工具，传入 `focus=quick`
- **THEN** 只执行结构概览 + 治理校验

### Requirement: 增量缓存
系统 SHALL 基于文件内容 SHA-256 缓存抽取结果，不变文件跳过重新抽取。

#### Scenario: 重复查询命中缓存
- **WHEN** 同一文件内容未变，再次调用 MCP 工具
- **THEN** 跳过抽取，直接使用缓存的事实
- **AND** 响应时间 < 50ms（vs 首次 ~200ms）

#### Scenario: 文件变更后缓存失效
- **WHEN** 文件内容变更
- **THEN** 只重新抽取该文件，合并到已有事实库

### Requirement: 开箱即用的 .mcp.json
项目根目录 SHALL 包含 `.mcp.json`，clone 后打开 Claude Code 即自动发现 MCP server。

#### Scenario: clone 后自动可用
- **WHEN** 用户 clone 项目并用 Claude Code 打开
- **THEN** Claude Code 自动发现并启动 formal-atlas MCP server
- **AND** 所有 6+ 个工具立即可用

### Requirement: 增强 MCP 工具描述
现有 MCP 工具的 description SHALL 包含更具体的触发场景示例，帮助 AI IDE 更准确匹配。

#### Scenario: AI IDE 自动匹配
- **WHEN** 用户说"这个函数改了会影响谁"
- **THEN** AI IDE 准确匹配到 `impact` 工具（因为描述包含此场景）
- **WHEN** 用户说"有没有安全问题"
- **THEN** AI IDE 准确匹配到 `verify` + `taint` 工具

## MODIFIED Requirements

### Requirement: MCP 工具列表扩展
现有 7 个工具（reaches/dead_code/impact/verify/taint/query/contract）扩展为 10 个，新增 map/search/review。

## REMOVED Requirements
无。
