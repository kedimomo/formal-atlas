# 计划：在 formal-atlas 内扩展 AI 形式化能力

## 摘要

在 formal-atlas 内新增 `src/formalize/` 模块，实现 **AI 自动生成行为规约（Hoare 三元组、循环不变式、函数契约）**，生成的 Prolog 事实直接喂给已有的 Prolog 引擎校验。不需要新建项目。

**关键架构决策**：LLM 调用优先通过 MCP sampling（IDE 提供），不支持时降级为用户配置 API Key。用户不需要额外提供 API。

---

## 当前状态分析

### 已有能力（不需要重做）

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| 代码→结构事实 | `src/extract/` | ✅ 完整 |
| AI 语义提升（intent/side_effect/pure） | `src/lift/ai-lifter.js` | ✅ 完整 |
| Prolog 校验引擎 | `src/verify/prolog-engine.js` | ✅ 完整 |
| 治理规则 | `src/rules/governance.pl` | ✅ 6 条规则 |
| SMT 契约验证 | `src/verify/smt-bridge.js` | ✅ 手写契约 |
| 事实合并+链接 | `src/pipeline.js` | ✅ 完整 |
| MCP 工具 | `mcp/tools.js` | ✅ 10 个工具 |
| 增量缓存 | `src/cache.js` | ✅ 完整 |
| Watch 模式 | `src/watch.js` | ✅ 完整 |

### 缺失能力（本次新增）

1. **AI 自动生成 Hoare 三元组** — 目前 `contract(Routine, pre|post, '...')` 只在在线 LLM 路径中偶尔生成，没有系统性生成
2. **循环不变式推断** — 完全没有
3. **基于契约的 Prolog 校验规则** — governance.pl 没有 contract 相关规则
4. **LLM 调用通过 IDE 提供** — 目前需要用户自己配 API Key，不合理
5. **formalize MCP 工具** — AI IDE 无法一键触发形式化

---

## 提议变更

### 变更 1：新增 `src/llm/` — 统一 LLM 调用层（优先 MCP sampling）

**文件**：`src/llm/index.js`（新建）

**做什么**：统一 LLM 调用接口，按优先级尝试三种方式：

```
优先级 1: MCP sampling（IDE 提供 LLM，用户零配置）
    ↓ 不支持时
优先级 2: 环境变量 API Key（ANTHROPIC_API_KEY / OPENAI_API_KEY）
    ↓ 不支持时
优先级 3: 离线启发式（无 LLM，降级为规则推断）
```

**MCP sampling 实现**：
- MCP server 在 `server.js` 初始化时保存 `server` 引用
- 当工具需要 LLM 时，调用 `server.requestSampling({ messages, maxTokens })`
- Claude Code 原生支持 MCP sampling，Trae 需确认
- sampling 结果返回后，用 `FACT_LINE` 正则验证格式

**API Key 降级**：
- 复用现有 `ai-lifter.js` 的 Anthropic API 调用逻辑
- 抽取为独立函数 `callWithApiKey(prompt)`

**为什么**：用户已经在用 AI IDE，不应该再要求配 API Key。MCP sampling 是标准协议，让 IDE 的 LLM 能力透明地流到 MCP server。

### 变更 2：新增 `src/formalize/hoare.js` — AI Hoare 三元组生成器

**文件**：`src/formalize/hoare.js`（新建）

**做什么**：用 LLM 为每个函数生成前置条件和后置条件，输出为 Prolog 事实：

```prolog
precondition(getUser, 'id is a positive integer').
postcondition(getUser, 'result is a user object or null').
precondition(deleteUser, 'id is a positive integer AND caller has admin role').
postcondition(deleteUser, 'user with given id no longer exists in database').
```

