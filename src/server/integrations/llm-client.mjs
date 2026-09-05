import { AppError, appError } from "../contracts/errors.mjs";

function parseJsonContent(content) {
  if (typeof content !== "string") throw appError("LLM_INVALID_RESPONSE");
  const normalized = content.trim().replace(/^```json\s*/iu, "").replace(/```$/u, "").trim();
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw appError("LLM_INVALID_RESPONSE", { cause: error });
  }
}

export class LlmClient {
  constructor({
    apiKey,
    baseUrl = "https://api.deepseek.com",
    model = "deepseek-chat",
    timeoutMs = 60_000,
    maxRetries = 1,
    temperature = 0,
    maxTokens = 1_200,
    fetchImpl = globalThis.fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
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
    return { provider: "deepseek", configured: Boolean(this.apiKey), model: this.model, live_calls_allowed: true };
  }

  async chatJson({ system, user, signal } = {}) {
    if (!this.apiKey) throw appError("LLM_NOT_CONFIGURED");
    const endpoint = `${this.baseUrl}/chat/completions`;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) forwardAbort();
      else signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
      try {
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = appError("LLM_NETWORK_ERROR", { status: response.status >= 500 ? 502 : 502, retryable: response.status >= 500 });
          if (attempt < this.maxRetries && error.retryable) {
            await this.sleep(250 * (2 ** attempt));
            continue;
          }
          throw error;
        }
        let payload;
        try {
          payload = JSON.parse(await response.text());
        } catch (error) {
          throw appError("LLM_INVALID_RESPONSE", { cause: error });
        }
        if (payload?.choices?.[0]?.finish_reason === "length") throw appError("LLM_OUTPUT_TRUNCATED");
        const content = payload?.choices?.[0]?.message?.content;
        return parseJsonContent(content);
      } catch (error) {
        if (error instanceof AppError) {
          if (error.code === "LLM_INVALID_RESPONSE") throw error;
          if (attempt < this.maxRetries && error.retryable && !signal?.aborted) {
            await this.sleep(250 * (2 ** attempt));
            continue;
          }
          throw error;
        }
        if (signal?.aborted) throw appError("LLM_CANCELLED", { message: "Language model request was cancelled", retryable: false, cause: error });
        const timedOut = controller.signal.aborted;
        if (timedOut) throw appError("LLM_TIMEOUT", { cause: error });
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
