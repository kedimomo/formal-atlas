# RESUME — 下次从这里继续

> 本次会话存档点（2026-06-08，★6 **第九刀完成** → 跨文件透传函数：第八刀的 param→return 透传摘要 `param_return` 现可跨文件——`id` 定义在另一文件经 import 时,`crossFilePassArgs` 发 `pass_arg/6` 候选,`taint-link.js` post-link 用同一 `resolve()` 把 pc 解析到 `param_return` QId 后合成 `taint_arg` 经 `emitSink` 接 param-sink；跨文件→跨文件 与 跨文件→同文件 两种外层都真阳,JSON 跨文件透传仍抑制,routes/auth 违规计数逐位不变）。本文件 + 自动记忆（`formal-atlas-subsystem.md`）共同记录"我停在哪、下一步做什么"。

## 当前所在分支
**`star2-refinement-types`**（main 是默认分支；★2/★3/★4/★6 + 累积 WIP 都在此分支，安全可回退）。
回到主线：`git checkout main && git merge star2-refinement-types`（如果你认可这批改动）。

## 已完成：★1–★4 神经符号主线全部收口
- **★2 精化类型**（`07-refinement-layer.md`）：`refinement(R,Var,φ,pre|post)` + 复用 `checkContract` 判 `φ_pre⇒φ_post`，四档 entailed/broken/vacuous/unchecked。
- **★3 闭环自愈**（`08-closed-loop.md`，commit `cb8870d`）：`sink_ct/2` 内容类型精化结构化压掉 ~92 假 XSS（`reply.send(json)`≠HTML 汇）；`explain.js` 证明树（`tainted_path/3`）；`repair/{feedback,loop}.js` LLM 补丁 → 应用到临时副本 → 重校验，过了才接受；离线 `needs-llm`。CLI `explain`/`repair`、MCP 14/15 工具。
- **★4 忠实度评测**（`09-faithfulness.md`，本次）：`faithfulness.js` 的 `scoreFaithfulness` 用带标签样例 `evalExpr`（QF-LIA 可判定、零 LLM）打忠实分，逮 too-weak/too-strong；`equiv` 复用 `checkContract` 撑 `roundTrip`（LLM 复述→再形式化→z3 判等价，离线 `needs-llm`）。CLI `smt faithfulness`、MCP `faithfulness`（第 **16** 工具）。

## 验证（确认存档可跑）
```bash
cd formal-atlas
npm test                                                  # 9 smoke + 34 engines(★2/★3/★4/★5/★6/★7) + MCP 16-工具自检,全绿
node src/cli.js smt faithfulness examples/faithfulness/abs.faithful.json   # ✅ faithful + round-trip ✅ equivalent
node src/cli.js verify examples/taint-interproc            # ★6 刀1：getName→innerHTML 跨调用真阳；rows()/consume 无误报
node src/cli.js verify examples/taint-paramsink            # ★6 刀2：render(html)/runSql(sql) 真阳 2 条；sendJson(json) 抑制 1 条
node src/cli.js verify examples/taint-xfile                # ★6 刀3：跨文件 renderHtml + 别名 paint 真阳 2 条；replyJson(json) 跨文件抑制 1 条
node src/cli.js verify examples/taint-retxfile             # ★6 刀4：跨文件 conduit getName + 别名 grab 真阳 2 条；rows() 非 conduit 无误报
node src/cli.js verify examples/taint-2hop                 # ★6 刀5：getName conduit→render(html) 跨文件 2-hop 真阳 1 条；→replyJson(json) 跨 2 跳抑制
node src/cli.js verify examples/taint-transitive           # ★6 刀6：A→B→C 传递 conduit(fetchName=return getName) 跨文件不动点真阳 1 条
node src/cli.js verify examples/taint-localtransitive      # ★6 刀7：同文件传递 conduit(fetchName) 经 summarizeReturns 不动点真阳 1 条
node src/cli.js verify examples/taint-passthrough          # ★6 刀8：本地透传 id 喂跨文件 render + 同文件 show 真阳 2 条；id 喂 JSON replyJson 抑制；swallow 非透传 0 误报
node src/cli.js verify examples/taint-passthrough-xfile    # ★6 刀9：跨文件透传 util.js::id 喂跨文件 render + 同文件 show 真阳 2 条；id 喂 JSON replyJson 跨文件抑制
node src/cli.js explain examples/repair                   # ★3 证明树
node src/cli.js verify  ../src/server/routes              # ★3+★6：直接 sink_xss 1 条；95 假 XSS 抑制 + 过程间 json 全抑制（0 误报）
```
回归：`verify examples/sample-project` 仍 7 条违规；taint smoke 仍 1 条 `sink_sql`。

