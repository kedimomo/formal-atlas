# ★2 精化类型层（Refinement Types）— 把契约从"需人看的自然语言"升级为"机器判定的谓词"

> 落地于 2026-06-07。对应数学依据 [`05-math-deepening.md §11`](./05-math-deepening.md)（Liquid Types）、`§10`（λ-立方体的可判定角）、`§8`（安全性质 = Π⁰₁ 的可判定子片段）。
> 这是 [`06-frontier-map.md`](./06-frontier-map.md) 优先级主线的 **★2**——"价值×可行性×复用现有资产"评分最高的一档。

## 一、为什么是这一档

formal-atlas 原本从 **Datalog（可判定结构，§9）** 一步跳到 **`contract/3` → SMT/Dafny 骨架**，再远眺 **ITP**。中间被跳过的，正是数学上极合身、且**能自动化**的台阶——**精化类型**：

```
{ v : T | φ(v) }      —— 类型 T 中所有满足谓词 φ 的值
```

关键在于 **φ 取自一个可判定的 SMT 理论**。本层把 φ 限定在 **QF-LIA（线性整数算术）**——Liquid Types 的甜区——于是"前置是否保证后置"这件事**可判定、可自动、sound 且不漏报**（落在 §8 的 Π⁰₁ 安全区的可判定子片段）。

它修的是一个真问题：原来的 `precondition(R, '自然语言')` / `postcondition(R, '自然语言')` 是 **NL 字符串，需人复核、机器判不了**。精化谓词 `refinement(R, amount, 'amount > 0', pre)` 是**可形式化、z3 可判定**的。

## 二、形式事实 schema

```prolog
refinement(Routine, Var, 'φ', pre).    % 参数 Var 进入时必须满足的约束
refinement(Routine, Var, 'φ', post).   % 返回值（保留变量 ret）在前置成立下满足的约束
```

φ 的文法复用 `src/verify/smt-dsl.js`：`+ - *`、比较 `< <= > >= == !=`、布尔 `&& || ! ->`、整数字面量、变量。

## 三、判定内核：零重写，复用 `checkContract`

核心洞见：**"φ_pre ⇒ φ_post" 就是一个 Hoare 蕴含**，而 `smt-bridge.js` 的 `checkContract` 已经在做它——检查 `pre ∧ ¬post` 是否 UNSAT（UNSAT ⇒ 蕴含成立；SAT ⇒ 给出反例输入）。所以本层**不新增任何求解器逻辑**，只做四件事（`src/verify/refinement-check.js`）：

1. 把 `refinement/4` 事实按 routine 归组成一份 `checkContract` 规约；
2. 把每个变量类型化为整数（QF-LIA）；
3. 调 `checkContract`；
4. 把裁决**降维回 Prolog 事实**，喂给 `src/rules/refinement.pl`，在**同一个事实库**上和结构层/污点层一起触发 `violation/2`。

## 四、四种裁决 —— 以及一条诚实的边界

| 裁决 | 含义 | 是否 `violation` |
|---|---|---|
| `entailed` / `ok` | 前置蕴含后置（z3 证明 `pre ∧ ¬post` UNSAT） | 否（健康） |
| `broken` | 前置**不**保证后置，z3 给出**具体反例输入** | ✅ `refinement-not-entailed` |
| `vacuous` | 前置自相矛盾（UNSAT）——契约永不可满足 | ✅ `refinement-vacuous` |
| `unchecked` | 有后置但**无前置**——契约层判不了，需函数体逐路径 VC | ❌ **不报违规** |

**`unchecked` 是这套设计的诚实底线（呼应 §13）**：契约层只能判 `φ_pre ⇒ φ_post` 这个**逻辑蕴含**。要证明"**函数体**确实建立了后置"，需要逐路径生成验证条件（VC）——那是 Dafny/Verus 的活，是路线图 **★8**。我们**绝不**把"够不着的"标成"证过的"——一个只有后置、没有前置的精化，只作为**假设**报告，不冒充定论。LLM 在线提升器产出的也只是**事实**，必须先过这个 z3 才成结论（generate-and-check）。

## 五、命令行 / MCP / 测试面

```bash
# 1) 纯规约判定（无需 API key，完全确定性）——最直观的演示
node src/cli.js smt refinement examples/refinement/bank.refine.json
#   ✅ transfer: entailed      (balance>=amount ⊨ balance-amount>=0)
#   ❌ withdraw: broken        (amount>0 ⊭ amount>100; 反例 amount=1)
#   ❌ badspec:  vacuous       (x>0 ∧ x<0 UNSAT)
#   ○  getCount: unchecked     (只有后置，需 ★8 函数体 VC)

# 2) 指向任意项目：抽取代码 → 提升精化 → z3 判定
node src/cli.js refine <path> [--online]
```

- **MCP 工具 `refine`**（第 13 个工具）：任意 LLM agent 可把"精化判定"当工具调用，返回 `{count, tally, refinements}`。
- **测试**：`test/engines.test.js` 新增 5 个用例（entailed / broken+反例 / vacuous / unchecked / 事实降维），与既有 5 个引擎用例一并 10/10 通过。

## 六、升级-回滚安全

- 走 `extractProject` 的 `formalize` 开关（默认 `off`）；`verify`/`query` 旧路径**完全不动**。
- `rules/refinement.pl` 用 `:- dynamic` 声明裁决谓词：规则文件总是加载，但裁决事实只在 `refine` 跑过后才存在——没跑时 `verify` 不受影响、不报"未知谓词"错（已实测：sample-project 的 7 条违规与加本层前**逐字一致**）。

## 七、它如何接续任务①暴露的误报问题（通往 ★3）

任务①扫 `src/server/routes` 报了 **92 条 "XSS"**，实读确认绝大多数是误报（Fastify 返回 JSON，`reply.send(obj)` 不是 HTML 汇）。精化层给出的解法范式是：把"响应"建模成带精化的值——`{ v : Response | contentType(v) == json }`——**可判定地证明它不是 HTML 汇**，从而系统性压掉这一类误报。本层先把这套"可判定谓词 + z3 判定"的机器搭好；把它接到污点汇的抑制、并把 z3 反例/Prolog 证明树**喂回 LLM 做反例驱动修复**，是下一档 **★3 闭环自愈**。
