import assert from "node:assert/strict";
import test from "node:test";

import { ValidatedLlmGateway } from "../../src/server/services/validated-llm-gateway.mjs";

test("validated gateway gives the model concrete decision errors and the invalid JSON", async () => {
  const requests = [];
  const gateway = new ValidatedLlmGateway({ client: { async chatJson(request) {
    requests.push(request);
    return requests.length === 1
      ? { action: "ask", reason: "信息不足", blocking_unknowns: ["具体选项"], queries: ["不应检索"], assumptions: [] }
      : { action: "ask", reason: "信息不足", blocking_unknowns: ["具体选项"], question: { text: "你在比较哪两个选项？" }, queries: [], assumptions: [] };
  } } });

  const value = await gateway.decideNextAction({ raw_messages: [] });
  assert.equal(value.action, "ask");
  assert.equal(requests.length, 2);
  assert.match(requests[1].user, /question_required/u);
  assert.match(requests[1].user, /queries_only_allowed_for_retrieve/u);
  assert.match(requests[1].user, /不应检索/u);
});

test("validated gateway forwards per-round telemetry to every model call", async () => {
  const requests = [];
  const metrics = [];
  const gateway = new ValidatedLlmGateway({ client: { async chatJson(request) {
    requests.push(request);
    request.onMetrics?.({ stage: request.stage, usage_available: true, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, latency_ms: 3 });
    return requests.length === 1
      ? { action: "ask", reason: "信息不足", blocking_unknowns: ["具体选项"], queries: ["不应检索"], assumptions: [] }
      : { action: "ask", reason: "信息不足", blocking_unknowns: ["具体选项"], question: { text: "你在比较哪两个选项？" }, queries: [], assumptions: [] };
  } } });

  await gateway.decideNextAction({ session_id: "session-telemetry", raw_messages: [] }, { requestId: "req-telemetry", metrics });
  assert.equal(requests.length, 2);
  assert.equal(metrics.length, 2);
  assert.deepEqual(requests.map((request) => ({ requestId: request.requestId, sessionId: request.sessionId, stage: request.stage })), [
    { requestId: "req-telemetry", sessionId: "session-telemetry", stage: "decision" },
    { requestId: "req-telemetry", sessionId: "session-telemetry", stage: "decision" },
  ]);
});

test("validated gateway repairs answer citations before they reach AnswerBuilder", async () => {
  let calls = 0;
  const base = { summary: "参照", sections: [{ kind: "case", title: "经历", content: "材料中的经历", source_ids: ["not-allowed"] }], assumptions: [], unknowns: [], limitations: ["样本有限，这不是预测"], next_actions: [] };
  const gateway = new ValidatedLlmGateway({ client: { async chatJson({ user }) {
    calls += 1;
    if (calls === 1) return base;
    assert.match(user, /source_id_not_found/u);
    return { ...base, sections: [{ ...base.sections[0], source_ids: ["zhihu:answer:1"] }] };
  } } });

  const answer = await gateway.buildGroundedAnswer({ evidence_packets: [{ source_id: "zhihu:answer:1" }] });
  assert.deepEqual(answer.sections[0].source_ids, ["zhihu:answer:1"]);
  assert.equal(calls, 2);
});

test("validated gateway stops after its bounded repair budget", async () => {
  let calls = 0;
  const gateway = new ValidatedLlmGateway({
    client: { async chatJson() { calls += 1; return { action: "invalid", reason: "bad" }; } },
    maxRepairAttempts: 1,
  });
  await assert.rejects(gateway.decideNextAction({ raw_messages: [] }), (error) => error.code === "LLM_INVALID_RESPONSE");
  assert.equal(calls, 2);
});

