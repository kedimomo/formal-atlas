# ★4 规约忠实度评测（Spec Faithfulness）— 闭环不能在错误规约上自洽

> 落地于 2026-06-07。承接 [`08-closed-loop.md §八`](./08-closed-loop.md)：★3 让闭环会自愈，但闭环要**可信**就得能度量 LLM 产出规约的忠实度。
> 数学依据 [`05-math-deepening.md §13`](./05-math-deepening.md)（忠实度无法证明、只能**证伪**）；工程参照 **Verus-SpecGym**。这是 [`06-frontier-map.md`](./06-frontier-map.md) 主线的 **★4**。

## 一、为什么是这一档

★2 让规约**机器可判定**，★3 让闭环**会自愈**。但一个闭环可能在**错误的规约**上自洽——LLM 生成一条又弱又自洽的契约（极端是 `true`），★3 校验"通过"，于是系统对一个毫无约束力的规约信心满满。这正是 §13 的核心警告：**忠实度（规约是否符合意图）无法证明，只能证伪**。

★4 用 Verus-SpecGym 的纪律证伪它——拿**带标签的可执行样例**考规约：

```
legal 样例（应满足）  → 忠实的规约必须 ACCEPT
illegal 样例（应违反）→ 忠实的规约必须 REJECT
```

## 二、判定：可判定、零 LLM、零求解器

`accept(point) := 所有前置 ∧ 所有后置在 point 上都成立`。因为谓词是 **QF-LIA**，在一个**具体整数点**上求值是纯算术——`src/verify/smt-dsl.js` 新增的 `evalExpr(ast, env)` 直接算，**不需要 z3、不需要 LLM**（呼应"可判定优先"）。打分循环里没有神经侧。

`src/verify/faithfulness.js` 的 `scoreFaithfulness(spec, samples)`：

| 指标 | 含义 |
|---|---|
| `recall` | legal 样例被接受的比例（应为 1） |
| `specificity` | illegal 样例被拒绝的比例（应为 1） |
| `mode` | `faithful` / `too-weak` / `too-strong` / `inconsistent` |

**它抓的两类不忠实：**
- **too-weak**：接受了某个 illegal 样例（`true` 这种空泛规约把它最大化）——闭环最危险的盲区。
- **too-strong**：拒绝了某个 legal 样例（自相矛盾的规约把它最大化，★2 的 `vacuous` 已能逮前置矛盾）。

`overAccepted` / `overRejected` 直接给出**反例样例点**，可喂回 ★3 闭环改规约。

## 三、回译 round-trip（LLM 生成，z3 当裁判）

`roundTrip(spec, {online})`：让 LLM 把规约**复述成自然语言、再形式化回谓词**，然后用 `equiv()` 检查回译谓词与原谓词**逻辑等价**——不等价说明规约有歧义/丢信息（drifted）。`equiv(vars, φA, φB)` 复用 `checkContract` **双向**判定（φA⇒φB 且 φB⇒φA），是纯 z3、可判定。LLM 只产复述/再形式化，**z3 才是裁判**；离线 ⇒ `needs-llm`，绝不臆断。

## 四、命令行 / MCP / 测试面

```bash
node src/cli.js smt faithfulness examples/faithfulness/abs.faithful.json
#   ✅ abs: faithful  (score 100%, recall 100%, specificity 100%, 6 samples)
#      round-trip vs "(ret >= 0) && (x >= 0 -> ret == x) && (x < 0 -> ret == -x)": ✅ equivalent
node src/cli.js smt faithfulness examples/faithfulness/too-weak.json
#   ❌ abs-too-weak: too-weak  → 接受了 abs(5)=4 这类 illegal 样例
node src/cli.js smt faithfulness examples/faithfulness/too-strong.json
#   ❌ abs-too-strong: too-strong → 拒绝了 abs(-7)=7 这个 legal 样例
```

`spec.json`：`{ name, vars, pre[], post[], samples:[{label:"legal"|"illegal", point:{var:val}}], equivalent? }`（`equivalent` 选填，触发 z3 round-trip 等价检查）。

- **MCP 工具 `faithfulness`**（第 **16** 个）：传 `{vars, pre, post, samples}` 回 `{faithful, mode, recall, specificity, overAccepted, overRejected}`。
- **测试**：`test/engines.test.js` 新增 5 个（evalExpr 求值、faithful、too-weak、too-strong、z3 等价/反例）；engines 19、`npm test` 全绿（9 smoke + 19 engines + MCP 16 工具自检）。

## 五、升级-回滚安全 & 诚实边界

- 纯新增：`evalExpr`（smt-dsl）、`faithfulness.js`、`smt faithfulness` 子命令、`faithfulness` MCP 工具、example 三份。旧路径不动。
- 打分**离线确定性**（无 LLM）；round-trip 离线 ⇒ `needs-llm`，从不臆断"忠实"。
- 诚实边界：忠实度**只证伪不证明**——`faithful` 表示"在给定样例上**未被证伪**"，不是"绝对忠实"。样例越强，结论越可信；这与 ★2 `unchecked`、★3 `needs-llm` 同一条诚实主线。

## 六、它如何收口 ★1–★4 这条主线

★1 数学地基 → ★2 让规约**可判定** → ★3 让系统**会解释、会自愈** → ★4 让自愈所依赖的**规约可信**（证伪式度量）。四档合起来：一个**可判定、会解释、能自愈、且对自己产出的规约保持怀疑**的神经符号引擎。下一程（`06-frontier-map` 5–8）按真实规模/严谨度需求启动：Soufflé 增量 Datalog（规模）、IFDS 过程间污点（精度）、全 ITP 放电（地平线）。
