# 参考文献 References

> 本项目调研所依据的全球文献，按主题分组。结论性引用见各文档正文。

## A. 数学基础：代码 ↔ 数学（Curry–Howard / 范畴 / 语义）
- Wadler, P. **Propositions as Types.** — Curry–Howard 最权威的现代综述。<https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf>
- **Curry–Howard correspondence** (Wikipedia, 三层对应总览)。<https://en.wikipedia.org/wiki/Curry%E2%80%93Howard_correspondence>
- **Curry–Howard–Lambek correspondence** (HaskellWiki) — 加上笛卡尔闭范畴 (CCC) 的第三极。<https://wiki.haskell.org/Curry-Howard-Lambek_correspondence>
- Lambek & Scott. *Introduction to Higher Order Categorical Logic.* — 范畴侧的经典文献（CCC = λ演算内部语言）。
- **Simply typed lambda calculus** (Wikipedia) — λ演算与 CCC 的字典。<https://en.wikipedia.org/wiki/Simply_typed_lambda_calculus>

## B. 抽象解释（sound 静态分析的格论基础）
- Cousot, P. & Cousot, R. (1977). **Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints.** POPL'77. — 领域奠基。
- Cousot & Cousot (1979). **Constructive versions of Tarski's fixed point theorems.** Pacific J. Math. 82(1).
- Cousot, P. **A Galois Connection Calculus for Abstract Interpretation.** POPL'14. <https://cs.nyu.edu/~pcousot/publications.www/CousotCousot-POPL14-ACM-p2-3-2014.pdf>
- Blanchet, B. **Introduction to Abstract Interpretation.** <https://bblanche.gitlabpages.inria.fr/absint.pdf>
- 关键词：Galois connection (α,γ)、complete lattice、Knaster–Tarski 不动点、widening/narrowing、soundness。

