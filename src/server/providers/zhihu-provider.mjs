import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { envBoolean, envInteger } from "../config/env.mjs";
import {
  ZhihuSearchClient,
  ZhihuSearchError,
  errorFromZhihuResponse,
} from "../integrations/zhihu-search-client.mjs";

const ALLOWED_FILTERS = new Set(["contentTypes"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return String(value ?? "").trim();
  }
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new ZhihuSearchError("filters must be an object", { code: "ZHIHU_INVALID_ARGUMENT" });
  }
  for (const key of Object.keys(filters)) {
    if (!ALLOWED_FILTERS.has(key)) {
      throw new ZhihuSearchError(`Unsupported Zhihu filter: ${key}`, {
        code: "ZHIHU_INVALID_ARGUMENT",
      });
    }
  }
  if (filters.contentTypes !== undefined && !Array.isArray(filters.contentTypes)) {
    throw new ZhihuSearchError("filters.contentTypes must be an array", {
      code: "ZHIHU_INVALID_ARGUMENT",
    });
  }
}

export function normalizeZhihuItem(item, retrievedAt) {
  const contentType = String(item.ContentType ?? "unknown").trim().toLowerCase();
  const contentId = String(item.ContentID ?? "").trim();
  const url = canonicalUrl(item.Url);
  return {
    source_id: contentId ? `zhihu:${contentType}:${contentId}` : `zhihu:url:${sha256(url).slice(0, 24)}`,
    title: String(item.Title ?? "").trim(),
    author: String(item.AuthorName ?? "").trim(),
    summary: String(item.ContentText ?? ""),
    url,
    content_type: contentType,
    retrieved_at: retrievedAt,
    provider: "zhihu",
    metadata: {
      content_id: contentId || null,
      vote_up_count: asFiniteNumber(item.VoteUpCount),
      authority_level: asFiniteNumber(item.AuthorityLevel),
      ranking_score: asFiniteNumber(item.RankingScore),
    },
  };
}

export function assertSourceDocument(document) {
  const requiredStringFields = [
    "source_id",
    "title",
    "author",
    "summary",
    "url",
    "content_type",
    "retrieved_at",
    "provider",
  ];
  for (const field of requiredStringFields) {
    if (typeof document?.[field] !== "string") {
      throw new TypeError(`SourceDocument.${field} must be a string`);
    }
  }
  if (document.provider !== "zhihu") throw new TypeError("SourceDocument.provider must be zhihu");
  return document;
}

function deduplicateDocuments(documents) {
  const seen = new Set();
  const result = [];
  for (const document of documents) {
    const key = document.url || document.source_id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(document);
  }
  return result;
}

async function readFreshCache(cachePath, nowMs) {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (!Number.isFinite(cached.expires_at_ms) || cached.expires_at_ms <= nowMs) return null;
    if (!Array.isArray(cached.documents)) return null;
    cached.documents.forEach(assertSourceDocument);
    return cached;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

async function writeCache(cachePath, value) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, cachePath);
}

export class ZhihuProvider {
  constructor({
    client,
    allowLiveCalls = true,
    cacheDir = ".runtime/cache/zhihu",
    cacheTtlSeconds = 3_600,
    logDir = ".runtime/logs",
    now = () => new Date(),
  } = {}) {
    if (!client || typeof client.search !== "function") {
      throw new TypeError("ZhihuProvider requires a ZhihuSearchClient-compatible client");
    }
    this.client = client;
    this.allowLiveCalls = allowLiveCalls;
    this.cacheDir = path.resolve(cacheDir);
    this.cacheTtlSeconds = cacheTtlSeconds;
    this.logDir = path.resolve(logDir);
    this.now = now;
  }

  status() {
    return {
      provider: "zhihu",
      configured: typeof this.client.accessSecret === "string" && this.client.accessSecret.length > 0,
      live_calls_allowed: this.allowLiveCalls,
      cache_ttl_seconds: this.cacheTtlSeconds,
    };
  }

