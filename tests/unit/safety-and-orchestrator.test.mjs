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
