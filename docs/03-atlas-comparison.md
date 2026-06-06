# 你的设想 vs "Atlas" —— 是不是同一个东西？

> 你问："我这里和 atlas 是不是一样的？" **简短回答：不完全一样，而且"Atlas"本身指的是三个不同的系统。** 你的设想（代码 → 形式表示 → Prolog 校验 + AI 翻译）和它们各有交集，但最贴近你的现成系统其实**不叫 Atlas**。下面逐一拆解。

---

## 一、"Atlas"是三个不同的研究项目（先消歧）

搜索"Atlas + 形式化/验证"，会撞到三个**同名但完全不同**的东西：

| # | 名称 | 它做什么 | 验证范式 | 与你的关系 |
|---|---|---|---|---|
| **A1** | **ATLAS: Automated Toolkit for Large-Scale Verified Code Synthesis** (arXiv 2512.10173) | AI **从零合成**带"规约 + 机器可检证明"的 **Dafny** 程序（在 TACO 数据集上产出 2.7K 个已验证程序） | **演绎验证 / SMT**（Dafny 用 SMT 自动证明实现满足规约） | 范式相近（AI 产形式工件 + 机器校验），**对象相反**（它造新代码，你查既有代码） |
| **A2** | **ATLAS: Autoformalizing Theorems through Lifting, Augmentation, Synthesis** (arXiv 2502.05567) | 把**数学定理**自动形式化到 Lean / Isabelle / HOL / Coq | **交互式定理证明 (ITP)** | 形式化的是"**数学命题**"，不是"**程序**" |
| **A3** | **The Axiom-Based Atlas** (arXiv 2504.00063) | 把定理表示为**公理系统上的"证明向量"**（坐标 = ZFC / Peano / Hilbert 等公理），做知识的结构地图；含 **Atlas-GPT** 助手 | 结构映射 / 知识图谱 | **哲学上最像你**——都在做"一张结构地图"，但它的坐标是公理，你的坐标是代码关系 |

> 所以"和 Atlas 一样吗"这个问题，得先问"哪个 Atlas"。

---

## 二、逐个对比你的设想

你的设想 = **既有代码 → 抽取为逻辑事实 → 规则/查询校验 → 语法够不到的语义用 AI 翻译成事实**。

### vs A1（Verified Code Synthesis / Dafny）
- **像**：都让 AI 产出"形式工件"，再交给**确定性引擎**把关（它交 SMT，你交 Prolog）。这正是 2025–26 的主流范式：`generate-and-check`。
- **不像**：
  - A1 验证的是**功能正确性**（"实现满足前/后置规约"），靠 **Hoare 逻辑 + SMT**；
  - 你验证的是**结构/架构/治理性质**（"有没有死代码 / 膜穿透 / 硬编码 / 调用是否可达"），靠 **Datalog 式声明查询**。
  - A1 是"**写新代码并证明它对**"；你是"**把存量代码照成一张逻辑地图并盘问它**"。
- 一句话：**同范式，异目标。** A1 是 deductive verification，你是 declarative static analysis。

