# 代码与数学的关系：formal-atlas 的数学基础

> 本文回答你的核心问题：**"代码和数学是什么关系？把代码变成形式表示再用 Prolog 校验，数学上站得住脚吗？"**
> 结论先行：**代码本来就是数学**。把代码"形式化"不是给它套一层外壳，而是把它**本已具有的**数学结构显化出来，交给逻辑引擎判定。下面是这件事的完整数学骨架。

---

## 1. 第一性原理：Curry–Howard(–Lambek) 同构 —— 代码即证明

整个领域的地基是 **Curry–Howard 对应**（命题即类型 / 程序即证明，propositions-as-types）。它是逻辑与计算之间的一个**双射**，分三层：

| 逻辑 (Logic) | 类型论 / 程序 (Type theory) | 对应关系 |
|---|---|---|
| 命题 proposition | 类型 type | `A→B` 既是"A 蕴含 B"也是"A 到 B 的函数类型" |
| 证明 proof | 程序 program | 一个 `A→B` 的程序 **就是** `A→B` 的一个构造性证明 |
| 证明化简 proof normalization | 程序求值 evaluation | 跑程序 = 化简证明 |

**Lambek** 又补上第三极，成为 **Curry–Howard–Lambek 三位一体**：再加上**笛卡尔闭范畴 (Cartesian Closed Category, CCC)**——类型是对象、程序是态射、`A→B` 是指数对象。于是：

```
   逻辑 (构造性/直觉主义)  ≅  类型论 / λ演算  ≅  范畴论 (CCC)
```

**这对你意味着什么**：
- 写代码 = 在一套构造性逻辑里写证明；**类型检查 = 证明检查**（每个良类型程序都是"它的类型可被居留"的证明）。
- 所以"把代码翻译成形式表示再校验"在数学上**天然合法**——你不是在做类比，你是在另一套同构的记号系统里重写同一个对象。
- 参考：Wadler《Propositions as Types》；Lambek & Scott《Introduction to Higher Order Categorical Logic》。

---

## 2. 给代码以数学意义：三种形式语义

要"校验"代码，先要给代码一个**精确的数学指称**。经典上有三条路，formal-atlas 同时借用：

1. **操作语义 (Operational)**：程序 = 一个状态转移系统（small-step / big-step）。→ 适合"可达性、终止性、轨迹"这类**时序**性质（CTL/LTL、模型检查）。
2. **指称语义 (Denotational)**：程序 = 一个数学对象（Scott 的 domain / CPO 上的连续函数）。Lambek 证明 λ-理论的模型就是 CCC 上的函子。→ 这是"程序等价、抽象"的根基。
3. **公理语义 (Axiomatic)**：Hoare 逻辑 `{P} c {Q}`——程序是前置断言到后置断言的蕴含。→ 这正是 **Dafny / Verus** 的契约式验证所形式化的东西。

> formal-atlas 当前主要工作在"操作语义的关系抽象"层（调用图 = 转移关系），并通过 AI lifter 触及"公理语义"层（`contract(Routine, pre/post, ...)`）。

---

## 3. 静态分析的数学：抽象解释 (Abstract Interpretation)

"对全部代码做可判定的形式校验"为什么可能？答案是 **Cousot & Cousot (1977)** 的**抽象解释**：

- 把**具体语义**（不可计算的精确行为）保守地近似到一个**抽象格 (complete lattice)** 上。
- 抽象 α 与具体化 γ 构成 **Galois 连接 `(α, γ)`**，它在数学上**保证 soundness**——抽象世界证明成立的，具体世界一定成立（不漏报）。
- 分析的"计算"= 求一个**单调算子在完备格上的最小不动点**，依据 **Knaster–Tarski 不动点定理**；遇到循环用 **widening/narrowing (∇/△)** 保证收敛。

**关键洞见**：一切可靠的全代码静态校验，本质都是"**用可判定的过近似换取 soundness**"。这给了 formal-atlas 一个清醒的边界：我们的结构规则（调用图、死代码、环）是 α 投影出来的**保守近似**，可能误报、但对所声明的抽象是 sound 的。

---

## 4. 逻辑引擎的数学：Datalog = Horn 子句的最小不动点

为什么用 Prolog / Datalog 而不是写一堆 `if`？因为**程序分析在数学上就是关系的递归闭包**，而这正是 Datalog 的定义性语义：

