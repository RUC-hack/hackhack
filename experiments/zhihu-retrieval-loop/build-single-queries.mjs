import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { envBoolean, envInteger, loadEnvFile } from "../../src/server/config/env.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "live") {
      args.live = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateGenerated(document, requestedIds) {
  if (!Array.isArray(document?.cases)) throw new Error("Model output must contain a cases array");
  const byId = new Map(document.cases.map((entry) => [entry.case_id, entry]));
  for (const caseId of requestedIds) {
    const entry = byId.get(caseId);
    if (!entry) throw new Error(`Model output is missing ${caseId}`);
    if (!Array.isArray(entry.queries) || entry.queries.length !== 1) {
      throw new Error(`${caseId} must contain exactly one query`);
    }
    const query = entry.queries[0];
    if (query.id !== "generated" || query.facet !== "high_yield") {
      throw new Error(`${caseId} query must use id=generated and facet=high_yield`);
    }
    if (typeof query.query !== "string" || query.query.trim().length === 0) {
      throw new Error(`${caseId} query must be non-empty`);
    }
    if ([...query.query].length > 30) throw new Error(`${caseId} query exceeds 30 characters`);
  }
  const unexpected = document.cases.map((entry) => entry.case_id).filter((id) => !requestedIds.includes(id));
  if (unexpected.length > 0) throw new Error(`Model output contains unexpected cases: ${unexpected.join(", ")}`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
await loadEnvFile(path.resolve(args.env ?? path.join(repositoryRoot, ".env.local")), { required: true });

const liveAllowed = args.live || envBoolean(process.env.ALLOW_LIVE_EXTERNAL_CALLS, false);
if (!liveAllowed) {
  throw new Error("DeepSeek calls are disabled. Pass --live after reviewing the selected synthetic cases.");
}
if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured");

const requestedIds = (args["case-id"] ?? "C01,C03,C05,C07")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const casesPath = path.resolve(args.cases ?? path.join(scriptDirectory, "cases.json"));
const casesDocument = JSON.parse(await readFile(casesPath, "utf8"));
const selectedCases = casesDocument.cases
  .filter((entry) => requestedIds.includes(entry.id))
  .map((entry) => ({
    case_id: entry.id,
    user_input: entry.user_input,
    decision: entry.decision,
  }));
if (selectedCases.length !== requestedIds.length) throw new Error("One or more requested case IDs do not exist");

const promptPath = path.resolve(args.prompt ?? path.join(scriptDirectory, "query-builder-single-prompt.md"));
const systemPrompt = await readFile(promptPath, "utf8");
const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/u, "");
const timeoutMs = envInteger(process.env.DEEPSEEK_TIMEOUT_MS, 60_000, {
  minimum: 1_000,
  maximum: 180_000,
  name: "DEEPSEEK_TIMEOUT_MS",
});
const maxTokens = envInteger(process.env.DEEPSEEK_MAX_TOKENS, 1_200, {
  minimum: 200,
  maximum: 8_000,
  name: "DEEPSEEK_MAX_TOKENS",
});

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
let response;
try {
  response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请为以下合成案例输出指定 JSON。不要添加案例，不要省略案例：\n${JSON.stringify(selectedCases, null, 2)}`,
        },
      ],
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      stream: false,
    }),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timer);
}

const responseBody = await response.json();
if (!response.ok) {
  throw new Error(`DeepSeek request failed with HTTP ${response.status}`);
}
const content = responseBody?.choices?.[0]?.message?.content;
if (typeof content !== "string" || content.trim().length === 0) {
  throw new Error("DeepSeek returned no JSON content");
}
const generated = JSON.parse(content);
validateGenerated(generated, requestedIds);

const output = {
  schema_version: "1.0",
  prompt_version: "single-query-quota-v1",
  prompt_sha256: sha256(systemPrompt),
  input_sha256: sha256(JSON.stringify(selectedCases)),
  generated_at: new Date().toISOString(),
  model,
  temperature: 0,
  cases: requestedIds.map((caseId) => generated.cases.find((entry) => entry.case_id === caseId)),
  usage: responseBody.usage ?? null,
};
const defaultName = `single-queries-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`;
const outputPath = path.resolve(args.output ?? path.join(repositoryRoot, ".runtime", "experiments", defaultName));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output_path: outputPath,
  model,
  case_count: output.cases.length,
  usage: output.usage,
}, null, 2));
