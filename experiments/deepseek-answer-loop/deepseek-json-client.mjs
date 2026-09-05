function extractFirstJsonObject(content) {
  if (typeof content !== "string") throw new Error("Model content is not a string");
  const start = content.indexOf("{");
  if (start < 0) throw new Error("Model content contains no JSON object");
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
      if (depth === 0) return JSON.parse(content.slice(start, index + 1));
    }
  }
  throw new Error("Model JSON object is incomplete");
}

export class DeepSeekJsonExperimentClient {
  constructor({ apiKey, baseUrl, model, timeoutMs = 90_000, maxTokens = 3_000, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || "https://api.deepseek.com").replace(/\/+$/u, "");
    this.model = model || "deepseek-chat";
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    this.fetchImpl = fetchImpl;
  }

  async chatJson({ system, user }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: this.maxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: controller.signal,
      });
      const rawPayload = await response.text();
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
      const payload = JSON.parse(rawPayload);
      const rawContent = payload?.choices?.[0]?.message?.content;
      return {
        value: extractFirstJsonObject(rawContent),
        raw_content: rawContent,
        finish_reason: payload?.choices?.[0]?.finish_reason ?? null,
        usage: payload?.usage ?? null,
        latency_ms: Math.round(performance.now() - startedAt),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export { extractFirstJsonObject };
