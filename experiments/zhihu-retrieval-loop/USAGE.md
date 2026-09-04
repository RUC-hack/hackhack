# 知乎检索验证 runner

本目录只用于验证“构建 query -> 调用知乎搜索 -> 评估结果”的可行性，不是产品后端接口。

产品代码位于 `src/server/`。实验 runner 会保存 query、原始响应、业务码和延迟，以便复现实验；这些内容不应成为前端或最终 Agent 的数据契约。

## 与旧入口的区别

| 入口 | 状态 | 用途 |
|---|---|---|
| `run-search.mjs` | legacy | 第一版验证脚本；遇到限流仍继续请求 |
| `run.mjs` | legacy wrapper | 为第一版脚本加载 `.env.local` |
| `run-experiment.mjs` | current | 分批、限流即停、断点续跑、安全联网开关 |

后续实验只使用 `run-experiment.mjs`。

## 先做 dry-run

```powershell
node .\experiments\zhihu-retrieval-loop\run-experiment.mjs `
  --strategy baseline `
  --max-calls 4 `
  --dry-run
```

dry-run 不读取 Secret、不联网，也不消耗额度。

## 分批真实运行

确认新的 Access Secret 已写入 `.env.local`，并确认当前频率限制已经解除后：

```powershell
node .\experiments\zhihu-retrieval-loop\run-experiment.mjs `
  --strategy baseline `
  --max-calls 4 `
  --live
```

`--live` 是显式联网授权。也可以在本地设置 `ALLOW_LIVE_EXTERNAL_CALLS=true`，但比赛开发期间更推荐保留命令级确认。

## 限流后续跑

默认遇到业务码 `30001` 时，runner 在记录该响应后立即暂停。等待限制解除后，对同一个结果文件运行：

```powershell
node .\experiments\zhihu-retrieval-loop\run-experiment.mjs `
  --strategy oracle `
  --seed 20260904 `
  --max-calls 4 `
  --resume .\experiments\zhihu-retrieval-loop\runs\zhihu-oracle-....jsonl `
  --live
```

已经业务成功的 `attempt + case_id + query_id` 会被跳过；限流、网络失败和无效响应会在续跑时重新执行。

## 缩小范围

只运行指定案例：

```powershell
node .\experiments\zhihu-retrieval-loop\run-experiment.mjs `
  --strategy oracle `
  --case-id C01,C02 `
  --max-calls 4 `
  --dry-run
```

主要参数：

| 参数 | 含义 |
|---|---|
| `--strategy baseline|oracle|generated` | Query 策略 |
| `--case-id C01,C02` | 选择案例 |
| `--max-calls N` | 本次最多执行多少次 |
| `--delay-ms N` | 调用之间的等待时间，默认 1000 ms |
| `--resume file.jsonl` | 断点续跑 |
| `--live` | 明确允许本次联网 |
| `--dry-run` | 只展示调用计划 |
| `--continue-on-rate-limit` | 仅用于测量限流行为；一般不要使用 |

知乎文档未给出具体限流窗口，因此不能把“每批 4 次”理解为官方额度。批次大小只是保守的实验操作参数；一旦出现 `30001`，应停止并等待，而不是轮换 Secret。
