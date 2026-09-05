# 后端问题登记册

Kevin  
2026-09-04

## 一、用途

本文统一记录对当前后端代码的审查结果，作为后续修复、复查和验收入口。

审查基线：

- Git 提交：`7191e74 feat: add quota-aware Zhihu retrieval workflow`；
- 代码范围：`src/server/`、`tests/unit/`、相关配置和设计文档；
- 已执行测试：9 个后端离线单元测试全部通过；
- 未执行事项：没有消耗额度调用真实知乎接口，也没有执行真实大模型调用。

优先级定义：

| 级别 | 含义 |
|---|---|
| `P0` | 阻止启动或存在立即的数据、凭证安全事故，必须立刻处理 |
| `P1` | 会导致错误分类、无法降级或产品主流程不可用，明日主流程前处理 |
| `P2` | 会导致额度浪费、结果不稳定、安全边界模糊或测试缺口，后端完成前处理 |
| `P3` | 文档、可维护性或低概率边界问题，可在主流程稳定后处理 |

状态使用 `OPEN / IN_PROGRESS / RESOLVED / ACCEPTED_RISK`。修改代码后只有通过对应验收项，才能将问题标记为 `RESOLVED`。

## 二、问题总览

| ID | 优先级 | 状态 | 问题 | 影响模块 |
|---|---:|---|---|---|
| `BE-001` | P1 | RESOLVED | 非对象 Item 导致响应校验器抛异常并误分类 | Zhihu Client |
| `BE-002` | P1 | RESOLVED | 日志写入失败会覆盖原始上游错误 | Zhihu Provider / 降级 |
| `BE-003` | P1 | RESOLVED | 尚无前端可调用的 HTTP API | API / Composition Root |
| `BE-004` | P1 | RESOLVED | 本地与 Mock Provider 未实现、未装配 | Retrieval / Demo 降级 |
| `BE-005` | P2 | RESOLVED | 相同查询并发时可能重复调用知乎 | Cache / 配额 |
| `BE-006` | P2 | RESOLVED | Provider 没有透传取消信号 | 请求生命周期 |
| `BE-007` | P2 | RESOLVED | 去重键优先 URL，不能稳定按内容去重 | Zhihu Provider |
| `BE-008` | P2 | RESOLVED | `ContentText` 的 HTML 语义没有进入契约 | Source / 前端安全 |
| `BE-009` | P2 | RESOLVED | 响应校验只检查字段存在，不检查类型 | Zhihu Client |
| `BE-010` | P2 | RESOLVED | 缓存写入位于成功请求的关键路径 | Cache / 可用性 |
| `BE-011` | P2 | RESOLVED | 产品降级来源被硬编码为 `zhihu` | Retrieval Service |
| `BE-012` | P2 | RESOLVED | 日志路径和结构与 XAI 设计不一致 | Logs / 文档契约 |
| `BE-013` | P3 | RESOLVED | `test:zhihu` 漏跑 RetrievalService 测试 | Test Script |
| `BE-014` | P3 | RESOLVED | 查询哈希不是匿名化，缺少隐私说明 | Logs / Privacy |
| `BE-015` | P3 | RESOLVED | 环境整数解析接受尾随非法字符 | Config |
| `BE-016` | P2 | ACCEPTED_RISK | 尚无真实知乎与大模型连通性冒烟测试 | Integration / Release |

## 三、详细问题

本轮后端闭环已完成 B0–B10：对应实现位于 `src/server/`，离线验证覆盖契约、Provider、存储、LLM 校验、状态机和 HTTP 集成。`BE-016` 保留为 `ACCEPTED_RISK`，因为真实 smoke 需要开发者显式提供现场凭证；命令已提供但未在默认测试中执行。

### BE-001：非对象 Item 导致响应校验器抛异常并误分类

- 位置：[zhihu-search-client.mjs](../../src/server/integrations/zhihu-search-client.mjs)
- 证据：`validateZhihuSearchResponse()` 对每个 Item 直接执行 `field in item`。当 Item 为 `null`、字符串或数组时会抛出 `TypeError`。
- 已复现输入：`{ "Code": 0, "Data": { "Items": [null] } }`。
- 当前结果：异常被 `searchRaw()` 的网络异常分支捕获，可能成为 `ZHIHU_NETWORK_ERROR` 并触发重试。
- 正确结果：响应应被稳定归类为 `ZHIHU_INVALID_RESPONSE`，不得因为结构错误再次消耗额度。

验收：

