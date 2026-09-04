import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { envBoolean, loadEnvFile } from "../../src/server/config/env.mjs";
import { ZhihuSearchClient, ZhihuSearchError } from "../../src/server/integrations/zhihu-search-client.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run" || key === "live") {
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

function readJsonLines(text, source) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${source} at line ${index + 1}: ${error.message}`);
    }
  });
}

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
await loadEnvFile(path.resolve(args.env ?? path.join(repositoryRoot, ".env.local")), {
  required: !args["dry-run"],
});

const planPath = path.resolve(args.plan ?? path.join(scriptDirectory, "quota-study-plan.json"));
const plan = JSON.parse(await readFile(planPath, "utf8"));
const casesPath = path.resolve(args.cases ?? path.join(scriptDirectory, "cases.json"));
const casesDocument = JSON.parse(await readFile(casesPath, "utf8"));
const casesById = new Map(casesDocument.cases.map((entry) => [entry.id, entry]));
if (!args.generated) throw new Error("--generated is required; create it with build-single-queries.mjs");
const generatedPath = path.resolve(args.generated);
const generatedDocument = JSON.parse(await readFile(generatedPath, "utf8"));
const generatedById = new Map(generatedDocument.cases.map((entry) => [entry.case_id, entry]));

const tasks = plan.paired_stage.schedule.map((scheduled) => {
  const testCase = casesById.get(scheduled.case_id);
  if (!testCase) throw new Error(`Plan references unknown case ${scheduled.case_id}`);
  if (scheduled.condition === "baseline") {
    return { ...scheduled, query_id: "baseline", query: testCase.user_input };
  }
  const generated = generatedById.get(scheduled.case_id)?.queries;
  if (!Array.isArray(generated) || generated.length !== 1) {
    throw new Error(`${scheduled.case_id} must have exactly one generated query`);
  }
  return { ...scheduled, query_id: generated[0].id, query: generated[0].query };
});

const count = integerOption(args.count, plan.paired_stage.count_per_call, "count", 1, 10);
const delayMs = integerOption(
  args["delay-ms"],
  plan.assumptions.delay_ms_between_calls,
  "delay-ms",
  0,
  120_000,
);
const maxCalls = integerOption(
  args["max-calls"],
  plan.assumptions.calls_budgeted_per_window,
  "max-calls",
  1,
  plan.assumptions.calls_budgeted_per_window,
);
const timeoutMs = integerOption(args["timeout-ms"], 15_000, "timeout-ms", 1_000, 120_000);

let previousRows = [];
let outputPath;
let runId;
if (args.resume) {
  if (args.output) throw new Error("--resume and --output cannot be combined");
  outputPath = path.resolve(args.resume);
  previousRows = readJsonLines(await readFile(outputPath, "utf8"), outputPath);
  runId = previousRows[0]?.run_id;
  if (!runId || previousRows.some((row) => row.study_id !== plan.study_id)) {
    throw new Error("Resume file does not belong to this quota study");
  }
} else {
  runId = `${plan.study_id}-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  outputPath = path.resolve(args.output ?? path.join(scriptDirectory, "runs", `${runId}.jsonl`));
}

const completed = new Set(previousRows.filter((row) => row.business_ok).map((row) => row.task_id));
const remaining = tasks.filter((task) => !completed.has(task.task_id));
const scheduled = remaining.slice(0, maxCalls);

if (args["dry-run"]) {
  console.log(JSON.stringify({
    dry_run: true,
    study_id: plan.study_id,
    calls_budgeted_this_window: maxCalls,
    calls_reserved_this_window: plan.assumptions.observed_successful_calls_before_block - maxCalls,
    delay_ms: delayMs,
    stop_on_first_rate_limit: true,
    previously_completed: completed.size,
    scheduled_calls: scheduled.length,
    remaining_after_batch: remaining.length - scheduled.length,
    generated_file: generatedPath,
    tasks: scheduled.map(({ position, task_id, case_id, condition, query_id, query }) => ({
      position,
      task_id,
      case_id,
      condition,
      query_id,
      query,
    })),
  }, null, 2));
  process.exit(0);
}

const liveAllowed = args.live || envBoolean(process.env.ALLOW_LIVE_EXTERNAL_CALLS, false);
if (!liveAllowed) throw new Error("Live calls are disabled. Review --dry-run, then pass --live.");

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
for (let index = 0; index < scheduled.length; index += 1) {
  const task = scheduled[index];
  let result;
  try {
    const raw = await client.searchRaw({ query: task.query, count });
    result = {
      transport_ok: raw.transportOk,
      http_status: raw.httpStatus,
      latency_ms: raw.latencyMs,
      schema_valid: raw.validation.valid,
      schema_errors: raw.validation.errors,
      item_count: raw.validation.itemCount,
      response: raw.body,
      client_error: null,
    };
  } catch (error) {
    const safe = error instanceof ZhihuSearchError ? error : new ZhihuSearchError("Unexpected client error");
    result = {
      transport_ok: false,
      http_status: safe.httpStatus,
      latency_ms: null,
      schema_valid: false,
      schema_errors: [safe.code],
      item_count: 0,
      response: null,
      client_error: safe.toJSON(),
    };
  }

  const row = {
    schema_version: "1.0",
    study_id: plan.study_id,
    run_id: runId,
    recorded_at: new Date().toISOString(),
    request_index: previousRows.length + invocationRows.length + 1,
    position: task.position,
    task_id: task.task_id,
    case_id: task.case_id,
    condition: task.condition,
    strategy: task.condition,
    query_id: task.query_id,
    query: task.query,
    count,
    generated_prompt_version: task.condition === "generated" ? generatedDocument.prompt_version : null,
    generated_model: task.condition === "generated" ? generatedDocument.model : null,
    business_ok: result.response?.Code === 0,
    ...result,
  };
  invocationRows.push(row);
  await appendFile(outputPath, `${JSON.stringify(row)}\n`, "utf8");
  console.error(`[${index + 1}/${scheduled.length}] ${task.task_id}: HTTP ${result.http_status ?? "-"}, Code ${result.response?.Code ?? "-"}, ${result.latency_ms ?? "-"} ms`);

  if (result.response?.Code === 30001) {
    stopReason = "ZHIHU_RATE_LIMITED";
    console.error("Quota study paused on the first Code 30001. Do not probe again in the same window.");
    break;
  }
  if (index < scheduled.length - 1 && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const rows = [...previousRows, ...invocationRows];
const successfulTasks = new Set(rows.filter((row) => row.business_ok).map((row) => row.task_id));
const pendingCalls = tasks.filter((task) => !successfulTasks.has(task.task_id)).length;
const latencies = rows.map((row) => row.latency_ms).filter(Number.isFinite);
const summary = {
  schema_version: "1.0",
  study_id: plan.study_id,
  run_id: runId,
  status: stopReason ? "rate_limited" : pendingCalls > 0 ? "paused" : "complete",
  stop_reason: stopReason,
  output_path: outputPath,
  planned_calls: tasks.length,
  invocation_calls: invocationRows.length,
  cumulative_calls: rows.length,
  successful_tasks: successfulTasks.size,
  pending_calls: pendingCalls,
  rate_limited_responses: rows.filter((row) => row.response?.Code === 30001).length,
  other_failed_responses: rows.filter((row) => !row.business_ok && row.response?.Code !== 30001).length,
  quality_denominator_calls: rows.filter((row) => row.business_ok).length,
  latency_ms: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.max(...latencies) : null,
  },
};
await writeFile(outputPath.replace(/\.jsonl$/iu, ".summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
