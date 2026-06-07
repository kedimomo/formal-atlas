# RESUME — 下次从这里继续

> 本次会话存档点（2026-06-07，★6 **第七刀完成** → 过程间污点七刀：RETURN 摘要 + within-file param-sink + 跨文件 param-sink + 跨文件 returns-taint + 跨文件 2-hop + 传递 conduit 跨文件不动点 + **传递 conduit 同文件不动点**）。本文件 + 自动记忆（`formal-atlas-subsystem.md`）共同记录"我停在哪、下一步做什么"。

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
npm test                                                  # 9 smoke + 27 engines(★2/★3/★4/★5/★6) + MCP 16-工具自检,全绿
node src/cli.js smt faithfulness examples/faithfulness/abs.faithful.json   # ✅ faithful + round-trip ✅ equivalent
node src/cli.js verify examples/taint-interproc            # ★6 刀1：getName→innerHTML 跨调用真阳；rows()/consume 无误报
node src/cli.js verify examples/taint-paramsink            # ★6 刀2：render(html)/runSql(sql) 真阳 2 条；sendJson(json) 抑制 1 条
node src/cli.js verify examples/taint-xfile                # ★6 刀3：跨文件 renderHtml + 别名 paint 真阳 2 条；replyJson(json) 跨文件抑制 1 条
node src/cli.js verify examples/taint-retxfile             # ★6 刀4：跨文件 conduit getName + 别名 grab 真阳 2 条；rows() 非 conduit 无误报
node src/cli.js verify examples/taint-2hop                 # ★6 刀5：getName conduit→render(html) 跨文件 2-hop 真阳 1 条；→replyJson(json) 跨 2 跳抑制
node src/cli.js verify examples/taint-transitive           # ★6 刀6：A→B→C 传递 conduit(fetchName=return getName) 跨文件不动点真阳 1 条
node src/cli.js verify examples/taint-localtransitive      # ★6 刀7：同文件传递 conduit(fetchName) 经 summarizeReturns 不动点真阳 1 条
node src/cli.js explain examples/repair                   # ★3 证明树
node src/cli.js verify  ../src/server/routes              # ★3+★6：直接 sink_xss 1 条；95 假 XSS 抑制 + 过程间 json 全抑制（0 误报）
```
回归：`verify examples/sample-project` 仍 7 条违规；taint smoke 仍 1 条 `sink_sql`。

## 下一步：★1–★4 主线 + ★6 七刀已完成,余为"按需"的规模/精度工程（06-frontier-map 5–8）
- **★6 过程间污点·七刀已实现**（`docs/10-interprocedural-taint.md`）：
  - **刀1（tainted-RETURN 摘要）**：`summarizeReturns` 给 within-file tainted-RETURN 摘要——`const x = helper(req)` 当 helper 返回不可信数据时跨调用污染 x（sound-leaning，`return db.query(arg)` 这类返回"结果而非输入"的不算 conduit）。发 `taint_returns(Fn)`；夹具 `examples/taint-interproc/`。
  - **刀2（参数→形参反向 / param-sink）**：`summarizeParamSinks` 给 `param_sink('File::Fn',Idx,Kind,Ct)` 摘要——只测 `sinkValueExpr` 的危险值位置、**排除接收者**（db/res/reply）；调用点发**虚拟汇**复用既有 `violation`/`html_safe`，故 **Ct=json 包装器在过程间被原样抑制**（不倒回 ★3）。夹具 `examples/taint-paramsink/`。
  - **刀3（跨文件 param-sink 连接）**：抽取器发 QId 键 `param_sink` + `taint_arg(File,Callee,Idx,ArgNode)`；`src/link/taint-link.js` 在 `link()` 后把 callee 解析到 QId（**复用 linker 同序：import_binding 别名 → 同文件 → 全局唯一 decl**，sound）→ cross-file 命中即发虚拟汇，json 仍抑制。夹具 `examples/taint-xfile/`（含 `import {x as y}` 别名）。实测路由上 cross-file 0 误报。
  - **刀4（跨文件 returns-taint 连接）**：抽取器发 QId 键 conduit 摘要 `taint_returns_q('File::Fn')` + `ret_call(File,Callee,Xnode)`（`localFnNames` gate 到非本文件 callee）；**独立 `retTaint` map**（与主 taint 分离 → 现有行为 bit-identical）铺 inert 下游边；`taint-link.js` 复用刀3 同一 `resolve()` 把 callee 解析到 QId,跨文件命中 conduit 即注入 `source(Xnode)` 激活那条边（零新规则,只发 source/1）。`summarizeReturns` 顺带修了**行尾注释剥离**（`return n // x` 真实代码必备）。夹具 `examples/taint-retxfile/`（getName conduit + rows 非 conduit + `getName as grab` 别名）、1 测试。实测路由/auth 上 0 误报。
  - **刀5（跨文件 2-hop：returns→param-sink 组合）**：`taint.js` 的 `taint_arg` 发射**扩到 `retTaint` 变量**——conduit 结果作为污点实参传给另一个跨文件 param-sink 包装器时,刀3 与刀4 两个跨文件 join 自然组合（刀4 注入 `source(Xnode)`,刀3 在 Xnode 发虚拟汇）。**content-type 护栏跨两跳仍成立**（json 包装器照抑制）；`taint_arg/4` 补声明 `:- dynamic` 保空查询安全。夹具 `examples/taint-2hop/`（三文件:getName→render(html) 真阳、→replyJson(json) 抑制）、1 测试。实测路由 +0.7% 事实、0 新误报。
  - **刀6（传递 conduit A→B→C 跨文件不动点）**：`summarizeReturns` 改返回 `{conduits, returnCalls}`,遇 `return callee(..)`（`calleeOf` 只认裸 callee,dotted 天然排除）收集 `[fn,callee]` → 发 `ret_returns_call('File::Fn',Callee)`；`taint-link.js` 在 return-join 前跑**跨文件不动点**——复用同一 `resolve()` 把 callee 解析到 QId,命中 conduit 集即并入 QFn,迭代到不变（单调有界必终止;自递归/环无基础 conduit 则不传播）。新并入的传递 conduit 也发 `taint_returns_q` 便于 query/explain。夹具 `examples/taint-transitive/`（source.getName→delegate.fetchName→consumer.show）、1 测试。实测路由 0 新误报。
  - **刀7（传递 conduit 同文件不动点）**：补刀6 的同文件漏报——`summarizeReturns` 收尾再跑一个**同文件不动点**:对每条 `[fn,callee]`,callee 是同文件 conduit 即把 fn 并入 `conduits`。于是同文件 `fetchName` 升格 direct conduit（slice-1 `returnsTaint.has` 真）→ 同文件 consumer 直接 source。与刀6 互补（同文件 callee 在此解、跨文件留给 linkTaint）。slice-1 锚点不受影响（taint-interproc 无 `return 裸conduit(..)`,returnCalls 空）。夹具 `examples/taint-localtransitive/`（单文件）、1 测试。
