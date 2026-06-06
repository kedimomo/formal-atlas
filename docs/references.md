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

## H. 本仓库内的相关实现（formal-atlas 的"前身"）
- `tools/lint/assertion-to-prolog.js` — assertion → `violation/2` Horn 子句。
- `tools/lint/prolog-check.js` — tau-prolog consult + query（**已验证可跑**）。
- `tools/lint/regex-fact-extractor.js` — 正则抽取整文件级事实（浅形式化）。
- `tools/lint/six-pillar-rules.js` / `assertion-concepts.js` — 六支柱规则与概念本体。
- `formal/ReBAC_SPV.tla` — ReBAC 的 TLA⁺ 形式规约。
