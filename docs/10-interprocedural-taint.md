# ★6 过程间污点：tainted-summary，把行级启发式升级为 sound 的跨过程流

> 状态：**七刀已实现（2026-06-07）**——within-file **tainted-RETURN 摘要**（一）、within-file **param-sink**（二，content-type 护栏）、**跨文件 param-sink**（三）、**跨文件 returns-taint**（四，ret_call + post-link 注入 source）、**跨文件 2-hop（returns→param-sink）**（五）、**传递 conduit 跨文件不动点**（六，`ret_returns_call` + conduit 集闭包）、**传递 conduit 同文件不动点**（七，`summarizeReturns` 收尾闭包）。完整 IFDS（return-of-arg、exploded supergraph 全量 CFL-可达）仍为后续加刀。
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

## 十、第六刀：传递 conduit（A→B→C 跨文件不动点，已落地 2026-06-07）

第四刀的 conduit 判定在文件内单趟：`summarizeReturns` 只把"`return` 裸污点变量 / 直接 SOURCE"判为 conduit，刻意拒绝 `return f(..)`（返回的是 f 的结果，§三）。但当 `f` **自身是 conduit** 时这条拒绝就漏了——委托/转发函数（getter 的薄封装）跨文件时传递性断链：

```js
// source.js  : export function getName(req){ const n=req.query.name; return n }  // 基础 conduit
// delegate.js: import {getName} from './source.js'
//              export function fetchName(req){ return getName(req) }              // 传递 conduit（仅因 getName 是）
// consumer.js: import {fetchName} from './delegate.js'
//              function show(req){ const name=fetchName(req); el.innerHTML=name }  // A→B→C 真 XSS
```

### 实现（摘要发传递候选 + post-link 不动点闭包）
- **`summarizeReturns` 改返回 `{ conduits, returnCalls }`**：除直接 conduit 外，遇 `return callee(..)`（`calleeOf` 只认**裸** callee——`db.query(..)` 这类 dotted 不算,天然 sound）收集 `[fn, callee]`。`taint.js` 对每条发 `ret_returns_call('File::Fn', Callee)`。
- **`taint-link.js` 在 return-join 前跑跨文件不动点**：从直接 conduit 集（`taint_returns_q`）出发,反复对每条 `ret_returns_call(QFn, Callee)` 用**同一个 `resolve()`**（import 别名→同文件→全局唯一）把 Callee 解析到 QId,命中 conduit 集即把 QFn 并入,迭代到不动点（**单调、以 `|returnCalls|` 为界 → 必然终止**；自递归/环若无基础 conduit 则不传播,sound）。新并入的传递 conduit 也发 `taint_returns_q(QFn)` 以便 query/explain 看见。随后第四刀 return-join 用**闭包后的** conduit 集 → A→B→C 链上 consumer 的局部变量被注入 source。

soundness 不变：传递性只在 return 的裸 callee **解析到已证 conduit** 时成立;`return db.query(x)`（dotted,非裸）/`return f(x)`（f 非 conduit）一律不传播。

### 验证（已落地）
- 夹具 `examples/taint-transitive/`（三文件 A→B→C）：`source.js::getName`(基础)→`delegate.js::fetchName`(传递,`return getName(req)`)→`consumer.js::show`。`taint_returns_q` 经不动点含 `getName`+`fetchName` 两条;`violation` 恰 1（`consumer.js:10`,两跳之外的汇）。
- 测试 `test/engines.test.js` ★6 slice-6：断言 conduit 集含传递 `fetchName`、违规恰 1。
- **真实库实测**（`../src/server/routes`）：**新增 0 误报**（仍 1 条直接 `sink_xss`），事实数仅 +~35。
- 回归（实测绿）：sample-project 7、taint 1、taint-interproc 1、taint-paramsink 2、taint-xfile 2、taint-retxfile 2、taint-2hop 1 全不变；`npm test` 通过（9 smoke + **25** engines + MCP 16-工具自检）。

## 十一、第七刀：文件内传递 conduit（同文件不动点，已落地 2026-06-07）

