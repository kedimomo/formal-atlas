# 两块精度引擎大件：完整 IFDS (#6) + 字段敏感 points-to (#7)（spec，2026-06-08）

> 这两块是 `06-frontier-map` 上剩下的**精度引擎**，体量足够各自**独立成子目录**（不是一两刀的小增量）。本档定它们**放哪、怎么实现、怎么集成**。

## 〇、先决：`src/verify/` 已 9 文件 > 8（既有违规），新引擎一律进子目录
`src/verify/` 现 9 个平铺文件，**已超 `code_architecture_guidelines` 的 ≤8/目录**。两块新引擎不该再往里堆。**Step 0（独立一刀）**：按子引擎归组现有文件，修这个既有违规并给新引擎安家：
```
src/verify/smt/      ← smt-bridge.js · smt-dsl.js · refinement-check.js · faithfulness.js   (z3 族)
src/verify/graph/    ← datalog.js · closure-delta.js                                          (Datalog/闭包族)
src/verify/pointsto/ ← points-to.js（→ andersen.js）+ #7 新文件
src/verify/ifds/     ← #6 新文件
src/verify/          ← explain.js · prolog-engine.js（顶层编排，留 ≤8）
```
归组只改 import 路径（机械、各处 parity），**先做它**再上新引擎。

## 一、#7 字段敏感 points-to → `src/verify/pointsto/`
**动机（本会话实测）**：首刀 points-to 在本库 +11 reaches，但 `dead_code`/dispatch 不动——因本库分派走 **`handlers[k]()` dispatch-table**（计算成员 + 对象字面量持函数），首刀的"裸变量持函数"覆盖不到。字段敏感是**实测的最大剩余精度杠杆**。

**怎么实现**：
- `pointsto/andersen.js`：现有 `points-to.js` 迁此（base：`alloc/assign/calleeVar/isFunction/argActual/formalParam`）。
- `pointsto/fields.js`：加 base relation `store(base,field,y)` / `load(x,base,field)` + **堆对象-字段**模型 `heapPts(obj,field,obj')`。不动点两条新规则：
  - `store(b,f,y) ∧ pts(b,o) ∧ pts(y,ov) ⇒ heapPts(o,f,ov)`
  - `load(x,b,f) ∧ pts(b,o) ∧ heapPts(o,f,ov) ⇒ pts(x,ov)`
  - 解 `const h={foo:fn}; h[k]()`：对象字面量把 `fn` store 到字段 → `h[k]` load 出 → 调用即 `resolvedCall`。计算键 `[k]` 字段不敏感地并所有字段（sound 上近似）。
- 抽取（`src/extract/js-ast.js`）：发 `store`（`obj.f = y` / 对象字面量 `{f:y}` / `obj[k]=y`）、`load`（`obj.f` / `obj[k]` 读）。**注意 `src/extract/` 已 8 文件**——若 js-ast.js 触 200 行，把 points-to 抽取拆到 `extract/pointsto-ast.js`，同时 extract/ 也要起子目录。
- 集成：同首刀——`resolvedCall` → 合成 `calls3` → linker QId 化 → `rcall`；behind `--points-to`、parity-safe。
- **刀法**：刀1 字段敏感（解 dispatch-table，量 routes/services FP↓）；刀2（可选）**上下文敏感** k-CFA/object-sensitive（`pointsto/context.js`，事实爆炸——这才是 #5 半朴素引擎的真正主场，用它扛）。

