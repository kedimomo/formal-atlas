# 计划：代码→形式化表示→Prolog 校验 — 全项目通用化研究

## 摘要

将 FDRS 的"规则→Prolog 校验"模式扩展到整个代码库：**用 AI 将任意代码转换为形式化逻辑事实，再用 Prolog/Datalog 校验**。这是一个可行但有数学天花板的方向。本计划梳理理论基础、现有实践、距离目标的差距，并设计一个独立原型。

***

## 一、数学基础：代码与数学的关系

### 1.1 Curry-Howard 同构（核心数学基础）

**命题即类型，证明即程序。** 这不是比喻，是严格的数学等价：

| 逻辑        | 编程                |
| --------- | ----------------- |
| 命题 A      | 类型 A              |
| 证明 of A   | 值 of 类型 A         |
| A → B（蕴含） | 函数 A → B          |
| A ∧ B（合取） | 积类型 (A, B)        |
| A ∨ B（析取） | 和类型 Either A B    |
| ∀x.P(x)   | 依赖类型 Π(x:A).P(x)  |
| ∃x.P(x)   | 依赖和类型 Σ(x:A).P(x) |

**意义**：写程序 = 构造证明，类型检查 = 证明验证。Coq/Lean/Agda 就是基于此。

### 1.2 Rice 定理（数学天花板）

**所有程序的非平凡语义性质都是不可判定的。**

* "这个函数有没有死代码？" — 不可判定

* "这个程序会不会泄露隐私？" — 不可判定

* "这两个函数是否等价？" — 不可判定

**后果**：不存在完美的静态分析器。你只能在 Sound（不漏报）和 Complete（不误报）之间取舍。

### 1.3 抽象解释（绕过天花板的方法）

Rice 定理说的是**精确判定**不可能，但**近似分析**可以：

* **Sound 近似**：保证不漏报，允许误报（formal-atlas 的路线）

* **Complete 近似**：保证不误报，允许漏报

* **抽象域**：把无限的具体状态空间映射到有限的抽象域

***

## 二、现有实践：谁在做类似的事

### 2.1 Doop / CodeQL — Datalog 静态分析

* **Doop**（2010）：用 Datalog 做全程序 Java 指针分析，比传统方法快 15x

* **CodeQL**（GitHub）：把源码编译成关系数据库，用 Datalog 查询找漏洞

* **关键思路**：代码 → 关系事实（Datalog） → 声明式查询

### 2.2 Autoformalization — AI 自动形式化

2025-2026 年爆发式进展：

* **AlphaProof**（DeepMind）：IMO 银牌，8000 万形式化题目 RL 训练

* **Gauss AI**：3 周完成人类 18 个月没搞定的素数定理形式化

* **DeepSeek-Prover-V2**：开源 Lean 证明器

* **DDR 框架**（浙大+蚂蚁）：直接依赖检索增强自动形式化，50 万样本微调

### 2.3 Typed Chain-of-Thought — Curry-Howard 验证 LLM 推理

ICLR 2026 论文：把 LLM 的推理链映射为类型化程序，用 Curry-Howard 同构验证推理的忠实性。

***

## 三、formal-atlas 已有的基础

### 3.1 已实现

| 能力        | 实现方式                       | 文件                                |
| --------- | -------------------------- | --------------------------------- |
| 代码→关系事实   | acorn/tree-sitter/正则       | `src/extract/`                    |
| 作用域链接     | linker.js                  | `src/linker.js`                   |
| Prolog 校验 | tau-prolog + governance.pl | `src/verify/prolog-engine.js`     |
| AI 语义提升   | 离线启发式 + 在线 LLM             | `src/lift/ai-lifter.js`           |
| SMT 契约验证  | Z3                         | `src/verify/smt-bridge.js`        |
| FDRS 回流   | 深事实→概念事实                   | `src/integrations/fdrs-bridge.js` |

### 3.2 缺什么

| 缺失               | 说明                     |
| ---------------- | ---------------------- |
| **通用语言适配器**      | 目前 JS 深度，其他语言粗粒度       |
| **AI 形式化转换器**    | 目前只提取结构事实，不提取语义/行为规约   |
| **Hoare 逻辑自动生成** | 前置/后置条件需手写             |
| **增量验证闭环**       | 代码改了→事实更新→规则重新校验→反馈    |
| **跨项目通用**        | 目前绑定在 formal-atlas 项目内 |

***

## 四、距离目标有多远

### 4.1 距离矩阵

| 目标                 | 当前状态                | 距离  | 瓶颈            |
| ------------------ | ------------------- | --- | ------------- |
| 代码→结构事实            | ✅ 已实现（JS深度，其他粗粒度）   | 0%  | —             |
| 代码→语义事实（AI）        | ⚠️ 离线启发式有，在线 LLM 可选 | 30% | LLM 幻觉        |
| 代码→行为规约（前置/后置条件）   | ❌ 需手写               | 80% | AI 形式化精度      |
| 代码→完整形式化证明         | ❌ 需要 Lean/Coq 级别    | 95% | Rice 定理 + 表达力 |
| Prolog 校验治理规则      | ✅ 已实现               | 0%  | —             |
| Prolog 校验任意属性      | ⚠️ 需写查询             | 50% | 查询编写门槛        |
| 全自动闭环（改代码→自动验证→反馈） | ⚠️ watch 模式有雏形      | 60% | 增量验证精度        |

