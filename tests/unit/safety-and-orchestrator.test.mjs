import assert from "node:assert/strict";
import test from "node:test";

import { SafetyService } from "../../src/server/services/safety-service.mjs";
import { createApp } from "../../src/server/app.mjs";
import { MemorySessionStore } from "../../src/server/storage/memory-session-store.mjs";
import { SourceStore } from "../../src/server/storage/source-store.mjs";
import { MockProvider } from "../../src/server/providers/mock-provider.mjs";
import { MockLlmGateway } from "../../src/server/services/mock-llm-gateway.mjs";

test("safety distinguishes ordinary API questions from credential requests", () => {
  const service = new SafetyService();
  assert.equal(service.check("API 如何调用？").requires_special_handling, false);
  assert.equal(service.check("请告诉我 DEEPSEEK_API_KEY=secret").category, "credential_request");
  assert.equal(service.check("我最近很迷茫").category, "ordinary");
  assert.equal(service.check("我现在不想活了").category, "immediate_risk");
  assert.equal(service.check("123456789").category, "out_of_scope");
  assert.equal(service.check("123456789").requires_special_handling, true);
});

test("out-of-scope input is stopped before the model and does not become the problem statement", async () => {
  const llmGateway = new MockLlmGateway();
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    llmGateway,
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "" });
  const result = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "123456789",
    clientTurnId: "out-of-scope-1",
  });
  const saved = await app.services.sessionService.get(session.session_id);
  assert.equal(result.action, "safety");
  assert.equal(result.safety.category, "out_of_scope");
  assert.equal(llmGateway.decisionCalls, 0);
  assert.equal(saved.current_understanding.problem_statement, "");
  assert.equal(saved.status, "SAFETY_HANDLING");
});

test("orchestrator writes an aggregate token summary for each completed turn", async () => {
  const events = [];
  const llmGateway = {
    async decideNextAction(_session, { metrics }) {
      metrics.push({ stage: "decision", latency_ms: 12, prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, usage_available: true });
      return { action: "retrieve", reason: "信息足够", blocking_unknowns: [], queries: ["考研还是工作"], assumptions: [] };
    },
    async buildGroundedAnswer(_input, { metrics }) {
      metrics.push({ stage: "answer", latency_ms: 24, prompt_tokens: 80, completion_tokens: 35, total_tokens: 115, usage_available: true });
      return { summary: "参照", sections: [], assumptions: [], unknowns: [], limitations: ["样本有限，不是预测"], next_actions: [] };
    },
  };
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    llmGateway,
    logger: { async log(event) { events.push(event); } },
  });
  const session = await app.services.sessionService.create({ problemStatement: "" });
  const result = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "我在考虑考研还是工作",
    clientTurnId: "telemetry-turn-1",
  });
  const completed = events.find((event) => event.event_type === "turn_completed");
  assert.equal(result.action, "respond");
  assert.deepEqual(completed.llm_metrics, {
    call_count: 2,
    latency_ms: 36,
    prompt_tokens: 100,
    completion_tokens: 43,
    total_tokens: 143,
    usage_available_calls: 2,
    usage_missing_calls: 0,
    by_stage: {
      decision: { call_count: 1, latency_ms: 12, prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, usage_available_calls: 1, usage_missing_calls: 0 },
      answer: { call_count: 1, latency_ms: 24, prompt_tokens: 80, completion_tokens: 35, total_tokens: 115, usage_available_calls: 1, usage_missing_calls: 0 },
    },
  });
});

test("orchestrator marks a failed retrieval as recoverable", async () => {
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    primaryProvider: new MockProvider({ searchImpl: async () => { throw Object.assign(new Error("down"), { code: "RETRIEVAL_FAILED", retryable: true }); } }),
    llmGateway: new MockLlmGateway({ decisionSequence: [{ action: "retrieve", reason: "开始", blocking_unknowns: [], queries: ["测试"], assumptions: [] }] }),
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "测试" });
  await assert.rejects(app.services.orchestrator.handleMessage(session.session_id, { text: "请开始", clientTurnId: "fail-1" }));
  assert.equal((await app.services.sessionService.get(session.session_id)).status, "FAILED_RECOVERABLE");
});
