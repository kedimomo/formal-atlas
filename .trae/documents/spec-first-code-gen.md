# Spec-First Code Generation — 先转形式化表达再写代码

## 核心思路

```
当前流程: NL → 代码 → verify → 违规 → 修复 → 代码 → verify → ...
问题:     模型不知道"干净代码长什么样"，只能试错

改进流程: NL → 形式化规约 → 代码 → verify（规约作为约束）
优势:     规约告诉模型"不能做什么"，从源头避免违规
```

## 对比

| | 当前（Code-First） | 改进（Spec-First） |
|---|---|---|
| 模型做的事 | 从 NL 直接生成代码 | 先生成规约，再生成代码 |
| 违规修复 | 猜怎么改 | 规约直接告诉代码边界 |
| 8B 模型难点 | 理解"intent-effect-mismatch 怎么修" | 只需要"按规约写代码" |

## Spec-First 两步走

### Step 1: NL → 形式化规约

```
输入: "Write a function that hashes multiple passwords using crypto.createHash"
输出:
  intent(hashPasswords, compute).
  has_side_effect(hashPasswords, crypto).  ← 明确标注有 crypto
  not(is_loop(hashPasswords)).             ← 明确要求无循环
  exports(hashPasswords, hashPasswords).
```

规约用 Prolog 事实表达，formal-atlas 原生支持。

### Step 2: 规约 → 代码

```
输入: 规约（上面那段）+ "实现 hashPasswords"
输出: 
  const crypto = require('crypto');
  function hashPasswords(passwords) {
    const hash = crypto.createHash('sha256');
    for (const p of passwords) hash.update(p);
    return hash.digest('hex');
  }
```

注意：因为规约说了 `not(is_loop)`，模型被约束不能写 `passwords.map(p => crypto.createHash(...))`。

## 规约模板 — 8 条约束

| 规则 | Prolog 事实 | 含义 |
|------|-----------|------|
| 命名/意图 | `intent(Fn, read\|write\|compute\|validate)` | 函数该做的事 |
| 副作用声明 | `has_side_effect(Fn, none\|network\|filesystem\|crypto\|db)` | 函数能做的事 |
| 禁止循环 | `not(is_loop(Fn))` | 不能有循环（防 crypto-in-loop / await-in-loop） |
| 禁止硬编码 | `is_const_only(Fn)` | 所有值来自参数/env |
| 必须被调用 | `has_caller(Fn, _)` | 不能是死代码 |
| 网络调用 OK | `expects_external_call(Fn)` | 明确允许外部调用 |
| 输污点入 | `taint_source(Var)` | 标注用户可控变量 |
| 断言 | `ensures(Fn, "result.length === input.length")` | 后置条件 |

## 为什么这个对 8B 模型可能更友好

1. **规约比代码简单** — 10 行 Prolog 事实 vs 可能 50 行 JS 代码
2. **规约是结构化约束** — 明确的"不能/只能"比模糊的"修复 violation"更容易遵循
3. **规约可以自检** — 生成规约后立即运行 formal-atlas 检查规约是否自洽
4. **规约明确预期** — 比如 `expects_external_call` 告诉模型 fetch 是合法的，不会误报

## 实现计划

### 新增文件: `src/agent/spec-first-loop.js`

```javascript
// Step 1: NL → 规约
const spec = await generateSpec(task)

// Step 2: 自检规约
const specCheck = await verifySpec(spec)
if (specCheck.violations.length) {
  // 规约本身有矛盾，修复规约
}

// Step 3: 规约 → 代码
const code = await generateCodeFromSpec(spec, task)

// Step 4: 验证
const violations = await verify(projectPath)
```

### 新增文件: `src/llm/spec-prompt.js`

两个 prompt 模板：
1. `specGenPrompt(task)` — NL → 形式化规约
2. `codeFromSpecPrompt(spec, task)` — 规约 → 代码

### 修改文件

- `src/agent/loop.js` — 增加 spec-first 分支
- `src/cli.js` — 增加 `--spec-first` 标志

## 验证方法

用之前 3 道题重新测试：
1. crypto-loop — 规约应有 `not(is_loop(Fn))`，生成代码不应有循环
2. intent-mismatch — 规约应有 `has_side_effect(Fn, db)`，函数名不会误报
3. taint — 规约应有 `taint_source(InputVar)`，代码应做净化

## 预期结论

如果 spec-first 能让 8B 模型在 ± 一轮内达到零违规，说明：
- "按规约写代码" 比 "根据违规修代码" 更容易被小模型理解
- 形式化规约作为中间表示是有效的
- 小模型的能力瓶颈在"理解模糊反馈"，不在"遵循精确约束"
