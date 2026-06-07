# 诊断：Ollama 不使用 GPU

## 根因：GPU 架构过旧

| 项目 | 值 |
|------|-----|
| **GPU 型号** | NVIDIA Tesla K40c |
| **架构** | Kepler (GK110B) |
| **Compute Capability** | 3.5 |
| **CUDA 版本** | 11.2 |
| **VRAM** | 11.5 GB |
| **Ollama 要求** | Compute Capability **5.0+** (Maxwell 及以上) |

Ollama 的 llama.cpp CUDA 后端要求 GPU 计算能力 ≥ 5.0。K40c (3.5) 不满足，自动回退到 CPU。

## 证据

从 Ollama 日志确认纯 CPU 推理：
```
prompt eval time = 1676.22 ms / 64 tokens (38.18 tok/s)
eval time        = 7103.43 ms / 64 tokens (9.01 tok/s)   ← 纯 CPU 速度
llama-server started in 223.17 seconds                    ← CPU 加载极慢
```

`ollama ps` 显示 `PROCESSOR` 列为空（有 GPU 时会显示 CUDA）。

`nvidia-smi` 显示 GPU-Util: 0%，无 Ollama 进程。

## 解决选项

| 选项 | 效果 | 成本 |
|------|------|------|
| **接受 CPU 推理** | 9 tok/s，简单任务可用 | 零 |
| **更换 GPU** | GTX 1060 6GB+ 即可 | ~500-1000 元二手 |
| **用云端 API** | OpenAI/DeepSeek API | ~$0.01/次 |
| **使用 Vulkan 后端** | K40c 支持 Vulkan 1.2，但 Ollama Windows 版不支持手动指定后端 | zero（不可行） |

## 建议

如果你的主要目标是**验证 micro-forge 的概念**（小模型 + 验证循环），CPU 推理虽然慢，但足以跑通流程。9 tok/s 对于代码生成任务是可接受的。

如果要长期使用，投入一块 GTX 1060 6GB (~500) 或 RTX 2060 12GB (~800) 性价比最高。

## 当前状态

Ollama 正常运行在 CPU 模式，qwen2.5-coder:7b 已可用，micro-forge 可以正常调用。
