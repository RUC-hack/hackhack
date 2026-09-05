import { randomUUID } from "node:crypto";
import path from "node:path";

import { readJsonBody } from "./api/request-body.mjs";
import { matchRoute } from "./api/router.mjs";
import { sendError, sendSuccess } from "./api/response.mjs";
import { healthData } from "./api/routes-health.mjs";
import { loadRuntimeConfig } from "./config/runtime-config.mjs";
import { appError } from "./contracts/errors.mjs";
import { createHttpServer } from "./api/http-server.mjs";
import { ResilientLlmClient } from "./integrations/resilient-llm-client.mjs";
import { ZhihuSearchClient } from "./integrations/zhihu-search-client.mjs";
import { ZhihuProvider } from "./providers/zhihu-provider.mjs";
import { LocalDatasetProvider } from "./providers/local-dataset-provider.mjs";
import { MockProvider } from "./providers/mock-provider.mjs";
import { RetrievalService } from "./services/retrieval-service.mjs";
import { SessionService } from "./services/session-service.mjs";
import { AgentOrchestrator } from "./services/agent-orchestrator.mjs";
import { AnswerBuilder } from "./services/answer-builder.mjs";
import { EvidenceService } from "./services/evidence-service.mjs";
import { SafetyService } from "./services/safety-service.mjs";
import { ValidatedLlmGateway } from "./services/validated-llm-gateway.mjs";
import { MockLlmGateway } from "./services/mock-llm-gateway.mjs";
import { AuditLogger } from "./storage/audit-logger.mjs";
import { JsonlSessionStore } from "./storage/jsonl-session-store.mjs";
import { MemorySessionStore } from "./storage/memory-session-store.mjs";
import { SourceStore } from "./storage/source-store.mjs";

function allowOrigin(requestOrigin, origins) {
  if (origins.includes("*")) return "*";
  return requestOrigin && origins.includes(requestOrigin) ? requestOrigin : null;
}

function normalizeMessageBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw appError("INVALID_REQUEST", { message: "JSON body must be an object" });
  const text = body.message ?? body.text;
  const clientTurnId = body.client_turn_id ?? null;
  if (clientTurnId !== null && (typeof clientTurnId !== "string" || clientTurnId.length > 200)) throw appError("INVALID_REQUEST", { message: "client_turn_id is invalid" });
  return { text, clientTurnId };
}

