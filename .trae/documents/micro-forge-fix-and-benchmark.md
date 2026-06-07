# micro-forge 修复 + 代码质量对比基准

## 当前问题的根因

### Bug 1: loop.js 不写文件
`loop.js` 将生成的代码保存在内存 `code` 变量中，但 `verify()` → `formal-atlas verify <projectPath>` 检查的是**磁盘上的文件**。因为从未写文件，每次验证都返回 0 violations，循环在一轮内结束。

### Bug 2: cli.js 参数解析错误
`task` 和 `projectPath` 用了相同的过滤逻辑，导致 task = projectPath = 第一个非 flags 参数。

### Bug 3: bridge.js 不支持文件注入
`verify()` 只知道检查 `projectPath` 下的文件，不知道有新生成的代码。

## 修复计划

### 修复 1: loop.js 写入生成代码
- 提取代码到多文件（根据注释 `// file: x.js` 或默认写入 `generated.js`）
- 验证前写入文件，验证后可清理

### 修复 2: cli.js 参数解析
- 用 `minimist` 或简单 positional 解析
- task = args[0], projectPath = args[1]

### 修复 3: bridge.js 支持指定生成文件
- `verify()` 接受可选的额外文件路径
- 验证前将生成代码写入临时文件，验证后加入 results

## 对比测试方案

写一个小脚本 `bench/compare.js`，做以下对比：

| 模式 | 流程 | token 来源 |
|------|------|-----------|
| **Raw** | 1 次 API 调用 → 存文件 → 1 次 formal-atlas verify（仅记录，不修复） | 1 次 LLM 调用 |
| **forge** | API 调用 → 写文件 → verify → 有违规→修复→重新验证（最多 5 轮） | N 次 LLM 调用 |

### 测试题目（选 3 道，容易触发违规的）

```
T1: "Write a function that hashes multiple user passwords using bcrypt.
     The function receives an array of passwords and returns hashed values."

T2: "Write a function getAndCleanUsers that fetches users from a database
     and deletes inactive ones. Name it exactly getAndCleanUsers."

T3: "Write a function with user input that executes a shell command
     based on a filename provided by the user."
```

| 题 | 预期触发 | 原因 |
|----|---------|------|
| T1 | `crypto-in-loop` | 数组循环内对每个密码 hash |
| T2 | `intent-effect-mismatch` | 函数名 get* 但做了 delete |
| T3 | `taint` + `external-call` | 用户输入→命令执行 |

### 指标

| 指标 | Raw | forge |
|------|-----|-------|
| 生成代码行数 | - | - |
| 最终 violations 数 | - | - |
| 迭代轮数 | 1 | - |
| 总 token 消耗 | - | - |
| 总耗时 | - | - |

## 验证方法

1. 修复后运行对比脚本
2. 检查 forge 模式的 violations 是否 ≤ Raw 模式
3. 检查 forge 模式是否在 ≤3 轮内收敛到 0 violations
