# 实验索引

本目录把验证拆成三个相互独立的层次，避免“接口能返回”被误当成“模型能组织答案”或“产品全链路可用”。

| 层次 | 目录 | 外部调用 | 回答的问题 | 当前结果 |
|---|---|---|---|---|
| 知乎检索 | `zhihu-retrieval-loop/` | 知乎 | query 能否稳定返回可用材料 | 8/8 调用成功；generated Top-5 usable 0.90，baseline 0.55 |
| DeepSeek 问答 | `deepseek-answer-loop/` | DeepSeek；复用冻结知乎结果 | 模型能否筛选证据并输出合法答案 | `deepseek-chat` 原始 3/4；确定性规范化后 4/4 |
| HTTP 全链路 | `e2e-full-chain/` | DeepSeek + 知乎 | 追问、检索、回答、来源与幂等是否连通 | v3 通过 16/16 |

完整结果与限制见 `../docs/实验总报告-2026-09-05.md`，原始文件解释见 `RAW-DATA-MANIFEST.md`。

## 推荐复现顺序

1. 先运行 `npm test`，不访问外部服务。
2. 对每个外部实验先运行 `--dry-run`，确认输入、模型和最大调用预算。
3. DeepSeek 独立实验只读取已冻结的知乎结果，不再次消耗知乎额度。
4. 全链路实验使用新会话，成功后才执行相同 `client_turn_id` 的幂等重放。
5. 真实运行后查询额度，并保存 `.summary.json` 与逐调用原始文件。

密钥只放在被 Git 忽略的 `.env.local` 和 `.env.zhihu-5000.local`。已选择入库的 `runs/` 文件是可复核数据快照；目录内未来新生成的文件仍由 `.gitignore` 默认忽略，需审查后显式加入。

