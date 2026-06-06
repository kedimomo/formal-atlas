# formal-atlas vs chiasmus 对比分析

## 摘要

formal-atlas 和 chiasmus 是**同范式、同构但不同侧重**的两个神经符号代码形式化系统。两者核心管线一致：**源码 → tree-sitter/AST 抽取 → Prolog 事实 → 求解器验证**，且都通过 MCP 暴露给 LLM。但 chiasmus 更像一个**功能丰富的 MCP 工具箱**（模板系统、语义搜索、代码地图、PR diff、图算法），而 formal-atlas 更像一个**自包含的形式化引擎**（作用域链接器、AI 语义提升、治理规则、FDRS 回流、三引擎分流）。

---

## 一、核心架构对比

| 维度 | formal-atlas | chiasmus |
|---|---|---|
| **定位** | 独立的形式化引擎（CLI + MCP） | MCP server，给 LLM 提供形式化验证工具 |
| **语言** | JavaScript (ES Module) | TypeScript（需编译） |
| **Node 要求** | >= 18 | >= 20 |
| **许可证** | GPL-3.0-or-later | Apache-2.0 |
| **Prolog 引擎** | `tau-prolog`（纯 JS 实现） | `prolog-wasm-full`（SWI-Prolog WASM，含 CLP(FD)） |
| **SMT 引擎** | `z3-solver`（WASM） | `z3-solver` |
| **图算法库** | 无（依赖 Prolog 递归） | `graphology`（Louvain 社区、介数中心性、最短路径等 O(V+E) 原生算法） |
| **持久化缓存** | 无 | `better-sqlite3`（per-file content-hash，LRU 预算） |
| **构建** | 零构建，直接运行 | `tsc` 编译到 `dist/` |

---

## 二、功能对比

### formal-atlas 有而 chiasmus 没有的

| 功能 | 说明 |
|---|---|
| **作用域感知链接器 (Linker)** | 把裸名调用解析为文件限定节点，根治跨文件同名合并问题。死代码误报从 86 降到 1 |
| **AI 语义提升器 (AI Lifter)** | 离线启发式（函数名前缀→intent，调用目标→side_effect）+ 在线 LLM（Anthropic API），输出统一 Prolog 事实 |
| **三引擎分流** | 按性质难度分流：Prolog（结构）→ SMT/Z3（契约/RBAC）→ FDRS（治理），可判定优先 |
| **治理规则 (governance.pl)** | 内置 6 条 `violation/2` 规则：crypto-in-loop、await-in-loop、external-call、hardcoded-sensitive、dead-code、intent-effect-mismatch |
| **FDRS 回流桥** | 深事实→FDRS 概念事实→现有六支柱规则 |
| **契约蕴含证明** | Hoare 风格：前置条件能否保证后置条件，给反例 |
| **RBAC 职责分离验证** | SMT 验证 SoD，给 SAT witness / UNSAT 证明 |
| **Dafny 骨架生成** | SMT 验证后可生成 Dafny 验证骨架 |
| **正则兜底抽取** | 对不支持的语言做粗粒度正则抽取 |
| **acorn 深度 JS 抽取** | 含 points-to 分析、`addr_taken/2`、`string_lit/3` 等精细事实 |
| **独立 CLI** | extract/verify/query/lift/smt/fdrs 六个子命令，可脱离 MCP 独立使用 |

### chiasmus 有而 formal-atlas 没有的