## 下一步：★1–★4 主线 + ★6 九刀已完成,余为"按需"的规模/精度工程（06-frontier-map 5–8）
- **★6 过程间污点·九刀已实现**（`docs/10-interprocedural-taint.md`）：
  - **刀1（tainted-RETURN 摘要）**：`summarizeReturns` 给 within-file tainted-RETURN 摘要——`const x = helper(req)` 当 helper 返回不可信数据时跨调用污染 x（sound-leaning，`return db.query(arg)` 这类返回"结果而非输入"的不算 conduit）。发 `taint_returns(Fn)`；夹具 `examples/taint-interproc/`。
  - **刀2（参数→形参反向 / param-sink）**：`summarizeParamSinks` 给 `param_sink('File::Fn',Idx,Kind,Ct)` 摘要——只测 `sinkValueExpr` 的危险值位置、**排除接收者**（db/res/reply）；调用点发**虚拟汇**复用既有 `violation`/`html_safe`，故 **Ct=json 包装器在过程间被原样抑制**（不倒回 ★3）。夹具 `examples/taint-paramsink/`。
  - **刀3（跨文件 param-sink 连接）**：抽取器发 QId 键 `param_sink` + `taint_arg(File,Callee,Idx,ArgNode)`；`src/link/taint-link.js` 在 `link()` 后把 callee 解析到 QId（**复用 linker 同序：import_binding 别名 → 同文件 → 全局唯一 decl**，sound）→ cross-file 命中即发虚拟汇，json 仍抑制。夹具 `examples/taint-xfile/`（含 `import {x as y}` 别名）。实测路由上 cross-file 0 误报。
  - **刀4（跨文件 returns-taint 连接）**：抽取器发 QId 键 conduit 摘要 `taint_returns_q('File::Fn')` + `ret_call(File,Callee,Xnode)`（`localFnNames` gate 到非本文件 callee）；**独立 `retTaint` map**（与主 taint 分离 → 现有行为 bit-identical）铺 inert 下游边；`taint-link.js` 复用刀3 同一 `resolve()` 把 callee 解析到 QId,跨文件命中 conduit 即注入 `source(Xnode)` 激活那条边（零新规则,只发 source/1）。`summarizeReturns` 顺带修了**行尾注释剥离**（`return n // x` 真实代码必备）。夹具 `examples/taint-retxfile/`（getName conduit + rows 非 conduit + `getName as grab` 别名）、1 测试。实测路由/auth 上 0 误报。
  - **刀5（跨文件 2-hop：returns→param-sink 组合）**：`taint.js` 的 `taint_arg` 发射**扩到 `retTaint` 变量**——conduit 结果作为污点实参传给另一个跨文件 param-sink 包装器时,刀3 与刀4 两个跨文件 join 自然组合（刀4 注入 `source(Xnode)`,刀3 在 Xnode 发虚拟汇）。**content-type 护栏跨两跳仍成立**（json 包装器照抑制）；`taint_arg/4` 补声明 `:- dynamic` 保空查询安全。夹具 `examples/taint-2hop/`（三文件:getName→render(html) 真阳、→replyJson(json) 抑制）、1 测试。实测路由 +0.7% 事实、0 新误报。
  - **刀6（传递 conduit A→B→C 跨文件不动点）**：`summarizeReturns` 改返回 `{conduits, returnCalls}`,遇 `return callee(..)`（`calleeOf` 只认裸 callee,dotted 天然排除）收集 `[fn,callee]` → 发 `ret_returns_call('File::Fn',Callee)`；`taint-link.js` 在 return-join 前跑**跨文件不动点**——复用同一 `resolve()` 把 callee 解析到 QId,命中 conduit 集即并入 QFn,迭代到不变（单调有界必终止;自递归/环无基础 conduit 则不传播）。新并入的传递 conduit 也发 `taint_returns_q` 便于 query/explain。夹具 `examples/taint-transitive/`（source.getName→delegate.fetchName→consumer.show）、1 测试。实测路由 0 新误报。
  - **刀7（传递 conduit 同文件不动点）**：补刀6 的同文件漏报——`summarizeReturns` 收尾再跑一个**同文件不动点**:对每条 `[fn,callee]`,callee 是同文件 conduit 即把 fn 并入 `conduits`。于是同文件 `fetchName` 升格 direct conduit（slice-1 `returnsTaint.has` 真）→ 同文件 consumer 直接 source。与刀6 互补（同文件 callee 在此解、跨文件留给 linkTaint）。slice-1 锚点不受影响（taint-interproc 无 `return 裸conduit(..)`,returnCalls 空）。夹具 `examples/taint-localtransitive/`（单文件）、1 测试。
  - **刀8（return-of-tainted-arg：param→return 透传摘要，与 param-sink 合流）**：补上第三类摘要——**透传**（函数把形参原样返回 `function id(x){return x}`，既不制造也不消费污点,而是**承载**）。`summarizeParamReturns`（第三遍,与 param-sink 同构）盯 `return`：返回表达式经**纯别名（无调用/汇/sanitizer，`hasCall` gate）** mention 形参派生变量 → 发 `param_return('File::Fn',Idx)`（sound-leaning:`return f(x)` 返 f 结果而非 x → 排除）。**零新规则/链接代码,折进既有 join**:`argSource` 改递归（本地透传调用 `id(inner)` 取 inner 污点节点 → 同文件 param-sink 虚拟汇）；新 `passthroughVarNode` 把 `id(taintedVar)` 解析到该变量已有节点 → 发 `taint_arg` 让**刀3 跨文件 join** 原样接出；**content-type 护栏跨透传成立**（虚拟汇 Ct 取自外层 param-sink,JSON 透传照 ★3 抑制）。抽离共享 `returnExpr`/`hasCall` 到 taint-patterns.js（消 conduit/透传两遍冗余）。夹具 `examples/taint-passthrough/`（本地 `id` 透传 + 对照 `swallow` + 本地 `show` + 跨文件 `render`/`replyJson`）、1 测试。实测 routes 发现 16 真实透传但**违规计数逐位不变**（stash 前后 routes 187/auth 27 一致）→ 0 新误报。
  - **刀9（跨文件透传函数：passthrough fn 在另一文件）**：补刀8 的"透传函数限本地"——`id` 经 import 来自另一文件时,把透传判定也推到 post-link。抽取 `taint-callsite.js` 新 `crossFilePassArgs`:外层实参是**非本地** call `pc(innerArgs)`（`!localFns.has(pc)`）含裸污点 inner 时发 `pass_arg(File,Outer,OIdx,PC,IIdx,Node)` 候选（本地透传仍由刀8 `passthroughVarNode` 即时处理,互斥）。`taint-link.js` 收 `param_return` 进 `paramReturnByQid`,对每条 `pass_arg` 用**同一 `resolve()`** 把 pc 解析到 pq,pq 是含 IIdx 的透传 → 合成 `taint_arg` 经统一 `emitSink()` 接外层 param-sink。`emitSink(...,skipSameFile)` 统一真实/合成两路:真实路（刀3/5）保留 `skipSameFile=true`（bit-identical）,合成路 `skipSameFile=false`（透传在别文件,抽取期没处理过,故同文件外层 `show` 也发；两路 arg 形状不相交无重复）。把 `argSource`/`passthroughVarNode`/`crossFilePassArgs` 三个调用点 helper 抽到 `taint-callsite.js` 守 taint.js ≤200 行（现 140）。可组合(Node 可为刀4 的 conduit 结果 → 跨文件 conduit→透传→sink 三跳)；`pass_arg/6` `:- dynamic`。夹具 `examples/taint-passthrough-xfile/`（三文件:util.js 透传 + lib.js param-sink + app.js 消费）、1 测试。实测 routes/auth 0 新误报。
