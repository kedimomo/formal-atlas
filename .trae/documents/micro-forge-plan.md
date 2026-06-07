# 计划：formal-atlas 修复建议 + 新项目 micro-forge（小模型+形式化验证写大项目）

## 摘要

两部分工作：
1. **formal-atlas**：只加第 1 层（修复建议），不偏离项目定位
2. **新项目 micro-forge**：用本地小模型 + formal-atlas 形式化验证，实现"小模型写大项目"

---

## Part A：formal-atlas 修复建议（第 1 层）

### 变更 A1：新增 `src/rules/suggestions.pl`

```prolog
suggestion('crypto-in-loop', 'Move crypto outside the loop, or isolate with Web Worker').
suggestion('await-in-loop', 'Use Promise.all() or batch queries instead of sequential awaits').
suggestion('external-call', 'Add allowlist/proxy boundary check before the call').
suggestion('hardcoded-sensitive', 'Replace with env variable or config lookup').
suggestion('dead-code', 'Remove or mark as entry point if intentionally unused').
suggestion('intent-effect-mismatch', 'Rename function to reflect side effect, or remove mutation').
suggestion('taint-reaches-sink', 'Add input validation or parameterized query between source and sink').
suggestion('postcondition-contradiction', 'Fix postcondition or remove mutation side effect').
suggestion('precondition-not-checked', 'Add precondition assertion at call site').
suggestion('invariant-crypto-contradiction', 'Fix loop invariant to account for crypto, or move crypto out').
suggestion('invariant-await-contradiction', 'Fix loop invariant to account for async, or parallelize').
```

### 变更 A2：修改 `src/verify/prolog-engine.js`

在 `runQuery` 返回违规结果后，自动查询 `suggestion/2` 并附加到结果。

### 变更 A3：修改 `mcp/tools.js`

`verify` 和 `review` 工具返回值增加 `suggestion` 字段。

---

## Part B：新项目 micro-forge

### 核心思想

当前 CLI coding agent（Claude Code、DeepSeek TUI、Codex CLI）的架构：

```
用户输入 → Agent Loop（LLM 推理 + 工具调用）→ 代码修改 → 运行测试 → 反馈
```

**问题**：LLM 推理不可靠，小模型（8B）更不可靠。但形式化验证器（Prolog/SMT）是 100% 可靠的。

**解决方案**：用形式化验证器替代 LLM 的"推理"环节：

```
用户输入 → 小模型生成代码 → formal-atlas 验证 → 反馈给小模型 → 修正 → 再验证 → 循环
```

### 与现有 CLI 工具的区别

| 维度 | Claude Code / DeepSeek TUI | micro-forge |
|------|---------------------------|-------------|
| LLM | 大模型（Opus/V4 Pro） | 本地小模型 |
| 验证 | LLM 自我检查（不可靠） | Prolog/SMT 形式化验证（100% 可靠） |
| 上下文 | 1M token 上下文窗口 | 形式化事实摘要（压缩 100x） |
| 修复策略 | LLM 猜测 | 验证器给修复建议 |
| 成本 | $20-200/月 | 本地免费 |
| 隐私 | 代码上传云端 | 本地运行 |

### LLM 推理引擎选择

#### 方案对比

| 方案 | 安装难度 | 模型选择 | 硬件要求 | 跨平台 | 推荐度 |
|------|---------|---------|---------|--------|--------|
| **Ollama** | 一行命令 | 200+ 模型 | 8GB+ RAM | Win/Mac/Linux | ⭐⭐⭐⭐⭐ |
| **ds4 (antirez)** | 编译 C | 仅 DeepSeek V4 Flash | 96GB+ RAM (Mac) | Mac/Linux | ⭐⭐ |
| **llama.cpp** | 编译 C++ | GGUF 格式 | 8GB+ RAM | Win/Mac/Linux | ⭐⭐⭐ |
| **LM Studio** | 桌面应用 | GUI 浏览模型 | 8GB+ RAM | Win/Mac | ⭐⭐⭐ |
| **WebLLM** | npm install | 浏览器 WebGPU | 任何浏览器 | 全平台 | ⭐⭐⭐⭐ |

