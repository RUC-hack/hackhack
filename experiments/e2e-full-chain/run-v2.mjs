import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createApp } from "../../src/server/app.mjs";
import { loadEnvFile } from "../../src/server/config/env.mjs";
import { validateAnswerEnvelope } from "../../src/server/contracts/answer.mjs";
import { ResilientLlmClient } from "../../src/server/integrations/resilient-llm-client.mjs";
import { LlmGateway } from "../../src/server/services/llm-gateway.mjs";
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
  return { status: response.status, body: await response.json(), latency_ms: Math.round(performance.now() - startedAt) };
}

function check(condition, code, checks) {
  checks.push({ code, passed: Boolean(condition) });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = parseArgs(process.argv.slice(2));
const scenario = JSON.parse(await readFile(path.resolve(args.scenario ?? path.join(here, "scenario.json")), "utf8"));
if (args["dry-run"]) {
  console.log(JSON.stringify({ scenario_id: scenario.scenario_id, client: "ResilientLlmClient", external_calls: false, maximum_zhihu_calls: scenario.expected.maximum_queries }, null, 2));
  process.exit(0);
}
if (!args.live) throw new Error("Run --dry-run first, then pass --live");
await loadEnvFile(path.resolve(args.env ?? path.join(root, ".env.local")), { required: true });
await loadEnvFile(path.resolve(args["zhihu-env"] ?? path.join(root, ".env.zhihu-5000.local")), { required: true, override: true });
const env = { ...process.env, APP_ENV: "experiment", DATA_PROVIDER: "zhihu", ALLOW_LIVE_EXTERNAL_CALLS: "true", MAX_QUESTIONS: "1", RETRIEVAL_QUERY_BUDGET: String(scenario.expected.maximum_queries), DEEPSEEK_MODEL: args.model ?? "deepseek-chat", DEEPSEEK_MAX_TOKENS: "3000", DEEPSEEK_TIMEOUT_MS: "90000", ZHIHU_TIMEOUT_MS: "30000", ZHIHU_MAX_RETRIES: "0", REQUEST_TIMEOUT_MS: "240000", CACHE_TTL_SECONDS: "0" };
const resilientClient = new ResilientLlmClient({ apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL, timeoutMs: 90_000, maxRetries: 1, maxTokens: 3_000 });
const auditEvents = [];
const app = createApp({ env, sessionStore: new MemorySessionStore(), sourceStore: new SourceStore(), llmGateway: new LlmGateway({ client: resilientClient }), logger: { async log(event) { auditEvents.push(event); } } });
const server = app.createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const runId = `e2e-full-chain-v2-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
const outputPath = path.resolve(args.output ?? path.join(here, "runs", `${runId}.json`));
const record = { schema_version: "1.0", run_id: runId, scenario, checks: [], transcript: [], sources: [], audit_events: auditEvents };
try {
  const health = await request(baseUrl, "/api/health");
  record.health = health;
  check(health.status === 200, "health_200", record.checks);
  const created = await request(baseUrl, "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  record.created = created;
  check(created.status === 200 && created.body.ok, "session_created", record.checks);
  const sessionId = created.body?.data?.session_id;
  if (sessionId) {
    const firstRequest = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: scenario.initial_message, client_turn_id: "e2e-turn-1" }) };
    record.transcript.push({ actor: "user", turn: 1, text: scenario.initial_message });
    const first = await request(baseUrl, `/api/sessions/${sessionId}/messages`, firstRequest);
    record.transcript.push({ actor: "assistant", turn: 1, response: first });
    check(first.status === 200, "first_turn_200", record.checks);
    check(first.body?.data?.action === scenario.expected.first_action, "first_turn_asks", record.checks);

    const secondRequest = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: scenario.clarification, client_turn_id: "e2e-turn-2" }) };
    record.transcript.push({ actor: "user", turn: 2, text: scenario.clarification });
    const second = await request(baseUrl, `/api/sessions/${sessionId}/messages`, secondRequest);
    record.transcript.push({ actor: "assistant", turn: 2, response: second });
    check(second.status === 200, "second_turn_200", record.checks);
    check(second.body?.data?.action === scenario.expected.final_action, "second_turn_responds", record.checks);
    check(second.body?.data?.state === scenario.expected.final_state, "final_state", record.checks);
    check(second.body?.data?.retrieval?.meta?.provider === scenario.expected.provider, "provider_is_zhihu", record.checks);
    check(second.body?.data?.retrieval?.meta?.degraded === false, "not_degraded", record.checks);
    const sourceIds = new Set(second.body?.data?.retrieval?.source_ids ?? []);
    check(sourceIds.size >= scenario.expected.minimum_sources, "sources_present", record.checks);
    check((second.body?.data?.retrieval?.queries?.length ?? Infinity) <= scenario.expected.maximum_queries, "query_budget", record.checks);
    const answerValidation = validateAnswerEnvelope(second.body?.data?.answer, { sourceIds });
    record.answer_validation = answerValidation;
    check(answerValidation.valid, "answer_contract", record.checks);
    for (const sourceId of sourceIds) {
      const source = await request(baseUrl, `/api/sources/${encodeURIComponent(sourceId)}`);
      if (source.status === 200) record.sources.push(source.body.data);
    }
    check(record.sources.length === sourceIds.size, "source_readback", record.checks);
    const duplicate = await request(baseUrl, `/api/sessions/${sessionId}/messages`, secondRequest);
    record.duplicate = duplicate;
    check(JSON.stringify(duplicate.body?.data) === JSON.stringify(second.body?.data), "idempotent_second_turn", record.checks);
    const finalSession = await request(baseUrl, `/api/sessions/${sessionId}`);
    record.final_session = finalSession;
    check(finalSession.body?.data?.raw_messages?.length === 2, "message_count_stable", record.checks);
  }
} catch (error) {
  record.runner_error = { message: error.message };
} finally {
  await new Promise((resolve) => server.close(resolve));
}
record.summary = {
  passed: record.checks.length > 0 && record.checks.every((item) => item.passed),
  passed_checks: record.checks.filter((item) => item.passed).length,
  total_checks: record.checks.length,
  failed_checks: record.checks.filter((item) => !item.passed).map((item) => item.code),
  action_sequence: record.transcript.filter((item) => item.actor === "assistant").map((item) => item.response.body?.data?.action ?? item.response.body?.error?.code),
  query_count: record.transcript.at(-1)?.response?.body?.data?.retrieval?.queries?.length ?? 0,
  source_count: record.sources.length,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
await writeFile(outputPath.replace(/\.json$/u, ".summary.json"), `${JSON.stringify(record.summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...record.summary, output_path: outputPath }, null, 2));
if (!record.summary.passed) process.exitCode = 1;
