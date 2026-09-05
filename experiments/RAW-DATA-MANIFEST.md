# 原始数据清单

本清单覆盖截至 2026-09-05 已执行的本地、知乎、DeepSeek 和全链路测试。Git 提交本身提供内容寻址；各 `.summary.json` 是机器汇总，`.jsonl`/完整 `.json` 是逐调用或逐会话记录。

## 安全与数据说明

- Access Secret、DeepSeek API Key、Authorization header 和本地 env 文件不入库。
- DeepSeek 原始记录包含模型原文、token 用量、延迟、校验错误和冻结的候选材料。
- 知乎原始记录包含接口返回的公开内容摘要、URL 与作者名，仅用于实验复核。
- 全链路完整记录包含用户测试文本、检索证据、最终答案、状态与审计事件。
- 入库前运行 `scripts/scan-staged-secrets.mjs`；该脚本同时匹配本地 env 中的真实值和常见凭证形态，但不会打印凭证本身。

## 固定输入

- `zhihu-retrieval-loop/cases.json`：8 个原始案例。
- `zhihu-retrieval-loop/quota-study-plan.json`：4 案例 × 2 条件的交错调用顺序。
- `.runtime/experiments/single-queries-quota-v1.json`：本轮实际使用的 generated query 快照。
- `deepseek-answer-loop/plan.json`：模型单独实验预注册规则。
- `e2e-full-chain/scenario.json`：两轮全链路场景和验收条件。

## 知乎检索原始数据

- `zhihu-oracle-2026-09-04T13-36-23-657Z.*`：32 次原始 Oracle 调用与汇总。
- `oracle-pilot-annotations.jsonl`、`oracle-pilot-auto-report.json`、`oracle-pilot-quota-aware-report.json`：Oracle 标注模板及两类分析。
- `zhihu-baseline-2026-09-04T13-45-41-239Z.*`：额度耗尽时的 baseline 记录。
- `quota-paired-v1-2026-09-04T14-20-55-944Z.*`：旧额度下立即限流的配对尝试。
- `quota-paired-v1-2026-09-05T03-41-02-155Z.*`：新额度下完成的 8 次配对调用、标注、评分和分析。
- `smoke-annotations.jsonl`：标注流程冒烟数据。

这些文件位于 `zhihu-retrieval-loop/runs/`。

## DeepSeek 原始数据

- `deepseek-answer-loop-v1-2026-09-05T04-38-13-360Z.*`：严格 JSON 解析基线。
- `deepseek-answer-loop-v2-2026-09-05T04-43-04-368Z.*`：一次模型修复版本。
- `deepseek-answer-loop-v3-2026-09-05T04-49-42-468Z.*`：`deepseek-v4-flash` 四案例。
- `deepseek-answer-loop-v3-2026-09-05T04-54-02-764Z.*`：`deepseek-chat` 两个针对性案例。
- `deepseek-answer-loop-v3-2026-09-05T04-54-45-357Z.*`：`deepseek-chat` 四案例原始、汇总及离线规范化结果。

这些文件位于 `deepseek-answer-loop/runs/`。

## 全链路原始数据

- `e2e-full-chain-v1-observed-failure-2026-09-05.json`：v1 提前断言退出的回溯记录；不是完整 trace。
- `e2e-full-chain-v2-2026-09-05T05-03-48-158Z.*`：宽容 JSON 解析器 + 原网关的失败 trace。
- `e2e-full-chain-v3-2026-09-05T05-09-55-964Z.*`：严格网关的 16/16 成功 trace。

这些文件位于 `e2e-full-chain/runs/`。

## 本地测试

- `local-tests/2026-09-05.summary.json`：`npm test` 的 45/45 汇总。

