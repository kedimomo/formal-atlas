# formal-atlas 对 IDE 开发提供的能力全景

## 摘要

formal-atlas 为 AI IDE（Claude Code、Trae、Cursor 等）提供 11 个 MCP 工具 + 8 个 CLI 命令，覆盖代码理解、质量校验、安全检测、形式化验证四大场景。本文档梳理所有能力及其对 IDE 开发的实际价值。

---

## 一、MCP 工具（IDE 直接调用）

### 1.1 代码理解（省 token，替代多轮文件读取）

| 工具 | 用户怎么说 | 返回什么 | 省多少 token |
|------|-----------|---------|-------------|
| **map** | "这个项目有什么" / "代码库概览" | 每文件摘要/单文件详情/符号调用关系 | 替代读全部文件 |
| **search** | "找一下 processOrder 函数" / "谁调用了 db.query" | 按名称/调用关系搜索符号 | 替代多轮 grep |
| **reaches** | "用户输入能到达数据库吗" | TRUE=可达路径存在，FALSE=不可达证明 | 替代手动追踪调用链 |
| **impact** | "改 handleRequest 会影响谁" | 所有传递性受影响的例程 | 替代逐文件追踪 |
| **dead_code** | "有没有死代码" | 从未被调用的函数列表 | 替代逐函数检查 |

### 1.2 质量校验（自动检测，无需手写规则）

| 工具 | 用户怎么说 | 检测什么 | 对应规则 |
|------|-----------|---------|---------|
| **verify** | "做一次治理校验" | 6 条治理规则 + 4 条契约规则 + 污点分析 | governance.pl + correctness.pl + taint.pl |
| **review** | "帮我审查一下代码" | 一键运行全部检查，按严重度排序 | verify + dead_code + taint + impact |

**verify 检测的 11 种违规**：

| 规则 ID | 检测什么 | 严重度 |
|---------|---------|--------|
| crypto-in-loop | 循环内同步加密 | 高 |
| await-in-loop | 循环内串行 await | 中 |
| external-call | 网络外联调用 | 中 |
| hardcoded-sensitive | 硬编码敏感字面量 | 高 |
| dead-code | 死代码 | 低 |
| intent-effect-mismatch | 名字说读但实际有副作用 | 中 |
| taint-reaches-sink | 未净化数据流到危险汇 | 高 |
| postcondition-contradiction | 后置条件与副作用矛盾 | 中 |
| precondition-not-checked | 调用者未检查前置条件 | 中 |
| invariant-crypto-contradiction | 不变式与加密操作矛盾 | 中 |
| invariant-await-contradiction | 不变式与串行 await 矛盾 | 中 |

### 1.3 安全检测

| 工具 | 用户怎么说 | 检测什么 | CWE |
|------|-----------|---------|-----|
| **taint** | "有没有注入漏洞" | 未净化输入→SQL/命令/XSS | CWE-89, CWE-79 |

### 1.4 形式化验证

| 工具 | 用户怎么说 | 做什么 | 数学基础 |
|------|-----------|--------|---------|
| **contract** | "这个契约对不对" | Z3 证明前置条件蕴含后置条件，或给反例 | Hoare 逻辑 |
| **formalize** | "生成契约" / "形式化代码" | AI 生成前置/后置条件 + 循环不变式 | Curry-Howard |

### 1.5 高级查询

| 工具 | 用户怎么说 | 做什么 |
|------|-----------|--------|
| **query** | "查一下有没有循环依赖" | 任意 Prolog 查询 |

---

## 二、CLI 命令（终端直接使用）

| 命令 | 用途 |
|------|------|
| `formal-atlas extract <path>` | 导出逻辑事实库 |
| `formal-atlas verify <path>` | 治理校验 |
| `formal-atlas query <path> "goal."` | 任意 Prolog 查询 |
| `formal-atlas lift <path>` | AI 语义提升 |
| `formal-atlas watch <path>` | 文件监控 + 自动校验 |
| `formal-atlas formalize <path>` | 生成 Hoare 三元组 + 不变式 |
| `formal-atlas smt contract <spec.json>` | 契约蕴含验证 |
| `formal-atlas smt policy <spec.json>` | RBAC 职责分离验证 |
| `formal-atlas fdrs <path>` | FDRS 回流 |

---

## 三、LLM 集成（零配置优先）

| 优先级 | 提供者 | 配置 | 适用场景 |
|--------|--------|------|---------|
| 1 | MCP sampling | IDE 自动提供 | AI IDE 中使用（零配置） |
| 2 | Anthropic API | `ANTHROPIC_API_KEY` | CLI 或 IDE 不支持 sampling |
| 2 | OpenAI API | `OPENAI_API_KEY` + `OPENAI_BASE_URL` | CLI 或使用 OpenAI 兼容接口 |
| 3 | 离线启发式 | 无需配置 | 无 API Key 时自动降级 |

---

## 四、多语言支持

| 语言 | 抽取方式 | 精度 |
|------|---------|------|
| JavaScript | acorn 深度 AST | 最高 |
| TypeScript | tree-sitter | 高 |
| Python | tree-sitter | 高 |
| Go | tree-sitter | 高 |
| Java | tree-sitter | 高 |
| Rust | tree-sitter | 高 |
| 其他 18 种 | 正则兜底 | 粗粒度 |

---

## 五、对 IDE 开发的核心价值

### 5.1 省 token
- 1 次结构化查询替代 3-5 轮文件读取
- map/search 让 LLM 不读文件就能理解代码库

### 5.2 更准确
- Prolog 传递闭包不会漏间接路径
- Z3 数学证明替代 LLM 猜测
- 作用域链接器消除同名合并误报

### 5.3 更安全
- 污点分析检测注入漏洞（CWE-89/79）
- 硬编码敏感字面量检测
- 网络外联边界审查

### 5.4 更智能
- AI 语义提升：从函数名推断意图和副作用
- AI 形式化：自动生成前置/后置条件
- LLM 可能幻觉，但 Prolog 是裁判——错的规约不会通过验证

---

## 六、安装与配置

```bash
# 安装
npm install -g formal-atlas

# Claude Code 注册 MCP
claude mcp add formal-atlas -- npx -y formal-atlas-mcp

# 或在项目 .mcp.json 中配置
{
  "mcpServers": {
    "formal-atlas": {
      "command": "npx",
      "args": ["-y", "formal-atlas-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "OPENAI_BASE_URL": "https://api.openai.com/v1"
      }
    }
  }
}
```