第六刀的不动点在 `taint-link.js`（post-link），只闭包**跨文件** conduit 集——consumer 与传递 conduit **同文件**时,第四刀 return-join 跳过 same-file,故同文件委托链（`fetchName` 与 `show` 同文件）漏报。第七刀在 **`summarizeReturns` 收尾处加一个同文件不动点**补齐:收集完 direct conduits + `returnCalls` 后,反复对每条 `[fn, callee]`——若 `callee` 是**同文件 conduit**（按名直接命中 `conduits`）则把 `fn` 也并入,迭代到不变（单调、以 `|returnCalls|` 为界 → 终止）。

于是同文件 `fetchName` 升格为 **direct conduit**（进 `conduits` ⇒ 既发 `taint_returns(Fn)`/`taint_returns_q`、`returnsTaint.has(fetchName)` 也为真）→ 同文件 consumer `const name = fetchName(req)` 经第一刀直接 source。与第六刀**互补**:同文件 callee 在此解析,跨文件 callee 仍留给 `taint-link.js` 的不动点（同文件不动点解不开的就留在 `returnCalls` 里）。slice-1 锚点不受影响（`taint-interproc` 的 `rows()` 是 dotted、`getName` 返回裸变量,无 `return 裸conduit(..)` → `returnCalls` 空,不动点空转）。

### 验证（已落地）
- 夹具 `examples/taint-localtransitive/handlers.js`（单文件）：`getName`(基础)→`fetchName`(`return getName(req)` 同文件传递)→`show` 同文件消费。`taint_returns` 经同文件不动点含 `getName`+`fetchName`;`violation` 恰 1（`handlers.js:18`）。
- 测试 `test/engines.test.js` ★6 slice-7：断言 `taint_returns` 含 `fetchName`、违规恰 1。
- 回归（实测绿）：slice-1 锚点 `taint-interproc` 的 `taint_returns` 仍仅 `[getName]`;sample-project 7、其余 taint 夹具与 routes 全不变（0 新误报）；`npm test` 通过（9 smoke + **26** engines + MCP 16-工具自检）。

## 十二、后续加刀（exploded supergraph 全量 IFDS）

within-file 两刀 + cross-file param-sink + cross-file returns-taint + cross-file 2-hop + 传递 conduit 不动点（跨文件 + 同文件，均含 import 别名解析、content-type 护栏跨跳）+ **param→return 透传摘要（第八刀，见 §十三）+ 跨文件透传函数（第九刀，见 §十四）** 已落地。完整 IFDS 仍待：

- ✅ **返回-of-tainted-arg（第八刀，已落地 2026-06-08，见 §十三）**：`function id(x){return x}` 这类**透传形参**的返回（`return x` 当 x 是形参）——区别于"内部制造污点"的 conduit,是 param→return 摘要,已与 param-sink 摘要合流。✅ **透传函数本身跨文件（id 定义在另一文件经 import）亦已落地（第九刀，见 §十四）**。
- 最终 **exploded supergraph 上的精确 CFL-可达**（Reps–Horwitz–Sagiv 全量 IFDS），把 conduit/param-sink/return 三类摘要统一成 supergraph 上的 realizable-path 可达。

按真实规模需要再推进；本框架（三遍摘要 + QId `param_sink`/`taint_returns_q`/`param_return` + `taint_arg`/`ret_call`/`ret_returns_call`/`pass_arg` + 既有 `tainted/2` 闭包 + 调用点/跨文件虚拟汇、source 注入与传递不动点）可增量承载。

## 十三、第八刀：return-of-tainted-arg（param→return 透传摘要，与 param-sink 合流，已落地 2026-06-08）

前七刀的摘要有两类：**conduit**（函数**内部制造**污点 → 返回不可信数据）和 **param-sink**（形参**流向**内部汇）。第八刀补上第三类——**透传（passthrough）**：函数把某个**形参原样返回**（`function id(x){ return x }`），既不制造也不消费,而是**承载**——`id(tainted)` 的结果继承实参的污点。这是 IFDS exploded-supergraph 上 param→return 那条摘要边。

```js
// app.js  : function id(x){ return x }                         // param_return(id,0) 透传
//           function swallow(x){ return 'constant' }           // 非透传（返回常量）— 对照
//           const name = req.query.name
//           render(el, id(name))     // 跨文件 param-sink（lib.js）经本地透传 → 真 XSS
//           show(el, id(name))       // 同文件 param-sink 经透传 → 真 XSS
//           replyJson(reply, id(data))  // 透传进 JSON 汇 → 被 ★3 content-type 护栏跨透传抑制
//           render(el, swallow(name))   // swallow 丢弃形参 → 0 误报
// lib.js  : export function render(el, html){ el.innerHTML = html }   // param_sink(render,1,xss,html)
//           export function replyJson(reply, obj){ reply.send(obj) }  // param_sink(replyJson,1,xss,json)
```

