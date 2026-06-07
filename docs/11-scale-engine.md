# ★5 规模引擎：零安装半朴素 Datalog（spec，2026-06-07）

> 状态：**spec（已用真实 profiling + 原型数据论证）**。遵循 `06-frontier-map` §落地约束"动手做 ★X 须单独开 spec、走升级-回滚安全开关"。结论先行：**#5 的答案是一个零安装的纯 JS 半朴素（semi-naive）Datalog 引擎，不是引入原生 Soufflé 二进制**——后者会破坏本项目反复强调的零安装原则，而前者实测已足够（传递闭包 ~3300× 加速）。

## 一、问题：求解是瓶颈，且集中在传递闭包

在真实子系统 `../src/store/services`（145 文件、16978 事实）上分段计时（`lift:none` 隔离）：

| 阶段 | 耗时 | 占比 |
|---|---|---|
| extract（acorn 抽取） | 1395 ms | 15% |
| build（拼 Prolog 程序） | 62 ms | <1% |
| **solve（tau-prolog 求解 `violation/2`）** | **8161 ms** | **85%** |

求解是瓶颈，extract 很快。逐规则再拆（同一程序，单查各派生谓词）：

| 查询 | 耗时 | 备注 |
|---|---|---|
| `dead_code/1` | 5.2 s | 基于 `r_reaches` 闭包 + 否定 |
| `tainted/1` | 5.3 s | `dataflow` 闭包 |
| **`cyclic/1`** | **52.8 s** | `r_reaches(Q,Q)` 近全对闭包——灾难性 |
| `violation/2`（verify 实际用） | 8.9 s | dead_code+tainted 闭包；**不含 cyclic** |
| `reaches(A,B)` 全对 | >90 s（未完成） | all-pairs 闭包，纯压测 |

**根因**：tau-prolog 是纯 JS 的 SLD（反向归结）解释器，对**递归传递闭包**会**重复求解子目标**——`r_reaches` 的 `Visited` 列表 + `member/2` 防环让每条路径都被重走，复杂度爆炸。`cyclic` 把它推到 52 s。这不是 extract 或规则逻辑的问题，是**求解引擎对 Datalog 递归的算法不对**。

## 二、决定性原型：半朴素闭包 16 ms vs tau-prolog 52.7 s

同样的 `rcall/2` 边（845 节点、3059 边），用一个零安装纯 JS **半朴素**传递闭包（`reach[a]` 增量集 + 索引，每条推导只算一次，9 轮迭代收敛）：

| 引擎 | reaches 全闭包(8767 对) + cyclic | 倍率 |
|---|---|---|
| tau-prolog（`cyclic/1`） | 52 751 ms | 1× |
| **半朴素 JS（零依赖）** | **16 ms** | **~3300×** |

半朴素之所以快：**delta 驱动 + 索引**——第 k 轮只用上一轮新增的事实去推新事实（`reach ∪= reach ∘ edges`），不重算已有的；tau-prolog 的 SLD 没有这个记忆，每次查询从头展开。这正是 Datalog（最小不动点 = 半朴素迭代）相对通用 Prolog 的算法优势（`05 §9` PTIME 数据复杂度）。

> 计数校验：原型的 cyclic 数（23）与 tau-prolog（22）有 1 之差——**不是闭包算错**，是口径差：tau-prolog 的 `cyclic(Name) :- decl(Q,_,Name,routine), r_reaches(Q,Q)` 只数 **routine decl** 并投影到 **Name**（去重），原型数了所有 `rcall` 源 QId（含 lambda/extern）。忠实引擎须复制"decl 过滤 + 名字投影 + distinct"才能逐位对齐——见 §四 parity 要求。

## 三、为什么是 JS 半朴素引擎，而不是原生 Soufflé

`06-frontier-map` 把 #5 写作"Soufflé / 增量 Datalog"。但落地要尊重本项目的**第一原则：零安装**（README、npm 包均零原生依赖；"runs with NO API key / zero-install inside this repo"）。原生 Soufflé 是 C++ 二进制：

| 方案 | 加速 | 零安装 | 跨平台 | 复杂度 |
|---|---|---|---|---|
| 原生 Soufflé（Datalog→并行 C++） | 极高（百万事实级） | **❌ 破坏** | 需分发/编译二进制 | 高（外部工具链 + .dl 代码生成） |
| **零安装半朴素 JS 引擎** | 高（实测 3300×，足够当前规模） | **✅ 保持** | 纯 JS 处处可跑 | 中（语义子集 + parity 验证） |

实测 16 ms 的半朴素已把 52 s 的最坏查询打到可忽略——**当前规模根本用不到 Soufflé**。logos 草稿本就带过一个零依赖 Datalog 引擎（当初为 tau-prolog 的表达力放弃，但 tau-prolog 不可规模化）；现在把"语义子集走半朴素、其余留 tau-prolog"两全。Soufflé 留作**真·十亿级**时的可选后端（再单独开 spec）。

