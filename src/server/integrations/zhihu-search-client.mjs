const SEARCH_PATH = "/api/v1/content/zhihu_search";

export const ZHIHU_SEARCH_REQUIRED_ITEM_FIELDS = Object.freeze([
  "Title",
  "ContentType",
  "ContentID",
  "ContentText",
  "Url",
  "VoteUpCount",
  "AuthorName",
  "AuthorityLevel",
  "RankingScore",
]);

const BUSINESS_ERRORS = Object.freeze({
  10001: { code: "ZHIHU_INVALID_ARGUMENT", message: "Zhihu rejected the request parameters", retryable: false },
  20001: { code: "ZHIHU_AUTH_FAILED", message: "Zhihu authentication failed", retryable: false },
  30001: { code: "ZHIHU_RATE_LIMITED", message: "Zhihu rate limit exceeded", retryable: false },
  90001: { code: "ZHIHU_UPSTREAM_ERROR", message: "Zhihu internal error", retryable: true },
});

export class ZhihuSearchError extends Error {
  constructor(message, {
    code = "ZHIHU_UNKNOWN_ERROR",
    providerCode = null,
    httpStatus = null,
    retryable = false,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "ZhihuSearchError";
    this.code = code;
    this.providerCode = providerCode;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      provider_code: this.providerCode,
      http_status: this.httpStatus,
      retryable: this.retryable,
      message: this.message,
    };
  }
}

export function validateZhihuSearchResponse(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, errors: ["response_not_object"], itemCount: 0 };
  }
  if (body.Code !== 0) errors.push(`business_code_${String(body.Code)}`);
  if (!body.Data || typeof body.Data !== "object" || Array.isArray(body.Data)) errors.push("data_not_object");
  if (!Array.isArray(body?.Data?.Items)) errors.push("items_not_array");

  const items = Array.isArray(body?.Data?.Items) ? body.Data.Items : [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`item_${index}_not_object`);
      return;
    }
    for (const field of ZHIHU_SEARCH_REQUIRED_ITEM_FIELDS) {
      if (!(field in item) || item[field] === null || item[field] === undefined) {
        errors.push(`item_${index}_missing_${field}`);
      }
    }
    if (item.Title !== undefined && item.Title !== null && typeof item.Title !== "string") errors.push(`item_${index}_Title_must_be_string`);
    if (item.ContentType !== undefined && item.ContentType !== null && typeof item.ContentType !== "string") errors.push(`item_${index}_ContentType_must_be_string`);
    if (item.ContentID !== undefined && item.ContentID !== null && !(typeof item.ContentID === "string" || typeof item.ContentID === "number")) errors.push(`item_${index}_ContentID_must_be_string_or_number`);
    if (item.ContentText !== undefined && item.ContentText !== null && typeof item.ContentText !== "string") errors.push(`item_${index}_ContentText_must_be_string`);
    if (item.Url !== undefined && item.Url !== null && typeof item.Url !== "string") errors.push(`item_${index}_Url_must_be_string`);
    if (typeof item.Url === "string") {
      try {
        const url = new URL(item.Url);
        if (url.protocol !== "https:" || !/(^|\.)zhihu\.com$/iu.test(url.hostname)) errors.push(`item_${index}_Url_must_be_zhihu_https_url`);
      } catch {
        errors.push(`item_${index}_Url_must_be_url`);
      }
    }
    if (item.AuthorName !== undefined && item.AuthorName !== null && typeof item.AuthorName !== "string") errors.push(`item_${index}_AuthorName_must_be_string`);
    for (const field of ["VoteUpCount", "AuthorityLevel", "RankingScore"]) {
      if (item[field] !== undefined && item[field] !== null && !(typeof item[field] === "number" || typeof item[field] === "string")) errors.push(`item_${index}_${field}_must_be_number`);
      else if (item[field] !== undefined && item[field] !== null && !Number.isFinite(Number(item[field]))) errors.push(`item_${index}_${field}_must_be_number`);
    }
  });
  return { valid: errors.length === 0, errors, itemCount: items.length };
}

