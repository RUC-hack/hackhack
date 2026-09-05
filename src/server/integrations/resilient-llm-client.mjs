import { appError } from "../contracts/errors.mjs";

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function usageStats(usage) {
  const promptTokens = tokenCount(usage?.prompt_tokens);
  const completionTokens = tokenCount(usage?.completion_tokens);
  const totalTokens = tokenCount(usage?.total_tokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    usage_available: [promptTokens, completionTokens, totalTokens].some((value) => value !== null),
  };
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    }).join("");
  }
  if (content && typeof content.text === "string") return content.text;
  return null;
}

export function extractJsonObject(content) {
  if (typeof content !== "string") throw appError("LLM_INVALID_RESPONSE");
  const start = content.indexOf("{");
  if (start < 0) throw appError("LLM_INVALID_RESPONSE");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(content.slice(start, index + 1)); }
        catch (error) { throw appError("LLM_INVALID_RESPONSE", { cause: error }); }
      }
    }
  }
  throw appError("LLM_INVALID_RESPONSE");
}

export class ResilientLlmClient {
  constructor({ apiKey, baseUrl = "https://api.deepseek.com", model = "deepseek-chat", timeoutMs = 90_000, maxRetries = 1, temperature = 0, maxTokens = 3_000, thinking = { type: "disabled" }, fetchImpl = globalThis.fetch, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), logger = null } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/u, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.thinking = thinking;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.logger = logger;
  }

  status() {
    return { provider: "deepseek", configured: Boolean(this.apiKey), model: this.model, thinking: this.thinking?.type ?? null, live_calls_allowed: true, json_parser: "balanced-object" };
  }

  async chatJson({ system, user, signal, requestId = null, sessionId = null, stage = "unknown", callLabel = null, onMetrics = null } = {}) {
    if (!this.apiKey) throw appError("LLM_NOT_CONFIGURED");
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) forwardAbort();
      else signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
      let outcome = "failed";
      let errorCode = null;
      let retrying = false;
      let usage = usageStats(null);
      let responseMeta = { finish_reason: null, content_type: null, content_length: null };
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...(this.thinking ? { thinking: this.thinking } : {}), response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status >= 500 && attempt < this.maxRetries) {
            outcome = "retrying";
            errorCode = "LLM_NETWORK_ERROR";
            retrying = true;
            await this.sleep(250 * (2 ** attempt));
            continue;
          }
          throw appError("LLM_NETWORK_ERROR", { retryable: response.status >= 500 });
        }
        const payload = JSON.parse(await response.text());
        usage = usageStats(payload?.usage);
        const choice = payload?.choices?.[0];
        const rawContent = choice?.message?.content;
        const content = normalizeMessageContent(rawContent);
        responseMeta = {
          finish_reason: choice?.finish_reason ?? null,
          content_type: rawContent === null || rawContent === undefined ? "missing" : Array.isArray(rawContent) ? "array" : typeof rawContent,
          content_length: typeof content === "string" ? content.length : 0,
        };
        if (choice?.finish_reason === "length") throw appError("LLM_OUTPUT_TRUNCATED");
        if (choice?.finish_reason === "content_filter") throw appError("LLM_CONTENT_FILTER");
        const value = extractJsonObject(content);
        outcome = "success";
        return value;
      } catch (error) {
        errorCode = error?.code ?? null;
        if (error?.code) throw error;
        if (signal?.aborted) {
          errorCode = "LLM_CANCELLED";
          throw appError("LLM_CANCELLED", { cause: error });
        }
        if (controller.signal.aborted) {
          errorCode = "LLM_TIMEOUT";
          throw appError("LLM_TIMEOUT", { cause: error });
        }
        if (attempt < this.maxRetries) {
          outcome = "retrying";
          errorCode = "LLM_NETWORK_ERROR";
          retrying = true;
          await this.sleep(250 * (2 ** attempt));
          continue;
        }
        errorCode = "LLM_NETWORK_ERROR";
        throw appError("LLM_NETWORK_ERROR", { cause: error });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
        const metric = {
          provider: "deepseek",
          model: this.model,
          request_id: requestId,
          session_id: sessionId,
          stage,
          ...(callLabel ? { call_label: callLabel } : {}),
          attempt: attempt + 1,
          outcome,
          retrying,
          error_code: errorCode,
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          response_meta: responseMeta,
          ...usage,
        };
        try { onMetrics?.(metric); } catch { /* metrics must never change the model result */ }
        try {
          await this.logger?.log?.({ event_type: "llm_call_completed", ...metric });
        } catch { /* LLM telemetry is best effort and must not change the business result */ }
      }
    }
    throw appError("LLM_NETWORK_ERROR");
  }
}