**怎么做**：
- 通过 `src/llm/` 统一调用层请求 LLM
- 构建 prompt：给定函数代码 + 已有结构事实，要求输出 `precondition/2` 和 `postcondition/2` 事实
- 离线路径：从函数参数类型和调用模式推断基本前置条件（如"参数非空"）
- 在线路径：LLM 生成自然语言契约
- 严格验证输出格式（复用 `FACT_LINE` 正则）

**为什么**：这是"代码→形式化"的核心缺口。目前只有 intent/side_effect，没有行为规约。

### 变更 3：新增 `src/formalize/invariant.js` — 循环不变式推断

**文件**：`src/formalize/invariant.js`（新建）

**做什么**：为循环生成不变式，输出为 Prolog 事实：

```prolog
invariant(processItems_loop, 'i <= items.length AND all processed items are valid').
```

**怎么做**：
- 离线路径：从循环结构推断基本不变式（如"迭代器在范围内"）
- 在线路径：通过 `src/llm/` 调用 LLM 分析循环体
- 利用已有的 `has_loop/1` 和 `crypto_in_loop/1` 事实定位循环

**为什么**：循环是最容易出 bug 的地方，不变式是证明循环正确性的数学工具。

### 变更 4：新增 `src/rules/correctness.pl` — 基于契约的校验规则

**文件**：`src/rules/correctness.pl`（新建）

**做什么**：在已有契约事实上定义校验规则：

```prolog
% 前置条件违反：调用者不满足被调用者的前置条件
violation(Caller, 'precondition-violation') :-
    calls(Caller, Callee),
    precondition(Callee, _),
    \+ precondition(Caller, _).

% 后置条件矛盾：函数声称的后置条件与实际副作用矛盾
violation(Routine, 'postcondition-contradiction') :-
    postcondition(Routine, Post),
    side_effect(Routine, mutation),
    intent(Routine, read).

% 不变式违反：循环不变式与循环体操作矛盾
violation(Scope, 'invariant-violation') :-
    invariant(Scope, _),
    crypto_in_loop(Scope).
```

**为什么**：governance.pl 只有结构规则，没有基于契约的语义规则。这是"形式化校验"的关键。

### 变更 5：修改 `src/pipeline.js` — 集成 formalize 模块

**文件**：`src/pipeline.js`（修改）

**做什么**：在 `extractProject` 中新增 `formalize` 选项：

```javascript
export async function extractProject(root, { lift = 'offline', formalize = 'off', maxFiles = 5000 } = {}) {
  // ... 已有逻辑 ...
  if (formalize !== 'off') {
    const hoareFacts = await generateHoare(facts, rawLines, { online: formalize === 'online' })
    facts.push(...hoareFacts)
    const invFacts = await generateInvariants(facts, { online: formalize === 'online' })
    facts.push(...invFacts)
  }
  // ... 已有逻辑 ...
}
```

### 变更 6：新增 `formalize` MCP 工具

**文件**：`mcp/tools.js`（修改）

**做什么**：新增 `formalize` 工具，一键生成 Hoare 三元组 + 不变式 + 校验：

```
formalize(path, { mode: 'hoare' | 'invariant' | 'all' })
```

**MCP sampling 集成**：`formalize` 工具在需要 LLM 时，通过 MCP sampling 请求 IDE 的 LLM。如果 IDE 不支持 sampling，降级为 API Key 或离线模式。

### 变更 7：修改 `mcp/server.js` — 支持 MCP sampling

**文件**：`mcp/server.js`（修改）

**做什么**：
- 保存 `server` 实例引用，供工具调用 sampling
- 暴露 `getServer()` 函数给 `tools.js`
- 在 `formalize` 工具中调用 `server.requestSampling()`

### 变更 8：修改 `src/cli.js` — 新增 `formalize` 子命令

**文件**：`src/cli.js`（修改）

**做什么**：
```
formal-atlas formalize <path>   # 生成 Hoare 三元组 + 不变式
formal-atlas formalize <path> --online  # 使用 LLM（API Key 或 MCP sampling）
```

