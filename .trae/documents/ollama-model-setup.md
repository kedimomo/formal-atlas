# 计划：安装 Ollama 模型

## 结论：选 Qwen2.5-Coder 7B，不选 DeepSeek

### 为什么选 Qwen2.5-Coder 7B

| 维度 | Qwen2.5-Coder 7B | DeepSeek-Coder 6.7B |
|------|-------------------|---------------------|
| HumanEval | **88.4%** | 78.6% |
| 中文能力 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| VRAM (Q4) | ~5GB | ~5GB |
| 上下文 | 128K | 16K |
| 语言覆盖 | 92 种 | 338 种 |
| 许可证 | Apache 2.0 | DeepSeek License |

**Qwen2.5-Coder 7B 在 HumanEval 上领先 DeepSeek-Coder 6.7B 近 10 个百分点**（88.4% vs 78.6%），且中文能力更强、上下文窗口更大（128K vs 16K）。

### 如果显存充足，更好的选择

| 显存 | 推荐模型 | HumanEval | 安装命令 |
|------|---------|-----------|---------|
| 8GB | Qwen2.5-Coder 7B | 88.4% | `ollama pull qwen2.5-coder:7b` |
| 16GB | Qwen2.5-Coder 14B | ~89% | `ollama pull qwen2.5-coder:14b` |
| 24GB | Qwen2.5-Coder 32B | 92.7% | `ollama pull qwen2.5-coder:32b` |

### 实施步骤

1. 拉取模型：`ollama pull qwen2.5-coder:7b`
2. 验证可用：`ollama list`
3. 更新 micro-forge 默认模型名为 `qwen2.5-coder:7b`
4. 测试运行 micro-forge

### 同时安装的辅助模型（可选）

- `deepseek-r1:14b` — 推理/调试场景（16GB VRAM）
