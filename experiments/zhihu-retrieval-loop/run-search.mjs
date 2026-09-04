import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const API_URL = "https://developer.zhihu.com/api/v1/content/zhihu_search";
const REQUIRED_ITEM_FIELDS = [
  "Title",
  "ContentType",
  "ContentID",
  "ContentText",
  "Url",
  "VoteUpCount",
  "AuthorName",
  "AuthorityLevel",
  "RankingScore",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run") {
      args.dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    i += 1;
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
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validateResponse(body) {
  const errors = [];
  if (!body || typeof body !== "object") errors.push("response_not_object");
  if (body?.Code !== 0) errors.push(`business_code_${String(body?.Code)}`);
  if (!Array.isArray(body?.Data?.Items)) errors.push("items_not_array");

  const items = Array.isArray(body?.Data?.Items) ? body.Data.Items : [];
  items.forEach((item, index) => {
    for (const field of REQUIRED_ITEM_FIELDS) {
      if (!(field in item)) errors.push(`item_${index}_missing_${field}`);
    }
  });
  return { valid: errors.length === 0, errors, itemCount: items.length };
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

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

async function requestSearch({ secret, query, count, timeoutMs }) {
  const url = new URL(API_URL);
  url.searchParams.set("Query", query);
  url.searchParams.set("Count", String(count));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const responseText = await response.text();
    let body = null;
    let parseError = null;
    try {
      body = JSON.parse(responseText);
    } catch (error) {
      parseError = error.message;
    }
    const validation = parseError
      ? { valid: false, errors: [`invalid_json: ${parseError}`], itemCount: 0 }
      : validateResponse(body);
    return {
      transport_ok: response.ok,
      http_status: response.status,
      latency_ms: Math.round(performance.now() - startedAt),
      schema_valid: validation.valid,
      schema_errors: validation.errors,
      item_count: validation.itemCount,
      response: body,
      non_json_body_preview: parseError ? responseText.slice(0, 500) : null,
    };
  } catch (error) {
    return {
      transport_ok: false,
      http_status: null,
      latency_ms: Math.round(performance.now() - startedAt),
      schema_valid: false,
      schema_errors: [error.name === "AbortError" ? "timeout" : `network_error: ${error.message}`],
      item_count: 0,
      response: null,
      non_json_body_preview: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const args = parseArgs(process.argv.slice(2));
const strategy = args.strategy ?? "baseline";
if (!new Set(["baseline", "oracle", "generated"]).has(strategy)) {
  throw new Error("--strategy must be baseline, oracle, or generated");
}

const repetitions = integerOption(args.repetitions, 1, "repetitions", 1, 20);
const count = integerOption(args.count, 10, "count", 1, 10);
const timeoutMs = integerOption(args["timeout-ms"], 15_000, "timeout-ms", 1_000, 120_000);
const delayMs = integerOption(args["delay-ms"], 300, "delay-ms", 0, 60_000);
const seed = integerOption(args.seed, 20260904, "seed", 1, 0x7fffffff);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.resolve(args.cases ?? path.join(scriptDir, "cases.json"));
const casesDocument = JSON.parse(await readFile(casesPath, "utf8"));
const testCases = casesDocument.cases;
if (!Array.isArray(testCases) || testCases.length === 0) throw new Error("No test cases found");

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

if (args.dryRun) {
  console.log(JSON.stringify({
    dry_run: true,
    api_url: API_URL,
    strategy,
    repetitions,
    count,
    seed,
    total_calls: orderedTasks.length,
    tasks: orderedTasks.map(({ attempt, testCase, query }) => ({
      attempt,
      case_id: testCase.id,
      query_id: query.id,
      facet: query.facet,
      query: query.query,
    })),
  }, null, 2));
  process.exit(0);
}

const secret = process.env.ZHIHU_ACCESS_SECRET;
if (!secret) throw new Error("ZHIHU_ACCESS_SECRET is not set. Set it only in the current terminal; never commit it.");

const runId = `zhihu-${strategy}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outputPath = path.resolve(args.output ?? path.join(scriptDir, "runs", `${runId}.jsonl`));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, "", "utf8");
const rows = [];

for (let index = 0; index < orderedTasks.length; index += 1) {
  const { attempt, testCase, query } = orderedTasks[index];
  const result = await requestSearch({ secret, query: query.query, count, timeoutMs });
  const row = {
    schema_version: "1.0",
    run_id: runId,
    recorded_at: new Date().toISOString(),
    strategy,
    generator: generatedMetadata,
    seed,
    request_index: index + 1,
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
  rows.push(row);
  await appendFile(outputPath, `${JSON.stringify(row)}\n`, "utf8");
  console.error(`[${index + 1}/${orderedTasks.length}] ${testCase.id}/${query.id}: HTTP ${result.http_status ?? "-"}, Code ${result.response?.Code ?? "-"}, ${result.latency_ms} ms`);
  if (index < orderedTasks.length - 1 && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const latencies = rows.map((row) => row.latency_ms);
const summary = {
  run_id: runId,
  output_path: outputPath,
  total_calls: rows.length,
  transport_successes: rows.filter((row) => row.transport_ok).length,
  business_successes: rows.filter((row) => row.business_ok).length,
  schema_valid_responses: rows.filter((row) => row.schema_valid).length,
  empty_successes: rows.filter((row) => row.business_ok && row.item_count === 0).length,
  latency_ms: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.max(...latencies) : null,
  },
};
const summaryPath = outputPath.replace(/\.jsonl$/i, ".summary.json");
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
