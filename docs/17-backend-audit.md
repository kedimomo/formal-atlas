# 后端全线违规审计 — formal-atlas verify ../src/server/routes

> 日期: 2026-06-12 | 引擎: tau-prolog | 目录: `../src/server/routes` (约 60 个路由文件)

## 总体发现: 187 条违规,4 个类别

| 规则 | 数量 | 分类 |
|---|---|---|
| `hardcoded-sensitive` | ~162 | 大多数假阳(路由配置/测试字符串含 `tenant-\d+` 模式) |
| `await-in-loop` | ~22 | 真实模式(anon@line 行内函数中顺序 await) |
| `external-call` | 2 | 真实——`verifyGreenworldToken`、`verifyGreenworldSsoCode` |
| `dead-code` | 2 | `votingRoutes` × 2 — 需确认是否被路由注册表引用 |
| `taint-reaches-sink` | **1** | **真实 XSS**——`admin/db-dr.routes.js:102:sink_xss`(★3 压制后幸存的真阳) |

## 分诊

### hardcoded-sensitive (~162):假阳率高

触发原因是 `/tenant-\d+/` 正则命中。在路由文件(如 `auth.routes.js`、`config.routes.js`、`admin/super-admin.routes.js`)里,`tenant-1`、`tenant-2` 等字符串作为**测试数据/配置占位符**出现。这些不是泄露的密钥。

**建议**:把 `hardcoded-sensitive` 规则的触发模式从简单字符串匹配精化为"在非测试/非配置上下文中"。或在 FDRS 信号层过滤掉已知安全的路由文件。

### await-in-loop (~22):真实但需要设计级判断

全部在路由处理器的内联 `async (req, reply)` 函数中(如 `admin/db-dr.routes.js` 的连接测试、`rebac-api.routes.js` 的批量查询)。

这些模式在**管理路由**中通常可接受(操作者可控的批量大小),但在**用户路由**中应该替换为 `Promise.all` 或批量 SQL。

**建议**:标记为 [WARN] 级别(现有行为)——不改代码,但在管理面板标注出来。

### external-call (2):需审查

- `verifyGreenworldToken`:向外部绿网 SSO 服务器发验证请求——**这是 SSO 集成的必要逻辑**,但在调用前应加超时/重试/allowlist 检查。
- `verifyGreenworldSsoCode`:同上。

### taint-reaches-sink (1):真阳性 ⚠️

`admin/db-dr.routes.js:102:sink_xss`——不可信输入到达 HTML 内容类型汇。**这是 ★3 内容类型精化后幸存的 XSS**,值得排查确认是否是实际漏洞。

## 与前次扫描(2026-06-04)的对比

前次 `fdrs_dci_log.jsonl` 记录 `total_bug_count: 0, dci: 1`。formal-atlas 的 Prolog 违规规则比 FDRS 的 regex 覆盖更广:**新增了调用图可达性(dead-code)、污点分析(taint-reaches-sink)、跨文件内容类型感知**。

## 压制/精化待做

- `hardcoded-sensitive` 需要上下文感知(排除测试/配置文件中的占位字符串)
- `await-in-loop` 可加"是否为用户面路由"判定(管理员路由应降级为 INFO)
- 前次扫描未触发的 `taint-reaches-sink` 本次触发 1 条——★3 压制正确过滤了 JSON 响应

## 重现

```bash
cd formal-atlas
node src/cli.js verify ../src/server/routes
# 或使用 MCP: formal-atlas verify ../src/server/routes
```
