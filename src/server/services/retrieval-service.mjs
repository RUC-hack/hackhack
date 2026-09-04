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
  constructor({ primaryProvider, fallbackProvider = null, fallbackErrors = DEFAULT_FALLBACK_ERRORS } = {}) {
    if (!primaryProvider || typeof primaryProvider.search !== "function") {
      throw new TypeError("RetrievalService requires a primaryProvider");
    }
    if (fallbackProvider && typeof fallbackProvider.search !== "function") {
      throw new TypeError("fallbackProvider must implement search(query, options)");
    }
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;
    this.fallbackErrors = new Set(fallbackErrors);
  }

  async search(query, options = {}) {
    try {
      const result = await this.primaryProvider.search(query, options);
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
      const fallback = await this.fallbackProvider.search(query, options);
      return {
        ...fallback,
        meta: {
          ...fallback.meta,
          degraded: true,
          degraded_from: "zhihu",
          degradation_reason: error.code,
        },
      };
    }
  }
}