| 功能 | 说明 |
|---|---|
| **模板系统 (Skills)** | 8 个预置验证模板（RBAC、依赖、污点、工作流、验证等），支持 `chiasmus_skills`/`chiasmus_formalize`/`chiasmus_craft`/`chiasmus_learn` |
| **语义搜索 (chiasmus_search)** | 基于 embedding + 余弦相似度的代码语义搜索（支持 OpenAI/DeepSeek/OpenRouter） |
| **代码地图 (chiasmus_map)** | 代码库概览：per-file headlines、exports with signatures、token estimates |
| **PR Diff (chiasmus_graph diff)** | 图级 diff：addedNodes/removedNodes/addedEdges/removedEdges，支持 snapshot baseline |
| **持久化缓存** | SQLite per-file content-hash 缓存，warm hit ~2.5ms vs cold ~170ms（60× 加速） |
| **Mermaid 解析** | 直接把 Mermaid 流程图/状态图解析为 Prolog 事实 |
| **图算法分析** | communities（Louvain）、hubs、bridges（介数中心性）、surprises、layer-violation |
| **代码审查工作流 (chiasmus_review)** | 7 阶段审查配方：结构→架构→安全→资源→授权→正确性→影响面 |
| **自定义语言适配器** | 插件式 `chiasmus-adapter-<language>` npm 包，自动发现 |
| **Clojure 支持** | 内置 Clojure/ClojureScript tree-sitter 适配器 |
| **推导轨迹 (explain=true)** | Prolog 查询返回 derivation trace，显示哪些规则被触发 |
| **UNSAT Core** | Z3 UNSAT 结果包含 `unsatCore`，显示哪些断言冲突 |
| **规范 Lint (chiasmus_lint)** | 不跑求解器的快速结构校验 |
| **端到端求解 (chiasmus_solve)** | 选模板→填槽→lint→修正循环→返回验证结果 |
| **qualified-name hints** | TS/JS 调用携带 `Class.method` 限定名，import 解析 tsconfig 路径别名 |

---

## 三、设计哲学差异

| 维度 | formal-atlas | chiasmus |
|---|---|---|
| **LLM 角色** | LLM 是"语义提升器"——只在抽取后补语义事实，求解器永远当裁判 | LLM 是"驾驶员"——LLM 选模板、填槽、解读结果，求解器是工具 |
| **自包含性** | 强：零构建、零原生依赖、CLI 可独立运行 | 弱：需编译、依赖 `better-sqlite3`（原生模块）、纯 MCP 形态 |
| **精度策略** | 作用域链接器根治同名合并，追求低误报 | 依赖 graphology 原生图算法，追求大规模性能 |
| **治理 vs 工具** | 内置治理规则，开箱即用 | 提供工具箱，治理规则由用户/LLM 通过模板定义 |
| **扩展方式** | 修改源码添加规则/抽取器 | 发布 `chiasmus-adapter-<lang>` npm 包 + `chiasmus_craft` 创建模板 |

---

## 四、Prolog 引擎差异（关键区别）

| | formal-atlas (tau-prolog) | chiasmus (prolog-wasm-full / SWI-Prolog) |
|---|---|---|
| **实现** | 纯 JS，无 WASM | SWI-Prolog 编译为 WASM |
| **CLP(FD)** | 不支持 | 支持 `library(clpfd)` |
| **标准库** | 有限 | 完整 SWI-Prolog 标准库 |
| **性能** | 较慢（纯 JS 解释） | 较快（WASM 编译） |
| **体积** | 小 | 大（WASM binary） |
| **推导轨迹** | 无 | `explain=true` 返回推导链 |
| **Mermaid 解析** | 无 | 支持 |

---

## 五、总结

**一句话：formal-atlas = 自包含形式化引擎（精度优先 + 治理内置 + AI 提升），chiasmus = LLM 驱动的形式化工具箱（功能丰富 + 性能优先 + 模板生态）。**

两者核心管线同构（源码→事实→Prolog/SMT 验证），但：
- formal-atlas 的**独特价值**在于：作用域链接器（根治误报）、AI 语义提升、治理规则、FDRS 回流、独立 CLI
- chiasmus 的**独特价值**在于：模板系统、语义搜索、代码地图、PR diff、持久缓存、原生图算法、Mermaid 解析、推导轨迹、UNSAT Core、插件式语言适配器

两者互补性很强：formal-atlas 的链接器和治理规则可以解决 chiasmus 的精度问题；chiasmus 的模板系统、缓存、图算法和工具生态可以补齐 formal-atlas 的功能短板。
