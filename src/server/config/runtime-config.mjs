import path from "node:path";

import { envBoolean, envInteger } from "./env.mjs";

function stringValue(value, fallback) {
  return value === undefined || value === "" ? fallback : String(value).trim();
}

export function loadRuntimeConfig(env = process.env) {
  const appEnvironment = stringValue(env.APP_ENV, "development");
  const allowLiveExternalCalls = envBoolean(env.ALLOW_LIVE_EXTERNAL_CALLS, false);
  const dataProvider = stringValue(env.DATA_PROVIDER, "local").toLowerCase();
  if (!["mock", "local", "zhihu"].includes(dataProvider)) throw new Error("DATA_PROVIDER must be mock, local, or zhihu");
  const appBaseUrl = stringValue(env.APP_BASE_URL, "http://localhost:3000");
  const runtimeStateDir = path.resolve(stringValue(env.RUNTIME_STATE_DIR, ".runtime/state"));
  const runtimeLogDir = path.resolve(stringValue(env.RUNTIME_LOG_DIR, "logs"));
  const runtimeCacheDir = path.resolve(stringValue(env.RUNTIME_CACHE_DIR, ".runtime/cache"));
  const config = {
    app_environment: appEnvironment,
    port: envInteger(env.APP_PORT, 3000, { minimum: 1, maximum: 65535, name: "APP_PORT" }),
    host: stringValue(env.APP_HOST, "127.0.0.1"),
    app_base_url: appBaseUrl,
    cors_origins: stringValue(env.CORS_ORIGINS, "*").split(",").map((value) => value.trim()).filter(Boolean),
    data_provider: dataProvider,
    allow_live_external_calls: allowLiveExternalCalls,
    runtime_state_dir: runtimeStateDir,
    runtime_log_dir: runtimeLogDir,
    runtime_cache_dir: runtimeCacheDir,
    max_request_bytes: envInteger(env.MAX_REQUEST_BYTES, 64 * 1024, { minimum: 1_024, maximum: 1_048_576, name: "MAX_REQUEST_BYTES" }),
    request_timeout_ms: envInteger(env.REQUEST_TIMEOUT_MS, 180_000, { minimum: 1_000, maximum: 300_000, name: "REQUEST_TIMEOUT_MS" }),
    max_questions: envInteger(env.MAX_QUESTIONS, 4, { minimum: 0, maximum: 10, name: "MAX_QUESTIONS" }),
    retrieval_query_budget: envInteger(env.RETRIEVAL_QUERY_BUDGET, 4, { minimum: 1, maximum: 8, name: "RETRIEVAL_QUERY_BUDGET" }),
    local_dataset_path: path.resolve(stringValue(env.LOCAL_DATASET_PATH, "data/experiences.jsonl")),
    deepseek_api_key: stringValue(env.DEEPSEEK_API_KEY, ""),
    deepseek_base_url: stringValue(env.DEEPSEEK_BASE_URL, "https://api.deepseek.com"),
    deepseek_model: stringValue(env.DEEPSEEK_MODEL, "deepseek-chat"),
    deepseek_timeout_ms: envInteger(env.DEEPSEEK_TIMEOUT_MS, 120_000, { minimum: 1_000, maximum: 300_000, name: "DEEPSEEK_TIMEOUT_MS" }),
    deepseek_max_retries: envInteger(env.DEEPSEEK_MAX_RETRIES, 1, { minimum: 0, maximum: 3, name: "DEEPSEEK_MAX_RETRIES" }),
    deepseek_temperature: Number.isFinite(Number(env.DEEPSEEK_TEMPERATURE)) ? Number(env.DEEPSEEK_TEMPERATURE) : 0,
    deepseek_max_tokens: envInteger(env.DEEPSEEK_MAX_TOKENS, 16_000, { minimum: 1, maximum: 100_000, name: "DEEPSEEK_MAX_TOKENS" }),
    zhihu_access_secret: stringValue(env.ZHIHU_ACCESS_SECRET, ""),
    zhihu_base_url: stringValue(env.ZHIHU_API_BASE_URL, "https://developer.zhihu.com"),
    zhihu_timeout_ms: envInteger(env.ZHIHU_TIMEOUT_MS, 30_000, { minimum: 1_000, maximum: 120_000, name: "ZHIHU_TIMEOUT_MS" }),
    zhihu_max_retries: envInteger(env.ZHIHU_MAX_RETRIES, 0, { minimum: 0, maximum: 3, name: "ZHIHU_MAX_RETRIES" }),
    cache_ttl_seconds: envInteger(env.CACHE_TTL_SECONDS, 3_600, { minimum: 0, maximum: 604_800, name: "CACHE_TTL_SECONDS" }),
  };
  return Object.freeze(config);
}
