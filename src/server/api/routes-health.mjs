export function healthData({ config, retrievalService, llmGateway }) {
  const primary = retrievalService.primaryProvider;
  const fallback = retrievalService.fallbackProvider;
  return {
    status: "ok",
    app_environment: config.app_environment,
    data_provider: config.data_provider,
    live_external_calls_allowed: config.allow_live_external_calls,
    providers: {
      primary: primary.status?.() ?? { provider: retrievalService.primaryName },
      fallback: fallback?.status?.() ?? null,
      llm: llmGateway.status?.() ?? { provider: "llm" },
    },
  };
}