- 非对象 Item 不抛原生异常；
- 缺字段、错类型和非法顶层结构都返回可枚举的校验错误；
- 非法响应不会被重试；
- 新增包含 `null`、字符串、数组和字段错类型的参数化测试。

### BE-002：日志写入失败会覆盖原始上游错误

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 证据：Provider 的 `catch` 中先 `await #writeLog()`，再抛出已经分类的 `safeError`。
- 影响：磁盘只读、空间不足或目录不可写时，原始限流/超时错误会被文件系统异常覆盖；`RetrievalService` 无法按错误码切换本地 Provider。

验收：

- 日志失败不会覆盖原始知乎错误；
- 日志采用明确策略：MVP 默认 best-effort 并上报 warning；如启用严格审计模式，必须抛出已分类错误并保留原始 cause；
- 注入日志写入失败时仍能触发本地 Provider；
- 错误日志自身失败时不得形成递归记录。

### BE-003：尚无前端可调用的 HTTP API

- 位置：[server index](../../src/server/index.mjs)
- 现状：当前只导出 Node.js 类和函数，没有 HTTP Server、路由、请求体校验或统一响应外壳。
- 影响：现有前端无法创建会话、发送消息、读取来源或获知 Provider 状态。

验收：

- 至少实现 `GET /api/health`、`POST /api/sessions`、`GET /api/sessions/:id`、`POST /api/sessions/:id/messages`、`GET /api/sources/:id`；
- 所有接口使用统一成功/错误外壳和 `request_id`；
- 未知路径、非法 JSON、超大请求体和不存在的会话均有稳定错误；
- API 集成测试不依赖真实外部网络。

### BE-004：本地与 Mock Provider 未实现、未装配

- 位置：[retrieval-service.mjs](../../src/server/services/retrieval-service.mjs)
- 现状：服务支持注入 fallback，但仓库中没有 `LocalDatasetProvider`、`MockProvider` 和产品组合入口。
- 影响：知乎限流、断网或现场凭证失效时，系统不能实际完成降级演示。

验收：

- 三个 Provider 遵守相同最小搜索契约；
- 本地 Provider 能从版本化、无隐私的样例数据读取材料；
- Composition Root 根据环境变量装配 primary 和 fallback；
- 模拟知乎限流、超时、关闭联网和未配置凭证时均可返回 `degraded=true`。

### BE-005：相同查询并发时可能重复调用知乎

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 原因：缓存未命中到缓存写入之间没有 in-flight 合并。
- 影响：多个并发会话使用相同 query 时会重复消耗知乎额度，并可能并发写同一缓存文件。

验收：

- 相同缓存键的并发请求共享一个上游 Promise；
- 不同缓存键仍可并行；
- 上游失败后 in-flight 项一定清理；
- 并发测试证明相同 query 只调用一次 Client。

### BE-006：Provider 没有透传取消信号

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 现状：Client 支持 `signal`，Provider 的 options 和 Client 调用均未传递。
- 影响：浏览器取消、HTTP 超时或会话被终止后，上游调用仍继续执行。

验收：

- `AbortSignal` 从 HTTP 请求一路透传至 LLM 与知乎 Client；
- 主动取消使用独立错误码，不误记为普通网络失败；
- 取消后不重试，不写入不完整缓存。

### BE-007：去重键优先 URL，不能稳定按内容去重

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 原因：当前使用 `document.url || document.source_id`。
- 影响：同一 `ContentID` 带不同非 UTM 参数或链接形式时，会作为多条材料进入答案。

验收：

- 有 `source_id` 时优先按 `source_id` 去重；
- 无内容 ID 时再使用规范化 URL；
- 同 ContentID、不同 URL 的测试只保留一条，并保留排序更靠前的结果。

### BE-008：`ContentText` 的 HTML 语义没有进入契约

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 依据：知乎文档说明 `ContentText` 是摘要，高亮部分可能含 `<em>` 标签。
- 影响：如果前端把 `summary` 作为 HTML 渲染，会产生内容注入风险；如果作为纯文本渲染，则会显示标签。

验收：

- MVP 在 Provider 边界将摘要转换为纯文本，保留原始摘要时使用单独的内部字段；
- API 契约明确 `summary` 是纯文本；
- 含 `<em>`、未知标签和转义字符的测试不会执行 HTML。

### BE-009：响应校验只检查字段存在，不检查类型

- 位置：[zhihu-search-client.mjs](../../src/server/integrations/zhihu-search-client.mjs)
- 影响：对象、数组或布尔值可能被 `String()` 静默转换，形成看似合法但不可用的来源。
- 说明：产品可以只依赖官方响应的最小字段子集，但函数应命名为最小契约校验，不能声称验证完整官方 schema。

