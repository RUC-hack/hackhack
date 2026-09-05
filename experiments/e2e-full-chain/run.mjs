import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createApp } from "../../src/server/app.mjs";
import { loadEnvFile } from "../../src/server/config/env.mjs";
import { validateAnswerEnvelope } from "../../src/server/contracts/answer.mjs";
import { MemorySessionStore } from "../../src/server/storage/memory-session-store.mjs";
import { SourceStore } from "../../src/server/storage/source-store.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (["live", "dry-run"].includes(key)) args[key] = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      args[key] = value;
    }
  }
  return args;
}

async function request(baseUrl, pathname, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body, latency_ms: Math.round(performance.now() - startedAt) };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = parseArgs(process.argv.slice(2));
const scenario = JSON.parse(await readFile(path.resolve(args.scenario ?? path.join(here, "scenario.json")), "utf8"));
if (args["dry-run"]) {
  console.log(JSON.stringify({ scenario_id: scenario.scenario_id, external_calls: false, expected: scenario.expected, planned_zhihu_calls_max: scenario.expected.maximum_queries, planned_deepseek_calls: "2 decisions + 1 answer, plus at most one repair per model stage" }, null, 2));
  process.exit(0);
}
if (!args.live) throw new Error("Run --dry-run first, then pass --live");

await loadEnvFile(path.resolve(args.env ?? path.join(root, ".env.local")), { required: true });
await loadEnvFile(path.resolve(args["zhihu-env"] ?? path.join(root, ".env.zhihu-5000.local")), { required: true, override: true });
const env = {
  ...process.env,
  APP_ENV: "experiment",
  DATA_PROVIDER: "zhihu",
  ALLOW_LIVE_EXTERNAL_CALLS: "true",
  MAX_QUESTIONS: "1",
  RETRIEVAL_QUERY_BUDGET: String(scenario.expected.maximum_queries),
  DEEPSEEK_MODEL: args.model ?? "deepseek-chat",
  DEEPSEEK_MAX_TOKENS: "3000",
  DEEPSEEK_TIMEOUT_MS: "90000",
  DEEPSEEK_MAX_RETRIES: "1",
  ZHIHU_TIMEOUT_MS: "30000",
  ZHIHU_MAX_RETRIES: "0",
  REQUEST_TIMEOUT_MS: "240000",
  CACHE_TTL_SECONDS: "0",
};
if (!env.DEEPSEEK_API_KEY || !env.ZHIHU_ACCESS_SECRET) throw new Error("Both DeepSeek and Zhihu credentials are required");

const auditEvents = [];
const app = createApp({
  env,
  sessionStore: new MemorySessionStore(),
  sourceStore: new SourceStore(),
  logger: { async log(event) { auditEvents.push(event); } },
});
const server = app.createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const transcript = [];
let summary;
try {
  const health = await request(baseUrl, "/api/health");
  assert.equal(health.status, 200);
  const created = await request(baseUrl, "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  const sessionId = created.body.data.session_id;

  transcript.push({ actor: "user", turn: 1, text: scenario.initial_message });
  const first = await request(baseUrl, `/api/sessions/${sessionId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: scenario.initial_message, client_turn_id: "e2e-turn-1" }),
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.action, scenario.expected.first_action);
  transcript.push({ actor: "assistant", turn: 1, action: first.body.data.action, payload: first.body.data, latency_ms: first.latency_ms });

  transcript.push({ actor: "user", turn: 2, text: scenario.clarification });
  const secondRequest = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: scenario.clarification, client_turn_id: "e2e-turn-2" }) };
  const second = await request(baseUrl, `/api/sessions/${sessionId}/messages`, secondRequest);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.action, scenario.expected.final_action);
  assert.equal(second.body.data.state, scenario.expected.final_state);
  assert.equal(second.body.data.retrieval.meta.provider, scenario.expected.provider);
  assert.equal(second.body.data.retrieval.meta.degraded, false);
  assert.ok(second.body.data.retrieval.source_ids.length >= scenario.expected.minimum_sources);
  assert.ok(second.body.data.retrieval.queries.length <= scenario.expected.maximum_queries);
  const sourceIds = new Set(second.body.data.retrieval.source_ids);
  const answerValidation = validateAnswerEnvelope(second.body.data.answer, { sourceIds });
  assert.deepEqual(answerValidation, { valid: true, errors: [] });
  transcript.push({ actor: "assistant", turn: 2, action: second.body.data.action, payload: second.body.data, latency_ms: second.latency_ms });

  const sources = [];
  for (const sourceId of sourceIds) {
    const source = await request(baseUrl, `/api/sources/${encodeURIComponent(sourceId)}`);
    assert.equal(source.status, 200);
    assert.equal(source.body.data.source_id, sourceId);
    sources.push(source.body.data);
  }

  const duplicate = await request(baseUrl, `/api/sessions/${sessionId}/messages`, secondRequest);
  assert.deepEqual(duplicate.body.data, second.body.data);
  const finalSession = await request(baseUrl, `/api/sessions/${sessionId}`);
  assert.equal(finalSession.status, 200);
  assert.equal(finalSession.body.data.raw_messages.length, 2);
  assert.equal(finalSession.body.data.status, scenario.expected.final_state);

  summary = {
    schema_version: "1.0", scenario_id: scenario.scenario_id, passed: true,
    action_sequence: [first.body.data.action, second.body.data.action],
    provider: second.body.data.retrieval.meta.provider,
    degraded: second.body.data.retrieval.meta.degraded,
    queries: second.body.data.retrieval.queries,
    source_count: sourceIds.size,
    answer_section_count: second.body.data.answer.sections.length,
    source_readback_count: sources.length,
    idempotency_verified: true,
    final_message_count: finalSession.body.data.raw_messages.length,
    latency_ms: { first_turn: first.latency_ms, second_turn: second.latency_ms, duplicate_turn: duplicate.latency_ms },
  };
  const runId = `e2e-full-chain-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  const outputPath = path.resolve(args.output ?? path.join(here, "runs", `${runId}.json`));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ summary, transcript, sources, health: health.body.data, audit_events: auditEvents }, null, 2)}\n`, "utf8");
  await writeFile(outputPath.replace(/\.json$/u, ".summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, output_path: outputPath }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
