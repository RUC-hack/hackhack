import { appError } from "../contracts/errors.mjs";

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
  constructor({ apiKey, baseUrl = "https://api.deepseek.com", model = "deepseek-chat", timeoutMs = 90_000, maxRetries = 1, temperature = 0, maxTokens = 3_000, fetchImpl = globalThis.fetch, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/u, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  status() {
    return { provider: "deepseek", configured: Boolean(this.apiKey), model: this.model, live_calls_allowed: true, json_parser: "balanced-object" };
  }

  async chatJson({ system, user, signal } = {}) {
    if (!this.apiKey) throw appError("LLM_NOT_CONFIGURED");
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) forwardAbort();
      else signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status >= 500 && attempt < this.maxRetries) {
            await this.sleep(250 * (2 ** attempt));
            continue;
          }
          throw appError("LLM_NETWORK_ERROR", { retryable: response.status >= 500 });
        }
        const payload = JSON.parse(await response.text());
        return extractJsonObject(payload?.choices?.[0]?.message?.content);
      } catch (error) {
        if (error?.code) throw error;
        if (signal?.aborted) throw appError("LLM_CANCELLED", { cause: error });
        if (controller.signal.aborted) throw appError("LLM_TIMEOUT", { cause: error });
        if (attempt < this.maxRetries) {
          await this.sleep(250 * (2 ** attempt));
          continue;
        }
        throw appError("LLM_NETWORK_ERROR", { cause: error });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }
    }
    throw appError("LLM_NETWORK_ERROR");
  }
}
