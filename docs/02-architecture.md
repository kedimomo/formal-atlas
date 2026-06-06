# formal-atlas 架构

## 1. 管线总览（neuro-symbolic loop）

```
                         ┌──────────────────────────────────────────────┐
   any project/dir  ──►  │  EXTRACT (符号)            LIFT (神经/启发)      │
                         │  acorn AST  (JS) ─┐                            │
                         │  tree-sitter (Py/Go/ ┼─► 结构事实 ─► AI lifter ─► 语义事实│
                         │   Java/Rust/TS)  │     calls/2 …      intent/2 …  │
                         │  regex 兜底 ──────┘                            │
                         └──────────────────┼──────────────────┬─────────┘
                                            ▼                  ▼
                              ┌───────────────────────────────────┐
                              │  ASSEMBLE: rules(*.pl) + facts      │
                              └──────┬───────────────┬─────────────┘
                                     ▼               ▼            ▼
                    ┌───────────────────┐ ┌────────────────┐ ┌──────────────────┐
                    │ VERIFY: tau-prolog │ │ SMT: z3-solver  │ │ FDRS bridge →     │
                    │ violation/2·reaches│ │ contract/SoD    │ │ tools/lint/       │
                    │ /dead/cyclic/impact│ │ (proof/反例)     │ │ prolog-check.js   │
                    └─────────┬─────────┘ └───────┬────────┘ └─────────┬────────┘
                              ▼                   ▼                    ▼
                         report/facts.pl     proof / 反例 / SAT    六支柱违规
```