### 实现（第三类摘要 + 复用既有 join，零新规则）
- **`summarizeParamReturns(code)`（taint-interproc.js）**：第三遍摘要,与 param-sink 同构（FN_DEF 处从形参重播 `pt: var→Set(idx)`）,但盯 `return`：返回表达式**经纯别名（无调用/汇/sanitizer）** mention 某形参派生变量 → 记 `param_return('File::Fn', Idx)`。**sound-leaning**：`return f(x)` 返回 f 的**结果**而非 x（`hasCall(e)` gate 排除）→ 绝不把"洗白器"误标为透传。抽离了共享的 `returnExpr(line)`（剥行尾注释,conduit 与透传两遍同款,消冗余）与 `hasCall(expr)` 到 taint-patterns.js。
- **折进既有 join，不新增规则/链接代码**：
  - **同文件 param-sink**：`argSource` 改为**递归/透传感知**——实参是本地透传调用 `id(inner)` 时,递归取其返回形参位 inner 的污点节点 → 复用既有虚拟汇（`show(el, id(name))` 真阳）。嵌套天然组合。
  - **跨文件 param-sink**：新 `passthroughVarNode` 把 `id(taintedVar)`（本地透传 + 裸污点实参）解析到该变量的**已有**污点节点,在调用点发 `taint_arg(File, Callee, Idx, innerNode)` → `taint-link.js` 第三刀的 join 原样把外层 callee 解析到另一文件的 `param_sink` → 虚拟汇从 innerNode 接出（`render(el, id(name))` 真阳）。
  - **content-type 护栏跨透传成立**：虚拟汇的 `Ct` 取自外层 param-sink,故 `replyJson(reply, id(data))`（Ct=json）照 ★3 抑制（`replyJson` 被 `suppressed_xss` 记录,非静默丢弃）。
- **`param_return/2` 声明 `:- dynamic`**：本刀作为**事实惰性**（无规则消费,经 `taint_arg`/虚拟汇间接生效）——供 query/explain 与未来"透传函数本身跨文件"的加刀复用。透传函数当前限**本地**（callee 在另一文件的透传留待下一刀,需 `taint-link` 解析 `param_return`——自然的第九刀）。

### 验证（已落地）
- 夹具 `examples/taint-passthrough/`（`app.js` 本地透传 `id`/对照 `swallow` + 本地 param-sink `show`；`lib.js` 跨文件 param-sink `render`/`replyJson`）：`param_return` 恰 `app.js::id/0`；`violation` 恰 **2**（跨文件 `xsink_render` + 同文件 `psink_show`），`swallow` 无误报；`suppressed_xss` 含 `xsink_replyJson`（护栏跨透传成立）。
- 测试 `test/engines.test.js` ★6 slice-8：断言透传集恰 `id`、违规恰 2（跨 + 同文件）、`swallow` 不出现、JSON 透传被抑制。
- **真实库实测**（`../src/server/routes`、`../src/auth`）：发现 16 条真实透传（`normalizeBool`/`parseJson`/…），但**违规计数逐位不变**（routes 187/41/23、auth 27/9/3，stash 前后一致）→ **新增 0 误报**（紧合取:透传 ∧ param-sink ∧ 污点实参,三者在现网代码未同时命中改变判定）。
- 回归（实测绿）：sample-project 7、taint 1（sink_sql）、前七刀全部夹具不变；`npm test` 通过（9 smoke + **33** engines + MCP 16-工具自检）。upgrade/rollback-safe（全加性,旧路径未触）。

## 十四、第九刀：跨文件透传函数（passthrough fn 在另一文件，已落地 2026-06-08）

第八刀的透传**函数本身**限**本地**——`argSource`/`passthroughVarNode` 只认 `paramReturns`（本文件 `summarizeParamReturns` 的产物）里的 callee。当 `id` 定义在另一文件经 `import` 引入时,`render(el, id(name))` 在抽取期看不到 `id` 是透传 → 漏报。第九刀补齐:把"透传判定"也推到 **post-link** 解析,与 param-sink 的跨文件 join 同机。