export function createApp(overrides = {}) {
  const config = overrides.config ?? loadRuntimeConfig(overrides.env ?? process.env);
  const now = overrides.now ?? (() => new Date());
  const idFactory = overrides.idFactory ?? randomUUID;
  const logger = overrides.logger ?? new AuditLogger({ logDir: config.runtime_log_dir, now });
  const sessionStore = overrides.sessionStore ?? (overrides.memoryStore ? new MemorySessionStore() : new JsonlSessionStore({ logDir: config.runtime_log_dir, now }));
  const sourceStore = overrides.sourceStore ?? new SourceStore({ directory: path.join(config.runtime_state_dir, "sources") });
  const localProvider = overrides.localProvider ?? new LocalDatasetProvider({ datasetPath: config.local_dataset_path, now });
  const mockProvider = overrides.mockProvider ?? new MockProvider({ now });
  const zhihuProvider = overrides.zhihuProvider ?? new ZhihuProvider({
    client: overrides.zhihuClient ?? new ZhihuSearchClient({
      accessSecret: config.zhihu_access_secret,
      baseUrl: config.zhihu_base_url,
      timeoutMs: config.zhihu_timeout_ms,
      maxRetries: config.zhihu_max_retries,
    }),
    allowLiveCalls: config.allow_live_external_calls,
    cacheDir: path.join(config.runtime_cache_dir, "zhihu"),
    cacheTtlSeconds: config.cache_ttl_seconds,
    logDir: config.runtime_log_dir,
    now,
    onWarning: (warning) => {
      try {
        const pending = logger.log({ event_type: "provider_warning", provider: "zhihu", ...warning });
        pending?.catch?.(() => {});
      } catch {
        // Provider warnings must never turn a successful retrieval into a failure.
      }
    },
  });
  const primaryProvider = overrides.primaryProvider ?? (config.data_provider === "mock" ? mockProvider : config.data_provider === "zhihu" ? zhihuProvider : localProvider);
  const fallbackProvider = overrides.fallbackProvider ?? (config.data_provider === "zhihu" ? localProvider : null);
  const retrievalService = overrides.retrievalService ?? new RetrievalService({ primaryProvider, fallbackProvider });
  const llmClient = overrides.llmClient ?? new ResilientLlmClient({
    apiKey: config.deepseek_api_key,
    baseUrl: config.deepseek_base_url,
    model: config.deepseek_model,
    timeoutMs: config.deepseek_timeout_ms,
    maxRetries: config.deepseek_max_retries,
    temperature: config.deepseek_temperature,
    maxTokens: config.deepseek_max_tokens,
    logger,
  });
  const llmGateway = overrides.llmGateway ?? (config.allow_live_external_calls && config.deepseek_api_key ? new ValidatedLlmGateway({ client: llmClient }) : new MockLlmGateway());
  const sessionService = overrides.sessionService ?? new SessionService({ store: sessionStore, now, idFactory, maxQuestions: config.max_questions });
  const evidenceService = overrides.evidenceService ?? new EvidenceService({ now, idFactory });
  const answerBuilder = overrides.answerBuilder ?? new AnswerBuilder({ llmGateway });
  const safetyService = overrides.safetyService ?? new SafetyService();
  const orchestrator = overrides.orchestrator ?? new AgentOrchestrator({
    sessionService,
    retrievalService,
    evidenceService,
    answerBuilder,
    llmGateway,
    safetyService,
    sourceStore,
    logger,
    now,
    maxQueries: config.retrieval_query_budget,
    idFactory,
  });

  async function logBestEffort(event) {
    try { await logger.log?.(event); } catch { /* logging cannot block the HTTP result */ }
  }

  async function handler(request, response) {
    const requestId = `req_${idFactory()}`;
    const origin = allowOrigin(request.headers.origin, config.cors_origins);
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const controller = new AbortController();
    const onClose = () => { if (!response.writableEnded) controller.abort(new Error("request closed")); };
    request.once("aborted", onClose);
    response.once("close", onClose);
    const timer = setTimeout(() => controller.abort(new Error("request timeout")), config.request_timeout_ms);
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const route = matchRoute(request.method, url.pathname);
      if (!route) throw appError("NOT_FOUND");
      if (route.name === "health") {
        sendSuccess(response, healthData({ config, retrievalService, llmGateway }), requestId, { origin });
        return;
      }
      if (route.name === "create_session") {
        const hasBody = Number(request.headers["content-length"] ?? 0) > 0 || Boolean(request.headers["transfer-encoding"]);
        const body = hasBody ? await readJsonBody(request, { maxBytes: config.max_request_bytes }) : {};
        if (!body || typeof body !== "object" || Array.isArray(body)) throw appError("INVALID_REQUEST", { message: "JSON body must be an object" });
        const problemStatement = body.problem_statement ?? body.initial_problem ?? "";
        if (typeof problemStatement !== "string" || problemStatement.length > 8_000) throw appError("INVALID_REQUEST", { message: "problem_statement is invalid" });
        const session = await sessionService.create({ problemStatement });
        await logBestEffort({ event_type: "session_created", request_id: requestId, session_id: session.session_id, stage: "session" });
        sendSuccess(response, session, requestId, { origin });
        return;
      }
      if (route.name === "get_session") {
        sendSuccess(response, await sessionService.publicView(route.sessionId), requestId, { origin });
        return;
      }
      if (route.name === "get_source") {
        const source = await sourceStore.getPublic(route.sourceId);
        if (!source) throw appError("SOURCE_NOT_FOUND");
        sendSuccess(response, source, requestId, { origin });
        return;
      }
      if (route.name === "post_message") {
        const body = normalizeMessageBody(await readJsonBody(request, { maxBytes: config.max_request_bytes }));
        const result = await orchestrator.handleMessage(route.sessionId, { ...body, requestId, signal: controller.signal });
        sendSuccess(response, result, requestId, { origin });
        return;
      }
      throw appError("NOT_FOUND");
    } catch (error) {
      if (!response.writableEnded) sendError(response, error, requestId, { origin });
    } finally {
      clearTimeout(timer);
      request.removeListener("aborted", onClose);
      response.removeListener("close", onClose);
    }
  }

  return {
    handler,
    createServer: () => createHttpServer(handler),
    config,
    stores: { sessionStore, sourceStore },
    services: { sessionService, retrievalService, llmGateway, orchestrator },
    providers: { primaryProvider, fallbackProvider, localProvider, mockProvider, zhihuProvider },
  };
}
