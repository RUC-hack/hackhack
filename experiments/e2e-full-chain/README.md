# 全链路 HTTP 实验

这项测试使用真实 DeepSeek 和真实知乎搜索，覆盖：

```text
创建会话
→ 用户提出模糊问题
→ DeepSeek 追问
→ 用户补充信息并要求直接回答
→ DeepSeek 生成 query
→ 知乎检索
→ 证据与来源落库
→ DeepSeek 生成引用式 AnswerEnvelope
→ 回读来源
→ 重复 client_turn_id 幂等检查
→ 回读最终会话
```

测试通过条件：

- 第一次动作是 `ask`；
- 第二次动作是 `respond`；
- 最终状态为 `WAITING_FOR_FOLLOW_UP`；
- 检索没有降级，provider 为 `zhihu`；
- 答案契约和 source_id 引用合法；
- 所有返回来源都能通过 `/api/sources/{id}` 回读；
- 重复提交第二轮不会新增消息或再次调用外部服务。

运行前需要本地 `.env.local` 中的 DeepSeek key，以及 `.env.zhihu-5000.local` 中的知乎 Access Secret。

```powershell
node .\experiments\e2e-full-chain\run.mjs --dry-run
node .\experiments\e2e-full-chain\run.mjs --live
```

当前测试验证后端 HTTP 交互。现有 `src/index.html`/`src/app.js` 还是概念展示页，没有接入会话 API，因此浏览器点击级 E2E 是下一项前端工作，而不是本测试伪造的通过项。
