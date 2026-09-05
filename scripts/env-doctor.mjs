import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.resolve(process.env.HACKHACK_ENV_FILE ?? path.join(repositoryRoot, ".env.local"));

function parseEnv(text) {
  const result = {};
  for (const originalLine of text.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid environment line for key-safe parser: ${originalLine.slice(0, 40)}`);
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function asBoolean(value, name, errors) {
  if (value === "true") return true;
  if (value === "false") return false;
  errors.push(`${name}_MUST_BE_TRUE_OR_FALSE`);
  return false;
}

function asInteger(value, name, minimum, maximum, errors) {
  if (!/^[+-]?\d+$/u.test(String(value ?? "").trim())) {
    errors.push(`${name}_OUT_OF_RANGE`);
    return null;
  }
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${name}_OUT_OF_RANGE`);
    return null;
  }
  return parsed;
}

function validHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

let env;
try {
  env = parseEnv(await readFile(envFile, "utf8"));
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(".env.local is missing. Run: node scripts/bootstrap-env.mjs");
    process.exit(2);
  }
  throw error;
}

const errors = [];
const warnings = [];
const allowedAppEnvs = new Set(["development", "test", "production"]);
const allowedProviders = new Set(["mock", "local", "zhihu"]);
const allowedExperimentModes = new Set(["dry-run", "smoke", "full"]);
const allowedLogLevels = new Set(["debug", "info", "warn", "error"]);

if (!allowedAppEnvs.has(env.APP_ENV)) errors.push("APP_ENV_INVALID");
if (!allowedProviders.has(env.DATA_PROVIDER)) errors.push("DATA_PROVIDER_INVALID");
if (!allowedExperimentModes.has(env.EXPERIMENT_MODE)) errors.push("EXPERIMENT_MODE_INVALID");
if (!allowedLogLevels.has(env.LOG_LEVEL)) errors.push("LOG_LEVEL_INVALID");
const liveAllowed = asBoolean(env.ALLOW_LIVE_EXTERNAL_CALLS, "ALLOW_LIVE_EXTERNAL_CALLS", errors);

asInteger(env.APP_PORT, "APP_PORT", 1, 65535, errors);
asInteger(env.DEEPSEEK_TIMEOUT_MS, "DEEPSEEK_TIMEOUT_MS", 1000, 300000, errors);
asInteger(env.DEEPSEEK_MAX_RETRIES, "DEEPSEEK_MAX_RETRIES", 0, 5, errors);
asInteger(env.DEEPSEEK_MAX_TOKENS, "DEEPSEEK_MAX_TOKENS", 1, 100000, errors);
asInteger(env.ZHIHU_SEARCH_COUNT, "ZHIHU_SEARCH_COUNT", 1, 10, errors);
asInteger(env.ZHIHU_TIMEOUT_MS, "ZHIHU_TIMEOUT_MS", 1000, 120000, errors);
asInteger(env.ZHIHU_MAX_RETRIES, "ZHIHU_MAX_RETRIES", 0, 3, errors);
asInteger(env.EXPERIMENT_REPETITIONS, "EXPERIMENT_REPETITIONS", 1, 20, errors);

if (!validHttpsUrl(env.DEEPSEEK_BASE_URL)) errors.push("DEEPSEEK_BASE_URL_MUST_BE_HTTPS");
if (!validHttpsUrl(env.ZHIHU_API_BASE_URL)) errors.push("ZHIHU_API_BASE_URL_MUST_BE_HTTPS");
if (env.APP_ENV === "production" && !validHttpsUrl(env.APP_BASE_URL)) errors.push("PRODUCTION_APP_BASE_URL_MUST_BE_HTTPS");

const deepseekConfigured = Boolean(env.DEEPSEEK_API_KEY);
const zhihuConfigured = Boolean(env.ZHIHU_ACCESS_SECRET);
if (liveAllowed && !deepseekConfigured) errors.push("DEEPSEEK_API_KEY_REQUIRED_FOR_LIVE_MODE");
if (liveAllowed && env.DATA_PROVIDER === "zhihu" && !zhihuConfigured) errors.push("ZHIHU_ACCESS_SECRET_REQUIRED_FOR_LIVE_ZHIHU");
if (!liveAllowed && env.EXPERIMENT_MODE !== "dry-run") errors.push("NON_DRY_EXPERIMENT_REQUIRES_LIVE_EXTERNAL_CALLS");
if (env.DATA_PROVIDER === "zhihu" && !liveAllowed) warnings.push("ZHIHU_PROVIDER_SELECTED_BUT_LIVE_CALLS_DISABLED");
if (!deepseekConfigured) warnings.push("DEEPSEEK_NOT_CONFIGURED");
if (!zhihuConfigured) warnings.push("ZHIHU_NOT_CONFIGURED");

const now = new Date().toISOString();
const status = errors.length ? "invalid" : "ready";
const state = {
  schemaVersion: "1.0",
  status,
  mode: env.EXPERIMENT_MODE,
  appEnvironment: env.APP_ENV,
  dataProvider: env.DATA_PROVIDER,
  liveExternalCallsAllowed: liveAllowed,
  providers: {
    deepseek: { configured: deepseekConfigured, lastCheckedAt: now, lastErrorCode: null },
    zhihu: { configured: zhihuConfigured, lastCheckedAt: now, lastErrorCode: null },
  },
  validation: { errors, warnings },
  lastRun: null,
  updatedAt: now,
};

const stateDirectory = path.resolve(repositoryRoot, env.RUNTIME_STATE_DIR || ".runtime/state");
await mkdir(stateDirectory, { recursive: true });
const statePath = path.join(stateDirectory, "runtime-state.json");
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: errors.length === 0,
  status,
  envFile,
  statePath,
  configuration: {
    appEnvironment: env.APP_ENV,
    dataProvider: env.DATA_PROVIDER,
    experimentMode: env.EXPERIMENT_MODE,
    liveExternalCallsAllowed: liveAllowed,
    deepseekConfigured,
    zhihuConfigured,
    deepseekModel: env.DEEPSEEK_MODEL,
  },
  errors,
  warnings,
}, null, 2));

process.exit(errors.length ? 1 : 0);