- 事实库 EDB（`calls/2`、`defines/4`…）+ 规则 IDB（`reaches/2`、`dead_code/2`…）。
- 语义 = **立即结论算子 `T_P` 的最小不动点** = 程序的**最小 Herbrand 模型**。`T_P` 单调 ⇒ 不动点存在、且可用 **semi-naive evaluation** 有限步算出。
- `reaches/2` 就是调用图关系的**自反传递闭包 `R⁺`**（关系代数）。Doop 的指针分析、CodeQL 的查询，本质都是"大规模传递闭包"。
- **Prolog = Datalog + 函数符号 + 否定 + SLD 归结 (resolution)**，图灵完备但可能不终止。formal-atlas 的 `reaches_/3` 用 `Visited` 累加器把可能无限的 SLD 树**剪成有限**（cycle-safe），这是在"表达力"和"可判定性"之间的工程取舍。

> 一句话：**把代码变成事实库 + 规则，校验性质 = 在最小 Herbrand 模型里求解一个查询**。这不是比喻，是 Datalog 的形式语义。

---

## 5. "把代码提升为逻辑结构" = 取一个抽象（选一个 functor）

形式化提取的本质，是为程序选一个**抽象层次**，每一层都是对程序指称的一个 α 投影：

```
源码 → AST → 调用图 → 数据流/指向 → 类型&效应 → 契约/不变式
 具体 ────────────────────────────────────→ 抽象
```

- "代码 → 事实"在数学上是：`program ↦ 一个有限的一阶关系结构 (first-order relational structure / 模型)`。
- "校验性质"= 判定一阶（或 Datalog/CTL）公式在该结构上是否成立 = **模型检查 (model checking)** 的精神。
- **AI 的角色（neuro-symbolic）**：当某个抽象层（意图、契约、纯度）**无法用语法判定**时，用 LLM 做 **autoformalization**——把非形式语义翻成形式事实。这是 soundness 的缺口：LLM 是**启发式 oracle**，所以 formal-atlas 坚持 **generate-and-check**——LLM 产出的事实必须先过语法/类型校验，再让确定性的求解器把关（见 `ai-lifter.js` 的 `FACT_LINE` 校验）。

---

## 6. 诚实的边界：Rice 定理

数学上必须承认天花板。**Rice 定理**：程序的**一切非平凡语义性质都不可判定**。推论：任何"全代码形式校验"必然落入以下之一（或组合）：

1. **过近似 (over-approximate)**：可能误报，但不漏报 → sound。（formal-atlas 的结构规则走这条）
2. **欠近似 (under-approximate)**：可能漏报，但报的都真 → 适合 bug-finding。
3. **不保证终止 / 需要人工辅助**：交互式定理证明 (Lean/Coq)。

**工程含义——按性质难度分层**（这也是 formal-atlas 的路线图）：

| 性质难度 | 例子 | 合适的引擎 | 是否 sound/可判定 |
|---|---|---|---|
| 结构性 | 调用图、死代码、循环依赖、命名规则 | **Datalog/Prolog**（本项目） | 可判定，对抽象 sound |
| 功能正确性 | "排序后真的有序" | **SMT**：Dafny / Verus / ESBMC | 半可判定，自动化高 |
| 深层数学 | 复杂不变式、并发协议 | **ITP**：Lean / Coq / Isabelle / TLA⁺ | 需人工，最强 |
| 设计意图 | "这个函数该不该联网" | **LLM autoformalization + 人复核** | 启发式 |

> formal-atlas 把 FDRS 已有的"规则层形式化"**下沉到全代码层**，稳稳落在第一行（Datalog 可判定区），并为后三行预留接口（`contract/3` → SMT；`intent/2` → LLM）。

---

## 7. 小结：你的设想的数学定位

> 你想做的事 = **为任意程序计算一个有限一阶关系结构（"代码的 atlas"），然后在其最小 Herbrand 模型上用逻辑查询判定性质；语法够不到的语义层，用 LLM 做 autoformalization 并以求解器把关。**

它的每一步都有坚实的数学背书：Curry–Howard（代码即数学对象）、抽象解释（sound 近似的格论与不动点）、Datalog 语义（最小不动点 = 模型）、Rice 定理（边界与分层）。**这不是把数学"套"在代码上，而是把代码还原成它本来就是的数学。**

参考文献见 [`references.md`](./references.md)。与"Atlas"及其它系统的关系见 [`03-atlas-comparison.md`](./03-atlas-comparison.md)。

> **想再往里挖一层?** 见 [`05-math-deepening.md`](./05-math-deepening.md):把 Rice 精化成**算术分层**、Datalog=**PTIME**(描述复杂度/Immerman–Vardi)、**λ-立方体**(工具地图)、**精化类型**(缺失的一档)、抽象解释**完备性**、神经符号**忠实度**、**HoTT** 地平线。
