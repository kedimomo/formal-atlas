# formal-atlas 路线图

按 [数学基础 §6](./01-math-foundations.md#6-诚实的边界rice-定理) 的"性质分层"推进——从可判定的结构层，逐步接入 SMT 与 ITP，并回流到 FDRS。

## Phase 0 — MVP（✅ 本仓库已完成）
- [x] acorn 真 AST 抽取 JS 调用图 + 结构事实；多语言正则兜底。
- [x] AI lifter：离线启发式 + 在线 LLM（Anthropic）两路，输出统一形式事实。
- [x] tau-prolog 引擎：`reaches/2`（cycle-safe 传递闭包）、`dead_code/2`、`cyclic/1`、`impact/2`、`violation/2`。
- [x] CLI（extract/verify/query/lift）+ 报告 + 端到端测试；可指向任意项目。
- [x] 在真实仓库代码（`tools/lint`，27 文件 / 1582 事实）上验证可用。

## Phase 1 — 精度与广度（结构层做扎实）
- [x] **跨语言深抽取**：已接入 **web-tree-sitter@0.22.6 + tree-sitter-wasms**（Python/Go/Java/Rust/TypeScript/TSX），与 JS 同一 fact schema，WASM 无原生编译。含 per-language 导出可见性识别（Go 大写 / Python 模块级 / Rust `pub` / Java `public` / TS `export`）。
- [x] **轻量指向分析 (points-to)**：已实现 **address-taken 分析**（函数名作为值传递/赋值/返回 → 间接可达，不算死代码）+ 对象字面量方法标 `lambda`。真实代码死代码**误报 86 → 1**。
- [x] **作用域感知的调用解析**：已实现 **linker**（`src/link/linker.js`）：抽取器发 `calls3/3`（带调用方文件）+ `import_binding/4`，linker 按 **import 绑定 → 同文件本地 → 全局唯一 → extern** 把每条调用解析到**文件限定**节点（`decl/node/rcall`）。跨文件**同名函数不再合并**（实测 `walkDir` 在 5 文件各成独立节点、各自局部递归）；死代码新增 `unresolved_call` 安全网，**误报趋近零**（`../tools/lint` 死代码=1 且为真阳）。
- [ ] **跨文件/高阶指向分析**：解析动态分派/反射（Doop 级，进一步降误报）。
- [ ] **数据流事实**：`flows_to/2`、`taints/2`，支撑注入/污点查询（CodeQL 的杀手锏）。
- [ ] **性能**：大库走 **Soufflé**（Datalog→并行 C++）或对 tau-prolog 做 EDB 索引；事实库持久化（ComputeHibernation）。

## Phase 2 — 接入更强引擎（按性质难度升级）
- [x] **SMT 层**：已接入 **z3-solver**（WASM Z3，本地跑）。`contract/3` → **Hoare 式蕴含校验**（证明 `pre ⊨ post` 或给反例）；**RBAC 职责分离 (SoD) 一致性**（SAT/UNSAT + witness）——"grep/Datalog 问不出"的组合性质。
- [x] **演绎验证桥（骨架）**：`contract/3` → **Dafny method 骨架**（requires/ensures）。
- [ ] **演绎验证（全证明）**：接 Dafny/Verus CLI 真正放电证明义务（参考 ATLAS-Synthesis）。
- [ ] **时序性质**：把调用图/状态机喂给 **TLA⁺ / 模型检查**（对接仓库 `formal/ReBAC_SPV.tla`）。

## Phase 3 — 神经符号闭环（autoformalization 做忠实）
- [ ] **spec faithfulness 评测**：仿 **Verus-SpecGym**，用"接受合法/拒绝非法"的可执行样例给 LLM 产出的 `contract/3` 打忠实度分。
- [ ] **推导轨迹解释**：暴露 Prolog 证明树（哪些子句被触发），把"为什么违规"喂回 LLM 与人（Chiasmus 的 derivation-trace 思路）。
- [ ] **反例驱动修复**：UNSAT/违规 → 结构化反馈 → LLM 提修复 → 再校验（generate-and-check 闭环）。

## Phase 4 — 回流 FDRS / 治理一体化
- [x] **deep→shallow 事实桥**（`src/integrations/fdrs-bridge.js`）：把 formal-atlas 深事实降维成 FDRS 概念事实（`fact/2`、`fact/3`），喂给**现有** `tools/lint/prolog-check.js`，六支柱规则在深事实上触发（实测 P1.1/P1.2/P6.1，比正则版更精确）。
- [x] 让 FDRS 的 `fdrs-synthesize` 以该深事实库为信号源生成新规则（而非正则信号）。已实现 `tools/lint/fdrs-deep-signal.js`：跑 formal-atlas 治理证明 `violation(Subject, RuleId)`，按 `DEEP_PILLAR` 映射到六支柱 id（`where/how_fast/boundary/whether/how_correct`），产出与 `computeFdrsScore()` 同形的信号；`fdrs-synthesize.js` 加 `--deep[=target]` 开关消费它（默认正则路径不变，升级/回滚安全）。实测 `src/auth/policy`(20 文件)→ score 23、9 条真违规驱动合成。
- [ ] 把 `governance.pl` 与 `.trae/rules/*` 的 assertion **双向同步**：规则演化在深事实层闭环。
- [ ] **规则即数据**：规则版本化 + `supersedes` DAG（复用 FDRS meta-rule 机制）。

## Phase 5 — 独立产品化（针对所有项目）
- [ ] 一条命令扫任意 repo 出"逻辑地图 + 性质报告"；CI 插件 / pre-commit hook。
- [x] **MCP server 形态**（像 Chiasmus），让任意 LLM agent 把"可达性/死代码/影响面/契约"当工具调用，**省 token、给定论**。已实现 `mcp/server.js`（零依赖 stdio MCP，暴露 `reaches/dead_code/impact/verify/query/contract` 六个工具，事实库按 path 缓存"抽取一次查多次"）；注册见 [`mcp/README.md`](../mcp/README.md)。已用 `mcp/bench.js` 实测省 token（真实 `src/auth/policy` 每次查询比读源码省 83–298×）。
- [x] **Claude Code 插件 + marketplace**：`plugin/`（`.claude-plugin/plugin.json` + bundle 的 `.mcp.json` + `skills/` 三个 slash 命令）+ 根 `.claude-plugin/marketplace.json`，`claude plugin validate` 通过。`--plugin-dir` 就地可测;真正 `/plugin install` 分发需先把引擎发 npm（`/plugin install` 会拷贝、脱离仓库依赖），见 `plugin/README.md`。
- [ ] Web 可视化：把事实库渲染成可点的"代码 atlas"。

---

### 取舍主线（始终遵循）
1. **可判定优先**：能在 Datalog 里 sound 判定的，绝不上 LLM。
2. **LLM 受检**：神经侧只产事实，**永远过求解器/类型检查**才成结论。
3. **升级-回滚安全**：新能力走开关，旧路径不动（呼应仓库 P7 可插拔约束）。
