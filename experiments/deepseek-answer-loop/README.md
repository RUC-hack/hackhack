# DeepSeek 独立问答实验

这个实验固定使用已经保存的知乎 Top-5 结果，只测试大模型，不再次调用知乎。

每个案例包含两个独立阶段：

1. `selector`：DeepSeek 为每条材料评估相关性、个人经历和证据充分度，并选出 usable 来源。
2. `writer`：DeepSeek 只能使用 selector 选中的来源生成 `AnswerEnvelope`，所有材料性陈述必须引用 `source_id`。

主要指标：

- selector/writer JSON 和 schema 合法率；
- selector 相对已保存单评审标签的 precision、recall、accuracy；
- answer 引用是否全部来自选中来源；
- 是否输出被禁止的伪成功率；
- 两阶段延迟。

先检查计划：

```powershell
node .\experiments\deepseek-answer-loop\run.mjs `
  --results .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.jsonl `
  --annotations .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.scored-annotations.jsonl `
  --dry-run
```

真实运行：

```powershell
node .\experiments\deepseek-answer-loop\run.mjs `
  --env .env.local `
  --results .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.jsonl `
  --annotations .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.scored-annotations.jsonl `
  --live
```

运行结果默认写入本目录的 `runs/`。密钥只从本地 env 读取，不进入提示词或结果文件。
