# ★8 ITP 放电：把证明义务交给定理证明器（spec，2026-06-08）

> 接 `docs/06-frontier-map` #8、`05 §10`（λ-立方体顶点）。formal-atlas 已用**内置 z3** 放电**可判定**的证明义务（★2 精化、契约蕴含、RBAC SoD——`smt-bridge.js`）。本档把 z3 **够不着**的义务（循环不变式的归纳、量词、堆、完整函数正确性、终止性）交给**程序验证器 / ITP**（Dafny/Verus/Lean）拿到机器证明。

## 一、定理证明器是什么（两类）
- **SMT 求解器**（z3，**已内置**）：判定可判定理论（线性算术 QF-LIA、数组、位向量、未解释函数）的可满足性。**全自动**，但限可判定片段；对"一个公式"问 `pre ∧ ¬post UNSAT?`。
- **程序验证器 / ITP**：
  - **Dafny / Verus**（auto-active）：你标注 `requires`/`ensures`/`invariant`，它**生成 VC（验证条件）**并在底层喂 z3，但额外处理**循环（靠不变式做归纳）、量词、堆别名、终止性**——这些 z3-单公式做不到。Verus 验 Rust；Dafny 自带语言。
  - **Lean / Coq / Isabelle**（交互式 ITP）：你写 tactic 证明，**内核检查**。最表达、最手动。

## 二、formal-atlas 今天 vs #8 的差距
今天 `smt-bridge.js` 把契约 lift 成**一个** QF-LIA 公式问 z3。直线、可判定谓词够用（你能现场看到 `entailed: true` / 反例 `balance=0, amount=1`）。**证不了**"这循环维持这不变式""这递归函数返回有序表"——那要**对控制流做 VC-gen + 归纳**的验证器。**`cli.js` 里 `unchecked` 档已显式标注"need body-level VC, ★8"**——这就是缺口。

## 三、已有一半：`toDafny(spec)` 已存在
`smt-bridge.js` 已 `export toDafny(spec)`，`cli.js smt dafny <spec.json>` 已能从 spec **生成 Dafny 代码骨架**。所以 **VC-生成那一半就位**；#8 = 补**放电**那一半（装 prover、跑、解析）。

## 四、落地（新子目录 `src/verify/itp/`，flag-gated）
1. **`itp/vcgen.js`**：扩展 `toDafny`——从 `contract/3`、`refinement/4`、Hoare `pre/post`、循环 `invariant` facts 生成**完整可验证单元**（`method` + `requires`/`ensures`/`invariant` + 提升的 body，或 `assume`-havoc 模型）。多后端时也出 Verus(Rust)/Lean 形态。
2. **`itp/discharge.js`**：`spawn` prover CLI（`dafny verify f.dfy` / `verus f.rs` / `lean f.lean`），捕获 exit code + stdout，解析 `verified` / `N errors` / counterexample。超时 + 防注入（写临时文件、不拼用户串）。
3. **`itp/index.js`**：判定降回 fact——`proved(Routine, Property)` 或 `violation(Routine, 'contract-unproven')` + prover 反例。**generate-and-check 不破**：prover 是"check"，没它的机器 OK **绝不**声称 proved。
4. **诚实降级**：`which dafny` 探测；prover 没装（如本机：dafny/verus/lean 皆 absent）→ `needs-prover`（仿 `needs-llm`），**绝不假证**。
5. **CLI `prove <path>` + MCP `prove` 工具**，默认关、opt-in、parity-safe。

## 五·一、必须引入 Dafny/Lean 吗？——不必。"数学自己建框架"的三档
**结论:中间一大档可以零外部、用已内置的 z3 自建,Dafny/Lean 只在最顶档才需要。**

| 档 | 性质范围 | 怎么证 | 要外部吗 |
|---|---|---|---|
| **A 可判定** | QF-LIA、数组、位向量、无量词 | **已内置 z3**（★2/契约,现成） | ❌ 零外部 |
| **B 自建 VCgen + z3**（**本就该先做这档**） | **带不变式的循环、有界量词、简单堆** | **自己写验证条件生成器**,把"循环不变式""前后置"编码成 z3 查询——**这正是 Dafny 内部干的事（Dafny = VCgen + z3）**。z3 本身支持量词实例化,所以自建 VCgen 能覆盖远超直线 QF-LIA | ❌ **零外部**(复用已装 z3) |
| **C 顶档** | 无界归纳、高阶逻辑、完整函数正确性、终止性证明 | 需**可信内核**（Lean/Coq/Isabelle）或 Dafny/Verus | ✅ 外部 |

**B 档怎么自建（无 Dafny）**:对一个带不变式 `I` 的循环,发**三条 z3 查询**——① `I` 入口成立;② `I ∧ guard ⇒ I'`（体执行后保持,归纳步）;③ `I ∧ ¬guard ⇒ post`。z3 逐条放电。**这就是"用数学自己建框架":VCgen 是纯逻辑构造,z3 已在手,不引 Dafny。** `itp/vcgen.js` 先做这档(把 `★8 unchecked` 里能 invariant 化的提上来),`toDafny` 的逻辑大半可复用成"toZ3-VC"。

**为什么顶档 C 仍劝用外部、不自建内核**:不是"建不出",是**信任本身就是产品**。证明器的**内核**（De Bruijn 判准:小到可独立复核、被数学界审过）是它的皇冠;**自己写内核,一旦有 bug 就"证出"假定理——比不证更糟（假信心）**。Lean/Coq 内核花了数十年挣得信任。所以顶档**借**外部内核;自建只到 B 档（VCgen+z3,z3 的内核已被信任）。

**修订后的 stage-2 刀法**:**刀1 = B 档自建 VCgen + 内置 z3（零外部,先做,覆盖循环不变式/有界量词）**；刀2（可选）= C 档接外部 ITP，只补 z3 真够不着的顶档。这样**零安装坚持得更久**,且直接落实"数学自建框架"。

## 五·二、与 MCP sampling 的关系（关键）
**MCP sampling 给不了 prover**。sampling 给的是 **LLM**——LLM 可以帮**写**不变式/标注（autoformalization），但**证明必须求解器/内核检**。神经符号闭环:**IDE 的 AI（经 sampling）写不变式 → z3(B 档)或外部 ITP(C 档)放电 → 过了才算证明**;不过把错喂回 LLM 重写（同 ★3 repair）。注意:**B 档的 z3 已内置——LLM 写不变式 + z3 放电,可全程零外部**;只有 C 档才需外部内核。

## 六、范围与非目标
- **是**：把已诚实标 `unchecked` 的义务真正放电；可判定档继续走 z3（不退化）；flag-gated、parity。
- **非**：不自带 prover 二进制（破坏零安装）；不在 prover 缺席时假装证明；不追全自动证明所有性质（不可判定，靠标注 + 交互）。
- **数学依据**：`05 §10` λ-立方体顶点（依赖类型/全功能正确性）；z3=可判定角，ITP=最强角。
