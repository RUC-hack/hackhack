import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createApp } from "../../src/server/app.mjs";
import { MemorySessionStore } from "../../src/server/storage/memory-session-store.mjs";
import { SourceStore } from "../../src/server/storage/source-store.mjs";
import { MockProvider } from "../../src/server/providers/mock-provider.mjs";
import { MockLlmGateway } from "../../src/server/services/mock-llm-gateway.mjs";

async function startTestApp() {
  const app = createApp({
    env: {
      APP_ENV: "test",
      DATA_PROVIDER: "mock",
      ALLOW_LIVE_EXTERNAL_CALLS: "false",
      CORS_ORIGINS: "http://frontend.test",
      MAX_QUESTIONS: "2",
      RETRIEVAL_QUERY_BUDGET: "3",
      MAX_REQUEST_BYTES: "65536",
      REQUEST_TIMEOUT_MS: "5000",
    },
    sessionStore: new MemorySessionStore(),
    sourceStore: new SourceStore(),
    primaryProvider: new MockProvider(),
    llmGateway: new MockLlmGateway(),
    logger: { async log() {} },
  });
  const server = app.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { app, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

test("HTTP flow creates a session, asks once, retrieves, answers, and exposes sources", async (context) => {
  const running = await startTestApp();
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const created = await jsonRequest(running.baseUrl, "/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://frontend.test" },
    body: JSON.stringify({ problem_statement: "我在考虑考研还是工作" }),
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.ok, true);
  assert.match(created.body.request_id, /^req_/u);
  assert.equal(created.response.headers.get("access-control-allow-origin"), "http://frontend.test");
  const sessionId = created.body.data.session_id;

  const asked = await jsonRequest(running.baseUrl, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "我还说不清", client_turn_id: "turn-1" }),
  });
  assert.equal(asked.response.status, 200);
  assert.equal(asked.body.data.action, "ask");
  assert.equal(asked.body.data.state, "COLLECTING_CONTEXT");

  const answered = await jsonRequest(running.baseUrl, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "我希望尽快独立，但也不想过早放弃探索", client_turn_id: "turn-2" }),
  });
  assert.equal(answered.response.status, 200);
  assert.equal(answered.body.data.action, "respond");
  assert.ok(answered.body.data.answer.sections.length > 0);
  const sourceId = answered.body.data.retrieval.source_ids[0];
  assert.ok(sourceId);

  const source = await jsonRequest(running.baseUrl, `/api/sources/${encodeURIComponent(sourceId)}`);
  assert.equal(source.response.status, 200);
  assert.equal(source.body.data.source_id, sourceId);
  assert.equal(/<[^>]+>/u.test(source.body.data.summary), false);

  const duplicate = await jsonRequest(running.baseUrl, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "我希望尽快独立，但也不想过早放弃探索", client_turn_id: "turn-2" }),
  });
  assert.deepEqual(duplicate.body.data, answered.body.data);

  const session = await jsonRequest(running.baseUrl, `/api/sessions/${sessionId}`);
  assert.equal(session.body.data.raw_messages.length, 2);
  assert.equal(session.body.data.status, "WAITING_FOR_FOLLOW_UP");
});

test("HTTP errors have a stable envelope and never expose a stack", async (context) => {
  const running = await startTestApp();
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const missing = await jsonRequest(running.baseUrl, "/api/sessions/does-not-exist");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.error.code, "SESSION_NOT_FOUND");
  assert.equal("stack" in missing.body.error, false);

  const invalid = await jsonRequest(running.baseUrl, "/api/sessions", { method: "POST", body: "{}" });
  assert.equal(invalid.response.status, 415);
  assert.equal(invalid.body.error.code, "CONTENT_TYPE_REQUIRED");
});

test("safety handling stops the ordinary retrieval flow", async (context) => {
  let providerCalls = 0;
  const provider = new MockProvider({ searchImpl: async () => { providerCalls += 1; return { documents: [], meta: { provider: "mock" } }; } });
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(), primaryProvider: provider, llmGateway: new MockLlmGateway(), logger: { async log() {} },
  });
  const server = app.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const created = await jsonRequest(`http://127.0.0.1:${port}`, "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const id = created.body.data.session_id;
  const result = await jsonRequest(`http://127.0.0.1:${port}`, `/api/sessions/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "我现在不想活了", client_turn_id: "risk-1" }) });
  assert.equal(result.body.data.action, "safety");
  assert.equal(result.body.data.state, "SAFETY_HANDLING");
  assert.equal(providerCalls, 0);
});
