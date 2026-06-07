# RESUME — 下次从这里继续

> 本次会话存档点（2026-06-07，★4 忠实度评测完成 → ★1–★4 主线收口）。本文件 + 自动记忆（`formal-atlas-subsystem.md`）共同记录"我停在哪、下一步做什么"。

## 当前所在分支
**`star2-refinement-types`**（main 是默认分支；★2/★3/★4 + 累积 WIP 都在此分支，安全可回退）。
回到主线：`git checkout main && git merge star2-refinement-types`（如果你认可这批改动）。

## 已完成：★1–★4 神经符号主线全部收口
- **★2 精化类型**（`07-refinement-layer.md`）：`refinement(R,Var,φ,pre|post)` + 复用 `checkContract` 判 `φ_pre⇒φ_post`，四档 entailed/broken/vacuous/unchecked。
- **★3 闭环自愈**（`08-closed-loop.md`，commit `cb8870d`）：`sink_ct/2` 内容类型精化结构化压掉 ~92 假 XSS（`reply.send(json)`≠HTML 汇）；`explain.js` 证明树（`tainted_path/3`）；`repair/{feedback,loop}.js` LLM 补丁 → 应用到临时副本 → 重校验，过了才接受；离线 `needs-llm`。CLI `explain`/`repair`、MCP 14/15 工具。
- **★4 忠实度评测**（`09-faithfulness.md`，本次）：`faithfulness.js` 的 `scoreFaithfulness` 用带标签样例 `evalExpr`（QF-LIA 可判定、零 LLM）打忠实分，逮 too-weak/too-strong；`equiv` 复用 `checkContract` 撑 `roundTrip`（LLM 复述→再形式化→z3 判等价，离线 `needs-llm`）。CLI `smt faithfulness`、MCP `faithfulness`（第 **16** 工具）。

## 验证（确认存档可跑）
```bash
cd formal-atlas
npm test                                                  # 9 smoke + 20 engines(★2/★3/★4/★6) + MCP 16-工具自检，全绿
node src/cli.js smt faithfulness examples/faithfulness/abs.faithful.json   # ✅ faithful + round-trip ✅ equivalent
node src/cli.js verify examples/taint-interproc            # ★6：getName→innerHTML 跨调用真阳；rows()/consume 无误报
node src/cli.js explain examples/repair                   # ★3 证明树
node src/cli.js verify  ../src/server/routes              # ★3：taint XSS ~92 → 少数 + "N xss FPs auto-suppressed"
```
回归：`verify examples/sample-project` 仍 7 条违规；taint smoke 仍 1 条 `sink_sql`。

## 下一步：★1–★4 主线 + ★6 第一刀已完成，余为"按需"的规模/精度工程（06-frontier-map 5–8）
- **★6 过程间污点·第一刀已实现**（`docs/10-interprocedural-taint.md`，本次）：`src/extract/taint.js` 的 `summarizeReturns` 给 within-file tainted-RETURN 摘要——`const x = helper(req)` 当 helper 返回不可信数据时跨调用污染 x（always-on，sound-leaning，**不引入误报**：`return db.query(taintedArg)` 这类返回"结果而非输入"的不算 conduit）。发 `taint_returns(Fn)` 事实；夹具 `examples/taint-interproc/`、1 测试。
- **#6 续刀**（最连贯的下一步）：**参数→形参反向传播**（taint-INTO-callee：callee 内 `sink(x)`、x 来自 caller 污点实参）+ **跨文件摘要**（用 linker `rcall/2` + 摘要持久化）→ 最终 exploded-supergraph 上的精确 CFL-可达。
- 其余：**#5 Soufflé/增量 Datalog**（规模）、**#7 Doop 级指向**（动态分派/反射）、**#8 全 ITP 放电**（Dafny/Verus/Lean，地平线）。
- **#5 Soufflé / 增量 Datalog**（规模）：大库 tau-prolog 慢 → Datalog→并行 C++；watch 模式增量维护。
- **#7 Doop 级过程间指向**（精度）：解析动态分派/反射，死代码/污点误报压到工业级。
- **#8 全 ITP 放电**（地平线）：接 Dafny/Verus/Lean CLI 真正放电证明义务（最严最贵）。

## 待办尾巴（可选，低优先）
- 真机 `repair --online` / `roundTrip` 在线（需 `ANTHROPIC_API_KEY` 或 IDE MCP 采样）跑一遍。
- 把 ★3 `sink_ct` 分诊接到 `fdrs-deep-signal`，让回流 FDRS 的信号也去掉 92 假 XSS 噪音。
- 本分支尚 **未 push、未 merge 到 main**（沿用 ★2 checkpoint 纪律）。
- 旁注：`formal-atlas/.trae/` 下有若干**与 ★ 系列无关的 micro-forge 规划稿**（未跟踪），历次提交都刻意排除，勿混入。