export function errorFromZhihuResponse(result) {
  if (!result || typeof result !== "object") {
    return new ZhihuSearchError("Zhihu response is missing", { code: "ZHIHU_INVALID_RESPONSE", retryable: false });
  }
  if (!result.transportOk) {
    const retryable = result.httpStatus === 429 || (result.httpStatus ?? 0) >= 500;
    return new ZhihuSearchError(`Zhihu HTTP request failed with status ${result.httpStatus}`, {
      code: result.httpStatus === 429 ? "ZHIHU_RATE_LIMITED" : "ZHIHU_HTTP_ERROR",
      httpStatus: result.httpStatus,
      retryable,
    });
  }
  if (result.parseError) {
    return new ZhihuSearchError("Zhihu returned a non-JSON response", {
      code: "ZHIHU_INVALID_RESPONSE",
      httpStatus: result.httpStatus,
      retryable: false,
    });
  }

  const providerCode = Number.isFinite(Number(result.body?.Code)) ? Number(result.body.Code) : null;
  if (providerCode === null) {
    return new ZhihuSearchError("Zhihu response does not contain a valid business code", {
      code: "ZHIHU_INVALID_RESPONSE",
      httpStatus: result.httpStatus,
      retryable: false,
    });
  }
  if (providerCode !== 0) {
    const mapped = BUSINESS_ERRORS[providerCode] ?? {
      code: "ZHIHU_BUSINESS_ERROR",
      message: "Zhihu returned an unknown business error",
      retryable: false,
    };
    return new ZhihuSearchError(mapped.message, {
      code: mapped.code,
      providerCode,
      httpStatus: result.httpStatus,
      retryable: mapped.retryable,
    });
  }
  if (!result.validation?.valid) {
    return new ZhihuSearchError("Zhihu response does not match the documented schema", {
      code: "ZHIHU_INVALID_RESPONSE",
      providerCode,
      httpStatus: result.httpStatus,
      retryable: false,
    });
  }
  return null;
}

function assertSearchInput(query, count) {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new ZhihuSearchError("query must be a non-empty string", {
      code: "ZHIHU_INVALID_ARGUMENT",
    });
  }
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new ZhihuSearchError("count must be an integer between 1 and 10", {
      code: "ZHIHU_INVALID_ARGUMENT",
    });
  }
}

function shouldRetryResult(result) {
  if (!result.transportOk) return result.httpStatus === 429 || result.httpStatus >= 500;
  return result.body?.Code === 90001;
}

export class ZhihuSearchClient {
  constructor({
    accessSecret,
    baseUrl = "https://developer.zhihu.com",
    timeoutMs = 15_000,
    maxRetries = 0,
    retryDelayMs = 500,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    this.accessSecret = accessSecret;
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
  }

  get endpoint() {
    return new URL(SEARCH_PATH, `${this.baseUrl}/`).toString();
  }

  async searchRaw({ query, count = 10, signal } = {}) {
    assertSearchInput(query, count);
    if (typeof this.accessSecret !== "string" || this.accessSecret.length === 0) {
      throw new ZhihuSearchError("ZHIHU_ACCESS_SECRET is not configured", {
        code: "ZHIHU_NOT_CONFIGURED",
      });
    }

    const url = new URL(this.endpoint);
    url.searchParams.set("Query", query.trim());
    url.searchParams.set("Count", String(count));

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) forwardAbort();
      else signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
      const startedAt = performance.now();

      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.accessSecret}`,
            "X-Request-Timestamp": String(Math.floor(this.now() / 1000)),
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
          : validateZhihuSearchResponse(body);
        const result = {
          transportOk: response.ok,
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startedAt),
          attemptCount: attempt + 1,
          body,
          parseError,
          nonJsonBodyPreview: parseError ? responseText.slice(0, 500) : null,
          validation,
        };

        if (attempt < this.maxRetries && shouldRetryResult(result)) {
          await this.sleep(this.retryDelayMs * (2 ** attempt));
          continue;
        }
        return result;
      } catch (error) {
        if (signal?.aborted) {
          throw new ZhihuSearchError("Zhihu request was cancelled", {
            code: "ZHIHU_CANCELLED",
            retryable: false,
            cause: error,
          });
        }
        const timedOut = controller.signal.aborted && !signal?.aborted;
        if (attempt < this.maxRetries && !signal?.aborted) {
          await this.sleep(this.retryDelayMs * (2 ** attempt));
          continue;
        }
        throw new ZhihuSearchError(timedOut ? "Zhihu request timed out" : "Zhihu network request failed", {
          code: timedOut ? "ZHIHU_TIMEOUT" : "ZHIHU_NETWORK_ERROR",
          retryable: !signal?.aborted,
          cause: error,
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }
    }

    throw new ZhihuSearchError("Zhihu request failed", { code: "ZHIHU_UNKNOWN_ERROR" });
  }

  async search(options) {
    const result = await this.searchRaw(options);
    const error = errorFromZhihuResponse(result);
    if (error) throw error;
    return result;
  }
}