## 四、设计：混合——半朴素物化闭包，tau-prolog 收尾

不重写整个引擎，也不碰非 Datalog 规则。**分层**：

- **半朴素层（新，零依赖 `src/verify/datalog.js`）**：只算**纯 Datalog 递归闭包**——`r_reaches`（`rcall` 的 TC）、`tainted`（`source` 经 `dataflow` 的 TC），以及派生的 `dead_code`/`cyclic`/`impact`（在闭包上加 decl 过滤 + 否定，stratified）。半朴素 + 按首参索引。
- **物化注入**：把算好的闭包作为 ground 事实（`r_reaches(a,b).`、`tainted(n).` …）注入程序，并**移除/旁路对应的递归规则**（否则 tau-prolog 会再算一遍）。
- **tau-prolog 层（不变）**：拿物化后的事实跑剩下的非递归裁决（`violation/2`、`html_safe`、refinement、SMT 桥等）和**带列表项的非 Datalog 规则**（`tainted_path/3` 重建证明树路径——它造 `Path` 列表项，超出 Datalog，留给 tau-prolog；explain 才用，不在热路径）。

**开关 + 回滚安全**：`--engine=datalog`（默认 `prolog`）。默认路径**位等价**于现状；开 flag 才走半朴素物化。`watch`/`verify`/MCP 不变。

### Parity 要求（替换引擎的硬约束）
半朴素结果必须与 tau-prolog **逐位一致**，否则是把"快"换成"错"。验证：在所有 `examples/*` + `sample-project` + 真实 `routes`/`auth` 上，两引擎的 `violation/2`、`dead_code`、`cyclic`、`reaches`、`tainted` 结果集必须相等（含 §二 的 decl 过滤 + 名字投影 + distinct 口径）。落地时加一个 parity 测试：同一程序两引擎跑、`assert.deepEqual` 排序后的结果。

## 五、增量维护（watch 模式，第二期）

半朴素天然支持增量：文件改动 → 重抽取该文件 → 边集 delta → 对闭包做 **DRed/半朴素增量**（加边走半朴素正向、删边走 DRed 反向删+重导），而非全量重算。`cache.js`（已按内容缓存抽取）+ `watch.js` 已是接入点。第一期先做全量半朴素（已证 16 ms，够快）；增量留第二期、按真实 watch 体感需要再上。

### 五·一、与 ReBAC 图引擎经验的对接（"这是个图问题"——已查证可复用）
formal-atlas 的 `reaches`/`tainted`/`points-to` 本质都是**图可达/传递闭包**;父项目 `src/store/services/rebac/` 有一套**生产级、对账过**的图引擎,直接对口。查证结论:

| ReBAC 技术（文件） | 是什么 | 对接 formal-atlas |
|---|---|---|
| **`ClosureService`**（`closure.service.js`） | **O(affected) 增量传递闭包**:加边 (u→v) 只插入 **祖先(u) × 后代(v)** 叉积(`addEdge`)、删边走反向(`removeEdge`)、`rebuild` 全量兜底;闭包物化在 `todo_rebac_closure`(带 distance/path)。 | **正是 watch 增量(本节第二期)的算法**。加边:`ancestors=reach⁻¹(u)∪{u}`、`descendants=reach(v)∪{v}`,`reach[a]∪=descendants`;删边:DRed(过删依赖该边的对 → 重导仍有他路支撑的)。把它从 DB 版搬成内存版(配反向索引 `reachedBy`)。 |
| **`csr-generator.js`** / `prediction/prototype/webgpu-csr.js` | **CSR(压缩稀疏行)**:`nodeMap`→连续下标 + 邻接数组,缓存友好、低分配。 | 当前引擎用 `Map<node,Set>`(哈希)。**十亿边**时换 CSR(TypedArray 连续布局)再得常数级提速 + 省内存;当前 17k 事实 33ms,Map 够用。 |
| **`accelerator/{cpu,wasm,webgpu}-impl.js`** | 可插拔 SpMV(稀疏矩阵×向量):闭包 = 布尔矩阵幂迭代到不动点。 | 闭包的**矩阵式**替代算法(GPU/稠密时强);当前 worklist 半朴素已足够,SpMV 留超大/稠密图。 |
| **`indexing/leopard-index.js`** | Leopard 可达性索引(分层/缓存)。 | 反复查"a 能否到 b"的**点查**索引;formal-atlas 目前多是全量枚举,点查需求出现时再上。 |

**对"能否解决 tau-prolog 性能问题"的判定**:**已解决**——`#5` 半朴素引擎(1238×、33ms)与 `ClosureService` **同族**(都弃 naive 重算、走增量/半朴素)。ReBAC 经验的增值在**下一档规模**:① **增量闭包**(`ClosureService` 算法)→ watch 增量;② **CSR/SpMV/Leopard** → 十亿边。按 `04-roadmap` 的"便宜够用就停":当前全量 33ms 够用,故增量/CSR **按 watch 体感 / 真实超大库需要再上**,不预先铺开;但算法已对账、随时可搬。

