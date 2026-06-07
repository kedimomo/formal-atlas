# ★6 过程间污点：tainted-summary，把行级启发式升级为 sound 的跨过程流

> 状态：**第一刀 + 第二刀 + 第三刀 + 第四刀 + 第五刀已实现（2026-06-07）**——within-file **tainted-RETURN 摘要**（一）、within-file **param-sink**（二，带 content-type 护栏）、**跨文件 param-sink**（三，QId 摘要 + post-link 解析）、**跨文件 returns-taint**（四，QId conduit 摘要 + ret_call + post-link 注入 source）、**跨文件 2-hop（returns→param-sink）**（五，两个跨文件 join 组合，护栏跨跳成立）。完整 IFDS（传递 conduit 不动点、exploded supergraph 全量 CFL-可达）仍为后续加刀。
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

- **Pass 1（摘要 `summarizeReturns`）**：扫全文件，按函数维护 intra-fn 污点（镜像主循环的 FN_DEF 边界重置），遇 `return E` 按 §三精确规则判定 → 收集 `returnsTaint` 并发事实 `taint_returns(Fn)`。含 `fnNameOf`（`function f`/`const f=()=>`/方法 `f(){`）+ `calleeOf`（`(await) f(..)`）两个名字抽取辅助。`return E` 先用 `noStr` 定位并剥离**行尾 `//` 注释**（避免误伤字符串内的 `//`），故 `return n // the user` 这类带注释的返回仍能判出裸污点变量——真实代码必备的健壮性（第四刀引入）。
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

## 八、第四刀：跨文件 returns-taint 连接（已落地 2026-06-07）

第一刀的 returns-taint 在文件内：`const x = conduit(req)` 当 `conduit ∈ returnsTaint`（同文件）即发 `source(x)`。第四刀把它跨到文件边界——conduit 定义在 A 文件，消费其返回值的调用方在 B 文件：

```js
// source.js
export function getName(req) { const n = req.query.name; return n }   // taint_returns_q('source.js::getName')
// consumer.js
import { getName } from './source.js'
export function show(req) {
  const name = getName(req)                          // 跨文件 conduit → name 污点
  document.getElementById('p').innerHTML = name      // 真 XSS：跨文件 returns-taint
}
```

### 为什么比第三刀（param-sink 跨文件）难
第三刀的效果是**终结的**（调用点发虚拟汇，直接出违规）；第四刀的效果是**污染调用方的局部变量 `name`**，`name` 还要继续沿 B 文件**文件内**流到汇——而那条文件内流在逐文件 pass 内就算完了，等 `linkTaint`（post-link）跑时已无法重跑 B 的行级传播。核心难点就在这条"跨文件 source 注入后，文件内下游边必须已经铺好"。

### 实现（独立 retTaint 通道 + post-link 注入 source）
- **抽取器（`taint.js`）发两件事 + 铺下游边**：
  - QId 键 conduit 摘要 `taint_returns_q('File::Fn')`（与第三刀 `param_sink` 同构；bare `taint_returns(Fn)` 仍保留作可见性）。
  - `ret_call(File, Callee, Xnode)`——`const x = callee(..)` 且 `callee` **非本文件定义**（`localFnNames` gate，排除文件内非 conduit 调用，控制噪音）、非第一刀已处理的 within-file conduit、无污点实参。
  - **独立 `retTaint` map**（与主 `taint` map 分离 → **现有行为 bit-identical**，无 masking）：把 `x` provisional 跟踪，使其在汇行被提及时发 `dataflow(Xnode, Sink)` 边。**这条边 inert**——`tainted/2` 闭包要求链根有 `source`，而 source 此刻尚未发出。
- **post-link 连接（`taint-link.js`）**：收集 `taint_returns_q`→conduit QId 集、`ret_call`→列表；**复用第三刀同一个 `resolve()`**（import_binding 别名 → 同文件 → 全局唯一）把 `ret_call` 的 callee 解析到 QId；当 QId 是**别的文件**的 conduit 时发 `source(Xnode)`。此刻 inert 的下游边被激活 → 既有 `tainted/2` 闭包把污点送达汇 → 出违规。same-file 跳过（第一刀已发 source）。**零新规则**——join 只发 `source/1`。

soundness：`source(Xnode)` 只在 callee 跨文件解析到 conduit 时发；非 conduit（如 `rows()` 返回 db 结果）的 `ret_call` 永不被激活 → 调用方变量保持干净，**无误报**。provisional 边 inert，故对未命中的调用零影响。

