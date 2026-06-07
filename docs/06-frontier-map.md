# formal-atlas 前沿地图:现状梳理 + 带优先级的下一程

> `04-roadmap.md` 是按阶段(Phase 0–5)记录的路线图,标了哪些 ✅ 做完、哪些 ☐ 待办。
> 本文做两件 `04` 没做的事:**(1) 把"现状"压成一张可快速扫的总览**(消除"这到底建了什么"的困惑);**(2) 把所有待办项 + `05-math-deepening.md` 推出的新机会,按"价值 × 可行性 × 复用现有资产"重新排成一条带优先级的主线**,并标清每项落在哪条数学轴上。

---

## 一、现状一页纸:你已经建成什么

一句话:**FDRS 证明了"用 Prolog 校验代码"可行;formal-atlas 把它从规则层下沉到全代码层**——把整个代码库抽象成一张**逻辑关系地图**,在最小 Herbrand 模型上问任意逻辑问题。

| 能力诉求 | 现状 | 位置 |
|---|---|---|
| 全代码形式化 + Prolog 校验 | ✅ `extract`→`link`→`verify` 全管线;`reaches/dead_code/cyclic/impact/violation` 跑真实调用图 | `src/pipeline.js`、`src/rules/*.pl` |
| **AI 把代码转成形式表示** | ✅ `intent/side_effect/pure/contract` + Hoare 前后置 + 循环不变式;统一 LLM 层(MCP sampling→API→离线) | `src/lift/ai-lifter.js`、`src/formalize/{hoare,invariant}.js`、`src/llm/index.js` |
| 组合/功能性质 | ✅ z3:契约蕴含证明/反例、RBAC 职责分离 SAT/UNSAT | `src/verify/smt-bridge.js`、`smt-dsl.js` |
| 跨语言 | ✅ acorn(JS 深)+ tree-sitter(Py/Go/Java/Rust/TS)+ 正则兜底 | `src/extract/` |
| 回流 FDRS | ✅ deep→shallow 概念桥 + 深事实信号源(`fdrs-synthesize --deep`) | `src/integrations/fdrs-bridge.js` |
| 独立、针对任意项目、可分发 | ✅ 零安装;已发布 npm `formal-atlas@0.1.0` + GitHub;MCP server + Claude Code 插件;14 测试 | `README.md`、`mcp/`、`plugin/` |
| 数学基础 + 全球文献 | ✅ Curry–Howard–Lambek/抽象解释/Datalog/Rice(`01`)+ 深化(`05`)+ 40+ 文献(`references`) | `docs/` |

> 定位:你的设想 ≈「Doop/CodeQL 式声明式分析」×「LLM autoformalization」×「FDRS 治理」。它**不是**任何一个 arXiv "Atlas",最像 CodeQL/Doop(符号侧)+ Chiasmus(神经符号侧);与 Logos Research 是"分析式 vs 合成式"的正交互补。详见 [`03-atlas-comparison.md`](./03-atlas-comparison.md)。

### 已诚实记录的边界(= 前沿入口)
1. **指向分析**:反射/高阶/动态分派未解析;作用域 import 绑定 + points-to **仅 JS**(非 JS 走"本地 + 全局唯一"较松解析)。
2. **污点分析**:**行级/文件内启发式**,无跨过程精确流(CWE-89/79)。
3. **LLM 事实**:启发式、**需复核**;NL 契约的形式化是 autoformalization 难题(`05 §13`)。
4. **SMT 契约**:只在用可形式化 DSL 表达时可判定;自然语言契约够不着。
5. **规模**:tau-prolog 在大库(10K+ 事实)可能慢;事实库未持久化。

---

## 二、带优先级的前沿地图(四条轴)

把 `04-roadmap` 未勾选项 + `05-math-deepening` 推出的新机会合并排序。**轴**对应你选定的四个侧重:`数学`=数学理论本身、`严谨`=严谨度↑、`规模`=规模与精度↑、`闭环`=神经符号闭环。

