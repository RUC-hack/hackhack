import assert from "node:assert/strict";
import test from "node:test";

import { LlmClient } from "../../src/server/integrations/llm-client.mjs";
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

test("gateway redacts secret-like user content before putting it in a model prompt", async () => {
  let prompt = "";
  const gateway = new LlmGateway({ client: { async chatJson({ system }) { prompt = system; return validDecision; } } });
  await gateway.decideNextAction({ raw_messages: [{ role: "user", text: "DEEPSEEK_API_KEY=sk-secret-value" }] });
  assert.equal(prompt.includes("sk-secret-value"), false);
});
