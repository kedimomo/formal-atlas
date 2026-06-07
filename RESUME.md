# RESUME — 下次从这里继续

> 本次会话存档点（2026-06-07，★3 闭环自愈完成）。本文件 + 自动记忆（`formal-atlas-subsystem.md`）共同记录"我停在哪、下一步做什么"。

## 当前所在分支
**`star2-refinement-types`**（main 是默认分支；★2 + ★3 + 累积 WIP 都提交在此分支，安全可回退）。
回到主线：`git checkout main && git merge star2-refinement-types`（如果你认可这批改动）。

## 已完成：★3 神经符号闭环（explain → triage → repair → re-verify）
roadmap Phase 3 的"推导轨迹解释 + 反例驱动修复"两项；见 `docs/08-closed-loop.md`。
- **可判定的一半（零 LLM，离线把 ~92 假 XSS 压到 ~0）**：`src/extract/taint.js` 在 xss 汇点结构化判定内容类型 → 新事实 `sink_ct(Id, json|html|unknown)`；`src/rules/taint.pl` 用 ★2 精化范式 `html_safe(N) :- sink(N,xss), sink_ct(N,json)` 抑制——这就是 `{v | contentType==json}`。**sound-leaning**：只在能论证时判 json，`html`/`unknown` 一律保留。无 `sink_ct` 事实 ⇒ 行为与改动前逐字一致（升级-回滚安全）。`verify` 会报抑制数（`suppressed_xss/1`）。
- **解释**：`src/verify/explain.js` 把 `violation/2` 还原成证明树——污点用新增的 `tainted_path/3`（cycle-safe）给 **源→数据流链→汇**，refinement 拎 ★2 的 z3 反例。CLI `explain`、MCP `explain`。
- **神经符号的一半**：`src/repair/{feedback,loop}.js` 把证明树+反例喂回 LLM（`callLLMText`，复用 MCP采样→API→离线 回退），候选补丁**应用到临时副本 → 重抽取 → 重校验**，目标规则计数下降且无回归才接受（generate-and-check）；离线诚实降级 `needs-llm`，**绝不编造补丁**；落盘需 `--apply`（默认 dry-run）。CLI `repair`、MCP `repair`（共 **15** 工具）。

## 验证（确认存档可跑）
```bash
cd formal-atlas
npm test                                  # 9 smoke + 14 engines(含 4 条 ★3) + MCP 自检(15 工具)，全绿
node src/cli.js explain examples/repair    # 真 .innerHTML 汇的证明树（reply.send(json) 已被抑制）
node src/cli.js repair  examples/repair    # 离线 ⇒ needs-llm（提示+证明树）；有 key ⇒ 补丁，已再校验
node src/cli.js verify  ../src/server/routes   # 任务①：taint XSS ~92 → 少数；并报 "N xss FPs auto-suppressed"
```
回归：`verify examples/sample-project` 仍 7 条违规；`smoke` 的 taint 用例仍 1 条 `sink_sql`（污点抑制只动 xss）。

## 下一步：★4 规约忠实度评测（见 docs/06-frontier-map.md / 04-roadmap Phase 3 第 1 项）
- 仿 **Verus-SpecGym**：用"接受合法 / 拒绝非法"的可执行样例，给 LLM 产出的 `contract`/`refinement` 打**忠实度分** + 回译 round-trip。
- 动机：★3 让闭环能自愈，但闭环要**可信**就得能度量 LLM 产出的忠实度，否则可能在错误规约上自洽（`05 §13`：忠实度无法证明、只能证伪）。
- 复用：`examples/`、`src/formalize/`、★2 的 `checkContract`/★3 的 generate-and-check 门（`verifyPatch` 同范式）。

## 待办尾巴（可选）
- 真机验证 `repair --online`（需 `ANTHROPIC_API_KEY` 或 IDE MCP 采样）跑一条真 `.innerHTML` 汇，看补丁被 re-verify 接受。
- 把 ★3 的 `sink_ct` 分诊接到 `fdrs-deep-signal`，让回流 FDRS 的信号也去掉 92 假 XSS 噪音。
- 本分支尚 **未 push、未 merge 到 main**（沿用 ★2 的 checkpoint 纪律）。
