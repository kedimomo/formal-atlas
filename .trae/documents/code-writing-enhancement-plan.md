# 计划：从"诊断器"升级为"治疗器" — 让 formal-atlas 提升 AI 代码编写能力

## 摘要

当前 formal-atlas 是纯诊断工具——只告诉 AI "哪里有问题"，从不告诉"怎么修"。要真正提升 AI 编写代码的能力，需要增加**从违规到修复的桥梁**，分四层递进实现。

---

## 当前状态：纯诊断，零治疗

| 维度 | 当前能力 | 缺失 |
|------|---------|------|
| 违规报告 | ✅ 精确报告 11 种违规 | ❌ 没有修复建议 |
| 反例生成 | ✅ SMT 能给具体反例 | ❌ 反例不映射到代码补丁 |
| 契约输出 | ✅ 自然语言前置/后置条件 | ❌ 没有可执行断言 |
| 代码生成 | ⚠️ 仅 Dafny 骨架 | ❌ 没有目标语言代码 |
| 反馈回路 | ❌ 无 | ❌ 没有"验证→修复→再验证"闭环 |

---

## 提议变更（4 层递进）

### 第 1 层：修复建议（低成本高收益）

**变更 1.1**：新增 `src/rules/suggestions.pl`

为每种违规提供修复方向：

```prolog
suggestion('crypto-in-loop', 'Move crypto outside the loop, or isolate with Web Worker').
suggestion('await-in-loop', 'Use Promise.all() or batch queries instead of sequential awaits').
suggestion('external-call', 'Add allowlist/proxy boundary check before the call').
suggestion('hardcoded-sensitive', 'Replace with env variable or config lookup').
suggestion('dead-code', 'Remove or mark as entry point if intentionally unused').
suggestion('intent-effect-mismatch', 'Rename function to reflect side effect, or remove mutation').
suggestion('taint-reaches-sink', 'Add input validation or parameterized query between source and sink').
suggestion('postcondition-contradiction', 'Fix postcondition or remove mutation side effect').
suggestion('precondition-not-checked', 'Add precondition assertion at call site').
suggestion('invariant-crypto-contradiction', 'Fix loop invariant to account for crypto, or move crypto out').
suggestion('invariant-await-contradiction', 'Fix loop invariant to account for async, or parallelize').
```

**变更 1.2**：修改 `mcp/tools.js` — `verify` 和 `review` 工具返回值增加 `suggestion` 字段

**变更 1.3**：修改 `src/verify/prolog-engine.js` — `runQuery` 后自动查询 `suggestion/2` 并附加到违规结果

### 第 2 层：可执行断言生成（中等成本）

**变更 2.1**：新增 `src/formalize/assert-gen.js`

将自然语言前置/后置条件转化为可插入源码的运行时断言：

```
输入: precondition(deleteUser, 'userId is a valid identifier')
输出: if (!userId || typeof userId !== 'string') throw new TypeError('Precondition: userId must be a valid identifier')
```

**变更 2.2**：新增 `assert` MCP 工具

```
assert(path, { function: 'deleteUser', lang: 'js' })
→ 返回可插入源码的断言代码片段
```

### 第 3 层：契约驱动代码骨架生成（高成本核心价值）

**变更 3.1**：新增 `src/synthesize/skeleton.js`

基于契约（前置/后置条件）生成满足契约的函数实现骨架：

```
输入: precondition(x > 0), postcondition(result >= x)
输出:
function f(x) {
  if (!(x > 0)) throw new Error('Precondition violated');
  let result;
  // TODO: implement logic such that result >= x
  if (!(result >= x)) throw new Error('Postcondition violated');
  return result;
}
```

**变更 3.2**：新增 `synthesize` MCP 工具

```
synthesize(path, { function: 'computeTotal', lang: 'js' })
→ 返回带契约守卫的函数骨架代码
```

### 第 4 层：验证-修复闭环（最高成本）

**变更 4.1**：新增 `src/feedback/loop.js`

实现 `verify → diagnose → patch → re-verify` 自动循环：

1. 运行 `verify` 发现违规
2. 获取修复建议 + 生成代码补丁
3. 应用补丁后自动重新验证
4. 直到所有违规消除或达到最大迭代次数

**变更 4.2**：新增 `autofix` MCP 工具

```
autofix(path, { maxIterations: 3 })
→ 自动循环修复，返回修复前后的 diff
```

---

## 实施优先级

| 层级 | 收益 | 成本 | 优先级 |
|------|------|------|--------|
| 第 1 层：修复建议 | 高 — AI 立刻知道怎么修 | 低 — 只加 Prolog 事实 | **P0** |
| 第 2 层：可执行断言 | 中 — 生成运行时守卫代码 | 中 — 需要语言特定模板 | P1 |
| 第 3 层：契约驱动骨架 | 高 — 从契约生成代码 | 高 — 需要多语言模板 | P2 |
| 第 4 层：自动修复闭环 | 最高 — 全自动 | 最高 — 需要安全边界 | P3 |

---

## 假设与决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 修复建议用 Prolog 事实 | 不用 JS 对象 | 与现有 violation/2 框架一致，可查询 |
| 断言生成只支持 JS/TS | 先不做 Python/Go | 项目核心是 JS，先做最常用的 |
| 骨架生成带契约守卫 | 不做纯代码生成 | 守卫确保生成代码满足契约，纯生成可能违反 |
| 自动修复不直接写文件 | 返回 diff 让 AI/用户决定 | 安全边界，不自动修改代码 |

---

## 验证步骤

1. 运行 `verify`，确认返回值包含 `suggestion` 字段
2. 运行 `assert`，确认生成的断言代码语法正确
3. 运行 `synthesize`，确认生成的骨架满足契约
4. 运行 `autofix`，确认闭环收敛
5. 回归测试：现有 11 个工具功能不受影响
