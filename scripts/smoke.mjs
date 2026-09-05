import process from "node:process";

import { loadRuntimeConfig } from "../src/server/config/runtime-config.mjs";
import { LlmClient } from "../src/server/integrations/llm-client.mjs";
import { ZhihuSearchClient } from "../src/server/integrations/zhihu-search-client.mjs";

const live = process.argv.includes("--live");
const config = loadRuntimeConfig(process.env);

if (!live) {
  console.log(JSON.stringify({ ok: true, mode: "dry-run", external_calls: false, checks: ["configuration parsed", "live calls disabled"] }));
  process.exit(0);
}

if (!config.allow_live_external_calls) throw new Error("Live smoke requires ALLOW_LIVE_EXTERNAL_CALLS=true");
if (!config.zhihu_access_secret) throw new Error("Live smoke requires ZHIHU_ACCESS_SECRET");
if (!config.deepseek_api_key) throw new Error("Live smoke requires DEEPSEEK_API_KEY");

const startedAt = Date.now();
const zhihu = new ZhihuSearchClient({
  accessSecret: config.zhihu_access_secret,
  baseUrl: config.zhihu_base_url,
  timeoutMs: config.zhihu_timeout_ms,
  maxRetries: 0,
});
const zhihuResult = await zhihu.search({ query: "考研还是工作", count: 1 });
const llm = new LlmClient({
  apiKey: config.deepseek_api_key,
  baseUrl: config.deepseek_base_url,
  model: config.deepseek_model,
  timeoutMs: config.deepseek_timeout_ms,
  maxRetries: 0,
});
await llm.chatJson({ system: "只返回 JSON。", user: "返回 {\"ok\":true}。" });
console.log(JSON.stringify({
  ok: true,
  mode: "live",
  external_calls: true,
  zhihu: { business_code: zhihuResult.body.Code, result_count: zhihuResult.body.Data.Items.length },
  llm: { handshake: true },
  elapsed_ms: Date.now() - startedAt,
}));