### 验证（已落地）
- 夹具 `examples/taint-retxfile/`：`source.js` 定义 `getName`(返回 `req.query.name` 裸污点 → conduit)/`rows`(`return db.query(...)` 返回结果 → **非** conduit)；`consumer.js` 跨文件调用——含 `import { getName as grab }` **别名**。`show`(直接 import)+`showAlias`(别名 `grab`) 跨文件真阳 2 条（`consumer.js:13`/`:27`，后者经 `import_binding` 解析 conduit）；`safe`(调 `rows()` 非 conduit)→**不报**（证明无误报）。`explain` 证明树正确把 `consumer.js:12:name` 标为不可信源。
- 测试 `test/engines.test.js` ★6 slice-4：`taint_returns_q(Q)` 恰 `[source.js::getName]`；`violation` 恰 2（show+showAlias），`consumer.js:20`(safe) 不在内。
- **真实库实测**（`../src/server/routes`）：cross-file returns-taint 在路由上**新增 0 误报**——唯一存活的 taint 违规仍是既有的直接 `sink_xss`；事实数 +~4%（`ret_call` + inert retTaint 边）。`../src/auth` 亦 0 taint 违规。
- 回归（实测绿）：sample-project 7、taint 1、repair 1、taint-interproc 1、taint-paramsink 2、taint-xfile 2 全不变；`npm test` 通过（9 smoke + **23** engines + MCP 16-工具自检）。

## 九、第五刀：跨文件 2-hop（returns-taint → param-sink，已落地 2026-06-07）

第三刀（跨文件 param-sink）的污点实参须是调用方**真实污点变量**；第四刀的 conduit 结果落在**独立 `retTaint` map**里，故第三刀的 `taint_arg` 发射看不见它——一条很常见的链（getter 取数据、再交给 renderer）跨两个文件时被漏掉：

```js
// source.js  : export function getName(req){ const n=req.query.name; return n }  // conduit
// wrappers.js: export function render(el, html){ el.innerHTML = html }            // param_sink(.,1,xss,html)
// consumer.js:
import { getName } from './source.js'; import { render } from './wrappers.js'
function show(req){ const name = getName(req); render(el, name) }  // 2-hop 真 XSS
```

### 实现（一处发射改动，让两个跨文件 join 组合）
`taint.js` 调用点扫描的 `taint_arg` 发射**扩到 `retTaint` 变量**：实参若是 `retTaint` 里的 conduit 结果（而非主 `taint` 变量），同样发 `taint_arg(File,Callee,Idx,Xnode)`。于是：
- 第三刀 join 把 `render` 跨文件解析到 `param_sink('wrappers.js::render',1,xss,html)` → 在 `Xnode`（=`name`）处发**虚拟汇** + `dataflow(name_node, 虚拟汇)`。
- 第四刀 join 把 `getName` 跨文件解析到 conduit → 发 `source(name_node)`。
- 两条 join 的产物在同一 `out` 事实集里共存（发射顺序无关，`tainted/2` 是最小不动点）→ `source(name_node)` 经虚拟汇出违规。

**content-type 护栏跨两跳仍成立**：若包装器是 JSON（`replyJson` → Ct=json），虚拟汇带 `sink_ct=json` → `html_safe` → 抑制。soundness 不变：`retTaint` 变量的 source 仍只在第四刀跨文件命中 conduit 时发，未命中则虚拟汇 inert（`taint_arg` 也声明 `:- dynamic` 以保空查询安全）。

### 验证（已落地）
- 夹具 `examples/taint-2hop/`（三文件）：`source.js::getName`(conduit) → `consumer.js` 经 `render`(html 包装器)/`replyJson`(json 包装器) 跨文件。`show` 2-hop 真阳 1 条（`xsink_render_1`）；`send` 2-hop 经 json 包装器→**抑制**（`suppressed_xss` 含 `xsink_replyJson_1`，跨两跳护栏不破）。`explain` 证明树正确。
- 测试 `test/engines.test.js` ★6 slice-5：`violation` 恰 1（render），suppressed 含 replyJson。
- **真实库实测**（`../src/server/routes`）：**新增 0 误报**（仍 1 条直接 `sink_xss`，87 JSON 抑制不变），事实数 +~0.7%。
- 回归（实测绿）：sample-project 7、taint 1、taint-interproc 1、taint-paramsink 2、taint-xfile 2、taint-retxfile 2 全不变；`npm test` 通过（9 smoke + **24** engines + MCP 16-工具自检）。

## 十、后续加刀（传递 conduit + exploded supergraph 全量 IFDS）

within-file 两刀 + cross-file param-sink + cross-file returns-taint + cross-file 2-hop（均含 import 别名解析、content-type 护栏跨跳）已落地。完整 IFDS 仍待：

- **传递 conduit（A→B→C 跨文件不动点）**：当前 `summarizeReturns` 只在文件内判 conduit；若 `B` 的 conduit 性依赖它 `return C(req)` 而 `C` 是另一文件的 conduit，则需把第四刀 `ret_call` 解析出的 source **喂回 conduit 摘要**并迭代到不动点（A 调 B、B 调 C 的传递污点）。本框架（QId 摘要 + post-link 解析）可增量承载，但需要跨文件迭代而非单趟解析。
- 最终 **exploded supergraph 上的精确 CFL-可达**（Reps–Horwitz–Sagiv 全量 IFDS）。

按真实规模需要再推进；本框架（两遍摘要 + QId `param_sink`/`taint_returns_q` + `taint_arg`/`ret_call` + 既有 `tainted/2` 闭包 + 调用点/跨文件虚拟汇与 source 注入）可增量承载。