  async #writeLog(entry) {
    const date = entry.recorded_at.slice(0, 10);
    const directory = path.join(this.logDir, "zhihu");
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, `${date}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
  }

  async search(query, {
    limit = 10,
    filters = {},
    requestId = randomUUID(),
    sessionId = null,
    bypassCache = false,
  } = {}) {
    const startedAt = performance.now();
    const recordedAt = this.now().toISOString();
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery) {
      throw new ZhihuSearchError("query must be a non-empty string", {
        code: "ZHIHU_INVALID_ARGUMENT",
      });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new ZhihuSearchError("limit must be an integer between 1 and 10", {
        code: "ZHIHU_INVALID_ARGUMENT",
      });
    }
    validateFilters(filters);

    const normalizedContentTypes = (filters.contentTypes ?? [])
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
      .sort();
    const cacheKey = sha256(JSON.stringify({
      query: normalizedQuery,
      limit,
      contentTypes: normalizedContentTypes,
    }));
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
    const logBase = {
      schema_version: "1.0",
      recorded_at: recordedAt,
      request_id: requestId,
      session_id: sessionId,
      provider: "zhihu",
      operation: "search",
      query_hash: sha256(normalizedQuery),
      query_length: normalizedQuery.length,
      limit,
    };

    if (!bypassCache) {
      const cached = await readFreshCache(cachePath, this.now().getTime());
      if (cached) {
        await this.#writeLog({
          ...logBase,
          ok: true,
          cached: true,
          result_count: cached.documents.length,
          latency_ms: Math.round(performance.now() - startedAt),
        });
        return {
          documents: cached.documents,
          meta: {
            provider: "zhihu",
            request_id: requestId,
            cached: true,
            retrieved_at: cached.retrieved_at,
            result_count: cached.documents.length,
          },
        };
      }
    }

    if (!this.allowLiveCalls) {
      throw new ZhihuSearchError("Live external calls are disabled", {
        code: "ZHIHU_LIVE_CALLS_DISABLED",
      });
    }

    try {
      const raw = await this.client.search({ query: normalizedQuery, count: limit });
      const upstreamError = errorFromZhihuResponse(raw);
      if (upstreamError) throw upstreamError;

      const retrievedAt = this.now().toISOString();
      let documents = raw.body.Data.Items.map((item) => normalizeZhihuItem(item, retrievedAt));
      documents = deduplicateDocuments(documents);
      if (normalizedContentTypes.length > 0) {
        const allowed = new Set(normalizedContentTypes);
        documents = documents.filter((document) => allowed.has(document.content_type));
      }
      documents = documents.slice(0, limit);
      documents.forEach(assertSourceDocument);

      if (this.cacheTtlSeconds > 0) {
        await writeCache(cachePath, {
          schema_version: "1.0",
          retrieved_at: retrievedAt,
          expires_at_ms: this.now().getTime() + this.cacheTtlSeconds * 1_000,
          documents,
        });
      }
      await this.#writeLog({
        ...logBase,
        ok: true,
        cached: false,
        provider_code: raw.body.Code,
        http_status: raw.httpStatus,
        result_count: documents.length,
        latency_ms: Math.round(performance.now() - startedAt),
      });
      return {
        documents,
        meta: {
          provider: "zhihu",
          request_id: requestId,
          cached: false,
          retrieved_at: retrievedAt,
          result_count: documents.length,
        },
      };
    } catch (error) {
      const safeError = error instanceof ZhihuSearchError
        ? error
        : new ZhihuSearchError("Zhihu provider failed", {
          code: "ZHIHU_PROVIDER_ERROR",
          cause: error,
        });
      await this.#writeLog({
        ...logBase,
        ok: false,
        cached: false,
        error_code: safeError.code,
        provider_code: safeError.providerCode,
        http_status: safeError.httpStatus,
        retryable: safeError.retryable,
        latency_ms: Math.round(performance.now() - startedAt),
      });
      throw safeError;
    }
  }
}

export function createZhihuProviderFromEnv(env = process.env, overrides = {}) {
  const client = overrides.client ?? new ZhihuSearchClient({
    accessSecret: env.ZHIHU_ACCESS_SECRET,
    baseUrl: env.ZHIHU_API_BASE_URL || "https://developer.zhihu.com",
    timeoutMs: envInteger(env.ZHIHU_TIMEOUT_MS, 15_000, {
      minimum: 1_000,
      maximum: 120_000,
      name: "ZHIHU_TIMEOUT_MS",
    }),
    maxRetries: envInteger(env.ZHIHU_MAX_RETRIES, 0, {
      minimum: 0,
      maximum: 3,
      name: "ZHIHU_MAX_RETRIES",
    }),
  });
  return new ZhihuProvider({
    client,
    allowLiveCalls: envBoolean(env.ALLOW_LIVE_EXTERNAL_CALLS, false),
    cacheDir: env.RUNTIME_CACHE_DIR
      ? path.join(env.RUNTIME_CACHE_DIR, "zhihu")
      : ".runtime/cache/zhihu",
    cacheTtlSeconds: envInteger(env.CACHE_TTL_SECONDS, 3_600, {
      minimum: 0,
      maximum: 604_800,
      name: "CACHE_TTL_SECONDS",
    }),
    logDir: env.RUNTIME_LOG_DIR || ".runtime/logs",
    ...overrides,
    client,
  });
}
