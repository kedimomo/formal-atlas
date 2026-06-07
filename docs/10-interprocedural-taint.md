# ★6 过程间污点：tainted-summary，把行级启发式升级为 sound 的跨过程流

> 状态：**第一刀已实现（2026-06-07）**——within-file、name-resolved 的 tainted-RETURN 摘要。完整 IFDS（exploded supergraph、参数→形参双向、跨文件摘要）仍为后续加刀。
> 遵循 [`06-frontier-map.md` §落地约束](./06-frontier-map.md)。数学依据：Reps–Horwitz–Sagiv POPL'95（IFDS = exploded supergraph 上的图可达，多项式）；本档先做 IFDS 的**轻量摘要近似**（function summary）。

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

## 四、实现：两遍，作为 sound-leaning 精度改进（已落地）

实现在 `src/extract/taint.js` 内，**always-on**（不走开关）——与 points-to/linker 这两次精度改进同样的取舍：§三 的精确 returns-taint 规则保证它**只新增真阳、不引入误报**，故按"严格更优的精度修复可直接应用"处理（也避开了按内容缓存的抽取层加 flag 的缓存键问题）。实测所有现有夹具行为不变（见 §五）。

- **Pass 1（摘要 `summarizeReturns`）**：扫全文件，按函数维护 intra-fn 污点（镜像主循环的 FN_DEF 边界重置），遇 `return E` 按 §三精确规则判定 → 收集 `returnsTaint` 并发事实 `taint_returns(Fn)`。含 `fnNameOf`（`function f`/`const f=()=>`/方法 `f(){`）+ `calleeOf`（`(await) f(..)`）两个名字抽取辅助。
- **Pass 2（主发射循环，增量）**：赋值 `const x = NAME(args)` 且 `NAME ∈ returnsTaint` 时，发 `source(x)` 并 `taint.set(x)`——x 由 helper 引入不可信数据。**纯增量**：只新增边；helper 不在 returnsTaint 时行为不变。

`rules/taint.pl` 加 `:- dynamic(taint_returns/1)`（仅为查询安全，无新规则——新 source 走既有 `tainted/2` 闭包）。

## 五、验证（已落地）

- 夹具 `examples/taint-interproc/handlers.js`：`getName`(returns 裸污点变量 → 是 conduit) → `show()` 经 `.innerHTML` 汇（真 XSS，报）；`rows()`(`return db.query('select * from t')` 返回**结果**、非污点 → **不是** conduit) → `consume()` 用其返回值进 `.innerHTML`（**不报**，证明无误报）。
- 测试 `test/engines.test.js` ★6：`taint_returns(F)` 仅 `[getName]`（`rows` 不在内）；`violation(taint-reaches-sink)` 恰 1 条（show 的 interproc 真阳，consume 无 FP）。
- 回归（实测绿）：`examples/taint` 仍 1 条 `sink_sql`；`sample-project` 仍 7 条；全套 `npm test` 通过（9 smoke + 20 engines + MCP 16-工具自检）。

## 六、后续加刀

第一刀（tainted-RETURN 摘要）已落地。完整 IFDS 仍待：

- **参数→形参反向传播**（taint-INTO-callee：`sink(x)` 在 callee、`x` 来自 caller 的污点实参）。**关键精度约束（实现前必读）**：param-sink 摘要**必须携带内部汇的 content-type 分类**。否则一个 JSON 包装器 `function send(res,obj){ res.send(obj) }` 会把"形参 obj 到达 xss 汇"记成 param-sink，调用 `send(reply, userObj)` 即被误报——**正是 ★3 已消除的那类假 XSS，会在过程间被重新引入**。故摘要需记 `param_sink(Fn, Idx, Kind, Ct)`，并在调用点复用 ★3 的 `html_safe` 抑制（json ⇒ 不报）。这条约束是把第二刀做对（而非倒回 ★3）的核心，单独做需配套夹具（JSON 包装器**不**误报 + 真 HTML 包装器报）。
- **跨文件摘要**（用 linker 的 `rcall/2` 解析跨文件调用 + 持久化摘要）。
- 最终 **exploded supergraph 上的精确 CFL-可达**。

按真实规模需要再推进；本框架（摘要 + 既有 `tainted/2` 闭包）可增量承载。