- **#6 续刀（最连贯的下一步）**：**exploded supergraph 全量精确 CFL-可达**（Reps–Horwitz–Sagiv IFDS）——三类摘要（conduit/param-sink/param→return）现已**双向跨文件 + 可组合**,把它们统一成 supergraph 上的 realizable-path 可达（区分 call/return 括号匹配,消除"非真实路径"的过度污染）。**注:`src/extract/` 现 8 文件（≤8 合规上限），下一个 extract 文件需起 `src/extract/taint/` 子目录**。
- **大前沿推荐序 = 5 → 7 → 8**（用户问过 7→8→5;判定:**#7 需 #5 在前**——Doop 级 points-to 本质是"Datalog 跑在 Soufflé 上",上下文敏感事实爆炸 tau-prolog 扛不住,所以规模引擎 #5 是 #7 的底座;#8 最贵且依赖外部 prover,补的是已诚实的 `unchecked` 档,放最后)：
  - **#5 Soufflé / 增量 Datalog**（规模，先行）：大库 tau-prolog 慢(实测 145 文件 17s),瓶颈是传递闭包(`cyclic` 52.8s)。**spec `docs/11` + 引擎 + verify 集成已落地（2026-06-07）**:`src/verify/datalog.js` 零安装半朴素引擎(`evaluate`/`materialize`)+ parity 测试(★5)——闭包查询 `cyclic/dead_code/tainted` 与 tau-prolog **逐位一致**,引擎一趟 **33ms** vs tau-prolog 40.9+5.9+3.6s(**110×–1238×**);`--engine=datalog` 经 `engine_materialized` 守卫接进 `violation/2`(物化 dead_code/tainted + 旁路递归规则),实测 violation/2 solve **6.4s→4.3s(1.5×),parity 294=294**(只 1.5× 因 violation 成本分散;CLI 默认 lift=offline 掩盖该加速)。答案是**零安装半朴素引擎(非原生 Soufflé)**。**闭包查询路由 + MCP 集成已落地**:`queryEngine` 把 CLI `query --engine=datalog` 与 **MCP `query` 工具**的 `cyclic/reaches/dead_code/tainted/impact`(全变量 goal)直接由引擎应答——实测 `cyclic` 在 store/services **52s→1.8s 端到端**;MCP `programFor` 改用 `engine='datalog'`(物化 dead_code/tainted),verify/dead_code/taint 工具自动提速、parity 保持(MCP 自检通过)。下一增量(可选):watch 增量维护(半朴素 DRed,docs/11 §五)。**★5 全交付完成**。
  - **#7 Doop 级过程间指向**（精度，居中）：建在半朴素引擎上,解析动态分派/反射,把死代码/污点误报压到工业级。**spec `docs/12` + 首刀端到端完整（2026-06-07）**:`src/verify/points-to.js` 字段/上下文不敏感 **Andersen** points-to(worklist 最小不动点,cycle-safe);抽取(`js-ast.js` 发 alloc/assign/calleeVar)+ link(`pipeline.js` per-file pointsTo → 合成 calls3 → linker QId 化 → rcall)+ flag `--points-to`(默认关,parity-safe)。实测 `examples/points-to/`:`--points-to` 下 `reaches(dispatch,realHandler)` 出现(变量调用 `h()` 被解析进调用图)、默认关时不变。**points-to 是首个引擎专属能力**(pts↔resolvedCall 互递归令 tau-prolog SLD 死循环 OOM,故无 Prolog 参考)。★7 四测试。**下一刀(可选)**:高阶/dispatch-table 夹具 + `routes` 实测 FP↓;过程间实参流(argActual/formalParam 抽取);跨文件(import 变量持函数)。