- **三条验证路，按性质难度分流**（见 [数学基础 §6](./01-math-foundations.md#6-诚实的边界rice-定理)）：结构性质→Prolog（可判定）；功能/组合性质→SMT（z3）；FDRS 治理→降维喂现有 prolog-check.js。
- **符号侧确定性、可解释、零 token、本地跑**；**神经侧只负责语法够不到的语义**，且产出必须过校验（generate-and-check）。
- 对应数学：EXTRACT+LIFT = 取一个 α 抽象，把程序投影成有限一阶结构；VERIFY = 在其最小 Herbrand 模型上求解查询。

## 2. 通用代码本体（the fact schema / 一阶关系签名）

事实是跨语言的"代码本体"——**JS（acorn）与 Python/Go/Java/Rust/TS（tree-sitter）产出同一套谓词**。当前签名：

| 谓词 | 含义 | 来源 |
|---|---|---|
| `file(File, Lang)` | 文件及语言 | extract |
| `defines(File, Name, Kind, Line)` | 定义（`Kind`=routine\|class\|lambda） | extract |
| `calls(Caller, Callee)` | 调用边（裸名，向后兼容查询） | extract |
| `calls3(File, Caller, Callee)` · `import_binding(File, Local, Mod, Imported)` | 带调用方文件的边 · ES import 绑定（供 linker 解析） | extract |
| `imports(File, Module)` / `exports(File, Name)` | 模块依赖 / 导出（含跨语言可见性） | extract |
| `param(Routine, Index, Name)` | 形参 | extract (JS) |
| `has_loop(Scope, Line)` | 循环 | extract |
| `awaits_in_loop(Scope)` / `crypto_in_loop(Scope)` | 循环内 await / 同步加密 | extract |
| `calls_external(Scope, Api)` | 网络出口（fetch/axios…） | extract |
| `string_lit(File, Value, Line)` | 敏感字面量（tenant/secret…） | extract |
| `addr_taken(File, Routine)` | **函数名被当值传递/赋值/返回 → 间接可达**（文件限定） | **extract (points-to)** |
| `decl(QId, File, Name, Kind)` | **作用域解析后**每个定义的唯一节点（`QId='File::Name'`） | **link** |
| `node(QId, Name)` · `rcall(QCaller, QCallee)` | 调用图节点 · **文件限定**的解析调用边 | **link** |
| `unresolved_call(Name)` | 仅被未解析(extern/动态)调用触达的已定义名（死代码安全网） | **link** |
| `intent(Routine, read\|write\|validate\|compute)` | **意图** | **lift** |
| `side_effect(Routine, network\|database\|crypto\|...)` | **副作用** | **lift** |
| `pure(Routine)` | **纯函数** | **lift** |
| `contract(Routine, pre\|post, '...')` | **前/后置契约**（→ SMT/Dafny） | **lift (LLM)** |
| `source(Id)` · `sink(Id, Kind)` · `sanitizer(Id)` · `dataflow(A, B)` | **污点数据流**：不可信输入 / 危险汇(sql\|command\|xss) / 净化器 / 值流（`Id='file:line:tag'`） | **extract (taint)** |

> 扩展本体 = 加抽取器输出新谓词 + 在 `*.pl` 里写消费它的规则。这是系统的主要延展点。

## 3. 规则层（pluggable logic）

`src/rules/` 下所有 `.pl` 会被自动加载、与事实拼成一个 Prolog 程序：

- **`structural.pl`** —— 基础 EDB 关系的 `:- dynamic` 声明 + 本地 `member/2`（避免空关系触发 existence_error）。
- **`resolved.pl`** —— 语言无关的结构规则，跑在 **linker 解析后的文件限定图**（`decl/node/rcall`）上：`reaches/2`（cycle-safe 传递闭包）、`dead_code/2`（含 `unresolved_call` 安全网）、`cyclic/1`、`impact/2`、`caller_of/2`。对外仍是**裸名接口**（经 `node/2` 投影回名字），所以跨文件**同名函数不再合并**。
- **`governance.pl`** —— 示例**性质规则**，统一为 `violation(Subject, RuleId)`。把 FDRS 六支柱重写在**深事实库**上，因而更精确（如 `intent-effect-mismatch` 只在"读"名 + 写/网络副作用时触发，DB 读不算矛盾）。
- **`taint.pl`** —— **数据流污点分析**(CWE-89/79)：不可信输入未经净化流到危险汇 → `violation(Sink, 'taint-reaches-sink')`。事实由 `extract/taint.js` 产出（从 logos 草稿**合并并强化**：函数边界重置 + 字符串字面量屏蔽，比原草稿少误报）。

新增规则只需丢一个 `.pl` 进去——**规则即插件**。

## 4. 代码地图（文件职责）

```
src/
  cli.js                 CLI: extract | verify | query | lift | smt | fdrs
  pipeline.js            遍历目录 → 抽取 → 提升 → 作用域链接 → 拼装 Prolog 程序
  extract/
    index.js             按扩展名分派 + 兜底链 (acorn → tree-sitter → regex)
    js-ast.js            acorn 真 AST → 调用图 + points-to + calls3/import_binding (JS)
    treesitter.js        web-tree-sitter → Python/Go/Java/Rust/TS，同一 schema
    generic.js           正则启发式 → 其余语言的粗粒度事实
    taint.js             数据流污点抽取 (source/sink/sanitizer/dataflow，JS 家族)
  link/
    linker.js            作用域感知调用解析：calls3+import_binding → decl/node/rcall
  lift/
    fact-model.js        Fact 模型 + Prolog 序列化(atom/quoted/number) + 去重
    ai-lifter.js         离线启发式 + 在线 LLM(Anthropic) 两条语义提升路径
  verify/
    prolog-engine.js     tau-prolog 封装：consult + query → 变量绑定
    smt-dsl.js           契约表达式 DSL → z3 项 (Pratt parser)
    smt-bridge.js        z3-solver：契约蕴含校验 + RBAC SoD + Dafny 骨架
  integrations/
    fdrs-bridge.js       深事实 → FDRS 概念事实 → 现有 tools/lint/prolog-check.js
  rules/*.pl             structural(声明) + resolved(结构) + governance(治理) + taint(污点)，自动加载
  report/reporter.js     违规分级报告 + 查询结果表格
examples/
  sample-project/ JS  polyglot/ Py+Go  scoped/ 同名  intent/ 意图×副作用  taint/ 注入
  policy/rbac-sod.json  RBAC 职责分离          contracts/*.json  契约样例
test/
  smoke.test.js          JS 核心端到端（9 用例：含同名解析/意图副作用/污点）
  engines.test.js        tree-sitter + z3 + FDRS 桥（5 用例）
```

> 回流 FDRS 的**信号源**桥在仓库侧：`tools/lint/fdrs-deep-signal.js` 把 `violation(Subject,RuleId)` 映射成六支柱信号，`fdrs-synthesize.js --deep` 消费它，让规则自进化以深事实为底座。

## 5. soundness / precision（要诚实）

- **结构事实**对其声明的抽象是 **sound 的过近似**（[抽象解释](./01-math-foundations.md#3)），可能误报。
- **已知精度边界**（与所有轻量分析共享）：
  1. **死代码过报已大幅根治**：`addr_taken` 指向分析（函数名作为值传递→间接可达）+ 对象字面量方法标 `lambda` 把误报 86→1；**linker 作用域解析**进一步消除"跨文件同名合并"——调用经 **import 绑定 / 同文件本地 / 全局唯一** 解析到文件限定节点（`File::Name`），并加 `unresolved_call` 安全网（被动态/歧义调用提及的名字不报死），使死代码**误报趋近零**（实测 `../tools/lint` 死代码=1 且为真阳）。**仍存的边界**：反射/高阶/动态分派指向未解析（完整解法 = Doop 级 points-to，见路线图 Phase 1）；**points-to/作用域解析的 import 绑定目前仅 JS**——非 JS 走"本地 + 全局唯一"较松解析。
  2. **正则兜底**层（tree-sitter 不支持的语言）只给粗粒度事实——深语义靠 AI lifter。
  3. **LLM 事实是启发式**：`ai-lifter.js` 用 `FACT_LINE` 正则把关语法，但语义忠实度需复核（参见 Verus-SpecGym 的"spec faithfulness"）。
  4. **SMT 契约**只在 `contract/3` 用可形式化的算术/布尔 DSL 表达时可判定；自然语言契约的形式化是 autoformalization 难题（路线图 Phase 3）。
- **设计原则**：宁可符号侧保守、神经侧大胆但受检——**绝不让 LLM 的输出绕过求解器直接成为结论**。

## 6. 怎么用

```bash
cd formal-atlas
node src/cli.js verify  examples/sample-project          # 结构+治理校验 (Prolog)
node src/cli.js verify  examples/polyglot                # 多语言 (Python+Go)
node src/cli.js query   examples/sample-project "reaches(handleRequest, dbQuery)."
node src/cli.js extract /path/to/ANY/project --out=facts.pl   # 导出任意项目的事实库
node src/cli.js lift    examples/sample-project          # 需 ANTHROPIC_API_KEY，LLM 语义提升
node src/cli.js smt     policy   examples/policy/rbac-sod.json     # RBAC 职责分离 (z3)
node src/cli.js smt     contract examples/contracts/add-positives.json  # 契约蕴含 (z3)
node src/cli.js fdrs    examples/sample-project          # 深事实 → 现有 FDRS prolog-check.js
node test/smoke.test.js && node test/engines.test.js     # 全部测试
```

> 在本仓库内运行时，`acorn`/`tau-prolog` 从仓库 `node_modules` 解析（零安装）；拷到别处则 `npm install`。
