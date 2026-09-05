# 全链路 HTTP 实验：推荐入口 v3

v1 和 v2 保留为失败基线；推荐使用 v3。它使用 `ResilientLlmClient` 提取平衡 JSON，并使用可复用的 `ValidatedLlmGateway` 校验 schema、来源白名单，把具体错误和上一版非法 JSON 交给模型做有界修复。

```powershell
node .\experiments\e2e-full-chain\run-v3.mjs --dry-run
node .\experiments\e2e-full-chain\run-v3.mjs --live --model deepseek-chat
```

通过条件共 16 项：健康检查、会话创建、首轮追问、次轮检索并回答、最终状态、知乎 provider、非降级、query 预算、来源数量与回读、答案契约、成功后的幂等重放和消息数稳定。

2026-09-05 的真实运行结果为 16/16，通过；动作 `ask → respond`，2 条 query、10 个来源。浏览器 UI 尚未接后端，点击级验收见 `browser-acceptance.md`。

