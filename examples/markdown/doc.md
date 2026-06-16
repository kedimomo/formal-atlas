---
title: 形式化覆盖证明
author: formal-atlas
date: 2026-06-12
---

# 架构概述

formal-atlas 是一个零安装、零外部依赖的代码形式化引擎。有 [[技术路线图]] 可以看。

## 抽取管道

源码通过三个层次的管道:

- **acorn AST**: JavaScript/Vue 文件的全 AST 抽取
- **tree-sitter**: Python/Go/Java/Rust 等 15 种语言
- **regex fallback**: 不支持的语言降级

核心函数 `extractProject` 在 [src/pipeline.js](src/pipeline.js) 中。

```js
// 关键调用路径
const { facts } = await extractProject(target, { lift: 'offline' });
```

```python
# Python 侧也是同一套 schema
def verify(path):
    facts = extract(path)
    return check_rules(facts)
```

## TODO: 需要补的

- TODO: 加 markdown 抽取器
- FIXME: 处理图片链接
- HACK: regex 匹配 `<br>` 标签暂时跳过

## 当前限制

对外部链接 `<https://github.com/kedimomo/formal-atlas>` 不做断链检查。