- **#8 全 ITP 放电**（严谨，地平线/收尾）：接 Dafny/Verus/Lean CLI 真正放电证明义务（最严最贵、需外部工具链）。
- **ReBAC 图经验对接（已查证 2026-06-07，回应"这是图问题")**：`reaches/tainted/points-to` 都是图可达;父仓 `src/store/services/rebac/` 的 **`ClosureService`(O(affected) 增量闭包=祖先×后代)、`csr-generator`(CSR)、`accelerator`(SpMV)、`leopard-index`** 是对口的生产级经验。判定:**tau-prolog 性能问题已由 #5 半朴素引擎解决**(与 ClosureService 同族);ReBAC 增值在下一档——**已把 `ClosureService` 增量闭包移植成内存版** `src/verify/closure-delta.js`(`addEdge` 祖先×后代,验证 增量==全量含环;watch 二期基元,DRed 删边待续),CSR/SpMV 留十亿边按需。见 `docs/11` §五·一。

## 待办尾巴（可选，低优先）
- 真机 `repair --online` / `roundTrip` 在线（需 `ANTHROPIC_API_KEY` 或 IDE MCP 采样）跑一遍。
- ✅ **已做（2026-06-07）**：把 ★3 `sink_ct` 分诊接到 `fdrs-deep-signal`。改在**父仓** `tools/lint/fdrs-deep-signal.js`：`DEEP_PILLAR` 加 `taint-reaches-sink → boundary(P6)`(注入=跨数据信任边界);因 ★3 抑制已在 `violation` 规则内,只有真阳回流(实测 routes 文件 1 真阳,非 7);并查询 `suppressed_xss/1` 把抑制数作 `suppressedXss` 字段 + 理由行**显式回流**(让 FDRS 看见"压掉了几个假 XSS"，不是漏掉)。端到端 `fdrs-synthesize --deep` 贯通、`fdrs-synthesis-proposal` 优雅消费、默认目标 auth/policy 行为不变。**注意:此改动在父仓(分支 `hid-fido-enum`)、尚未提交**——formal-atlas 自身未动。
- 本分支尚 **未 push、未 merge 到 main**（沿用 ★2 checkpoint 纪律）。
- 旁注：`formal-atlas/.trae/` 下有若干**与 ★ 系列无关的 micro-forge 规划稿**（未跟踪），历次提交都刻意排除，勿混入。
