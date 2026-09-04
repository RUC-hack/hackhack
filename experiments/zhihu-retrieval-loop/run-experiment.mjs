import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { envBoolean, loadEnvFile } from "../../src/server/config/env.mjs";
import {
  ZhihuSearchClient,
  ZhihuSearchError,
} from "../../src/server/integrations/zhihu-search-client.mjs";

const BOOLEAN_FLAGS = new Set(["dry-run", "live", "continue-on-rate-limit"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function integerOption(value, fallback, name, minimum, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffled(values, seed) {
  const result = [...values];
  const random = makeRng(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function queriesForCase(testCase, strategy, generatedByCase) {
  if (strategy === "baseline") {
    return [{ id: "baseline", facet: "user_input", query: testCase.user_input }];
  }
  if (strategy === "oracle") return testCase.oracle_queries;
  const generated = generatedByCase.get(testCase.id);
  if (!generated) throw new Error(`Generated query set is missing case ${testCase.id}`);
  return generated;
}

function readJsonLines(text, source) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${source} at line ${index + 1}: ${error.message}`);
    }
  });
}

function taskKey({ attempt, testCase, query }) {
  return `${attempt}|${testCase.id}|${query.id}`;
}

function rowKey(row) {
  return `${row.attempt}|${row.case_id}|${row.query_id}`;
}

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
const envPath = path.resolve(args.env ?? process.env.HACKHACK_ENV_FILE ?? path.join(repositoryRoot, ".env.local"));
await loadEnvFile(envPath, { required: !args["dry-run"] });

const strategy = args.strategy ?? "baseline";
if (!new Set(["baseline", "oracle", "generated"]).has(strategy)) {
  throw new Error("--strategy must be baseline, oracle, or generated");
}
const repetitions = integerOption(args.repetitions, 1, "repetitions", 1, 20);
const count = integerOption(args.count, 10, "count", 1, 10);
const timeoutMs = integerOption(args["timeout-ms"], 15_000, "timeout-ms", 1_000, 120_000);
const delayMs = integerOption(args["delay-ms"], 1_000, "delay-ms", 0, 60_000);
const maxCalls = integerOption(args["max-calls"], Number.MAX_SAFE_INTEGER, "max-calls", 1, 10_000);
const seed = integerOption(args.seed, 20260904, "seed", 1, 0x7fffffff);

const casesPath = path.resolve(args.cases ?? path.join(scriptDirectory, "cases.json"));
const casesDocument = JSON.parse(await readFile(casesPath, "utf8"));
let testCases = casesDocument.cases;
if (!Array.isArray(testCases) || testCases.length === 0) throw new Error("No test cases found");
if (args["case-id"]) {
  const requestedIds = new Set(args["case-id"].split(",").map((value) => value.trim()).filter(Boolean));
  testCases = testCases.filter((testCase) => requestedIds.has(testCase.id));
  const foundIds = new Set(testCases.map((testCase) => testCase.id));
  const missingIds = [...requestedIds].filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) throw new Error(`Unknown --case-id: ${missingIds.join(", ")}`);
}

const generatedByCase = new Map();
let generatedMetadata = null;
if (strategy === "generated") {
  if (!args.generated) throw new Error("--generated is required for generated strategy");
  const generatedDocument = JSON.parse(await readFile(path.resolve(args.generated), "utf8"));
  generatedMetadata = {
    prompt_version: generatedDocument.prompt_version ?? null,
    model: generatedDocument.model ?? null,
    temperature: generatedDocument.temperature ?? null,
  };
  for (const entry of generatedDocument.cases ?? []) {
    if (!Array.isArray(entry.queries) || entry.queries.length === 0) {
      throw new Error(`Generated case ${entry.case_id} has no queries`);
    }
    generatedByCase.set(entry.case_id, entry.queries);
  }
}

const tasks = [];
for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  for (const testCase of testCases) {
    for (const query of queriesForCase(testCase, strategy, generatedByCase)) {
      if (!query.query || typeof query.query !== "string") {
        throw new Error(`Invalid query in ${testCase.id}/${query.id}`);
      }
      tasks.push({ attempt, testCase, query });
    }
  }
}
const orderedTasks = shuffled(tasks, seed);

let previousRows = [];
let outputPath;
let runId;
if (args.resume) {
  if (args.output) throw new Error("--resume and --output cannot be used together");
  outputPath = path.resolve(args.resume);
  previousRows = readJsonLines(await readFile(outputPath, "utf8"), outputPath);
  runId = previousRows[0]?.run_id;
  if (!runId) throw new Error("The resume file contains no run_id");
  if (previousRows.some((row) => row.strategy !== strategy || row.seed !== seed)) {
    throw new Error("The resume file strategy or seed does not match this invocation");
  }
} else {
  runId = `zhihu-${strategy}-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  outputPath = path.resolve(args.output ?? path.join(scriptDirectory, "runs", `${runId}.jsonl`));
}

const completedKeys = new Set(previousRows.filter((row) => row.business_ok).map(rowKey));
const remainingTasks = orderedTasks.filter((task) => !completedKeys.has(taskKey(task)));
const scheduledTasks = remainingTasks.slice(0, maxCalls);

if (args["dry-run"]) {
  console.log(JSON.stringify({
    dry_run: true,
    runner: "retrieval-validation",
    api_url: `${(process.env.ZHIHU_API_BASE_URL || "https://developer.zhihu.com").replace(/\/+$/u, "")}/api/v1/content/zhihu_search`,
    strategy,
    repetitions,
    count,
    seed,
    stop_on_rate_limit: !args["continue-on-rate-limit"],
    planned_total_calls: orderedTasks.length,
    previously_completed_calls: completedKeys.size,
    scheduled_calls: scheduledTasks.length,
    deferred_calls: remainingTasks.length - scheduledTasks.length,
    tasks: scheduledTasks.map(({ attempt, testCase, query }) => ({
      attempt,
      case_id: testCase.id,
      query_id: query.id,
      facet: query.facet,
      query: query.query,
    })),
  }, null, 2));
  process.exit(0);
}

const liveAllowed = args.live || envBoolean(process.env.ALLOW_LIVE_EXTERNAL_CALLS, false);
if (!liveAllowed) {
  throw new Error("Live calls are disabled. Review the dry-run, then pass --live or set ALLOW_LIVE_EXTERNAL_CALLS=true.");
}

const client = new ZhihuSearchClient({
  accessSecret: process.env.ZHIHU_ACCESS_SECRET,
  baseUrl: process.env.ZHIHU_API_BASE_URL || "https://developer.zhihu.com",
  timeoutMs,
  maxRetries: 0,
});

await mkdir(path.dirname(outputPath), { recursive: true });
if (!args.resume) await writeFile(outputPath, "", "utf8");

const invocationRows = [];
let stopReason = null;
for (let index = 0; index < scheduledTasks.length; index += 1) {
  const { attempt, testCase, query } = scheduledTasks[index];
  let result;
  try {
    const raw = await client.searchRaw({ query: query.query, count });
    result = {
      transport_ok: raw.transportOk,
      http_status: raw.httpStatus,
      latency_ms: raw.latencyMs,
      attempt_count: raw.attemptCount,
      schema_valid: raw.validation.valid,
      schema_errors: raw.validation.errors,
      item_count: raw.validation.itemCount,
      response: raw.body,
      non_json_body_preview: raw.nonJsonBodyPreview,
      client_error: null,
    };
  } catch (error) {
    const safeError = error instanceof ZhihuSearchError ? error : new ZhihuSearchError("Unexpected client error");
    result = {
      transport_ok: false,
      http_status: safeError.httpStatus,
      latency_ms: null,
      attempt_count: 1,
      schema_valid: false,
      schema_errors: [safeError.code],
      item_count: 0,
      response: null,
      non_json_body_preview: null,
      client_error: safeError.toJSON(),
    };
  }

  const row = {
    schema_version: "1.1",
    run_id: runId,
    recorded_at: new Date().toISOString(),
    runner: "retrieval-validation",
    strategy,
    generator: generatedMetadata,
    seed,
    request_index: previousRows.length + invocationRows.length + 1,
    attempt,
    case_id: testCase.id,
    decision: testCase.decision,
    query_id: query.id,
    facet: query.facet,
    query: query.query,
    count,
    business_ok: result.response?.Code === 0,
    ...result,
  };
  invocationRows.push(row);
  await appendFile(outputPath, `${JSON.stringify(row)}\n`, "utf8");
  console.error(`[${index + 1}/${scheduledTasks.length}] ${testCase.id}/${query.id}: HTTP ${result.http_status ?? "-"}, Code ${result.response?.Code ?? "-"}, ${result.latency_ms ?? "-"} ms`);

  if (result.response?.Code === 30001 && !args["continue-on-rate-limit"]) {
    stopReason = "ZHIHU_RATE_LIMITED";
    console.error("Paused after Code 30001. Wait for the provider limit to clear, then resume this JSONL file with --resume.");
    break;
  }
  if (index < scheduledTasks.length - 1 && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const rows = [...previousRows, ...invocationRows];
const successfulKeys = new Set(rows.filter((row) => row.business_ok).map(rowKey));
const pendingCalls = orderedTasks.filter((task) => !successfulKeys.has(taskKey(task))).length;
const latencies = rows.map((row) => row.latency_ms).filter(Number.isFinite);
const status = stopReason === "ZHIHU_RATE_LIMITED"
  ? "rate_limited"
  : pendingCalls > 0
    ? "paused"
    : "complete";
const summary = {
  schema_version: "1.1",
  run_id: runId,
  status,
  stop_reason: stopReason,
  output_path: outputPath,
  resume_supported: true,
  planned_total_calls: orderedTasks.length,
  invocation_calls: invocationRows.length,
  cumulative_calls: rows.length,
  completed_task_keys: successfulKeys.size,
  pending_calls: pendingCalls,
  transport_successes: rows.filter((row) => row.transport_ok).length,
  business_successes: rows.filter((row) => row.business_ok).length,
  rate_limited_responses: rows.filter((row) => row.response?.Code === 30001).length,
  schema_valid_responses: rows.filter((row) => row.schema_valid).length,
  empty_successes: rows.filter((row) => row.business_ok && row.item_count === 0).length,
  latency_ms: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.max(...latencies) : null,
  },
};
const summaryPath = outputPath.replace(/\.jsonl$/iu, ".summary.json");
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
