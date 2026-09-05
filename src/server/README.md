# 可复用检索接口

这里是产品后端代码，不是实验脚本。前端和 Agent 编排器只能依赖本目录导出的稳定接口，不能读取 `experiments/` 中的 JSONL 或直接调用知乎 HTTP API。

## 分层

```text
RetrievalService
  -> ZhihuProvider
       -> ZhihuSearchClient
       -> cache
       -> redacted JSONL logs
  -> LocalDatasetProvider
  -> MockProvider（测试）
```

- `ZhihuSearchClient`：只实现官方 HTTP 契约、超时、有限重试和错误分类。
- `ZhihuProvider`：返回稳定的 `SourceDocument`，并负责去重、缓存和脱敏日志。
- `RetrievalService`：在知乎限流或不可用时切换本地 Provider，并显式标记降级。

## 稳定调用方式

```js
import path from "node:path";
import {
  RetrievalService,
  createZhihuProviderFromEnv,
  loadEnvFile,
} from "./src/server/index.mjs";

await loadEnvFile(path.resolve(".env.local"), { required: true });

const zhihuProvider = createZhihuProviderFromEnv();
const retrieval = new RetrievalService({
  primaryProvider: zhihuProvider,
  // fallbackProvider: localDatasetProvider,
});

const result = await retrieval.search("计算机本科毕业直接工作经历", {
  limit: 5,
  requestId: "request-id",
  sessionId: "session-id",
  filters: { contentTypes: ["answer"] },
});
```

返回结构：

```json
{
  "documents": [
    {
      "source_id": "zhihu:answer:...",
      "title": "...",
      "author": "...",
      "summary": "...",
      "url": "https://...",
      "content_type": "answer",
      "retrieved_at": "2026-09-04T12:00:00.000Z",
      "provider": "zhihu",
      "metadata": {
        "content_id": "...",
        "vote_up_count": 0,
        "authority_level": 0,
        "ranking_score": 0
      }
    }
  ],
  "meta": {
    "provider": "zhihu",
    "request_id": "request-id",
    "cached": false,
    "degraded": false,
    "degraded_from": null,
    "degradation_reason": null
  }
}
```

## 错误契约

调用方通过 `error.code` 判断处理方式：

| code | 含义 | 自动重试 |
|---|---|---|
| `ZHIHU_INVALID_ARGUMENT` | 本地或上游参数错误 | 否 |
| `ZHIHU_AUTH_FAILED` | Access Secret 无效 | 否 |
| `ZHIHU_RATE_LIMITED` | 知乎业务码 `30001` | 否 |
| `ZHIHU_TIMEOUT` | 请求超时 | 可有限重试 |
| `ZHIHU_NETWORK_ERROR` | 网络失败 | 可有限重试 |
| `ZHIHU_UPSTREAM_ERROR` | 知乎业务码 `90001` | 可有限重试 |
| `ZHIHU_INVALID_RESPONSE` | 返回不符合已知契约 | 否 |
| `ZHIHU_LIVE_CALLS_DISABLED` | 本地安全开关未开启 | 否 |
| `ZHIHU_NOT_CONFIGURED` | 未配置凭证 | 否 |

`30001` 不自动重试。不断重试限流请求只会继续消耗时间并制造无效日志。

## 缓存与日志

- 缓存默认写入 `.runtime/cache/zhihu/`，键由 query、limit 和 filters 的哈希构成。
- 日志默认写入 `logs/zhihu/YYYY-MM-DD/request-<id>.jsonl`；对话日志写入 `logs/conversations/YYYY-MM-DD/session-<id>.jsonl`。
- 日志只记录 query 哈希和长度，不记录 query 原文、Access Secret 或完整响应。
- `.runtime/` 由 Git 忽略。

## 安全开关

从环境创建 Provider 时，只有 `ALLOW_LIVE_EXTERNAL_CALLS=true` 才允许访问知乎；已有的有效缓存仍可在关闭联网时读取。

运行离线测试：

```powershell
npm run test:zhihu
```

启动离线后端：

```powershell
npm start
```

接口顺序示例：

```powershell
$session = Invoke-RestMethod http://localhost:3000/api/sessions -Method Post -ContentType application/json -Body '{"problem_statement":"我在考虑考研还是工作"}'
Invoke-RestMethod "http://localhost:3000/api/sessions/$($session.data.session_id)/messages" -Method Post -ContentType application/json -Body '{"message":"我希望尽快独立，但也不想过早放弃探索","client_turn_id":"turn-1"}'
```
