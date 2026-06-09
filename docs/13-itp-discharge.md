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

**✅ 刀1 已落地（2026-06-09，B 档 自建 VCgen + 内置 z3，零外部）**:`src/verify/itp/vcgen.js`（`loopVCs(spec)` **纯逻辑**构造三 VC，无求解器——"框架自建"那一半；`toDafnyLoop` 把同一 spec 出 Dafny 骨架，为 C 档备好 VC-gen 输入）+ `src/verify/itp/prove.js`（`proveLoop` 放电 + `runProveFile` CLI 薄入口）。**关键复用:每条 VC = 一次 UNSAT 检查**,正是 `checkContract` 的形状——① `pre ⇒ inv`、③ `inv ∧ ¬guard ⇒ post` 直接复用 `checkContract`;② 归纳步 `inv ∧ guard ∧ x'=body(x) ⇒ inv'` 用 smt-bridge 新增的 **`checkInductive`**（带撇号 `'` 的原状态变量编码转移关系 + frame;`'` 在 DSL 标识符 `[A-Za-z_]\w*` 里非法,故 next-state 常量绝不与用户变量撞名）。`proved` 当且仅当三 VC 全 entailed 且无 vacuous（前件 UNSAT 按精化层同例判 ❌,不充假证）。CLI `prove <loop-spec.json>`（薄委派给 `runProveFile`,raw 项目路径**诚实拒绝**——从代码 lift 不变式见 §五·二,未接,绝不假装）。夹具 `examples/itp/`:`sum-bound.loop.json`（耦合不变式 `sum==i` **真证功能后置** `sum==n`,三 VC 全过→PROVED）、`noninductive.loop.json`（`sum<=i` 入口成立但体内 `sum+=2,i+=1` 不保持→**step VC 被 z3 反例 `i=0,sum=0` 驳回**,generate-and-check 拒绝假证）。2 测试（engines **40→42** 全绿）。**parity = 纯增量**:新命令分支 + 新 `itp/` 子目录 + 一个 smt-bridge 新 export,**不改任何既有路径**→ `verify examples/sample-project` 仍 7、`refine` 仍标 `getCount: unchecked`、40 既有测试全保。**直接闭合 `refine` 诚实标的 `unchecked`（"post 无 pre→需 body-level VC, ★8"）缺口**:循环体 + 不变式正是那条 body-level VC,z3 把它从假设升为机器证明。`src/verify/` 仍 8 文件（`itp/`/`pointsto/` 为子目录,不计入),`cli.js` 委派化只 +7 行。**余**:① **✅ MCP `prove` 工具已落地（2026-06-09）**——第 17 工具,`invariant` 给定走 `proveLoop` 放电、缺省走 `synthesizeInvariant`（**经 MCP sampling 让 IDE 自己的 LLM 提议不变式 → z3 验**,§五·二闭环经 MCP 跑通）;`test-mcp.js` 自检扮演 IDE LLM 回 sampling、断言 proved（端到端）。提交时用 `git stash` 隔离 `mcp/tools.js` 上无关未提交改动,故 commit 干净（WIP 已 pop 回工作树,仍未提交）;② C 档 刀2（外部 ITP,仅顶档无界归纳/全功能正确性）按需;③ **从 raw 源 sound 抽取 loop 骨架**（vars/pre/guard/body/post）使 `prove`/合成作用于真实代码——soundness 敏感,留待后续。

## 五·二、与 MCP sampling 的关系（关键）
**MCP sampling 给不了 prover**。sampling 给的是 **LLM**——LLM 可以帮**写**不变式/标注（autoformalization），但**证明必须求解器/内核检**。神经符号闭环:**IDE 的 AI（经 sampling）写不变式 → z3(B 档)或外部 ITP(C 档)放电 → 过了才算证明**;不过把错喂回 LLM 重写（同 ★3 repair）。注意:**B 档的 z3 已内置——LLM 写不变式 + z3 放电,可全程零外部**;只有 C 档才需外部内核。

