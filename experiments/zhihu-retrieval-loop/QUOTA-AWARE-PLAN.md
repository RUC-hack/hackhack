# 低额度条件下的知乎检索实验

## 为什么重设计

现有观察是：一次窗口内获得 10 次业务成功后，后续请求返回 `Code 30001`；官方没有公开窗口长度。原方案的 96 次调用无法在黑客松周期内稳定完成，而且把限流响应继续发完不会增加证据。

新方案采用序贯验证：每一步先回答一个会影响下一步的判断，只在通过质量门后继续消耗知乎额度。

## 总额度纪律

- 暂按每个未知窗口最多 10 次成功调用规划，但不声称这是官方规则。
- 每个窗口最多安排 8 次，保留 2 次余量。
- 调用间隔固定为 15 秒，减少短时突发的影响。
- 第一个 `30001` 出现后立即停止，同一窗口不再探测。
- 业务码 `30001` 单独报告，不进入相关性和内容质量的失败分母。
- 不轮换 Secret 绕过限制。

机器可读的预注册计划见 `quota-study-plan.json`。

## 阶段 0：利用已有数据，不再调用知乎

已有 Oracle 先导运行包含：

- 10 次业务成功；
- 100 条返回结果；
- 覆盖 C01、C03、C05、C06、C07、C08 六个案例。

先生成 Top 5 人工标注表：

```powershell
node .\experiments\zhihu-retrieval-loop\analyze.mjs `
  --results .\experiments\zhihu-retrieval-loop\runs\zhihu-oracle-2026-09-04T13-36-23-657Z.jsonl `
  --prepare-annotations .\experiments\zhihu-retrieval-loop\runs\oracle-pilot-annotations.jsonl
```

对每条材料标注 `relevance`、`lived_experience`、`evidence_sufficiency`、`usable` 和开放式 `path_label`。

停止条件：如果 Oracle 先导数据的 `usable precision@5 < 0.60`，或大部分摘要无法支撑“选择—结果/代价”关系，不再花额度比较 Query Builder；优先处理摘要能力或产品边界。

## 阶段 1：生成查询，不调用知乎

选择四个差异明显且已有 Oracle 参照的案例：

- C01：考研或就业；
- C03：大城市互联网或家乡银行；
- C05：本专业保研或跨专业；
- C07：考研二战或工作。

使用固定提示词和固定模型，一次 DeepSeek 请求为每个案例生成一条 query：

```powershell
node .\experiments\zhihu-retrieval-loop\build-single-queries.mjs `
  --case-id C01,C03,C05,C07 `
  --output .\.runtime\experiments\single-queries-quota-v1.json `
  --live
```

生成后只检查格式、缺失和违规假设，不根据“看起来是否容易搜到结果”人工改写。否则会引入挑选偏差。

## 阶段 2：下一个可用窗口运行 8 次配对调用

每个案例比较：

- `baseline`：用户原话直接搜索；
- `generated`：Query Builder 的单条 query。

调用顺序已经在 `quota-study-plan.json` 中交错并预注册，避免所有 baseline 都在窗口前半段、所有 generated 都在后半段。

先检查计划：

```powershell
node .\experiments\zhihu-retrieval-loop\run-quota-study.mjs `
  --generated .\.runtime\experiments\single-queries-quota-v1.json `
  --dry-run
```

确认 Access Secret 已更换、限流窗口已解除后再联网：

```powershell
node .\experiments\zhihu-retrieval-loop\run-quota-study.mjs `
  --generated .\.runtime\experiments\single-queries-quota-v1.json `
  --live
```

runner 默认最多 8 次、间隔 15 秒，并在第一个 `30001` 后暂停。

如果暂停，等待下一窗口后续跑同一文件：

```powershell
node .\experiments\zhihu-retrieval-loop\run-quota-study.mjs `
  --generated .\.runtime\experiments\single-queries-quota-v1.json `
  --resume .\experiments\zhihu-retrieval-loop\runs\quota-paired-v1-....jsonl `
  --live
```

## 阶段 3：冻结结果并盲评，不调用知乎

只对 `Code 0` 的响应进行内容质量评估。每个 case/condition 去重后取 Top 5，并隐藏 `baseline/generated` 标签交给评审。

主要通过门：

- 四个案例中至少三个，generated 找到至少两条 usable 来源；
- 四个案例中至少三个，generated 的 usable 数量不低于 baseline；
- generated 合并后的 `usable precision@5 >= 0.50`。

样本量只有四个配对案例，所以报告逐案例差值和总量，不做“对所有用户显著有效”的总体推断。

## 阶段 4：验证多查询的增量价值

只有阶段 2 通过后才进入。另选两个案例，各新增最多三条互补 query，总计不超过 6 次调用。比较新增 query 带来的“去重后新增 usable 来源数”，而不是重复计算返回条数。

如果新增 6 次调用没有带来至少 2 条新的 usable 来源，产品默认每次只生成一条 query；只有材料不足时再按需扩展。

## 阶段 5：回答构建测试，不调用知乎

冻结成功响应后，对相同证据分别运行普通总结提示词和证据约束提示词。检查：

- 事实性陈述引用覆盖率至少 95%；
- 无依据陈述率不超过 5%；
- 每个来源保留标题、作者、摘要与 URL；
- 明确告诉用户这些是人生参照，不是总体概率。

## 产品演示策略

比赛演示不能依赖现场知乎额度：

1. 在线可用时走 `ZhihuProvider`，重复 query 命中缓存；
2. 限流时由 `RetrievalService` 切换本地案例 Provider；
3. 只有通过人工审核的冻结来源才能晋升到本地演示数据；
4. 实验原始 JSONL 不直接作为前端接口。

这样，知乎额度用于验证和补充材料，而不是成为演示能否成功的单点故障。
