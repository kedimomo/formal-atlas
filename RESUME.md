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
npm test                                                  # 9 smoke + 19 engines(★2×5,★3×4,★4×5...) + MCP 16-工具自检，全绿
node src/cli.js smt faithfulness examples/faithfulness/abs.faithful.json   # ✅ faithful + round-trip ✅ equivalent
node src/cli.js smt faithfulness examples/faithfulness/too-weak.json        # ❌ too-weak（接受 illegal）
node src/cli.js explain examples/repair                   # ★3 证明树
node src/cli.js verify  ../src/server/routes              # ★3：taint XSS ~92 → 少数 + "N xss FPs auto-suppressed"
```
回归：`verify examples/sample-project` 仍 7 条违规；taint smoke 仍 1 条 `sink_sql`。

## 下一步：★1–★4 主线已完成，转入"按需"的规模/精度工程（见 06-frontier-map 第 5–8 项）
不预先铺开，按真实需求选一项启动。**最连贯的下一步是 #6 IFDS/CFL-可达污点**——它把 ★3 刚分诊过的**行级/文件内**污点升级为 **sound 的过程间精确流**（Reps–Horwitz–Sagiv POPL'95，多项式），直接消掉 `sink_ct` 之外的跨过程误报根因。**设计 spec 已写：[`docs/10-interprocedural-taint.md`](docs/10-interprocedural-taint.md)**（按项目"星标实现前先开 spec"的落地约束）——含两遍 tainted-summary 算法、**避免重新引入误报的精确 returns-taint 规则**、升级-回滚安全开关、夹具与测试计划。照它实现即可。其余：
- **#5 Soufflé / 增量 Datalog**（规模）：大库 tau-prolog 慢 → Datalog→并行 C++；watch 模式增量维护。
- **#7 Doop 级过程间指向**（精度）：解析动态分派/反射，死代码/污点误报压到工业级。
- **#8 全 ITP 放电**（地平线）：接 Dafny/Verus/Lean CLI 真正放电证明义务（最严最贵）。

## 待办尾巴（可选，低优先）
- 真机 `repair --online` / `roundTrip` 在线（需 `ANTHROPIC_API_KEY` 或 IDE MCP 采样）跑一遍。
- 把 ★3 `sink_ct` 分诊接到 `fdrs-deep-signal`，让回流 FDRS 的信号也去掉 92 假 XSS 噪音。
- 本分支尚 **未 push、未 merge 到 main**（沿用 ★2 checkpoint 纪律）。
- 旁注：`formal-atlas/.trae/` 下有若干**与 ★ 系列无关的 micro-forge 规划稿**（未跟踪），历次提交都刻意排除，勿混入。
