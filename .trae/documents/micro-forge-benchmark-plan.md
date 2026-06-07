# micro-forge + formal-atlas 基准测试方案

## 现有基准测试盘点

### 与 micro-forge 最相关的

| 基准 | 语言 | 规模 | 验证方式 | 与 micro-forge 关系 |
|------|------|------|----------|---------------------|
| **Clover** (Stanford 2023) | Dafny | 60 题 | 一致性检查 + Dafny 验证器 | ⭐⭐⭐⭐⭐ 最接近！同样的"生成→验证→修复"闭环 |
| **SecCodeBench-V2** (阿里 2025) | Go/JS/Python/Java/C | 98 题,22 CWE | 动态执行 + LLM-as-Judge | ⭐⭐⭐⭐ 有 Node.js 安全场景 |
| **VeriContest** (UVA 2026) | Rust + Verus | 946 题 | Verus 形式化证明 | ⭐⭐⭐ 数学证明级别最高但语言不匹配 |
| HumanEval | Python | 164 题 | 单元测试 | ⭐⭐ 经典但：Python 单函数，不测治理违规 |
| SWE-bench | Python | 500 真实 Issue | 单元测试 | ⭐ 太大，需要 API 级模型 |
| BigCodeBench | Python | 1140 题 | 单元测试 | ⭐⭐ 多函数多库，但无形式化验证 |

### 关键发现：没有现成的 JS + 结构验证基准

所有现有基准要么：
1. **只测功能正确性**（HumanEval/MBPP/BigCodeBench）——不测治理违规
2. **语言不匹配**（Clover=Dafny, VeriContest=Rust）
3. **安全专项**（SecCodeBench-V2）——不测 await-in-loop、dead-code 等

**结论：需要创建专门的 micro-forge 基准集。**

---

## 自定义基准集设计：forge-bench

### 设计原则

1. **测的是"生成→验证→修复"闭环**，不是模型裸生成能力
2. **每条题目针对 formal-atlas 一条具体规则**，能精确对比
3. **15 题 × 11 规则覆盖**，JS 语言（formal-atlas 最优语言）
4. **可自动化**：每个用例有明确的违规判定标准

### 12 条基准题

| ID | 题目 | 目标规则 | 为什么 8B 模型容易出错 |
|---|---|---|---|
| T01 | 输入验证器（email+password） | `hardcoded-sensitive` | 容易写死 JWT_SECRET |
| T02 | 用户列表批量更新 | `await-in-loop` | 容易 for-await 串行而非 Promise.all |
| T03 | 密码哈希工具函数 | `crypto-in-loop` | 容易循环内散列多个密码 |
| T04 | REST HTTP 客户端封装 | `external-call` | 函数含 fetch 调用 |
| T05 | 只读查询函数（命名 get*） | `intent-effect-mismatch` | 函数名 get* 但调了 deleteMany |
| T06 | 三函数微模块 | `dead-code` | 定义一个函数但从不调用 |
| T07 | RBAC 权限检查 | `side-effect-mismatch` | checkPermission 声称只读但改状态 |
| T08 | 用户注册—前置条件 | `precondition-break` | 忘了检查用户名是否已存在 |
| T09 | 订单金额计算—后置条件 | `postcondition-violation` | 计算逻辑有边界溢出 |
| T10 | 数组去重—循环不变式 | `invariant-failure` | 去重算法错位判断 |
| T11 | 空函数签 stub | `contract-vacuous` | 只有前置条件没有后置条件 |
| T12 | 文件操作模块 | `taint` | 文件内容直接被命令执行 |

### 指标体系

| 指标 | 含义 | 计算方式 |
|------|------|---------|
| **Violations@Gen** | 首次生成违规数 | 每题的违规列表计数 |
| **Iterations** | 达到零违规所需轮数 | 循环计数 |
| **Fix Rate** | 修复成功率 | 成功修复轮数/总轮数 |
| **Time** | 总耗时（含推理+验证） | 秒 |
| **Token Cost** | LLM token 消耗 | 所有轮 token 之和 |

