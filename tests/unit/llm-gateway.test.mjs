import assert from "node:assert/strict";
import test from "node:test";

import { LlmClient } from "../../src/server/integrations/llm-client.mjs";
import { ResilientLlmClient } from "../../src/server/integrations/resilient-llm-client.mjs";
import { LlmGateway } from "../../src/server/services/llm-gateway.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const validDecision = { action: "respond", reason: "信息足够", blocking_unknowns: [], queries: [], assumptions: [] };

test("LLM client sends structured JSON requests without exposing the API key in the prompt", async () => {
  let captured;
  const client = new LlmClient({
    apiKey: "sk-test-secret-value",
    fetchImpl: async (url, options) => { captured = { url, options }; return response({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }); },
    maxRetries: 0,
  });
  const value = await client.chatJson({ system: "系统规则", user: "返回 JSON" });
  assert.deepEqual(value, { ok: true });
  assert.match(captured.options.headers.Authorization, /Bearer sk-test/u);
  assert.equal(captured.options.body.includes("sk-test-secret-value"), false);
});

test("resilient LLM client records call latency and token usage without logging prompt content", async () => {
  const metrics = [];
  const logs = [];
  const client = new ResilientLlmClient({
    apiKey: "sk-test-secret-value",
    maxRetries: 0,
    logger: { async log(event) { logs.push(event); } },
    fetchImpl: async () => response({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 },
    }),
  });

  const value = await client.chatJson({
    system: "不要把这段规则写进日志",
    user: "包含用户上下文的提示",
    requestId: "req-telemetry",
    sessionId: "session-telemetry",
    stage: "decision",
    callLabel: "decision_validation_1",
    onMetrics: (metric) => metrics.push(metric),
  });

  assert.deepEqual(value, { ok: true });
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].provider, "deepseek");
  assert.equal(metrics[0].stage, "decision");
  assert.equal(metrics[0].attempt, 1);
  assert.equal(metrics[0].latency_ms >= 0, true);
  assert.deepEqual({
    prompt_tokens: metrics[0].prompt_tokens,
    completion_tokens: metrics[0].completion_tokens,
    total_tokens: metrics[0].total_tokens,
  }, { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event_type, "llm_call_completed");
  assert.equal("system" in logs[0], false);
  assert.equal("user" in logs[0], false);
});

test("invalid model JSON is repaired at most once and then validated", async () => {
  let calls = 0;
  const gateway = new LlmGateway({
    client: {
      async chatJson() {
        calls += 1;
        return calls === 1 ? { action: "not-allowed", reason: "bad" } : validDecision;
      },
    },
  });
  const value = await gateway.decideNextAction({ raw_messages: [] });
  assert.equal(value.action, "respond");
  assert.equal(calls, 2);
});

test("gateway normalizes a string question returned by the model", async () => {
  const gateway = new LlmGateway({
    client: { async chatJson() { return { action: "ask", reason: "还需要一点背景", question: "你最在意什么？", queries: [], assumptions: [] }; } },
  });
  const value = await gateway.decideNextAction({ raw_messages: [] });
  assert.deepEqual(value.question, { text: "你最在意什么？", suggestions: [] });
});

test("invalid model JSON does not execute repair when repair is disabled", async () => {
  let calls = 0;
  const gateway = new LlmGateway({ client: { async chatJson() { calls += 1; return { action: "not-allowed", reason: "bad" }; } }, repair: false });
  await assert.rejects(gateway.decideNextAction({ raw_messages: [] }), /invalid|AgentDecision/u);
  assert.equal(calls, 1);
});

test("LLM client classifies malformed JSON as invalid response", async () => {
  const client = new LlmClient({ apiKey: "test", maxRetries: 2, sleep: async () => {}, fetchImpl: async () => new Response("not-json", { status: 200 }) });
  await assert.rejects(client.chatJson({ system: "x", user: "y" }), (error) => error.code === "LLM_INVALID_RESPONSE");
});

test("LLM client classifies length-truncated output separately", async () => {
  const client = new LlmClient({ apiKey: "test", maxRetries: 0, fetchImpl: async () => response({ choices: [{ finish_reason: "length", message: { content: "" } }] }) });
  await assert.rejects(client.chatJson({ system: "x", user: "y" }), (error) => error.code === "LLM_OUTPUT_TRUNCATED");
});

test("gateway redacts secret-like user content before putting it in a model prompt", async () => {
  let prompt = "";
  const gateway = new LlmGateway({ client: { async chatJson({ system }) { prompt = system; return validDecision; } } });
  await gateway.decideNextAction({ raw_messages: [{ role: "user", text: "DEEPSEEK_API_KEY=sk-secret-value" }] });
  assert.equal(prompt.includes("sk-secret-value"), false);
});
