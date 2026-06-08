# formal-atlas

**把任意代码库提升为逻辑事实，用 Prolog/Datalog 校验任意性质。** 独立、跨语言、可指向任何项目的神经符号代码形式化引擎。

> 一句话：FDRS 证明了"用 Prolog 校验代码"可行——formal-atlas 把它从**规则层**下沉到**全代码层**：不再问"这个文件含不含某特征"，而是把整个代码库抽象成一张**逻辑关系地图**，在上面问任意逻辑问题（可达性、死代码、循环依赖、影响面、意图×副作用矛盾……）。

```
            ┌─► tau-prolog  → 结构/治理 (reaches·dead·cyclic·impact·violation)
源码 ─acorn(JS) / tree-sitter(Py·Go·Java·Rust·TS) / 正则─► 结构事实 ─AI lifter─► 语义事实 ─┤
     (符号 · 含 points-to 指向分析)                       (神经·受检)        ├─► z3-solver  → 契约蕴含 / RBAC 职责分离 (证明·反例)
                                                                          └─► FDRS 桥    → 现有 tools/lint/prolog-check.js (六支柱)
```

> 一句话：FDRS 证明了"用 Prolog 校验代码"可行——formal-atlas 把它从**规则层**下沉到**全代码层**，并按性质难度分流到三种引擎：结构性质→**Prolog**（可判定）、功能/组合性质→**SMT/z3**、治理→**回流 FDRS**。

## 为什么存在 / 它解决什么

| 问题 | grep/linter | formal-atlas |
|---|---|---|
| `handleRequest` 能否到达 `dbQuery`？ | 手动追多跳，易漏 | `reaches(handleRequest, dbQuery).` → 求解器给**定论**（负结果是穷举证明） |
| 全局死代码？（含 Python/Go） | "我扫了几个文件没找到调用方" | `dead_code(F, N).` → 整图判定（points-to 已根治误报） |
| 改这个函数会影响谁？ | 靠经验 | `impact(target, Caller).` |
| 名字像"读"却写库？ | 做不到 | `intent(N,read), side_effect(N,database).`（**跨层**查询） |
| 前置条件真能保证后置条件？ | 做不到 | `smt contract` → z3 **证明**或给**反例** |
| 契约**可判定、不矛盾**吗？(精化类型 ★2) | 做不到 | `refine`/`smt refinement` → z3 判定 `φ_pre ⇒ φ_post`,给反例/标 vacuous |
| 角色授权会让同一人既建又批（职责分离漏洞）？ | grep 不出来 | `smt policy` → z3 给 SAT **witness** / UNSAT |

## 快速开始（零安装，若在本仓库内）

```bash
cd formal-atlas

# 1) 跑治理校验（自带演示项目，含植入问题）
node src/cli.js verify examples/sample-project

# 2) 任意 Prolog 查询
node src/cli.js query examples/sample-project "reaches(handleRequest, connect)."
node src/cli.js query examples/sample-project "dead_code(File, Name)."
node src/cli.js query examples/sample-project "impact(validateUser, Caller)."

# 3) 多语言（Python + Go，tree-sitter，同一套谓词）
node src/cli.js verify examples/polyglot
node src/cli.js query  examples/polyglot "reaches(handle_request, get_from_cache)."

# 4) SMT（z3）：契约蕴含 / RBAC 职责分离
node src/cli.js smt contract examples/contracts/add-positives.json
node src/cli.js smt policy   examples/policy/rbac-sod.json

# 4b) 精化类型（★2）：判定 φ_pre ⇒ φ_post，给反例/标矛盾（无需 API key）
node src/cli.js smt refinement examples/refinement/bank.refine.json
node src/cli.js refine examples/sample-project

# 5) 回流 FDRS：深事实 → 现有 tools/lint/prolog-check.js（六支柱规则触发）
node src/cli.js fdrs examples/sample-project

# 6) 导出任意项目的逻辑事实库 / LLM 语义提升 / 测试
node src/cli.js extract /path/to/ANY/project --out=facts.pl
node src/cli.js lift examples/sample-project        # 需 ANTHROPIC_API_KEY
node test/smoke.test.js && node test/engines.test.js
```