### vs A2（Autoformalizing Theorems）
- **像**：你的 **AI lifter** 干的就是 autoformalization——把非形式语义翻成形式记号。
- **不像**：A2 的输入是**数学定理**，输出是 **Lean 证明**；你的输入是**源码**，输出是**关系事实**。按 [Curry–Howard](./01-math-foundations.md#1) 两者底层同源（命题≅类型、证明≅程序），但**工件层不同**。

### vs A3（Axiom-Based Atlas）—— 名字最贴，精神最近
- **像**：A3 把定理映射成"**公理空间里的向量**"，本质是给数学知识画一张**结构地图 (atlas)**。你做的也是一张地图——**代码的关系事实库就是 code 的 "atlas"**：每个谓词（`calls`、`defines`、`reaches`…）是一个坐标轴，每个程序是这个空间里的一个点/结构。
- **不像**：
  - A3 的坐标轴是**逻辑公理**（ZFC/Peano/Hilbert），点是**定理**；
  - 你的坐标轴是**程序关系谓词**，点是**代码实体（函数/文件/调用）**。
  - A3 关心"定理依赖哪些公理"；你关心"代码满足哪些性质 / 违反哪些规则"。
- 这就是为什么这个子项目取名 **formal-atlas**——**借 A3 的"结构地图"哲学，落到代码上**（详见末节命名说明）。

---

## 三、真正最接近你设想的，其实不叫 Atlas

你的想法在工业界和最新研究里有**更直接的对应物**：

1. **Datalog 程序分析谱系**（最成熟、最对口）：
   - **Doop**：用 Datalog 写 Java 指针分析，把代码抽成事实 (EDB) 再跑递归规则——和你"代码→事实→Prolog 规则"**一模一样的架构**，只是它用 Datalog、规模工业级。
   - **CodeQL / Semmle**（源自 CodeQuest, 2006）：把源码当数据库，用类 Datalog 的查询语言找漏洞——**这就是"全代码形式化 + 声明式校验"的商用形态**。
   - **Soufflé**：把 Datalog 编译成并行 C++，让上述分析能跑百万行级。
   - **Meta Glean**：把整个代码库索引成事实供查询。
2. **神经符号 / LLM+逻辑引擎**（最贴你"用 AI 翻译"这一步）：
   - **Chiasmus**（2026.04，开源 MCP server）：tree-sitter 解析 → Prolog 事实（`defines/4`、`calls/2`）→ tau-prolog/Z3 查询可达性/死代码/环，**还带推导轨迹做解释**。**这几乎就是你设想的开源实现**——formal-atlas 与它独立同构，区别是本项目自带 AI 语义 lifter + 治理规则 + 可指向任意项目的 CLI。
   - **Verus-SpecGym**（2025）：评测 LLM **写规约 (spec)** 的"忠实度"——对应你流程里"AI 把意图翻成形式契约"的难点。
3. **你自己的 FDRS**：已经是"规则层"的此类系统（assertion → Prolog → tau-prolog 校验）。formal-atlas = **把 FDRS 从规则层下沉到全代码层**。

---

## 四、延伸对比：Logos Research（2026）—— 分析式 vs 合成式

> 2026 年从帝国理工 spinout 的 **Logos Research**（[logosresearch.ai](https://www.logosresearch.ai/)）常被拿来和本项目并提。它其实是 §二 里 **A1（Verified Code Synthesis）范式的最新、最高规格代表**——只是把证明引擎从 Dafny/SMT 换成了 **Lean 全证明**。

**Logos 在做什么**：在 **Lean 4**（依赖类型定理证明器）之上建一个数学库 **LogosLib**，让 AI agent 生成代码时**同步生成 Lean 证明**，验证层放电证明义务、失败即反馈重试，直到产出"机器证明为正确"的代码；并以 **MCP** 暴露"已验证思维链"供任意 agent 调用。首攻量化金融/算法交易（"差一点就是灾难"的域），团队含 **Kevin Buzzard**（正用 Lean 形式化费马大定理）。其口号是把标准从"this looks right"提到"this is proven correct"。

### 逐项对比

| 维度 | **Logos Research** | **formal-atlas** |
|---|---|---|
| **方向** | **正向合成**：生成*新*代码 + 配套证明 | **逆向分析**：把*既有*代码映成逻辑、盘问性质 |
| **"正确"指什么** | **整程序功能正确性**（实现满足规约） | 结构 soundness + 治理 + 契约蕴含（代码*关于*自身的性质） |
| **核心引擎** | **Lean 4**（ITP / 依赖类型）——严格度天花板 | 按难度分层：Datalog/Prolog → SMT/z3 →（骨架）Dafny |
| **取舍** | 极致严格、**窄域**、人工形式化成本极高 | 广覆盖、可判定优先、便宜、**sound 过近似** |
| **LLM 角色** | LLM 写 Lean 支撑的代码，**Lean 当裁判** | 多为纯符号抽取；LLM 只补语义，**求解器当裁判** |
| **域 / 语言** | 数学密集、金融/科学 | 通用软件工程、多语言、企业治理 |
| **形态** | VC 创业公司（Khosla/XTX/SOSV）、闭源、早期访问 | 仓库内研究子系统、独立、离线零安装、MIT |
| **谱系** | Dafny/Verus/Lean 验证合成、AlphaProof 一脉（= 本文 **A1**） | Doop/CodeQL/Soufflé + autoformalization-lite（本文 **§三**） |

### 两条谱系轴（你要的"定位"）

把这一领域摊平，本项目和 Logos 落在**两条正交轴**的对角：

**轴一 · 任务方向（分析 ↔ 合成）：**
```
   分析既有代码                                       合成带证明的新代码
  （问"它满足什么"）                                 （问"造个对的出来"）
  CodeQL·Doop·Glean ─ formal-atlas ─┊─ Dafny/ATLAS-A1·Verus·Logos
       纯符号               神经符号·受检              LLM + ITP 全证明
```

**轴二 · 引擎严格度 / 性质难度（按 [Rice 定理](./01-math-foundations.md#6-诚实的边界rice-定理)分层）：**
```
  可判定 ───────────────── 半可判定 ───────────────── 需人类 / ITP
  Datalog/Prolog            SMT (Z3)                    Dafny/Lean/Coq
  reaches·dead·cyclic       契约蕴含·SoD                整程序功能正确性
  └──── formal-atlas 覆盖 ────┘ └─骨架→┘             └──── Logos 主战场 ────┘
```

> **formal-atlas 的策略**是"可判定优先、便宜够用就停，只在性质难度上升时才升级引擎，且坚持横跨多语言广覆盖"；**Logos 的策略**是"一步到位上 Lean 全证明，用最高严格度换整程序正确性，代价是窄域 + 高形式化成本"。同一条难度轴上，一个**铺满左/中段且跨语言**，一个**直接钉死最右端的高价值窄域**。

### 互补而非竞争
- formal-atlas 抽出的 `contract/3`、结构事实、RBAC 约束，可作为 Logos 这类系统的**证明义务来源**（"谁需要被证明、证明什么"）。
- 反过来，formal-atlas 的"`contract` → SMT/Dafny 骨架"是 Logos"`contract` → Lean 证明"的**轻量近亲**；若接上 Lean/Dafny 后端真正放电，本项目路线图 [Phase 2「演绎验证（全证明）」](./04-roadmap.md)即落地。
- 两者共享同一种哲学：**LLM 只产候选、永远过求解器/证明器才成结论**（generate-and-check）。区别只在裁判量级：Logos 用重量级 ITP，formal-atlas 用分层、可判定优先的更便宜求解器。

> **一句话：Logos = "A1 验证式合成"的 Lean 满配版，赌高风险窄域的整程序正确性；formal-atlas = "CodeQL × autoformalization × FDRS"的分析式审计，赌广覆盖与可判定优先。正交、互补，不是同一件事。**

---

## 五、结论：一句话定位

> **你的设想 ≈ 「Doop/CodeQL 式声明式程序分析」 × 「LLM autoformalization」 × 「FDRS 治理规则」 的融合。**

- 它**和 Atlas 有交集**：与 A1 共享"AI 产工件 + 机器校验"范式，与 A3 共享"结构地图"哲学。
- 但它**不是任何一个 Atlas**：你不做定理形式化 (A2)、不从零合成带证明的新代码 (A1)、坐标系是代码关系而非公理 (A3)。
- 它**最像的现成系统是 CodeQL/Doop（符号侧）+ Chiasmus（神经符号侧）**，而你独特的增量是：**把治理规则（FDRS 六支柱）、AI 语义提升、跨语言、可独立运行**捏成一个针对**任意项目**的引擎。
- 它的**对立面**（同领域、反方向）是 **Dafny/A1、Verus、Logos** 这类"合成式全证明"系统——分析 vs 合成、Datalog 分层 vs Lean 全证明，详见本文 **§四**。

**所以："不是在重造某个 Atlas，而是在把'形式化'从 FDRS 的规则层下沉到全代码层，落在 CodeQL × LLM 的交叉点上。"**

---

## 六、命名说明：为什么叫 `formal-atlas`

取这个名字是**有意的双关**，但不是宣称"我们就是那个 Atlas"：
- **atlas = 地图册**：本项目把一个代码库映成一张完整的**逻辑关系地图**（事实库），正如 A3 把数学映成公理地图。
- **formal = 形式方法 / Prolog**：地图上的每个断言都是**可机检**的。
- 文档里始终明确：formal-atlas 与 arXiv 上的三个 ATLAS 是**不同系统**，关系如上表。若担心混淆，可随时改名（如 `code-logos` / `prolog-lift` / `codemap`）。

> 参考文献（含全部 arXiv 链接）见 [`references.md`](./references.md)。