## C. Datalog / 逻辑编程做程序分析（本项目的直接范式）
- **Using Datalog for Fast and Easy Program Analysis** (Datalog Reloaded, 2011). <https://link.springer.com/chapter/10.1007/978-3-642-24206-9_14>
- **Doop**: Bravenboer & Smaragdakis. *Strictly Declarative Specification of Sophisticated Points-to Analyses.* — Datalog 写 Java 指针分析。<https://inst.eecs.berkeley.edu/~cs294-260/sp24/2024-02-07-doop>
- **Porting Doop to Soufflé** (SOAP'17). <https://dl.acm.org/doi/10.1145/3088515.3088522>
- **Soufflé** — Datalog 编译成并行 C++ 的高性能引擎。<https://www.javacodegeeks.com/2025/10/building-lightning-fast-program-analysis-with-souffle-and-datalog.html>
- **CodeQuest → CodeQL/Semmle**: Hajiyev, Verbaere, de Moor (ECOOP 2006). — 源码当数据库、Datalog 式查询找漏洞。
- **Source Code Verification for Embedded Systems using Prolog** (arXiv:1701.00630) — C++ AST → Prolog 事实 + CTL。<https://arxiv.org/pdf/1701.00630>
- **Towards Fully Declarative Program Analysis via Source Code Transformation** (arXiv:2112.12398) — 源码→Datalog 事实 (EDB) 的工程难点。<https://arxiv.org/pdf/2112.12398>

## D. 神经符号：LLM + 逻辑引擎（"用 AI 翻译代码"这一步）
- **Chiasmus / neurosymbolic MCP** (yogthos, 2026-04) — tree-sitter→Prolog 事实 + tau-prolog/Z3 + 推导轨迹。**最贴近本项目的开源实现。** <https://yogthos.net/posts/2026-04-08-neurosymbolic-mcp.html>
- **Training Language Models to Use Prolog as a Tool** (arXiv:2512.07407). <https://arxiv.org/html/2512.07407>
- **LoRP: LLM-based Logical Reasoning via Prolog** (2025). <https://www.sciencedirect.com/science/article/abs/pii/S0950705125011815>
- **NeuroProlog** (arXiv:2603.02504) — 训练期内化符号结构。<https://arxiv.org/pdf/2603.02504>
- **Reliable Reasoning Beyond Natural Language** (arXiv:2407.11373) — 把 LLM 任务从"推理"转为"翻译成 Prolog"。<https://arxiv.org/pdf/2407.11373>
- **Neuro-Symbolic Verification on Instruction Following of LLMs** (arXiv:2601.17789) — 把验证当约束满足。

## E. Autoformalization / 规约形式化（AI 写 spec/contract 的忠实度）
- **Verus-SpecGym / Verus-SpecBench** (arXiv:2605.26457) — 评测 LLM 把"编程意图"翻成**忠实规约**。<https://arxiv.org/html/2605.26457v1>
- **Autoformalization with Large Language Models** (综述)。<https://www.emergentmind.com/topics/autoformalization-with-large-language-models>
- **Improving Auto-Formalization to UCLID5 with LLMs and Formal Methods** (Berkeley EECS-2025-115). <https://www2.eecs.berkeley.edu/Pubs/TechRpts/2025/EECS-2025-115.pdf>

## F. "Atlas" 三系统（消歧见 [03-atlas-comparison.md](./03-atlas-comparison.md)）
- **ATLAS: Automated Toolkit for Large-Scale Verified Code Synthesis** (arXiv:2512.10173) — AI 合成带证明的 Dafny。<https://arxiv.org/html/2512.10173>
- **ATLAS: Autoformalizing Theorems through Lifting, Augmentation, and Synthesis** (arXiv:2502.05567) — 数学定理→Lean/Isabelle。<https://arxiv.org/html/2502.05567v1>
- **The Axiom-Based Atlas** (arXiv:2504.00063) — 定理→公理空间的"证明向量"；Atlas-GPT。<https://arxiv.org/pdf/2504.00063>

## G. 演绎验证 / SMT / ITP（路线图 Phase 2 的目标引擎）
- **Dafny** — 验证感知语言，SMT 自动证明（AWS Cedar、IronFleet 等工业落地）。
- **Verus** — Rust 的演绎验证框架。
- **Lean / Coq / Isabelle / HOL** — 交互式定理证明器。
- **TLA⁺ / TLC** — 时序逻辑模型检查（仓库已有 `formal/ReBAC_SPV.tla`）。
- **Logos Research** (logosresearch.ai, 2026；帝国理工 spinout) — Lean 之上的 **LogosLib** + MCP：AI agent 生成代码时同步产 Lean 证明，验证层放电证明义务、失败即重试，专攻量化金融等高风险域（团队含 Kevin Buzzard）。与本项目的「分析式 vs 合成式」对比见 [03-atlas-comparison.md §四](./03-atlas-comparison.md)。<https://www.logosresearch.ai/>

## I. 05/06 深化的文献锚点（经典基础可靠；最新 2026 链接待联网核验补全）

> 下列支撑 [`05-math-deepening.md`](./05-math-deepening.md) 与 [`06-frontier-map.md`](./06-frontier-map.md)。**经典基础**为公认高被引文献（作者/标题/出处/年份可靠，URL 待补）；末尾"待联网"项需在分类器服务恢复后用 WebSearch/WebFetch 核验并补 arXiv/DOI。

### I-1 可计算性与性质分层（05 §8）
- Rice, H. G. (1953). **Classes of recursively enumerable sets and their decision problems.** Trans. AMS 74. — 一切非平凡语义性质不可判定。
- Alpern, B. & Schneider, F. (1985). **Defining Liveness.** Information Processing Letters 21(4). — 安全/活性划分；安全性质 ≈ co-r.e.（Π⁰₁），可被 sound 过近似证明。
- Manna, Z. & Pnueli, A. (1992). **The Temporal Logic of Reactive and Concurrent Systems.** Springer. — 安全-进展层级。
- 关键词：arithmetical hierarchy（Σ⁰₁/Π⁰₁/Π⁰₂）、安全=Π⁰₁ 可 sound 过近似、可达=Σ⁰₁ 可欠近似抓真阳。

### I-2 描述复杂度：Datalog/LFP = PTIME（05 §9）
- Immerman, N. (1986). **Relational queries computable in polynomial time.** Information and Control 68.
- Vardi, M. (1982). **The complexity of relational query languages.** STOC'82. — 与 Immerman 独立给出 LFP = PTIME（有序有限结构）。
- Abiteboul, Hull, Vianu (1995). **Foundations of Databases.** Addison-Wesley（第 12–15 章：Datalog 语义与复杂度）。

### I-3 类型论谱系：λ-立方体、CIC、HoTT（05 §10、§14）
- Barendregt, H. (1991/92). **Lambda calculi with types.** Handbook of Logic in Computer Science, vol. 2. — λ-立方体八角。
- Coquand, T. & Huet, G. (1988). **The Calculus of Constructions.** Information and Computation 76. — Coq 内核（CIC）之源，λC 顶点。
- The Univalent Foundations Program (2013). **Homotopy Type Theory: Univalent Foundations of Mathematics.** IAS（HoTT Book）。— 类型=空间、相等=路径、单值公理（05 §14 地平线）。

### I-4 精化类型：缺失的一档（05 §11；路线图 ★2）
- Freeman, T. & Pfenning, F. (1991). **Refinement types for ML.** PLDI'91. — 精化类型起源。
- Rondon, Kawaguchi, Jhala (2008). **Liquid Types.** PLDI'08. — 谓词限定可判定 SMT 理论 ⇒ 类型检查可判定 + 谓词抽象自动推断不变式（= 抽象解释实例）。
- Vazou et al. (2014). **Refinement Types for Haskell.** ICFP'14（Liquid Haskell）。
- Swamy et al. (2016). **Dependent Types and Multi-Monadic Effects in F\*.** POPL'16。

### I-5 过程间分析与增量 Datalog（06 前沿 ★5–6）
- Reps, Horwitz, Sagiv (1995). **Precise interprocedural dataflow analysis via graph reachability.** POPL'95. — IFDS：分布式过程间数据流约化为 exploded supergraph 上的图可达（多项式）。
- Reps, T. (1998). **Program analysis via graph reachability.** Information & Software Technology 40. — CFL-reachability。
- McSherry, Murray, Isaacs, Isard (2013). **Differential Dataflow.** CIDR'13. — 增量 + 迭代数据流（增量维护最小不动点）；DDlog 为其 Datalog 实现。

### I-6 抽象解释的完备性（05 §12）
- Giacobazzi, Ranzato, Scozzari (2000). **Making abstract interpretations complete.** JACM 47(2). — 完备抽象的存在性与"完备化"，系统性消误报的理论。

### 待联网核验 / 补充（分类器服务恢复后）
- 为上列经典文献补 arXiv/DOI/官方链接。
- 补 2025–2026 最新工作：精化类型综述、autoformalization 忠实度（Verus-SpecGym 后续）、Differential Dataflow/DDlog 近作、IFDS 工程化近作。

## H. 本仓库内的相关实现（formal-atlas 的"前身"）
- `tools/lint/assertion-to-prolog.js` — assertion → `violation/2` Horn 子句。
- `tools/lint/prolog-check.js` — tau-prolog consult + query（**已验证可跑**）。
- `tools/lint/regex-fact-extractor.js` — 正则抽取整文件级事实（浅形式化）。
- `tools/lint/six-pillar-rules.js` / `assertion-concepts.js` — 六支柱规则与概念本体。
- `formal/ReBAC_SPV.tla` — ReBAC 的 TLA⁺ 形式规约。