| 优先 | 前沿 | 轴 | 做什么 | 复用 | 成本 | 数学依据 |
|---|---|---|---|---|---|---|
| **★1** | **数学深化(本批文档)** | 数学 | 把 `05` 的 §8–§14 落地成文档:算术分层、描述复杂度、λ-立方体、精化类型档、完备性、忠实度、HoTT | 纯文档 | 低 | `05` 全文 |
| **★2 ✅** | **精化类型层(已完成 2026-06-07)** | 严谨 | 已新增 `refinement(R, Var, φ, pre\|post)` 事实 + z3 判定 `φ_pre ⇒ φ_post`,四档裁决(entailed/broken+反例/vacuous/unchecked);CLI `refine`+`smt refinement`、MCP `refine` 工具、6 测试。见 [`07-refinement-layer.md`](./07-refinement-layer.md) | **已集成 z3**、`smt-dsl.js`、`smt-bridge.checkContract`(零重写复用) | 中 | `05 §11`(Liquid Types)、`05 §10`(λ-立方体可判定角) |
| **★3 ✅** | **反例驱动修复 + 证明树解释（已完成 2026-06-07）** | 闭环 | 已新增 `src/verify/explain.js`（证明树：污点 `tainted_path/3` 给源→汇链、refinement 拎 z3 反例）+ `src/repair/{feedback,loop}.js`（LLM 候选 → 应用到临时副本 → 重抽取重校验 → 计数下降且无回归才接受；离线诚实降级 `needs-llm`）。先决可判定分诊：`sink_ct/2` 内容类型精化压掉 ~92 假 XSS。CLI `explain`/`repair`、MCP 第 14/15 工具、4 测试。见 [`08-closed-loop.md`](./08-closed-loop.md) | tau-prolog、z3、`llm/`、★2 的 `broken` 反例 | 中 | `05 §13`(证伪式闭环)、Chiasmus derivation-trace |
| **★4 ✅** | **规约忠实度评测（已完成 2026-06-07）** | 严谨/闭环 | 已新增 `src/verify/faithfulness.js`：`scoreFaithfulness` 用带标签样例 `evalExpr`（QF-LIA 可判定、零 LLM）打忠实分,逮 too-weak/too-strong;`equiv` 复用 `checkContract` 双向撑 `roundTrip`(LLM 复述→再形式化→z3 判等价)。CLI `smt faithfulness`、MCP 第 16 工具、5 测试。见 [`09-faithfulness.md`](./09-faithfulness.md) | `examples/`、`formalize/`、`checkContract` | 中 | `05 §13`(忠实度无法证明、只能证伪) |
| 5 | **Soufflé / 增量 Datalog** | 规模 | 大库走 Soufflé(Datalog→并行 C++);watch 模式上增量维护(Differential Dataflow / DDlog / DRed) | 事实库、`watch.js`、`cache.js` | 中高 | `05 §9`(PTIME 数据复杂度);增量 = 最小不动点的 IVM |
| 6 ◑ | **IFDS/CFL-可达 污点（三刀已实现 2026-06-07）** | 规模/精度 | 已落地 within-file **tainted-RETURN 摘要**（刀1）+ **param-sink/参数→形参反向**（刀2，content-type 护栏）+ **跨文件 param-sink 连接**（刀3，QId 摘要 + `link/taint-link.js` post-link 解析，0 误报）；余 IFDS（returns-taint 跨文件、exploded graph）待续。见 [`10-interprocedural-taint.md`](./10-interprocedural-taint.md) | `extract/taint{,-interproc,-patterns}.js`、`link/taint-link.js`、`taint.pl` | 中高 | Reps–Horwitz–Sagiv POPL'95;CFL-reachability |
| 7 | **Doop 级过程间指向** | 规模 | 解析动态分派/反射,把死代码/污点误报压到工业级 | linker、points-to | 高 | `05 §12`(完备性:给抽象补维度) |
| 8 | **全 ITP 放电** | 严谨(地平线) | 接 Dafny/Verus/Lean CLI **真正放电**证明义务(= Logos territory;最严、最贵、需外部工具链) | `contract/3`、Dafny 骨架 | 高 | `05 §10`(λC 顶点) |

### 推荐主线
**★1(本批文档已写)→ ★2 精化类型(✅ 2026-06-07,`07`)→ ★3 闭环修复 + 证明树(✅ 2026-06-07,`08`)→ ★4 忠实度评测(✅ 2026-06-07,`09`)。★1–★4 主线完成。**
此后 **5–8(Soufflé 增量 Datalog / IFDS 过程间污点 / Doop 级指向 / 全 ITP 放电)按真实规模与严谨度需求启动**,不预先铺开。
5–8 按**真实规模 / 严谨度需求**按需启动,不预先铺开——遵循 `04-roadmap` 的"可判定优先、便宜够用就停、升级-回滚安全"三条取舍主线。

### 为什么是这个顺序
- **★2 排在最前的能力项**:它是 `05 §10` λ-立方体地图上**当前唯一缺的可判定档**,且**复用已经跑通的 z3**,边际成本最低、严谨度提升最直接——把"前/后置契约"从"NL 需人看"升级成"机器判定"。
- **★3 紧随**:有了可判定的 refinement/contract,反例(z3 的 counterexample、Prolog 的失败证明树)才有结构可喂回 LLM,形成 `05 §13` 的证伪式闭环——这是"神经符号"真正闭合的地方。
- **★4 配套 ★3**:闭环要可信,就得能**度量** LLM 产出的忠实度(证伪测试 + 回译),否则闭环可能在错误规约上自洽。
- **5–8 是规模/精度工程**:价值高但成本高、且只有在**真去扫超大库或追工业级精度**时才有回报,故按需。

---

## 三、与原路线图的关系

本文不替代 [`04-roadmap.md`](./04-roadmap.md)——`04` 是按 Phase 记录的"做了什么 / 待办",本文是**"现在该先做哪个"的优先级视图 + 新增的 ★2 精化类型档**(`04` 原本直接从 Datalog 跳到 SMT/ITP,`05 §11` 论证了中间应补这一档)。两者一并阅读:`04` 看历史与全貌,本文看下一步与理由。

> **落地约束(与本批一致)**:不新建重复子项目;若动手做 ★2,**单独开 spec**,走"升级-回滚安全"开关;LLM 侧严守 `01 §5` / `05 §13` 的"只产事实、永远过求解器才成结论"。
