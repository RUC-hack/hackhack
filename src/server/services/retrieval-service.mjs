import { appError } from "../contracts/errors.mjs";

const DEFAULT_FALLBACK_ERRORS = new Set([
  "ZHIHU_RATE_LIMITED",
  "ZHIHU_TIMEOUT",
  "ZHIHU_NETWORK_ERROR",
  "ZHIHU_HTTP_ERROR",
  "ZHIHU_UPSTREAM_ERROR",
  "ZHIHU_INVALID_RESPONSE",
  "ZHIHU_LIVE_CALLS_DISABLED",
  "ZHIHU_NOT_CONFIGURED",
]);

export class RetrievalService {
  constructor({ primaryProvider, fallbackProvider = null, primaryName, fallbackErrors = DEFAULT_FALLBACK_ERRORS } = {}) {
    if (!primaryProvider || typeof primaryProvider.search !== "function") {
      throw new TypeError("RetrievalService requires a primaryProvider");
    }
    if (fallbackProvider && typeof fallbackProvider.search !== "function") {
      throw new TypeError("fallbackProvider must implement search(query, options)");
    }
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;
    this.primaryName = primaryName ?? primaryProvider.name ?? primaryProvider.status?.().provider ?? "zhihu";
    this.fallbackErrors = new Set(fallbackErrors);
  }

  async search(query, options = {}) {
    try {
      const result = await this.primaryProvider.search(query, options);
      if (this.fallbackProvider && Array.isArray(result.documents) && result.documents.length === 0) {
        const emptyResultCode = this.primaryName === "zhihu" ? "ZHIHU_EMPTY_RESULT" : "PRIMARY_EMPTY_RESULT";
        try {
          const fallback = await this.fallbackProvider.search(query, options);
          return {
            ...fallback,
            meta: {
              ...fallback.meta,
              degraded: true,
              degraded_from: this.primaryName,
              degradation_reason: emptyResultCode,
              primary_error_code: emptyResultCode,
            },
          };
        } catch (fallbackError) {
          throw appError("RETRIEVAL_FAILED", {
            cause: fallbackError,
            retryable: Boolean(fallbackError?.retryable),
            details: {
              primary_error: { code: emptyResultCode, message: "Primary provider returned no documents" },
              fallback_error: { code: fallbackError?.code ?? "UNKNOWN", message: fallbackError?.message },
            },
          });
        }
      }
      return {
        ...result,
        meta: {
          ...result.meta,
          degraded: false,
          degraded_from: null,
          degradation_reason: null,
        },
      };
    } catch (error) {
      if (!this.fallbackProvider || !this.fallbackErrors.has(error?.code)) throw error;
      try {
        const fallback = await this.fallbackProvider.search(query, options);
        return {
          ...fallback,
          meta: {
            ...fallback.meta,
            degraded: true,
            degraded_from: this.primaryName,
            degradation_reason: error.code,
            primary_error_code: error.code,
          },
        };
      } catch (fallbackError) {
        throw appError("RETRIEVAL_FAILED", {
          cause: error,
          retryable: Boolean(fallbackError?.retryable ?? error?.retryable),
          details: {
            primary_error: { code: error?.code ?? "UNKNOWN", message: error?.message },
            fallback_error: { code: fallbackError?.code ?? "UNKNOWN", message: fallbackError?.message },
          },
        });
      }
    }
  }

  async searchMany(queries, options = {}, { maxQueries = 4 } = {}) {
    if (!Array.isArray(queries) || queries.length === 0) return {
      documents: [],
      meta: { provider: this.primaryName, query_count: 0, degraded: false },
      retrievals: [],
    };
    const uniqueQueries = [...new Set(queries.map((query) => String(query).trim()).filter(Boolean))].slice(0, maxQueries);
    const documents = [];
    const retrievals = [];
    let degraded = false;
    let degradedFrom = null;
    let degradationReason = null;
    for (const query of uniqueQueries) {
      const result = await this.search(query, options);
      documents.push(...(result.documents ?? []));
      retrievals.push({ query, result });
      degraded ||= Boolean(result.meta?.degraded);
      degradedFrom ??= result.meta?.degraded_from ?? null;
      degradationReason ??= result.meta?.degradation_reason ?? null;
    }
    const seen = new Set();
    const uniqueDocuments = documents.filter((document) => {
      const key = document.source_id || document.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      documents: uniqueDocuments,
      retrievals,
      meta: {
        provider: degraded ? "local" : (retrievals[0]?.result.meta?.provider ?? this.primaryName),
        query_count: uniqueQueries.length,
        result_count: uniqueDocuments.length,
        degraded,
        degraded_from: degradedFrom,
        degradation_reason: degradationReason,
      },
    };
  }
}
