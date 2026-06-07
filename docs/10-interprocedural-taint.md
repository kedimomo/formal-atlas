# ★6（设计 spec，未实现）过程间污点：tainted-summary，把行级启发式升级为 sound 的跨过程流

> 状态：**设计 spec，尚未实现**。遵循 [`06-frontier-map.md` §落地约束](./06-frontier-map.md)——"动手做 ★X 前，单独开 spec，走升级-回滚安全开关"。★1–★4 主线已收口（`07`/`08`/`09`）；本文是 06-frontier-map 第 6 项（IFDS/CFL-可达污点）的可实现规约。
> 数学依据：Reps–Horwitz–Sagiv POPL'95（IFDS = exploded supergraph 上的图可达，多项式）；本档先做 IFDS 的**轻量摘要近似**（function summary），不上完整 exploded graph。

## 一、要解决的问题

当前 `src/extract/taint.js` 是**行级、文件内、函数内**启发式：`taint.clear()` 在每个函数边界清空，污点**不跨调用**。后果是**漏报（false negative）**：

```js
function getName(req) { return req.query.name }          // 抽取器看不到这是"返回污点"
function handler(req, reply) {
  const n = getName(req)                                 // n 实际是不可信输入，但当前不标污点
  reply.type('text/html').send('<b>' + n + '</b>')       // 真 XSS，当前漏报
}
```

★3 解决的是**误报**（92 假 XSS）；★6 解决的是**漏报**（跨过程真流）——两者都是精度，方向互补。

## 二、范围（本档只做第一刀）

**只做 within-file、name-resolved 的 tainted-RETURN 摘要**（最高频、最可控的一类）。**不做**：跨文件、参数→形参的反向传播（taint-INTO-callee）、动态分派/高阶（那是 #7 Doop 级）。后续刀可在同一摘要框架上加。

## 三、关键精度陷阱（必须避免，否则把 ★3 的成果倒回去）

天真规则"return 表达式提到了污点变量 ⇒ 函数返回污点"是**错的**：
```js
function q(req){ return db.query('... ' + req.query.id) }  // 返回的是查询【结果】，不是污点本身
```
`db.query(taintedArg)` 的返回值是行集，不是不可信输入；把它标成 tainted-return 会在调用方制造**新的误报**。

**精确规则（sound-leaning，只在能论证时判 returns-taint）**：函数 F ∈ `returnsTaint` 当且仅当其某条 `return E` 满足——`E` **本身**是
- 一个当前污点变量（`return n`，n 被 SOURCE 链污染），或
- 直接匹配 `SOURCE` 的表达式（`return req.query.x`）。

`return f(...)`（E 是函数调用）、`return E.prop`、`return E1 + E2`（拼接结果）**一律不**判 returns-taint（除非整个 E 去掉外层后仍是裸污点变量）。宁可漏报，不可误报——与 ★3 同一条 sound-leaning 主线。

## 四、设计：两遍 + 升级-回滚安全开关

`extractTaintJs(fileId, code, { interproc = false } = {})`——**默认 off**，行为与今逐字一致（回滚安全）；`interproc:true` 时启用下述两遍。pipeline 侧加 `taint:'interproc'` 开关（仿 `formalize`），CLI/MCP 显式开启。

- **Pass 1（摘要）**：扫全文件，按函数维护 intra-fn 污点（复用现有逻辑），遇 `return E` 按 §三精确规则判定 → 收集 `returnsTaint:Set<fnName>` + 发事实 `taint_returns(fnName)`（可供 Prolog/调试）。需补**函数名抽取**：`function NAME(`、`async function NAME`、`const NAME = (..)=>`、对象/类方法 `NAME(..) {`。
- **Pass 2（发射，在现有 emit 上增量）**：赋值 `const x = NAME(args)` 且 `NAME ∈ returnsTaint` 时，发 `dataflow(taint_returns_node(NAME), x)` 并 `taint.set(x)`——x 由 helper 引入不可信数据。**纯增量**：只新增 dataflow 边，不改既有边；helper 不在 returnsTaint 时行为不变。

新事实：`taint_returns(Fn)`、节点 id 形如 `file:line:retsum_<fn>`。`rules/taint.pl` 无需改（新边走既有 `tainted/2` 闭包）；可选加 `:- dynamic(taint_returns/1)`。

## 五、验证计划（实现时）

- 新夹具 `examples/taint-interproc/`：`getName`(returns-taint) → handler 经 `.innerHTML`/html `send` 汇（真 XSS，应报）；外加一个 `q(){return db.query(tainted)}`（**不应**判 returns-taint，调用方不应新增误报）。
- 测试：interproc on ⇒ getName 链报 1 条；`db.query` 包装**不**误报；interproc off ⇒ 与现状逐字一致（回滚）。
- 回归：`examples/taint` 仍 1 条 `sink_sql`；`sample-project` 仍 7；所有现有测试绿。
- CLI：`verify <path> --interproc`（或 pipeline `taint` 开关）；MCP `taint`/`verify` 加可选 `interproc` 入参。

## 六、为什么先停在 spec

本档是 06-frontier-map "5–8 按需启动" 的第 6 项；★1–★4 主线已交付。按项目"星标实现前先开 spec、走开关"的落地约束，这里给出可直接照做的规约，留待下一实现轮（含夹具与测试）落地。完整 IFDS（exploded supergraph、参数→形参双向、跨文件摘要）是本框架之后的加刀，再按真实规模需要推进。
