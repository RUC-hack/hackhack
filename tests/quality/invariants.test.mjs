import assert from "node:assert/strict";
import test from "node:test";

import { MockLlmGateway } from "../../src/server/services/mock-llm-gateway.mjs";

test("default answer states limitations instead of a pseudo probability", async () => {
  const answer = await new MockLlmGateway().buildGroundedAnswer({
    session: { current_understanding: { assumptions: [], blocking_unknowns: [] } },
    evidence_packets: [{ source_id: "mock:1", narrative: "一个人选择了不同路径。", unknowns: ["长期结果未知"] }],
    retrieval_meta: { degraded: true },
  });
  const serialized = JSON.stringify(answer);
  assert.match(serialized, /公开经验样本|不是预测/u);
  assert.match(serialized, /本地案例库/u);
  assert.equal(/成功率|成功概率|\d+%\s*成功/u.test(serialized), false);
});
