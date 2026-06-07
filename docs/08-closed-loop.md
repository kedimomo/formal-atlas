# ★3 神经符号闭环（Closed Loop）— 让系统会"解释"违规、并"自愈"误报

> 落地于 2026-06-07。承接 [`07-refinement-layer.md §七`](./07-refinement-layer.md) 留下的钩子：把 ★2 的"可判定谓词 + z3 反例"接到污点汇抑制，并把**证明树 + 反例喂回 LLM 做反例驱动修复**。
> 对应数学依据 [`05-math-deepening.md §13`](./05-math-deepening.md)（证伪式闭环：忠实度无法证明、只能证伪）；工程参照 Chiasmus 的 derivation-trace。这是 [`06-frontier-map.md`](./06-frontier-map.md) 优先级主线的 **★3**。

## 一、为什么是这一档

★2 让契约从"自然语言"升级成"机器可判定的谓词"，并能产出 **z3 反例**。但系统还只会"报"，不会"解释"，更不会"改"。★3 把神经符号回路**真正闭合**：

```
violation ──explain──▶ 证明树(+z3 反例) ──LLM──▶ 候选裁决/补丁 ──re-verify──▶ 只在通过时接受
   ▲                                                                              │
   └──────────────────────────── 再校验失败则带反馈重试（有界） ──────────────────┘
```

它修的是任务①暴露的真问题：扫 `src/server/routes` 报的 **~92 条 "XSS"** 绝大多数是误报——Fastify `reply.send(obj)` 返回 JSON，**不是 HTML 汇**。★3 分两半解决：**可判定的一半**（结构化分诊，零 LLM，离线把 92 条压到 ~0）+ **神经符号的一半**（残余/真汇 → LLM 提补丁 → 再校验）。

## 二、可判定的一半：内容类型精化 → 自动分诊

污点抽取器 `src/extract/taint.js` 原本把 `.send|.write|.end(` 一律当 XSS 汇——于是每个携带 `req.*` 的 Fastify 响应都误报。★3 在汇点**结构化判定响应的内容类型**，新增事实：

```prolog
sink_ct(SinkId, json|html|unknown).
```

判定取自源码本身（sound-leaning：**只在能论证时**判 `json`，其余留 `unknown`/`html`、继续保留）：

| 形态 | 判定 |
|---|---|
| `.innerHTML =` | `html`（真 DOM 汇） |
| `reply.send(obj/ident)`、链式 `reply.code(x).send(obj)`、`.json(` | `json`（Fastify 序列化为 JSON） |
| 字符串实参含标记 `<…>`、`.render(`、`reply.type('text/html')` | `html` |
| `res.send(ident)`（Express，语义模糊）/ 其余 | `unknown`（保留，交给 ★3 的 LLM 分诊） |

规则层 `src/rules/taint.pl` 用 ★2 的精化范式把它接上——这正是 `{ v | contentType(v) == json }`：

```prolog
:- dynamic(sink_ct/2).
html_safe(N) :- sink(N, xss), sink_ct(N, json).      % JSON 序列化 ⇒ 不是 HTML/脚本汇
violation(N, 'taint-reaches-sink') :-
    sink(N, _), tainted(N), \+ sanitized_into(N), \+ html_safe(N).
suppressed_xss(N) :-                                  % 审计：被抑制的误报，供 verify 报数
    sink(N, xss), tainted(N), \+ sanitized_into(N), sink_ct(N, json).
```

**无 `sink_ct/2` 事实时 `html_safe` 永不成立 ⇒ 行为与改动前逐字一致**（升级-回滚安全）。

## 三、解释：派生轨迹 / 证明树

`src/verify/explain.js` 把一条 `violation(Subject, Rule)` 还原成**结构化的"为什么"**——而且每条 "because" 都是从**同一个 Prolog 程序**里查出来的事实，绝不臆测：

