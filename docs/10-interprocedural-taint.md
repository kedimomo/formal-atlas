# ★6 过程间污点：tainted-summary，把行级启发式升级为 sound 的跨过程流

> 状态：**第一刀 + 第二刀 + 第三刀已实现（2026-06-07）**——within-file **tainted-RETURN 摘要**（第一刀）、within-file **param-sink / 参数→形参反向**（第二刀，带 content-type 护栏）、**跨文件 param-sink 连接**（第三刀，QId 摘要 + post-link 解析）。完整 IFDS（returns-taint 跨文件、exploded supergraph）仍为后续加刀。
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

实现在 `src/extract/taint-interproc.js`（摘要）+ `taint.js`（发射）内，**always-on**（不走开关）——与 points-to/linker 这两次精度改进同样的取舍：§三 的精确 returns-taint 规则保证它**只新增真阳、不引入误报**，故按"严格更优的精度修复可直接应用"处理（也避开了按内容缓存的抽取层加 flag 的缓存键问题）。实测所有现有夹具行为不变（见 §五）。

- **Pass 1（摘要 `summarizeReturns`）**：扫全文件，按函数维护 intra-fn 污点（镜像主循环的 FN_DEF 边界重置），遇 `return E` 按 §三精确规则判定 → 收集 `returnsTaint` 并发事实 `taint_returns(Fn)`。含 `fnNameOf`（`function f`/`const f=()=>`/方法 `f(){`）+ `calleeOf`（`(await) f(..)`）两个名字抽取辅助。
- **Pass 2（主发射循环，增量）**：赋值 `const x = NAME(args)` 且 `NAME ∈ returnsTaint` 时，发 `source(x)` 并 `taint.set(x)`——x 由 helper 引入不可信数据。**纯增量**：只新增边；helper 不在 returnsTaint 时行为不变。

`rules/taint.pl` 加 `:- dynamic(taint_returns/1)`（仅为查询安全，无新规则——新 source 走既有 `tainted/2` 闭包）。

## 五、验证（已落地）

- 夹具 `examples/taint-interproc/handlers.js`：`getName`(returns 裸污点变量 → 是 conduit) → `show()` 经 `.innerHTML` 汇（真 XSS，报）；`rows()`(`return db.query('select * from t')` 返回**结果**、非污点 → **不是** conduit) → `consume()` 用其返回值进 `.innerHTML`（**不报**，证明无误报）。
- 测试 `test/engines.test.js` ★6：`taint_returns(F)` 仅 `[getName]`（`rows` 不在内）；`violation(taint-reaches-sink)` 恰 1 条（show 的 interproc 真阳，consume 无 FP）。
- 回归（实测绿）：`examples/taint` 仍 1 条 `sink_sql`；`sample-project` 仍 7 条；全套 `npm test` 通过（9 smoke + 20 engines + MCP 16-工具自检）。

## 六、第二刀：参数→形参反向传播（taint-INTO-callee，已落地 2026-06-07）

第一刀解决"callee 返回污点污染 caller"；第二刀解决其镜像——**caller 的污点实参，经形参流到 callee 内部的汇**：

```js
function render(el, html) { el.innerHTML = html }   // 形参 html(idx 1) 到达 xss 汇
function handleHtml(req)  { render(el, req.query.name) } // 真 XSS：污点实参 → render 的 html 汇
```

### 关键精度约束（实现的核心，已遵守）
param-sink 摘要**必须携带内部汇的 content-type 分类**。否则一个 JSON 包装器 `function sendJson(reply,obj){ reply.send(obj) }` 会把"形参 obj 到达 xss 汇"记成裸 param-sink，调用 `sendJson(reply, userObj)` 即被误报——**正是 ★3 已消除的那类假 XSS，会在过程间被重新引入**。故摘要记 `param_sink(Fn, Idx, Kind, Ct)`，并在调用点复用 ★3 的 `html_safe` 抑制（json ⇒ 不报）。

### 实现（`summarizeParamSinks` + 调用点虚拟汇）
- **Pass 1b（摘要 `summarizeParamSinks`，`taint-interproc.js`）**：按函数维护 `形参名→其下标集` 的 param-taint 映射（FN_DEF 边界以 `paramsOf` 重新播种）。赋值按 mention 传播 param-taint（**调用结果不传播**——与第一刀同一条 sound 规则）；遇汇时**只测 `sinkValueExpr` 抽出的"危险值"位置**（`.innerHTML=` 的右值、`.send(/.query(/eval(` 的实参），**排除接收者**（`db`/`res`/`reply`）。命中即发 `param_sink(Fn, Idx, Kind, Ct)`，Ct 为 xss 的 `classifyXssCt` 或非 xss 的 `na`。
- **Pass 2（调用点连接，`taint.js`）**：within-file 调用 `helper(.., arg, ..)` 且 `helper` 有 `param_sink(helper, Idx, Kind, Ct)`、第 Idx 实参为污点（裸污点变量 / 内联 SOURCE / 第一刀的 tainted-RETURN 调用）时，在调用点发**虚拟汇** `sink(Site,Kind)`+`sink_ct(Site,Ct)`（xss）+`dataflow(argNode,Site)`。**零新规则**——既有 `violation`/`html_safe`/`suppressed_xss`/`sanitized_into` 原样裁决，故 `Ct=json` 的包装器在过程间被原样抑制。

为守 ≤200 行架构红线，原 `taint.js` 拆为三：`taint-patterns.js`（词法原子 + parse 助手）、`taint-interproc.js`（两遍摘要）、`taint.js`（发射管线 + 调用点连接）。