#### 决策：多引擎支持，Ollama 优先

**为什么不用 ds4**：
- antirez 的 ds4.c 是 DeepSeek V4 Flash 专用引擎，性能极强（26 tok/s on M3 Max）
- 但需要 96GB+ RAM，且目前只支持 Mac Metal + CUDA
- 对"小模型写大项目"的目标来说太重了——我们要的是 8B 模型，不是 284B MoE

**为什么用 Ollama 作为默认**：
- 安装最简单：`curl -fsSL https://ollama.com/install.sh | sh`
- 一行拉模型：`ollama pull qwen3:8b`
- 内置 OpenAI 兼容 API（localhost:11434）
- 200+ 模型可选：qwen3:8b, deepseek-coder:6.7b, codellama:7b, phi4-mini
- 8GB RAM 就能跑 8B 模型

**为什么也支持 WebLLM**：
- 纯浏览器运行，零安装
- WebGPU 加速，支持 30+ 模型
- 适合不想装任何东西的用户
- 可以在网页里直接体验 micro-forge

**为什么也支持 llama.cpp server**：
- 最轻量的本地推理引擎
- 单二进制文件，无依赖
- OpenAI 兼容 API
- 适合高级用户自定义量化

#### LLM 接口设计

```javascript
// src/llm/provider.js — 统一接口，所有引擎共用
export async function generate(prompt, { model, maxTokens }) {
  const provider = detectProvider()  // 自动检测可用引擎
  return provider.chat(prompt, { model, maxTokens })
}

// 自动检测优先级：
// 1. Ollama (localhost:11434) — 最常用
// 2. llama.cpp server (localhost:8080) — 高级用户
// 3. WebLLM (浏览器 WebGPU) — 零安装
// 4. OpenAI 兼容 API (自定义 URL) — 云端回退
```

### 关键论文支撑

1. **Sol-Ver（Meta/UCSD, ICML 2026）**：Llama 3.1 8B 自博弈 solver-verifier，代码生成提升 19.63%。证明小模型 + 验证器 = 有效。

2. **7B 形式化推理模型（港科大/中科院, 2025）**：7B 模型在形式化验证任务上达到 671B DeepSeek-R1 水平。证明小模型可以做形式化推理。

3. **Agnostics（ICLR 2026）**：Qwen-3 4B + RLVR 达到 16-70B 模型水平。证明小模型 + 验证奖励 = 大模型效果。

4. **WybeCoder（2026.3）**：Agentic 验证循环解决 74% VERINA 任务。证明验证循环比纯生成有效。

### 文件结构

```
u:\trae\todo_list\micro-forge\
├── package.json
├── src/
│   ├── agent/
│   │   ├── loop.js          # Agent Loop: 生成→验证→修复→再验证
│   │   ├── context.js       # 上下文管理：formal-atlas 事实摘要
│   │   └── planner.js       # 任务分解：大任务→小步骤
│   ├── llm/
│   │   ├── provider.js      # 统一 LLM 接口（自动检测引擎）
│   │   ├── ollama.js        # Ollama 引擎（默认）
│   │   ├── llamacpp.js      # llama.cpp server 引擎
│   │   ├── webllm.js        # WebLLM 浏览器引擎
│   │   └── prompt.js        # Prompt 模板：含验证结果的修复提示
│   ├── verify/
│   │   └── bridge.js        # formal-atlas MCP/CLI 桥接
│   ├── edit/
│   │   └── patch.js         # 代码补丁应用（search-replace）
│   └── cli.js               # CLI 入口
├── config/
│   └── default.toml         # 默认配置（模型、验证规则等）
└── test/
    └── smoke.test.js
```

### Agent Loop 工作流