```js
// util.js: export function id(x){ return x }                    // param_return('util.js::id',0)
// lib.js : export function render(el, html){ el.innerHTML=html } // param_sink('lib.js::render',1,xss,html)
// app.js : import {id} from './util.js'; import {render} from './lib.js'
//          const name = req.query.name
//          render(el, id(name))   // 跨文件透传 id → 跨文件 param-sink render = 真 XSS
//          show(el, id(name))     // 跨文件透传 → 同文件 param-sink show（合成 taint_arg 路径）= 真 XSS
```

### 实现（pass_arg 候选 + post-link 双解析，零新规则）
- **抽取（`taint-callsite.js` 新 `crossFilePassArgs`）**：外层实参是**非本地** call `pc(innerArgs)`（`!localFns.has(pc)`）且 inner 有裸污点变量时,对每个污点 inner 位发 `pass_arg(File, Outer, OIdx, PC, IIdx, Node)`——只是**候选**,不臆断 pc 是透传。本地透传仍由第八刀的 `passthroughVarNode` 即时处理（互斥:`else` 分支才落到 `crossFilePassArgs`）。`taint.js` 的三个调用点 arg-resolution helper（`argSource`/`passthroughVarNode`/`crossFilePassArgs`）抽到 `taint-callsite.js`,守住 ≤200 行（taint.js 140 行）。
- **链接（`taint-link.js`）**：收 `param_return` 进 `paramReturnByQid`（qid→Set(idx)）。对每条 `pass_arg`:用**同一个 `resolve()`**（import 别名→同文件→全局唯一）把 `pc` 解析到 `pq`——`pq` 在 `paramReturnByQid` 且含 `IIdx`（确是个跨文件透传）→ 合成一条 `taint_arg(File, Outer, OIdx, Node)`,经**同一 `emitSink()`** 接外层 `Outer` 的 param-sink。
- **`emitSink(file, callee, idx, node, skipSameFile)`** 统一真实/合成两路:真实 `taint_arg`（刀3/5）保留 `skipSameFile=true`（同文件外层抽取期已处理,行为 bit-identical）;合成路 `skipSameFile=false`——**透传在别的文件,抽取期不可能处理过**,故同文件外层 param-sink（`show`）也要发（合成路独占,与真实路 arg 形状不相交,无重复）。content-type 护栏因复用 `emitSink` 自动成立（JSON 包装器照抑制）。
- **可组合**:`Node` 可以是被 source 的 conduit 结果（刀4）——跨文件 conduit→跨文件透传→param-sink 三跳自然串起。`pass_arg/6` 声明 `:- dynamic`（惰性事实,仅 `taint-link` 消费）。

### 验证（已落地）
- 夹具 `examples/taint-passthrough-xfile/`（三文件:`util.js` 透传 `id`、`lib.js` 跨文件 param-sink `render`/`replyJson`、`app.js` 消费）：`param_return` 恰 `util.js::id/0`；`violation` 恰 **2**（跨文件→跨文件 `xsink_render` + 跨文件→同文件 `xsink_show`）；`suppressed_xss` 含 `xsink_replyJson`（护栏跨文件 + 跨透传成立）。
- 测试 `test/engines.test.js` ★6 slice-9：断言透传集恰 `util.js::id`、违规恰 2（两种外层）、JSON 跨文件透传被抑制。
- **真实库实测**（`../src/server/routes`、`../src/auth`）：**违规计数逐位不变**（routes 187/41/23、auth 27/9/3，stash 前后一致）→ **新增 0 误报**。
- 回归（实测绿）：sample-project 7、taint 1（sink_sql）、第八刀夹具仍 2、前七刀全部不变；`npm test` 通过（9 smoke + **34** engines + MCP 16-工具自检）。`src/extract/` 现 8 文件（≤8 合规,下个 extract 文件需起 `taint/` 子目录）。

至此 conduit / param-sink / param→return 三类摘要均**双向跨文件 + 可组合**。剩 **exploded supergraph 全量精确 CFL-可达**（Reps–Horwitz–Sagiv IFDS,把三类摘要统一成 realizable-path）按规模再推。