**✅ autoformalization 续刀已落地（2026-06-09，invariant synthesis = LLM 提议 + z3 处置，零外部）**:`src/verify/itp/synth.js` 的 `synthesizeInvariant(spec)`——给一个**缺 `invariant` 的** loop Hoare-spec（vars/pre/guard/body/post），① `hasLLM()` 关→ `needs-llm` + 结构化 prompt（**离线绝不臆造不变式**,与 ★3 repair 同诚实边界）;② 在线→ `callLLMText`（复用 ★3 同一 MCP-sampling/Anthropic/OpenAI 传输）拿候选不变式 JSON → `parseInvariantResponse` 解析 → **`proveLoop({...spec, invariant})` 用内置 z3 逐条放电（generate-and-check）**——三 VC 全过才 `proved`;③ 失败把**失败的那条 VC + z3 反例**喂回 LLM,有界 `attempts` 轮精化（"提议→反驳→再提议"的闭环,同 repairReal）。`prove <spec.json>` 在 spec **无 `invariant` 键**时自动走合成（动态 import `synth.js`,避免与 `prove.js` 成静态环）。**诚实分工**:loop spec 仍假定为代码的忠实转写（从 raw 源 lift spec 骨架——结构化 body/guard 抽取——soundness 敏感,仍**留待后续**,见 §四 / RESUME);此刀被检的产物是**不变式**——z3 保证它对**给定 spec** 归纳且证后置,创造性那步（发明不变式）被机器核验。夹具 `examples/itp/sum-bound.synth.json`（同 sum-bound 但删 `invariant` 键 → 触发合成;期望 z3 找到 `0<=i && i<=n && sum==i`;离线 `needs-llm`）。2 测试（offline 边界 + generate-and-check 门:好候选放行/非归纳候选被 z3 拒,engines **42→44**）。parity:纯增量,opt-in（仅当 invariant 缺失触发）,with-invariant 放电路径不变。**这把 §五·二 的神经符号闭环从理念落成可跑代码**:`prove` 不再只吃带不变式的手写 spec,而能在有 LLM 时**自己合成并机器验证**不变式。

**✅ autoformalization "前半"——从代码 lift loop-spec 已落地（2026-06-10，迭代器界安全，零外部、零 LLM）**:`src/extract/loop/counter.js` 的 `extractLoopSpecs(fileId, code)` 用 acorn 从**真实代码**抽取循环 Hoare-spec,使 `prove <file.js | dir>` 直接作用于项目（不再只手写 spec）。**soundness 是这刀的全部**——误读循环会让 z3 "证"出不存在的代码（假信心,比不证更糟）,故识别器**极保守**:只认规范的**单位步长**升序计数循环 `for(let i=INIT; i</<= BOUND; i++|i+=1|i=i+1)`,**BOUND 可为整数字面量、标识符、或非计算成员 `arr.length`**（数组迭代——最常见真实形态）。约束:**循环体内**（含闭包任意深度）**不得**重赋 counter 或标识符 bound;**当 bound 为 `arr.length`** 时**不得**变异 `arr`（重赋、写成员/元素 `arr.x=`/`arr[x]=`、调方法 `arr.f()`——都会改 length）;**不得**含 break/continue/return/throw（直接层）、**不得**有嵌套循环;调用/条件/**数组读 `arr[i]`**/对他变量赋值允许（不改整数 counter 或未变异的 length）。任何不匹配→**发 NOTHING（跳过,绝不猜）**。证的性质=**迭代器界安全**:自带不变式 `INIT<=i<=BOUND`（机械已知,故**离线放电、无需 LLM**）,z3 证 counter 不越界;off-by-one（`i<=n` 或 `i<=arr.length` 读 `arr[arr.length]`）令不变式非归纳→ z3 **反例驳回**（真实越界发现,空数组反例 `i=0,arr_length=0`）。**步长精度抉择**:v1 只认 step=1——step>1 时 `i<=BOUND` 在最后一跳机械为假（i 到 BOUND+1）**即使代码安全**,会误报;故跨步循环**跳过**（要有用需 per-access OOB 义务,后续）。`runProveFile` 按 target 路由:`.json`→spec 模式、`.js`/目录→code 模式（`walkFiles` + 抽取 + 逐 spec `proveLoop`）。夹具 `examples/itp/loops.js`（safe `i<n`/`i<arr.length` 证 ✅ / off-by-one `i<=n`/`i<=arr.length` 驳 ❌ / counter 重赋 + break + `arr.push` 变异界三个**跳过**）+ 1 测试（engines **44→45**）。**真实库实测**:`prove ../src/store/services/rebac` lift **14 个计数循环**（CSR/SpMV/Merkle 计算核心 + `arr.length` 迭代）**全 14 证迭代器界安全、0 误报、离线**;**精度验证**:merkle-tree 的 `for(i=0;i<layer.length;i+=2)` step-2 循环被**正确跳过**（其体内 `i+1<length ? layer[i+1] : left` 已守界、代码安全,step>1 的界报会是假阳——跳过守住"误报 0"）;`prove ../src/server/workers` 诚实报 **0 可建模循环**。parity:纯增量,新 `extract/loop/` 子目录 + code 模式新分支,`.json` spec 模式/verify/refine/合成全不变（`verify sample-project` 仍 7、既有 44 测试全保）。**范围(v1 故意窄)**:仅升序单位步长整数 for 循环（标识符或 `.length` 界）;降序、while、step>1 的 per-access OOB 义务、注解驱动的功能后置=后续。

## 六、范围与非目标
- **是**：把已诚实标 `unchecked` 的义务真正放电；可判定档继续走 z3（不退化）；flag-gated、parity。
- **非**：不自带 prover 二进制（破坏零安装）；不在 prover 缺席时假装证明；不追全自动证明所有性质（不可判定，靠标注 + 交互）。
- **数学依据**：`05 §10` λ-立方体顶点（依赖类型/全功能正确性）；z3=可判定角，ITP=最强角。
