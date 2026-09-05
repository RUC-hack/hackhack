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

test("safety preserves contextual replies to a pending question", () => {
  const service = new SafetyService();
  const session = {
    status: "COLLECTING_CONTEXT",
    pending_question: { text: "你所在的行业是什么？" },
    current_understanding: { problem_statement: "选择在上海还是北京工作" },
  };
  assert.equal(service.check("互联网/科技行业", { session }).requires_special_handling, false);
  assert.equal(service.check("123456789", { session }).requires_special_handling, true);
  assert.equal(service.check("互联网/科技行业").requires_special_handling, true);
});

test("orchestrator treats a short answer as context instead of refusing it", async () => {
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    llmGateway: new MockLlmGateway(),
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "" });
  const first = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "我是选择在上海工作还是在北京",
    clientTurnId: "contextual-first",
  });
  assert.equal(first.action, "ask");
  const second = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "互联网/科技行业",
    clientTurnId: "contextual-second",
  });
  assert.notEqual(second.action, "safety");
});

test("orchestrator permits four bounded clarification rounds before retrieval", async () => {
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false", MAX_QUESTIONS: "4" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    llmGateway: new MockLlmGateway(),
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "" });
  const inputs = ["我在考虑去哪里工作", "互联网/科技行业", "更看重成长", "希望离家近", "请开始"];
  const results = [];
  for (const [index, text] of inputs.entries()) {
    results.push(await app.services.orchestrator.handleMessage(session.session_id, {
      text,
      clientTurnId: `multi-round-${index}`,
    }));
  }

  assert.deepEqual(results.slice(0, 4).map((result) => result.action), ["ask", "ask", "ask", "ask"]);
  assert.equal(results[4].action, "respond");
  assert.equal((await app.services.sessionService.get(session.session_id)).question_count, 4);
});

test("orchestrator exits a repeated model question instead of looping", async () => {
  const repeatedQuestion = {
    action: "ask",
    reason: "还需要一点背景",
    blocking_unknowns: ["行业"],
    question: { text: "你所在的行业是什么？", suggestions: ["互联网", "金融"] },
    queries: [],
    assumptions: [],
  };
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(),
    llmGateway: new MockLlmGateway({ decisionSequence: [repeatedQuestion, repeatedQuestion] }),
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "" });
  const first = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "我在考虑北京还是上海工作",
    clientTurnId: "repeated-question-first",
  });
  const second = await app.services.orchestrator.handleMessage(session.session_id, {
    text: "我在考虑换工作，行业还没有完全确定",
    clientTurnId: "repeated-question-second",
  });

  assert.equal(first.action, "ask");
  assert.equal(second.action, "respond");
  assert.ok(second.retrieval.queries.length >= 1);
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
    async selectSources(input, { metrics }) {
      metrics.push({ stage: "selection", latency_ms: 6, prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, usage_available: true });
      return { groups: input.evidence_packets.length ? [{ key: "case", title: "相关经历", description: "与当前问题相关的材料。", items: [{ source_id: input.evidence_packets[0].source_id, reason: "与当前问题相关。" }] }] : [] };
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
    call_count: 3,
    latency_ms: 42,
    prompt_tokens: 140,
    completion_tokens: 55,
    total_tokens: 195,
    usage_available_calls: 3,
    usage_missing_calls: 0,
    by_stage: {
      decision: { call_count: 1, latency_ms: 12, prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, usage_available_calls: 1, usage_missing_calls: 0 },
      selection: { call_count: 1, latency_ms: 6, prompt_tokens: 40, completion_tokens: 12, total_tokens: 52, usage_available_calls: 1, usage_missing_calls: 0 },
      answer: { call_count: 1, latency_ms: 24, prompt_tokens: 80, completion_tokens: 35, total_tokens: 115, usage_available_calls: 1, usage_missing_calls: 0 },
    },
  });
});

test("orchestrator analyzes only the sources selected for presentation", async () => {
  let analyzedSourceIds = null;
  const llmGateway = new MockLlmGateway({
    decisionSequence: [{ action: "retrieve", reason: "信息足够", blocking_unknowns: [], queries: ["考研还是工作"], assumptions: [] }],
    selectionFactory: async (input) => ({
      groups: [{
        key: "selected",
        title: "筛出的经历",
        description: "与当前问题相关的材料。",
        items: [{ source_id: input.evidence_packets[1].source_id, reason: "与当前问题相关。" }],
      }],
    }),
    answerFactory: async (input) => {
      analyzedSourceIds = input.evidence_packets.map((packet) => packet.source_id);
      return { summary: "参照", sections: [{ kind: "case", title: "筛选后的经历", content: "基于已筛选材料。", source_ids: analyzedSourceIds }], assumptions: [], unknowns: [], limitations: ["样本有限，不是预测"], next_actions: [] };
    },
  });
  const app = createApp({
    env: { APP_ENV: "test", DATA_PROVIDER: "mock", ALLOW_LIVE_EXTERNAL_CALLS: "false" },
    sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(), llmGateway, logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "考研还是工作" });
  const answered = await app.services.orchestrator.handleMessage(session.session_id, { text: "请开始", clientTurnId: "selection-analysis-1" });
  assert.equal(answered.action, "respond");
  assert.equal(answered.analysis.status, "completed");
  assert.deepEqual(analyzedSourceIds, [answered.source_selection.groups[0].items[0].source_id]);
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
