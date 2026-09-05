# ADR-002：后端 MVP 闭环实现

日期：2026-09-05  
状态：accepted

## 背景

项目需要在不引入数据库、向量库或多 Agent 框架的前提下，完成“创建会话 → 追问 → 检索 → 证据 → 有来源回答”的可演示后端，并保证知乎不可用时仍可离线演示。

## 决策

- 沿用 Node.js ESM 和标准库，以 `src/server/app.mjs` 作为唯一 Composition Root。
- API 固定为 `/api/health`、会话创建/读取、会话消息和来源读取五个 REST 路由；统一返回 `ok/data/error/request_id` 外壳。
- 默认使用本地案例库和 Mock LLM；只有 `ALLOW_LIVE_EXTERNAL_CALLS=true` 且凭证存在时才启用真实外部调用。
- 知乎 Provider 失败或空结果时切换 `LocalDatasetProvider`，并在 `meta` 和回答 `limitations` 中标记降级。
- 会话和对话审计使用按日期组织的 JSONL；知乎调用使用 `logs/zhihu/YYYY-MM-DD/request-<id>.jsonl`，查询关联使用进程内或环境注入的 HMAC，而不是无盐哈希。
- 模型决策和回答均先做结构校验；格式错误最多修复一次。回答引用只能来自当前已保存的 EvidencePacket。

## 后果

单机演示和离线测试具备确定性，前端不接触知乎或大模型凭证；JSONL 不适合多实例并发和复杂查询，后续部署时再迁移数据库。真实外部 smoke 已提供独立命令，但由于需要现场凭证，不纳入默认测试。