### 4.2 核心瓶颈

1. **Rice 定理**：不可能完美，只能 Sound 近似
2. **AI 幻觉**：LLM 生成的形式化规约可能是错的（DDR 框架用 Suffix Array Check 缓解）
3. **表达力鸿沟**：Prolog/Datalog 是一阶逻辑，很多程序性质需要高阶逻辑
4. **可扩展性**：大项目的事实库可能很大，Prolog 推理可能超时

***

## 五、实施方案：独立原型 `code2formal`

### 5.1 目标

创建独立项目 `code2formal`，放在 `u:\trae\todo_list\code2formal\`，实现：

**代码 → AI 形式化 → Prolog/Datalog 校验 → 反馈闭环**

### 5.2 架构

```
源代码
  ↓
[1] 多语言抽取器（复用 formal-atlas 的 extract 模块）
  ↓ 结构事实（defines, calls, imports, loops...）
  ↓
[2] AI 形式化器（LLM 生成 Hoare 三元组 + 行为规约）
  ↓ 语义事实（precondition, postcondition, invariant, side_effect...）
  ↓
[3] 事实合并器（结构 + 语义 → 统一 Prolog 事实库）
  ↓
[4] Prolog/Datalog 校验引擎
  ↓ 违规 / 证明 / 反例
  ↓
[5] 反馈闭环（违规→建议修复→AI 生成补丁→重新验证）
```

### 5.3 文件结构

```
code2formal/
├── package.json
├── README.md
├── src/
│   ├── extract/          # 复用 formal-atlas 抽取
│   ├── formalize/        # AI 形式化器
│   │   ├── hoare.js      # Hoare 三元组生成
│   │   ├── invariant.js  # 循环不变式推断
│   │   └── contract.js   # 函数契约生成
│   ├── merge/            # 事实合并
│   ├── verify/           # Prolog/Datalog 校验
│   │   ├── prolog-engine.js
│   │   └── rules/
│   │       ├── safety.pl     # 安全规则
│   │       ├── correctness.pl # 正确性规则
│   │       └── liveness.pl   # 活性规则
│   ├── feedback/         # 反馈闭环
│   │   └── repair.js     # AI 修复建议
│   └── cli.js            # CLI 入口
├── mcp/
│   ├── server.js         # MCP Server
│   └── tools.js          # 工具定义
└── test/
    └── smoke.test.js
```

### 5.4 实施步骤

#### Phase 1：最小可用原型

1. 创建项目骨架（package.json + 目录结构）
2. 复用 formal-atlas 的 extract 模块（npm 依赖或直接引用）
3. 实现 AI 形式化器：LLM 生成 Hoare 三元组
4. 实现 Prolog 校验：加载事实 + 规则，查询违规
5. CLI 入口：`code2formal verify <path>`

#### Phase 2：反馈闭环

1. 实现违规→修复建议（LLM 生成）
2. 实现修复→重新验证循环
3. watch 模式：文件变更→增量验证

#### Phase 3：MCP 集成

1. MCP Server 暴露工具
2. 增强工具描述

### 5.5 关键设计决策

| 决策                | 选择                          | 理由                                           |
| ----------------- | --------------------------- | -------------------------------------------- |
| 形式化语言             | Prolog/Datalog（不是 Lean/Coq） | 实用主义：Prolog 足够表达大多数治理规则，且 tau-prolog 已在项目中验证 |
| AI 形式化方式          | LLM 生成 + Prolog 验证          | LLM 可能幻觉，但 Prolog 是裁判——错的规约不会通过验证            |
| Sound vs Complete | Sound 近似                    | 宁可误报不可漏报，与 formal-atlas 一致                   |
| 独立 vs 集成          | 独立项目                        | "针对所有项目"，不应绑定 formal-atlas                   |
| 缓存                | 文件内容 hash                   | 复用 formal-atlas 的 cache.js 思路                |

***

## 六、假设与风险

### 假设

1. LLM 生成的 Hoare 三元组 70%+ 语法正确（参考 Autoformalization 论文的成功率）
2. Prolog 推理在 10K 事实以内可接受（tau-prolog 的限制）
3. 用户愿意接受 Sound 近似的误报

### 风险

1. **LLM 幻觉**：生成的规约可能语义错误但语法正确 → 用 Prolog 交叉验证
2. **Prolog 表达力不足**：某些性质需要高阶逻辑 → 降级为近似规则
3. **性能**：大项目事实库可能太大 → 分模块验证 + 增量更新
4. **Rice 定理**：某些性质根本无法自动验证 → 明确标记为"需人工确认"

***

## 七、验证步骤

1. 在示例项目上运行 `code2formal verify`，检查是否能检测到已知 bug
2. 对比 formal-atlas 的 governance.pl 结果，确认一致性
3. 测试 AI 形式化器的 Hoare 三元组生成质量
4. 测试反馈闭环：违规→修复→重新验证
5. 测试 MCP 集成：Claude Code 能否自动调用

