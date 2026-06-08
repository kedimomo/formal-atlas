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

## 五、与 MCP sampling 的关系（关键）
**MCP sampling 给不了 prover**。sampling 给的是 **LLM**——LLM 可以帮**写** Dafny 标注/不变式（autoformalization），但**证明必须 prover 的内核检**。神经符号闭环：**LLM（经 IDE sampling）写标注 → prover 放电 → 过了才算证明**；不过则把 prover 的错喂回 LLM 重写（同 ★3 repair 的 generate-and-check）。但 **prover 二进制仍需安装**（或经一个包装 prover 的 MCP 工具间接调用）——这是与"LLM 可用性"正交的外部依赖。

## 六、范围与非目标
- **是**：把已诚实标 `unchecked` 的义务真正放电；可判定档继续走 z3（不退化）；flag-gated、parity。
- **非**：不自带 prover 二进制（破坏零安装）；不在 prover 缺席时假装证明；不追全自动证明所有性质（不可判定，靠标注 + 交互）。
- **数学依据**：`05 §10` λ-立方体顶点（依赖类型/全功能正确性）；z3=可判定角，ITP=最强角。
