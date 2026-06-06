# formal-atlas 愿景：把"形式化"从规则层下沉到全代码层

## 起点：FDRS 已经证明了一件事

你的仓库里已有 **FDRS**（Feedback-Driven Rule Synthesis）。它做的事在数学上很漂亮：

```
.trae/rules/*.md (人类规则)
      │  assertion (JSON)
      ▼
assertion-to-prolog.js  →  violation(File, RuleId) :- fact(File, contains_loop, N), N>1000, ...
      │
regex-fact-extractor.js  →  fact('src/x.js', contains_loop, 50000).
      ▼
tau-prolog (prolog-check.js)  →  查询 violation(File, Rule)
```

这已经是一个**真跑的神经符号系统**：规则被编译成 Horn 子句，事实被抽取成 Prolog 事实，`tau-prolog` 做归结判定。**它证明了"用逻辑引擎校验代码"这条路是通的。**

## 但 FDRS 的形式化是"浅"的

它的事实是**整文件级的布尔/数值标志**，用正则抽取：

```prolog
fact('src/x.js', contains_loop, 50000).      % 这个文件"含"循环
fact('src/x.js', uses_hardcoded_id).          % 这个文件"含"硬编码
```

规则是**单层、无递归**的 `violation(File, Id) :- 一堆 fact 的合取`。本质上是**"用 Prolog 语法写的 linter"**——它没有：
- 实体之间的**关系**（谁调用谁、谁依赖谁）；
- **递归 / 传递闭包**（A→B→C 是否可达）；
- **跨文件的全局推理**（整个调用图上的死代码、环、影响面）。

## formal-atlas 的飞跃：把代码本身变成模型

> 不再只问"这个**文件**含不含某个特征"，而是把**整个代码库**抽象成一个**有限一阶关系结构**（一张逻辑地图），然后在它上面问**任意逻辑问题**。

```prolog
% 深形式化：实体 + 关系，可递归
defines('server.js', handleRequest, routine, 5).
calls(handleRequest, validateUser).
calls(handleRequest, dbQuery).
calls(dbQuery, getConnection).

reaches(A, B) :- calls(A, B).
reaches(A, B) :- calls(A, M), \+ member(M, V), reaches(M, B).   % 传递闭包

dead_code(F, N) :- defines(F, N, routine, _), \+ calls(_, N), \+ entry_point(N).
```

于是这些**原来 linter 做不到**的问题，都变成一行查询：
- `reaches(handleRequest, dbQuery).` —— 可达性（**带证明**：负结果是"穷举证明不可达"）
- `dead_code(F, N).` —— 全局死代码（不是"我扫了几个文件没找到调用方"，是求解器给的定论）
- `cyclic(N).` —— 自递归 / 循环依赖
- `impact(target, Caller).` —— 改一个函数会影响谁（影响面分析）
- `intent(N, read), side_effect(N, database).` —— **跨层**：名字像"读"但实际写库（语义矛盾）

## 三个设计承诺

1. **针对所有项目**：独立子项目，自带依赖，CLI 指向**任意目录**即可（不限于本仓库、不限语言）。
2. **离线可跑、在线更强**：无 API Key 时用确定性启发式做语义提升；有 Key 时用 LLM 做 autoformalization。两条路输出**同一种**形式事实，下游求解器无感。
3. **诚实的形式化**：明确区分"**可判定且 sound 的结构性质**"（Datalog 直接给真值）与"**启发式语义**"（LLM 提取、需复核、用求解器把关）。见 [数学基础 §6](./01-math-foundations.md#6-诚实的边界rice-定理)。

## 与 FDRS 的关系：不是替代，是下沉与回流

```
        FDRS (规则层形式化)                 formal-atlas (全代码层形式化)
   人类规则 → assertion → Prolog      代码 → 关系事实库 → Prolog/Datalog
        ↑                                        │
        └──────── 回流：新规则可直接写成 violation/2 over 深事实库 ────────┘
```

formal-atlas 的 `governance.pl` 已经演示了把 FDRS 六支柱风格的规则，重写成**基于深事实库**的 `violation/2`——比正则版**更精确**（例如 `crypto-in-loop` 现在是"循环作用域内确有加密调用"，而非"文件里同时出现循环和加密关键字"）。长期目标：让 FDRS 的规则演化引擎以 formal-atlas 的事实库为底座。

> 落地细节见 [`02-architecture.md`](./02-architecture.md)；推进路线见 [`04-roadmap.md`](./04-roadmap.md)。