### 对比维度

需要对比以下三种模式：

| 模式 | 说明 |
|------|------|
| **Raw** | 裸模型单次生成，不验证不修复 |
| **Retry** | 裸模型 + 简单重试（违规就重新生成，不给错误信息） |
| **forge** | micro-forge 全闭环（验证→提取违规文件→给修复建议→重新生成） |

### 预期结果（假设，需实测验证）

- **Raw 模式**：5-7 violations（12 题中），函数正确性率 ~70%
- **Retry 模式**：3-4 violations，但 token 消耗 2-3×
- **forge 模式**：0 violations 终态，平均 1.3-2 轮迭代，token 消耗 ~1.5×

**核心检验**：forge 模式是否比 Retry 模式用更少 token 达到零违规

---

## 实施计划

### Phase 1: 构建基准数据
- [ ] 编写 12 条题目的 prompt（英文，与 JS 最佳实践对齐）
- [ ] 为每题标注预期的违规类型和 golden fix（人工审核）
- [ ] 创建测试脚本 `bench/suite.js`

### Phase 2: 完善 micro-forge 引擎
- [ ] 修复 `loop.js` — 生成后的代码写入项目文件
- [ ] 修复 `bridge.js` — 使 formal-atlas verify 能正确反馈行号
- [ ] 添加 `prompt.js` 中的修复提示模板（利用 formal-atlas suggestion）

### Phase 3: 运行基准
- [ ] 用 qwen2.5-coder:7b 跑 Raw 模式
- [ ] 用 qwen2.5-coder:7b 跑 Retry 模式
- [ ] 用 qwen2.5-coder:7b + formal-atlas 跑 forge 模式
- [ ] 记录：每轮 violations、每次耗时、token 数

### Phase 4: 分析报告
- [ ] 可视化三种模式对比
- [ ] 分析各类违规类型的修复难度排名
- [ ] 结论：8B 模型 + 形式化验证是否可行

---

## 与学术前沿的差距

| 维度 | 学术前沿 | 本项目（micro-forge） | 差距 |
|------|---------|---------------------|------|
| **验证方式** | Clover (Dafny 定理证明器) | formal-atlas (Prolog 结构验证) | 中等—Prolog 不能证功能正确性，但能证结构违规 |
| **模型规模** | GPT-4/o1 级 | 8B 本地模型 | 大—但这是本项目的核心卖点 |
| **语言支持** | Rust/Verus | JS/Python/Go/Java | 相近 |
| **闭环修复** | Clover 仅检测不修复 | micro-forge 自动修复 | **领先**—本项目有操作闭环 |
| **基准规模** | CloverBench 60 题 | forge-bench 12 题 | 需扩展 |

### 从数学角度：代码与验证的关系

这个方向在数学上叫做**程序合成 + 形式化验证**（Program Synthesis + Formal Verification）：

```
人工智能（LLM）        ──搜索空间导航──▶  程序合成
        │
  形式化方法（逻辑）     ──可判定性边界──▶  验证约束
        │
        ▼
  闭环最小不动点      ←←  生成⇄验证⇄修复   →→  FP
```

**理论上能走多远**：
- 结构级属性（调用图、数据流、治理规则）→ **已解决**（formal-atlas + Prolog）
- Hoare 三元组级别（前置/后置条件）→ **局部可解**（micro-forge 已有雏形）
- 完全功能正确性（代码 = 规约）→ **AI 当前不可解**（NP-hard，需定理证明器如 Dafny/Verus/Coq）

本项目正在第 1→2 层过渡。

---

## 结论

**for micro-forge 的本质价值**：不是生成更好的源代码，而是让 8B 模型通过验证反馈达到接近大模型的代码质量。这在学术上已有 Clover/VeriContest 等先例，但用在本地小模型上是新颖贡献点。