### ✅ 刀1 已落地（2026-06-08，alias-unaware 首刀）
- `points-to.js` 已迁 `src/verify/pointsto/andersen.js`（flat `verify/` 9→8，顺手修了既有 ≤8 违规）。
- 引擎加 `field_store(base,key,val)` + `field_call(site,base,key)` 收集 + **post-fixpoint 解析**：对每条 field_call，在**同名 base** 的 `storesByBase` 里按 key（`*`=计算键并所有字段）取 val，经 `pts(val)` 解到函数 → `resolved(site,fn)`。**alias-unaware on the base**（同名 base 直解，不追 `g=h` 别名）、**value 经 pts 解析**（`{k:fn}` 与 `{k:aliasVar}` 都行）；sound（无伪边）。
- 抽取（`js-ast.js`，单遍、零膨胀）：`const h={k:fn}` 发 `field_store` 并把 `h` 记入 `objLitVars`；**仅对 `objLitVars` 里的 base** 的成员调用 `h.foo()`(key=foo)/`h[k]()`(key=`*`) 发 `field_call`——故非 dispatch-table 的 `db.query()` 不发，事实库不膨胀。js-ast.js 守 200 行。
- 夹具 `examples/points-to-fields/`（计算 `handlers[k]()` 解到 create+delete、非计算 `ops.run()` 解到 runOp）；★7 第 6 测试；默认模式 routes 187/sample 7/taint 1 **位等价**（新事实 inert）。
- **真实库实测（诚实）**：routes/services 有 **45/67 个对象字面量持函数**，但 `field_call` **= 0**——它们是 **Fastify 路由/回调注册对象**（被框架调用、`addr_taken` 已判活），**不是**本地 `h.foo()` dispatch-table。结论：**本库动态分派是框架中介的**（Fastify 路由、传给库的回调），语言级 points-to（含字段敏感）对它增益有限；字段敏感对**确有内部 dispatch-table 的库**才发力。刀2（上下文敏感）同理——除非有内部多态分派，否则本库收益低。**这是"先 measure 再投精度"的又一次诚实落点**。

## 二、#6 完整 exploded-supergraph IFDS → `src/verify/ifds/`
**动机**：现有 ★6 九刀走**函数摘要近似**（sound-leaning、0 误报），但不区分**realizable path**——理论上会有"从调用点 A 进 f、却像从 B 返回"的非真实路径污染。完整 IFDS（Reps–Horwitz–Sagiv POPL'95）给**精确**的过程间可达。

**怎么实现**：
- `ifds/supergraph.js`：建 **exploded supergraph**——每个 CFG 节点 N × 每个数据流 fact d 一个节点 `(N,d)`；intra 边来自 **flow function**；`call→start` 与 `exit→returnSite` 边带 **call/return 括号**（同 callsite 配对）。
- `ifds/tabulation.js`：**tabulation 算法**——worklist 算 `pathEdge`（过程摘要 `summaryEdge`），只沿 **realizable（括号平衡）** 路径传播 → 上下文匹配，消除非真实路径 FP。终止性：fact 域有限、pathEdge 单调。
- **复用现有摘要**：`taint-interproc.js` 的三类摘要（conduit / param-sink / param→return）**不丢**——它们**就是 flow function** 的 per-procedure 积木；IFDS 把它们泛化成精确、可组合、上下文匹配的可达。
- 集成：`ifds/` 产 realizable-path 精度的 `tainted(N)` → 喂**现有** `violation(taint-reaches-sink)` 规则；behind `--ifds`、parity-safe（关时走现有九刀摘要）。
- 规模：fact 爆炸（N×D）→ 用 **#5 半朴素引擎**（已就绪）跑 tabulation 的不动点；增量用 `closure-delta`。

## 三、为什么"独立立项"
| | 体量 | 子目录 | 复用 |
|---|---|---|---|
| #7 字段敏感 | 中（堆模型 + load/store 抽取 + 上下文敏感后续） | `src/verify/pointsto/` | Andersen 首刀、linker、#5 引擎 |
| #6 完整 IFDS | 大（exploded supergraph + tabulation，新求解器） | `src/verify/ifds/` | 九刀摘要做 flow function、#5 引擎、closure-delta |

两者都**新求解器组件 + 多刀**，故各自 spec + 子目录 + 一刀刀实现（夹具 + parity + 诚实边界），与 ★2–★7 同方法论。**先 Step 0 归组 `src/verify/`**，再 #7（杠杆更高、更便宜），再 #6。