## 六、范围与非目标

- **是**：纯 Datalog 递归闭包子集的半朴素求值 + 物化；分层与 tau-prolog 共存；flag-gated；parity 验证。
- **非**：不做通用 Prolog 引擎（cut/findall/列表项规则仍归 tau-prolog）；不引原生二进制；不改抽取层与规则语义（只改**怎么求解**，不改**求解什么**）。
- **分层依据**：否定是 stratified（`\+ rcall(_,Q)`、`\+ html_safe`——否定的谓词不依赖被定义谓词），半朴素 + 分层可判定；`tainted_path/3` 这类构造列表项的留 tau-prolog。

## 七、与大前沿序的关系（5 → 7 → 8）

#5 是 **#7（Doop 级 points-to）的前置引擎**——上下文敏感 points-to 的事实爆炸正是半朴素 Datalog 的主场（真 Doop = Datalog points-to on 引擎）。所以 #5 先行：先把求解换成半朴素，#7 的 points-to 规则才有跑得动的底座；#8（ITP 放电）最后。详见 `RESUME.md` 路线判断。

## 八、落地清单（下一增量）
1. ✅ **`src/verify/datalog.js`**（已实现 2026-06-07）：半朴素 TC（`transitiveClosure`/`reachableFrom`）+ stratified 否定 + 首参索引；`evaluate(facts)` 一趟物化 `reaches`/`cyclic`/`deadCode`/`tainted`/`rReaches`。
2. ✅ **`pipeline.js` + `cli.js` 集成**（已落地 2026-06-07）：`--engine=datalog` 时 `extractProject` 调 `materialize(facts)` 注入 `engine_materialized` + `dead_code/2`、`tainted/1` ground facts；`resolved.pl` 的 `dead_code` 与 `taint.pl` 的 `tainted` 规则加 `\+ engine_materialized` 守卫(默认无此 fact ⇒ inert ⇒ 行为 bit-identical;实测全夹具 violation 数与默认一致)。`violation/2` 用物化 facts 收尾。
   **诚实实测**(`store/services`,lift:none 隔离):`violation/2` solve **6378ms → 4296ms(~1.5×)**,parity 294=294。**只 1.5× 不是 1238×**——因 violation/2 成本分散在多条规则,`dead_code`+`tainted` 在其中仅 ~2s(它们各 5s 是**独立全量查询**的代价,非 violation 路径内)。且 CLI 默认 `lift=offline`,离线 AI-lifter 那 ~5s 对两引擎相同、**掩盖**了 solve 加速(verify 总墙钟 12.4s 两者持平;lift:none 时端到端 7.5s→4.5s)。**引擎的 1238× 杀手锏在独立闭包查询**(`cyclic`/`reaches`/`impact`),见 item 5。
3. ✅ **parity 测试**（`test/engines.test.js` ★5）：sample-project + taint-xfile 上 `reaches/cyclic/dead_code/tainted` 两引擎结果集 `deepEqual`。
4. ✅ **真实库实测**（`../src/store/services`，145 文件 / 16978 事实）：

   | 谓词 | tau-prolog | 半朴素引擎 | parity | 加速 |
   |---|---|---|---|---|
   | `cyclic` | 40 866 ms | **33 ms**（一趟算全部闭包） | ✅ 15=15 | **1238×** |
   | `dead_code` | 5 859 ms | （同上 33 ms） | ✅ 160=160 | 178× |
   | `tainted` | 3 631 ms | （同上 33 ms） | ✅ 1=1 | 110× |

   引擎一次 `evaluate` 即 33 ms 算完全部闭包,且与 tau-prolog **逐位一致**。论点证实:零安装半朴素**又对又快**,无需 Soufflé。
5. ✅ **闭包查询路由（已落地 2026-06-07，1238× 的落地处）**：`src/verify/datalog.js` `queryEngine(facts, goal)` 把 `query`/`--engine=datalog` 的纯闭包谓词（`cyclic`/`reaches`/`dead_code`/`tainted`/`impact`，仅全变量 goal）直接由引擎应答、绕开 tau-prolog；不支持/带绑定的 goal 返回 null 回退 tau-prolog。`evaluate` 增 `impact`(node×routine-decl×r_reaches)。**实测**:`query --engine=datalog "cyclic(N)." ../src/store/services` **52s → 1.8s 端到端**(引擎计算本身 ~33ms,余为抽取),15 解、标注 `[semi-naive engine]`;cyclic/reaches/impact/dead_code 在 sample-project 上默认 vs datalog **逐位一致**。parity 测试(★5)覆盖 5 个谓词。
