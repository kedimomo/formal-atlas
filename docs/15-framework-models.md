# 框架模型感知 + 实现计划：framework-model awareness（spec，2026-06-08）

> 本会话反复实测出的结论：formal-atlas 的**语言级引擎（points-to / IFDS）在本库已"够精"**（误报 0），剩余的可达性/污点缺口来自 **① 框架中介的调用**（Fastify 路由/钩子，`field_call`=0 的根因）和 **② 未证的安全核心**。故**最高杠杆的下一步是框架模型感知（本档）与 ITP 放电（`docs/13`），而非更多 points-to/IFDS 精度（`docs/14`）**。本档给框架模型的实现 + 三项的执行序。

## 一、动机（本库实测的真实模式）
```js
app.get('/api/abac/rules', { preHandler: [requireAuth] }, async (req, res) => { ... })
//      ~450 处(get 205/post 195/delete 32/put 18,74 文件) + addHook('preHandler', rebacVerifier)
```
- `requireAuth`/`rebacVerifier`/handler **由 Fastify 运行时调用**——源码无 `xxx()` 调它们,调用在 `node_modules` 内,分析器读不到 → 调用图**断在 HTTP 入口**。
- 后果:`reaches`/`impact` 答不出"**一个 HTTP 请求能触发什么 / 哪条路由能到这个 DB 写/汇**"（handler 是孤立 lambda,无入边）；安全钩子（auth/rebac）的体未被当入口分析。
- 这正是项目使命（RBAC/ReBAC/污点）最该回答的问题,所以框架模型对本项目**高价值**。

## 二、建什么模型（models-as-data，声明式优先）
一张**框架 API 表**（数据,非代码——便于加 Express/Koa）：
```
{ recv:/^(app|fastify|router)$/, method:/^(get|post|put|delete|patch|all)$/,
  handlerArg:'last',              // handler = 最后一个函数实参
  optsArg:1, hookFields:['preHandler','onRequest','preValidation'],  // opts 对象里的钩子链
  taintParams:[0] }               // handler/钩子的第 0 参(req)是不可信入口源
{ recv:/.../, method:'route', handlerField:'handler', hookFields:[...] }   // app.route({...})
{ recv:/.../, method:'addHook', hookArg:'last' }                          // 全局 addHook('onRequest', fn)
{ recv:/.../, method:'register' }                                          // 插件注册(子作用域,二期)
```

## 三、产出什么 facts（附加、对现有规则 inert，flag-gated `--framework`）
- `entry(QId)` — handler/钩子是调用图**根**（reaches/dead_code 把它当 `main` 同级入口,不再误判孤立）。
- 合成 `calls3(file, '__http__', handler)` + 每个钩子 `calls3(file, handler, hook)` — handler/钩子**进调用图**（经既有 linker QId 化 → rcall；`reaches('__http__', X)` 即"HTTP 可达 X"）。
- `source(handler 第0参节点)` — `req` 作**确认的入口污点源**（喂现有 `tainted/2`；现有 `req.query.x` 仅在体内命中,本模型把"入口→handler→深层汇"打通,且让 preHandler 链被分析）。
- 新规则极少:`reaches` 已有；`dead_code` 加 `\+ entry(N)` 守卫（入口不算死）。

## 四、落地（新顶层 `src/models/`，与 extract/ 解耦）
- `src/models/index.js` — 加载模型表 + `applyModels(facts)`：扫 `calls3`/AST 派生的调用点,匹配框架模式 → 发 `entry`/合成 `calls3`/`source`。
- `src/models/fastify.js` — Fastify 模型表（上述）。Express/Koa/Spring 后续各一文件。
- 抽取侧（`js-ast.js`）已发 `calls(scope, cn)` + 实参 AST 不足以拿 handler 节点 → **新发 `call_site(file, scope, callee, argKinds, line)`**（或复用现有 calls3 + 一个轻量 arg 记录）让 models 层匹配。**注意 extract/ 已 8 文件、js-ast 200 行** → arg 记录若超量,起 `src/extract/calls/` 子目录。
- 集成:`pipeline.js` 在 `link()` 后跑 `applyModels`（需 decl/QId）；flag `--framework`（默认关,parity-safe）。CLI/MCP 暴露。

## 五、刀 plan（framework-model）
- **刀1**:`app.METHOD(path[,opts],handler)` → `entry(handler)` + 合成 `calls3('__http__'→handler)` + `source(req)`。夹具:一个路由文件;实测 `reaches('__http__', dbQuery)` 出现、handler 不再孤立。**最高即时收益**。
- **刀2**:钩子链 `opts.preHandler`/`onRequest` + 全局 `addHook` → `calls3(handler→hook)`、auth/rebac 钩子进图被分析（安全核心可达性）。
- **刀3**:`app.route({handler,preHandler})` 字段式 + `app.register` 子作用域；models-as-data 化,加 Express/Koa 仅加数据。
- 每刀:夹具 + parity（`--framework` 关时位等价）+ 真实库实测（reaches/impact 入口可达性↑、handler dead-code FP→0）。

## 六、三项执行序（推荐：框架模型 → ITP → IFDS）
| 序 | 项 | 为何这个序 | spec | 即时收益(本库) |
|---|---|---|---|---|
| **1** | **框架模型（本档）** | 补的是**缺失的调用边/入口源**,本库 450 路由直接受益;解锁"HTTP→汇"安全查询 | `docs/15` | **高**(语言级引擎此处已尽,这是真缺口) |
| **2** | **ITP 放电** | 把安全核心(crypto/auth/rebac/Merkle)的 `unchecked` 义务真证掉;`toDafny` 已生成 VC,缺接 prover | `docs/13` | 中(需装 prover;价值集中在核心函数,非全库) |
| **3** | **完整 IFDS** | realizable-path 精度;本库污点误报已 0,边际收益低,**按出现摘要过报的具体案例再上** | `docs/14` | 低(精度天花板补强) |

> 取舍主线（沿 `04-roadmap`）：**先 measure 再投精度;便宜够用就停;升级-回滚安全（全程 flag-gated + parity）**。框架模型排第一不是因为它"高级",而是因为**本库实测的缺口在那里**。

## 七、诚实边界
- 框架模型是**按框架建的**——只覆盖建了模型的框架(先 Fastify);未建模的框架仍断在入口（sound-leaning:漏可达,不造假边）。
- `source(req)` 让污点从入口流入,可能**新增真阳**(本是好事)——上线前在真实库量一遍 FP，护栏(sanitizer/content-type)按需补。
- 不引外部框架运行时;模型是**静态声明的 API 契约**,非执行。