验收：

- 对产品依赖字段验证类型；
- `Url` 必须是允许的 HTTPS 知乎域名，或者被明确标记为不可点击；
- 数值字段允许官方文档中可兼容的字符串数字，但归一化失败时返回 `null`；
- 校验器和 Provider 不重复执行互相矛盾的校验。

### BE-010：缓存写入位于成功请求的关键路径

- 位置：[zhihu-provider.mjs](../../src/server/providers/zhihu-provider.mjs)
- 影响：知乎成功返回后，缓存目录异常仍会让用户得到失败结果。

验收：

- 默认情况下，缓存写失败不改变已经成功的检索结果；
- 返回 `meta.cache_write_failed=true` 或记录结构化 warning；
- 临时文件在失败后得到清理；
- 缓存损坏时忽略该项并重新检索，不导致进程崩溃。

### BE-011：产品降级来源被硬编码为 `zhihu`

- 位置：[retrieval-service.mjs](../../src/server/services/retrieval-service.mjs)
- 影响：更换 primary Provider 后，`degraded_from` 仍错误显示为 `zhihu`。

验收：

- Provider 暴露稳定名称或由构造器显式传入名称；
- `degraded_from` 根据实际 primary 生成；
- fallback 失败时保留 primary 与 fallback 两段错误上下文。

### BE-012：日志路径和结构与 XAI 设计不一致

- 当前实现：`.runtime/logs/zhihu/YYYY-MM-DD.jsonl`；
- XAI 设计：`logs/zhihu/YYYY-MM-DD/request-<id>.jsonl`；
- 结构性约束：所有知乎调用和 Agent 对话按日期进入 `logs/`。

验收前必须做出一个项目级决定。推荐统一为：

```text
logs/
├── conversations/YYYY-MM-DD/session-<id>.jsonl
└── zhihu/YYYY-MM-DD/request-<id>.jsonl
```

真实用户日志保持 Git ignored；仓库只提交合成或匿名 fixtures。若最终选择 `.runtime/logs`，需要同步修改全部设计文档，不允许两套约定长期并存。

### BE-013：`test:zhihu` 漏跑 RetrievalService 测试

- 位置：[package.json](../../package.json)
- 现状：文档推荐 `npm run test:zhihu`，但脚本没有包含 `retrieval-service.test.mjs`。

验收：

- `test:zhihu` 包含 Client、Provider 和 RetrievalService；
- 增加 `test:unit`、`test:contract`、`test:integration` 分层脚本；
- 默认 `npm test` 不意外执行 `zhihu-hackathon/assets/` 内的模板测试。

### BE-014：查询哈希不是匿名化

- 现状：日志不保存 query 原文，只保存无盐 SHA-256 和长度。
- 风险：常见人生问题可以通过字典枚举反推出原文；哈希只能用于关联，不等于匿名化。

验收：

- 文档明确其为伪匿名标识；
- 如需跨日志关联，使用由本地密钥生成的 HMAC；
- 如不需要关联，使用 request 内随机 ID；
- 不把真实对话日志上传 Git。

### BE-015：环境整数解析接受尾随非法字符

- 位置：[env.mjs](../../src/server/config/env.mjs)
- 现状：`Number.parseInt("10abc", 10)` 会得到 `10`。

验收：

- 先通过整数正则或完整数值转换验证整个字符串；
- `10abc`、`1.2`、空格以外的尾随字符均拒绝；
- `env-doctor` 与运行时加载器复用同一套解析逻辑。

### BE-016：尚无真实连通性冒烟测试

- 依据：[项目结构性约束](../项目结构性约束.md) 要求知乎与大模型最小握手测试。
- 限制：CI 和普通单元测试不得调用真实外部服务。

验收：

- 提供需要显式 `--live` 和环境安全开关的独立 smoke 命令；
- 知乎仅执行一个最小查询，大模型仅执行一个最小结构化响应；
- 输出不包含凭证与完整用户内容；
- 记录测试时间、耗时、业务码和人工验收结果。

## 四、复查规则

每个问题修复时应同时提交以下证据供人工审查：

1. 对应代码 diff；
2. 新增或更新的测试；
3. 实际测试命令和结果；
4. 是否改变 API、日志或环境变量契约；
5. 如果接受风险，记录原因、影响范围和比赛后的处理计划。

在用户审查之前，不自动提交或推送修复代码。