```
1. 用户输入任务描述
2. planner.js 分解为子任务
3. 对每个子任务：
   a. provider.js 调用本地小模型生成代码
   b. bridge.js 调用 formal-atlas 验证
   c. 如果有违规：
      - 获取 suggestion + 反例
      - 构造修复 prompt（含违规详情 + 建议修复方向）
      - 回到步骤 a
   d. 如果无违规：应用补丁，进入下一个子任务
4. 全部子任务完成，运行测试
```

### 为什么小模型也能写大项目

| 传统方式 | micro-forge 方式 |
|---------|-----------------|
| 小模型直接生成代码，错误率高 | 小模型生成代码，验证器 100% 检测错误 |
| 小模型不知道自己错了 | 验证器给精确的错误位置 + 修复方向 |
| 小模型需要大上下文理解代码库 | formal-atlas 把代码库压缩为事实摘要 |
| 小模型无法追踪跨文件影响 | Prolog 传递闭包精确追踪 |

**核心洞察**：小模型的弱点是"推理不可靠"，但形式化验证器恰好弥补了这个弱点。小模型只需要做"生成"（它擅长的），验证交给 Prolog/SMT（100% 可靠的）。

### 实施步骤

#### Phase 1：最小可用原型
1. 创建项目骨架
2. 实现 Ollama 接口（调用本地 8B 模型）
3. 实现 formal-atlas 桥接（调用 verify + 获取 suggestion）
4. 实现 Agent Loop（生成→验证→修复循环）
5. CLI 入口

#### Phase 2：多引擎支持
6. 实现 provider.js 统一接口
7. 实现 llama.cpp server 引擎
8. 实现 WebLLM 引擎
9. 自动检测可用引擎

#### Phase 3：上下文优化
10. 实现 context.js（formal-atlas 事实摘要替代全文件读取）
11. 实现 planner.js（大任务分解）

#### Phase 4：编辑能力
12. 实现 patch.js（search-replace 代码补丁）
13. 支持 Plan/Agent/YOLO 三种模式

### 配置示例

```toml
# config/default.toml
[llm]
# 自动检测：ollama > llamacpp > webllm > openai
provider = "auto"
model = "qwen3:8b"           # 或 deepseek-coder:6.7b, phi4-mini

# 各引擎配置
[llm.ollama]
base_url = "http://localhost:11434"

[llm.llamacpp]
base_url = "http://localhost:8080"

[llm.webllm]
model = "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC"

[llm.openai]                  # 云端回退
base_url = "https://api.openai.com/v1"
api_key = ""                  # 可选

[verify]
engine = "formal-atlas"
rules = ["governance", "correctness", "taint"]
max_iterations = 5

[agent]
mode = "agent"                # plan / agent / yolo
auto_fix = true
```

---

## 假设与决策

| 决策 | 选择 | 理由 |
|------|------|------|
| formal-atlas 只加第 1 层 | 不加代码生成 | 不偏离项目定位 |
| 新项目独立 | 不放在 formal-atlas 内 | 定位不同：验证 vs 生成 |
| Ollama 默认 + 多引擎 | 不只用 Ollama | Ollama 最简单，但 WebLLM 零安装，llama.cpp 最轻量 |
| 不用 ds4 | 硬件要求太高 | 96GB RAM 不适合"小模型"定位 |
| 验证器用 formal-atlas | 不自己写 | 已有完整 Prolog/SMT 能力 |
| 小模型 + 验证器 | 不用大模型 | 论文证明有效，且成本为零 |

---

## 验证步骤

### Part A
1. 运行 `verify`，确认返回值包含 `suggestion` 字段
2. 回归测试：现有 11 个工具功能不受影响

### Part B
3. 安装 Ollama + 8B 模型，确认 `ollama run qwen3:8b` 可用
4. 运行 `micro-forge "创建一个 Express 路由处理器"`，确认生成-验证-修复循环工作
5. 对比：纯 8B 模型 vs 8B + formal-atlas 的代码质量
6. 测试 WebLLM 引擎：在浏览器中运行 micro-forge