> 在本仓库内：`acorn` / `tau-prolog` 从仓库 `node_modules` 解析，**无需安装**。拷到别处：`npm install`。

## 实测输出（演示项目）

```
$ node src/cli.js verify examples/sample-project
[ERROR] crypto-in-loop       (1)   • hashAll
[ERROR] hardcoded-sensitive  (2)   • auth.js  • server.js
[WARN]  await-in-loop        (1)   • getConnection
[INFO]  external-call        (1)   • reportMetric
[INFO]  dead-code            (2)   • formatBytes  • legacyCheck
— 7 solution(s): 3 error(s), 1 warning(s)

$ node src/cli.js query examples/sample-project "reaches(handleRequest, connect)."
true.   # handleRequest → dbQuery → getConnection → connect（传递闭包）

$ node src/cli.js smt policy examples/policy/rbac-sod.json
safe assignment (meets requirements + respects SoD): unsat  → 需求强制造成职责分离冲突
SoD violation reachable under these grants: sat
  witness: alice:author, alice:reviewer, bob:admin      # z3 给出反例

$ node src/cli.js fdrs examples/sample-project          # 喂给"现有"FDRS 校验器
[prolog-check] 7 条违规:
  [ERROR] crypto.js — [P1-Where] 含同步加密，无Worker
  [ERROR] server.js — [P6-Boundary] 硬编码ID ...
```

在真实仓库代码上（`../tools/lint`，32 文件 → 4600+ 事实，含 256 个文件限定 `decl`、976 条解析 `rcall`）已验证：**死代码误报经 points-to + 作用域解析 86 → 1（且为真阳）**；曾被合并的 7 个同名函数（`main`×5、`walkDir`×5、`parseFrontmatter`×3…）现各成独立节点、各自局部递归；`fdrs-synthesize --deep src/auth/policy` 让现有六支柱规则演化以深事实为信号源（20 文件 → score 23、9 条真违规）。Python+Go 经 tree-sitter 抽出与 JS 同构的调用图。

## 文档（设计与思想）

| 文档 | 内容 |
|---|---|
| [`docs/00-vision.md`](./docs/00-vision.md) | 愿景：从 FDRS 规则层下沉到全代码层 |
| [`docs/01-math-foundations.md`](./docs/01-math-foundations.md) | **代码与数学的关系**：Curry–Howard–Lambek、抽象解释、Datalog=最小不动点、Rice 边界 |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | 管线、事实本体、规则插件、精度/soundness、文件职责 |
| [`docs/03-atlas-comparison.md`](./docs/03-atlas-comparison.md) | **和 Atlas/Logos 是不是一样**：三个 ATLAS 消歧 + 逐项对比 + 真正最像的系统 + Logos「分析式 vs 合成式」 |
| [`docs/04-roadmap.md`](./docs/04-roadmap.md) | 路线图：points-to / Soufflé / SMT / autoformalization / 回流 FDRS |
| [`docs/05-math-deepening.md`](./docs/05-math-deepening.md) | **代码↔数学（深化）**：算术分层精化 Rice、Datalog=PTIME、λ-立方体、精化类型、完备性、忠实度、HoTT |
| [`docs/06-frontier-map.md`](./docs/06-frontier-map.md) | **现状一页纸 + 带优先级的下一程**（四条轴排序，含"精化类型档"） |
| [`docs/references.md`](./docs/references.md) | 全球文献（含 arXiv 链接） |

## 现状与边界（诚实）