- `taint-reaches-sink`：用新增的 `tainted_path(Sink, Source, Path)`（cycle-safe）给出 **不可信源 → 数据流链 → 汇** 的完整链，外加内容类型裁决。
- `refinement-not-entailed` / `refinement-vacuous`：直接拎出 ★2 的 **z3 反例**。
- 兜底：报规则名 + 已登记的修复建议（`suggestion/2`）。

`node src/cli.js explain <path>` 打印每条违规的证明树；MCP 工具 `explain` 返回结构化 JSON（供 agent 复用）。

## 四、神经符号的一半：反例驱动修复（generate-and-check）

`src/repair/loop.js` 的 `repairViolations()`：对每条违规，把**证明树 + z3 反例 + 源码片段**（`src/repair/feedback.js` 组装）交给 LLM（`callLLMText`，复用 MCP 采样→API→离线 三级回退），要求回**严格 JSON**：

```jsonc
{"verdict":"false-positive","reason":"…","refinement":"contentType==json"}
{"verdict":"real","reason":"…","patch":{"find":"<源码精确子串>","replace":"<最小修复>"}}
```

**LLM 只是候选，求解器才是裁判**：
- `real`+补丁 → 应用到**临时副本**（绝不就地改源码），重抽取+重校验该文件；**当且仅当**目标规则计数下降**且**总违规数不增（无回归）才接受；否则拒绝，带失败反馈**有界重试**。
- 接受的补丁默认**只读演练**（dry-run），`--apply` 才落盘。

## 五、诚实边界（呼应 §13）

| 情形 | 状态 | 说明 |
|---|---|---|
| 无任何 LLM | `needs-llm` | **绝不**编造补丁；返回证明树 + 修复提示，等人/agent 接力 |
| LLM 判误报 | `false-positive` | 带可判定的 `refinement` 理由 |
| 补丁过了再校验 | `verified` / `applied` | 唯一被接受的"真修复" |
| 补丁没过再校验 | `rejected` | 带 `re-verify` 对比明细 |

★2 的 `unchecked`、★3 的 `needs-llm` 一脉相承：**够不着的，绝不冒充证过的**。

## 六、命令行 / MCP / 测试面

```bash
node src/cli.js verify  ../src/server/routes   # taint XSS ~92 → 少数；并报 "N xss FPs auto-suppressed"
node src/cli.js explain examples/repair         # 真 .innerHTML 汇的证明树
node src/cli.js repair  examples/repair          # 离线 ⇒ needs-llm（提示+证明树）；有 key ⇒ 补丁，已再校验
```

- **MCP 工具**：新增 `explain` + `repair`（共 **15** 个）。`repair` 默认 dry-run，`apply` 显式才写盘。
- **测试**：`test/engines.test.js` 新增 4 个用例——JSON 汇抑制/真汇保留、证明树含源→汇、修复门（analyzer-visible 修复被接受 / 装饰性补丁被拒）、离线 `needs-llm`。
- **新增/改动文件**：`src/verify/explain.js`、`src/repair/{feedback,loop}.js`（新）；`src/extract/taint.js`、`src/rules/taint.pl`、`src/llm/index.js`、`src/cli.js`、`mcp/tools.js`、`src/report/reporter.js`（改）；`examples/repair/handlers.js`（夹具）。

## 七、升级-回滚安全

- `sink_ct/2` 为附加事实 + `:- dynamic`；缺失 ⇒ 旧污点行为。
- `explain`/`repair` 为新命令/新工具，旧路径不动；修复默认 dry-run、`--apply` 才落盘。
- 离线永不产补丁；LLM 产出永远过"重校验"才成结论。
- 实测：`verify`/`query`/`refine` 在 `examples/sample-project` 上的 7 条违规与本档前**逐字一致**。

## 八、下一档

★4 规约忠实度评测（仿 Verus-SpecGym：用"接受合法/拒绝非法"的可执行样例给 LLM 的 `contract`/`refinement` 打忠实分 + 回译 round-trip）——闭环要可信，就得能**度量** LLM 产出的忠实度，否则闭环可能在错误规约上自洽。