### 变更 9：修改 `src/lift/ai-lifter.js` — 重构为使用统一 LLM 层

**文件**：`src/lift/ai-lifter.js`（修改）

**做什么**：
- `liftOnline` 改为调用 `src/llm/` 统一层，而非直接调 Anthropic API
- 保持 `liftOffline` 不变（纯规则推断，不需要 LLM）

---

## LLM 调用架构图

```
                    ┌─────────────────────┐
                    │   AI IDE (Claude)    │
                    │   已有 LLM 能力      │
                    └──────────┬──────────┘
                               │ MCP sampling
                               ▼
                    ┌─────────────────────┐
                    │  mcp/server.js      │
                    │  保存 server 引用    │
                    └──────────┬──────────┘
                               │ getServer()
                               ▼
┌──────────────────────────────────────────────────┐
│              src/llm/index.js                     │
│  统一 LLM 调用层                                  │
│                                                   │
│  优先级 1: MCP sampling (IDE 提供)                │
│  优先级 2: ANTHROPIC_API_KEY (用户配置)           │
│  优先级 3: 离线启发式 (降级)                      │
└──────┬───────────────────────┬───────────────────┘
       │                       │
       ▼                       ▼
  src/formalize/         src/lift/
  hoare.js               ai-lifter.js
  invariant.js           (重构为调用统一层)
```

---

## 数学基础（为什么这样做可行）

### Curry-Howard 同构
- 命题 = 类型，证明 = 程序
- Hoare 三元组 `{P}C{Q}` 就是类型签名 `P → Q`
- 生成 Hoare 三元组 = 生成类型签名 = 生成命题

### Rice 定理的限制
- 完美验证不可能，但 Sound 近似可行
- 我们的策略：**LLM 生成规约（可能错），Prolog 验证（一定对）**
- 错的规约不会通过验证 → 自动纠错

### 抽象解释
- 把无限的具体状态映射到有限的抽象域
- `precondition(R, 'id is positive')` 就是一个抽象域
- 不精确但 Sound，不会漏报

---

## 距离目标的差距

| 目标 | 修改后状态 | 剩余距离 |
|------|-----------|---------|
| 代码→结构事实 | ✅ 已有 | 0% |
| 代码→语义事实 | ✅ 已有 | 0% |
| 代码→行为规约（Hoare） | ✅ 本次新增 | 0% |
| 代码→循环不变式 | ✅ 本次新增 | 0% |
| 基于契约的 Prolog 校验 | ✅ 本次新增 | 0% |
| LLM 通过 IDE 提供 | ✅ 本次新增 | 0% |
| 代码→完整形式化证明 | ❌ 需要 Lean/Coq | 90% |
| 全自动闭环 | ⚠️ watch + formalize | 30% |

---

## 假设与决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 在 formal-atlas 内扩展 | 不新建项目 | 已有 80% 基础，避免重复 |
| Prolog 而非 Lean/Coq | 实用主义 | Prolog 足够表达治理规则，tau-prolog 已验证 |
| LLM 优先 MCP sampling | 用户零配置 | IDE 已有 LLM，不应要求额外 API Key |
| 不支持 sampling 时降级 API Key | 兼容性 | CLI 模式下没有 IDE，需要 API Key |
| Sound 近似 | 宁可误报 | 与现有 governance.pl 一致 |
| 契约用自然语言 | 不用形式化语言 | 降低门槛，LLM 生成更可靠 |

---

## 验证步骤

1. 在 `examples/` 项目上运行 `formal-atlas formalize`，检查生成的 Hoare 三元组质量
2. 检查 `correctness.pl` 规则是否能在已知 bug 上触发
3. 对比在线（MCP sampling）vs 离线路径的契约质量
4. 测试 MCP `formalize` 工具在 Claude Code 中的调用（MCP sampling）
5. 测试 CLI 模式下 API Key 降级路径
6. 回归测试：现有 10 个 MCP 工具功能不受影响
