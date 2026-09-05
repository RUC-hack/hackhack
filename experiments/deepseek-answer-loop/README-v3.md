# DeepSeek 独立问答实验：推荐入口 v3

固定读取已保存的 generated Top-5 知乎结果，只测试 DeepSeek 的 selector 和 writer，不再次消耗知乎额度。

```powershell
node .\experiments\deepseek-answer-loop\run-v3.mjs `
  --results .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.jsonl `
  --annotations .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.scored-annotations.jsonl `
  --dry-run

node .\experiments\deepseek-answer-loop\run-v3.mjs `
  --env .env.local `
  --results .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.jsonl `
  --annotations .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-2026-09-05T03-41-02-155Z.scored-annotations.jsonl `
  --live `
  --model deepseek-chat
```

最终四案例原始结果为 3/4；C07 因禁用的“成功率”措辞未通过。确定性后处理命令：

```powershell
node .\experiments\deepseek-answer-loop\recover-v3-output.mjs `
  --input .\experiments\deepseek-answer-loop\runs\deepseek-answer-loop-v3-2026-09-05T04-54-45-357Z.jsonl
```

后处理得到 4/4，但它不是原始模型合规率。完整结果与限制见 `../../docs/实验总报告-2026-09-05.md`。