- ✅ 已跑通：**JS 深抽取 + points-to 指向分析**（死代码误报根治 86→1；Andersen 引擎解析变量持函数/动态分派、过程间实参流、高阶 builtin 回调 `arr.map(cb)`，behind `--points-to`）、**作用域感知调用解析**（linker 用 import 绑定把跨文件同名函数解析为文件限定节点，死代码误报趋近零）、**多语言 tree-sitter**（Python/Go/Java/Rust/TS，同一 schema）、AI 语义提升（离线+在线）、`reaches/dead_code/cyclic/impact/violation`、**SMT/z3**（契约蕴含证明+反例、RBAC 职责分离）、**精化类型层 ★2**（`refinement/4` + z3 判定 `φ_pre ⇒ φ_post`，四档裁决、诚实区分 `unchecked`，见 [`docs/07`](docs/07-refinement-layer.md)）、**反例驱动修复 + 证明树解释 ★3**（`explain`/`repair`，离线诚实降级 `needs-llm`，[`docs/08`](docs/08-closed-loop.md)）、**规约忠实度评测 ★4**（`faithfulness`，逮 too-weak/too-strong，[`docs/09`](docs/09-faithfulness.md)）、**零安装半朴素 Datalog 规模引擎 ★5**（闭包查询 110–1238×、增量闭包 add+delete，[`docs/11`](docs/11-scale-engine.md)）、**过程间数据流污点分析 ★6**（`taint-reaches-sink`，CWE-89/79；conduit/param-sink/param→return 三类摘要双向跨文件 + content-type 护栏，九刀，[`docs/10`](docs/10-interprocedural-taint.md)）、**FDRS 回流桥 + 深事实信号源**（`fdrs-synthesize --deep`）、**MCP server（16 工具）+ Claude Code 插件**、CLI、**9 smoke + 37 engines 测试 + MCP 16-工具自检**、真实代码验证。
- ⚠️ 已知限制：**反射 / 字段敏感 dispatch-table**（`handlers[k]()`）指向未解析（**变量持函数、过程间实参流、高阶 builtin 回调已由 points-to 解析**，behind `--points-to`；跨文件同名已由 linker 根治）；作用域解析的 import 绑定与 points-to 目前**仅 JS**（非 JS 走"本地+全局唯一"较松解析）；正则兜底层仅粗粒度；**污点分析已过程间**（★6 九刀，三类摘要双向跨文件、0 误报），唯**完整 exploded-supergraph IFDS（精确 realizable-path）** 未做；LLM 事实是**启发式**、需复核（在线 `repair`/`roundTrip` 需 `ANTHROPIC_API_KEY`）；SMT 契约需用可形式化 DSL 表达；**全 ITP 放电（Dafny/Verus/Lean）未接**（需外部工具链）。根治方案见路线图。
- 🧭 原则：**按性质难度分流引擎；可判定优先；LLM 只产事实、永远过求解器才成结论**。

## 安装

```bash
cd formal-atlas && npm install   # acorn · tau-prolog · web-tree-sitter@0.22.6 · tree-sitter-wasms · z3-solver（均 WASM/纯 JS，无原生编译）
```
> 在父仓库内 `acorn`/`tau-prolog` 可从仓库 node_modules 解析；tree-sitter/z3 需在 `formal-atlas/` 内 `npm install`（已装好）。

## 与 FDRS 的关系

formal-atlas 不替代 FDRS——它是 FDRS 的**深层底座**。两个方向已打通：
1. **deep→shallow 概念桥**（`src/integrations/fdrs-bridge.js`）：把深事实降维成 FDRS 概念事实，喂给**现有** `tools/lint/prolog-check.js`，六支柱规则在深事实上触发（如 `crypto-in-loop` = "循环作用域内确有加密调用"，比正则版精确）。
2. **深事实信号源**（`tools/lint/fdrs-deep-signal.js` + `fdrs-synthesize.js --deep`）：把治理证明 `violation(Subject,RuleId)` 映射到六支柱 id，作为 FDRS **规则自进化的信号源**（取代正则关键词信号；默认路径不变、可回退，升级安全）。

长期目标：`governance.pl` 与 `.trae/rules/*` 的 assertion 双向同步，规则演化在深事实层闭环。

---
*License: GPLv3 (GPL-3.0-or-later). 命名说明（为何叫 "atlas"）见 [03-atlas-comparison.md §6](./docs/03-atlas-comparison.md)。*