### 验证（已落地）
- 夹具 `examples/taint-paramsink/handlers.js`：`render`(html 包装器，Ct=html)→真阳；`sendJson`(JSON 包装器，Ct=json)→**抑制**（`suppressed_xss`，非漏报）；`runSql`(sql 包装器)→真阳；三个包装器的**接收者形参**（idx 0：el/reply/db）均**不**入 param_sink。
- 测试 `test/engines.test.js` ★6 slice-2：`param_sink/4` 恰 `render/1/xss/html`、`runSql/1/sql/na`、`sendJson/1/xss/json`；`violation` 恰 2 条（render+runSql 真阳，sendJson 不在内）；`suppressed_xss` 含 `psink_sendJson`。
- **真实库实测**（`../src/server/routes`）：slice 2 在路由上发现 **4 处过程间污点实参流入 JSON 包装器**，**全部被 content-type 护栏正确抑制**（0 误报）；唯一存活的 taint 违规仍是既有的**直接** `sink_xss`（非 psink），证明第二刀在工业代码上**只在能论证时报、不倒回 ★3**。
- 回归（实测绿）：`examples/taint` 仍 1、`sample-project` 仍 7、`repair` 仍 1、`taint-interproc` 仍 1；全套 `npm test` 通过（9 smoke + **21** engines + MCP 16-工具自检）。

## 七、第三刀：跨文件 param-sink 连接（已落地 2026-06-07）

第二刀的 param-sink 连接在抽取器内、按 bare-name 文件内完成。第三刀把它跨到文件边界——sink 包装器定义在 A 文件，喂污点的调用方在 B 文件：

```js
// wrappers.js
export function renderHtml(el, html) { el.innerHTML = html }   // param_sink('wrappers.js::renderHtml', 1, xss, html)
// handlers.js
import { renderHtml } from './wrappers.js'
function showProfile(req) { renderHtml(el, req.query.name) }   // 真 XSS：跨文件连接
```

### 实现（解析在 link 之后，发射两个可解析事实）
逐文件抽取器看不到别处的摘要，故**不**急于连接，改发两个可解析事实：
- `param_sink('File::Fn', Idx, Kind, Ct)`——摘要**改 file-qualified QId 键**（抽取器知道 fileId + fnName），与 linker 的 `decl/4` 同构（`File::Name`）。within-file 连接仍用内存 Map，**行为不变**，只改发射的事实键。
- `taint_arg(File, Callee, Idx, ArgNode)`——调用点传入的**已污点变量**（复用其既有节点，**不**造新 source，零噪音）。

`src/link/taint-link.js` 的 `linkTaint`（在 `link()` 之后跑，故 `decl/4` 已就绪）把每个 `taint_arg` 的 callee 解析到 QId，**复用 linker 同序**：(1) ES `import_binding/4`（解析模块说明符到项目文件——含 `import {x as y}` 别名）、(2) 同文件 decl、(3) 项目内全局唯一 decl。**sound-leaning**：歧义名（>1 家且无 import）留作漏报，**绝不**跨文件误报。cross-file 命中 `param_sink(QId,Idx,Kind,Ct)` 即发与 within-file 同形的**虚拟汇**（`sink`+`sink_ct`+`dataflow`）。same-file 跳过（抽取器已做）。故既有 `violation`/`html_safe` 原样裁决，**Ct=json 包装器跨文件仍被抑制**。

### 验证（已落地）
- 夹具 `examples/taint-xfile/`：`wrappers.js` 定义 `renderHtml`(html)/`replyJson`(json)，`handlers.js` 跨文件调用——含 `import { renderHtml as paint }` **别名调用**。`renderHtml`(直接 import) 与 `paint`(别名) 跨文件真阳 2 条（`xsink_renderHtml`/`xsink_paint`，后者经 `import_binding` 解析）；`replyJson` 跨文件被 content-type 护栏**抑制**（`suppressed_xss` 含 `xsink_replyJson`）。
- 测试 `test/engines.test.js` ★6 slice-3：param_sink 为 `wrappers.js::renderHtml/...`、`wrappers.js::replyJson/...`；`violation` 恰 2（renderHtml + 别名 paint），suppressed 含 replyJson。
- **真实库实测**（`../src/server/routes`）：cross-file 在路由上**新增 0 误报**——唯一存活的 taint 违规仍是既有的直接 `sink_xss`（非 `xsink_`）。
- 回归（实测绿）：sample-project 7、taint 1、repair 1、taint-interproc 1、taint-paramsink 2 全不变；`npm test` 通过（9 smoke + **22** engines + MCP 16-工具自检）。

## 八、后续加刀（returns-taint 跨文件 + exploded supergraph）

within-file 两刀 + cross-file param-sink（含 import 别名解析）已落地。完整 IFDS 仍待：

- **returns-taint 跨文件**（比 param-sink 跨文件更难）：第一刀的效果是**污染调用方的局部变量**，再反哺调用方文件内的 intra-proc 流——而那流在逐文件 pass 内算完，故跨文件 returns-taint 需要跨文件**不动点迭代**（caller 文件需先知道 callee 返回污点），是更完整的 IFDS 一步。
- 最终 **exploded supergraph 上的精确 CFL-可达**（Reps–Horwitz–Sagiv 全量 IFDS）。

按真实规模需要再推进；本框架（两遍摘要 + QId param_sink + taint_arg + 既有 `tainted/2` 闭包 + 调用点/跨文件虚拟汇）可增量承载。
