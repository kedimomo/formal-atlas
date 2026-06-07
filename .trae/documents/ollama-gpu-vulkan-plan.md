# 诊断：Ollama 不使用 GPU & 可行解决方案

## 根因

| 项目 | 值 |
|------|-----|
| GPU | NVIDIA Tesla K40c (Kepler, 2013) |
| Compute Capability | 3.5 |
| Ollama CUDA 要求 | ≥ 5.0 (Maxwell+) |

Ollama 的 llama.cpp CUDA 后端不支持 Kepler 架构，自动回退到 CPU：
```
prompt eval: 26.19 ms/token (38 tok/s)
eval:        110.99 ms/token (9 tok/s)   ← 纯 CPU
```

## 为什么不应该手写 CUDA 加速器

| 理由 | 详情 |
|------|------|
| **代码量巨大** | 完整的 Transformer 推理引擎需要数千行 CUDA 内核（Attention、FFN、LayerNorm、RoPE 等），不是一个文件能搞定的 |
| **K40c 无 FP16** | 现代 LLM 推理依赖半精度，K40c 只能用 FP32，显存带宽减半 |
| **显存带宽瓶颈** | K40c 288 GB/s vs 现代 GPU 1000+ GB/s，即使写好内核也快不了多少 |
| **无 Tensor Core** | 无硬件矩阵乘加速 |
| **无人维护** | 你得到一个无法升级、只有你能用的定制推理引擎 |

**结论**：手写 CUDA 加速器 = 数月工作 + 速度可能比 CPU 还慢。

## 实际可行方案：Ollama Vulkan 后端

Ollama 0.12.11+ 内置 Vulkan 后端。K40c 支持 Vulkan 1.2。只需设置环境变量 `OLLAMA_VULKAN=1`。

### 实施步骤

1. 关闭当前 Ollama 进程
2. 设置环境变量：
   ```powershell
   # 用户级永久的
   [Environment]::SetEnvironmentVariable("OLLAMA_VULKAN", "1", "User")
   ```
3. 重启 Ollama（务必确保环境变量生效）：
   ```powershell
   # 确保之前进程已关
   taskkill /f /im "ollama app.exe" 2>$null
   taskkill /f /im "ollama.exe" 2>$null
   
   # 重新启动
   & "C:\Users\Administrator\AppData\Local\Programs\Ollama\ollama app.exe"
   ```
4. 验证：
   ```powershell
   ollama ps  # 应显示 GPU 后端
   ```

### 预期效果

Vulkan 后端会比纯 CPU 快 **2-5 倍**。虽然不如现代 GPU CUDA，但足够让 K40c 从"只能跑"变成"流畅可用"。

## 其他选项

| 方案 | 可行性 | 成本 |
|------|--------|------|
| Ollama + Vulkan | ✅ 一行配置 | 免费 |
| llama.cpp 直接编译 Vulkan 版 | ✅ 更灵活 | 需要编译 |
| 手写 CUDA 加速器 | ❌ 不现实 | 巨大 |
| 换 GPU (GTX 1060 6GB+) | ✅ 效果最好 | ~500-800 元 |