- **#6 续刀（最连贯的下一步）**：**return-of-tainted-arg**（`function id(x){return x}` 透传形参的返回——区别于"内部制造污点"的 conduit,是 param→return 摘要,可与 param-sink 摘要合流）→ 最终 exploded-supergraph 上把 conduit/param-sink/return 三类摘要统一成 realizable-path CFL-可达。
- **大前沿推荐序 = 5 → 7 → 8**（用户问过 7→8→5;判定:**#7 需 #5 在前**——Doop 级 points-to 本质是"Datalog 跑在 Soufflé 上",上下文敏感事实爆炸 tau-prolog 扛不住,所以规模引擎 #5 是 #7 的底座;#8 最贵且依赖外部 prover,补的是已诚实的 `unchecked` 档,放最后)：
  - **#5 Soufflé / 增量 Datalog**（规模，先行）：大库 tau-prolog 慢(实测 145 文件 17s),瓶颈是传递闭包(`cyclic` 52.8s)。**spec `docs/11` + 引擎 + verify 集成已落地（2026-06-07）**:`src/verify/datalog.js` 零安装半朴素引擎(`evaluate`/`materialize`)+ parity 测试(★5)——闭包查询 `cyclic/dead_code/tainted` 与 tau-prolog **逐位一致**,引擎一趟 **33ms** vs tau-prolog 40.9+5.9+3.6s(**110×–1238×**);`--engine=datalog` 经 `engine_materialized` 守卫接进 `violation/2`(物化 dead_code/tainted + 旁路递归规则),实测 violation/2 solve **6.4s→4.3s(1.5×),parity 294=294**(只 1.5× 因 violation 成本分散;CLI 默认 lift=offline 掩盖该加速)。答案是**零安装半朴素引擎(非原生 Soufflé)**。**下一增量(1238× 落地处)**:把 `query`/MCP 的闭包谓词(cyclic/reaches/impact)直接路由到引擎。
  - **#7 Doop 级过程间指向**（精度，居中）：建在 Soufflé 上,解析动态分派/反射,把死代码/污点误报压到工业级。
  - **#8 全 ITP 放电**（严谨，地平线/收尾）：接 Dafny/Verus/Lean CLI 真正放电证明义务（最严最贵、需外部工具链）。

## 待办尾巴（可选，低优先）
- 真机 `repair --online` / `roundTrip` 在线（需 `ANTHROPIC_API_KEY` 或 IDE MCP 采样）跑一遍。
- ✅ **已做（2026-06-07）**：把 ★3 `sink_ct` 分诊接到 `fdrs-deep-signal`。改在**父仓** `tools/lint/fdrs-deep-signal.js`：`DEEP_PILLAR` 加 `taint-reaches-sink → boundary(P6)`(注入=跨数据信任边界);因 ★3 抑制已在 `violation` 规则内,只有真阳回流(实测 routes 文件 1 真阳,非 7);并查询 `suppressed_xss/1` 把抑制数作 `suppressedXss` 字段 + 理由行**显式回流**(让 FDRS 看见"压掉了几个假 XSS"，不是漏掉)。端到端 `fdrs-synthesize --deep` 贯通、`fdrs-synthesis-proposal` 优雅消费、默认目标 auth/policy 行为不变。**注意:此改动在父仓(分支 `hid-fido-enum`)、尚未提交**——formal-atlas 自身未动。
- 本分支尚 **未 push、未 merge 到 main**（沿用 ★2 checkpoint 纪律）。
- 旁注：`formal-atlas/.trae/` 下有若干**与 ★ 系列无关的 micro-forge 规划稿**（未跟踪），历次提交都刻意排除，勿混入。
