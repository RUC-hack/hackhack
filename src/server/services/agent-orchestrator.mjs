import { randomUUID } from "node:crypto";

import { appError } from "../contracts/errors.mjs";
import { assertAgentDecision } from "../contracts/answer.mjs";
import { assertTransition, publicSessionView } from "../contracts/session.mjs";
import { selectedSourceIds } from "../contracts/source-selection.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isTopicSwitch(text) {
  return /(?:换个话题|另一个问题|其实我想问|我想改问|不想聊这个)/u.test(text);
}

function normalizeQueries(queries, fallback) {
  const values = [...new Set((queries ?? []).map((query) => String(query).trim()).filter(Boolean))];
  return (values.length ? values : [fallback]).slice(0, 4);
}

function contextQueries(session) {
  const problem = String(session?.current_understanding?.problem_statement ?? "").trim();
  const contextItems = Array.isArray(session?.current_understanding?.context_items)
    ? session.current_understanding.context_items
      .slice(-3)
      .map((item) => String(item?.value ?? "").trim())
      .filter(Boolean)
    : [];
  return normalizeQueries([problem, ...contextItems].filter(Boolean), problem || "人生选择 真实经历");
}

function sumKnown(metrics, field) {
  const values = metrics.map((metric) => Number(metric?.[field])).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function summarizeLlmMetricGroup(metrics) {
  return {
    call_count: metrics.length,
    latency_ms: sumKnown(metrics, "latency_ms") ?? 0,
    prompt_tokens: sumKnown(metrics, "prompt_tokens"),
    completion_tokens: sumKnown(metrics, "completion_tokens"),
    total_tokens: sumKnown(metrics, "total_tokens"),
    usage_available_calls: metrics.filter((metric) => metric?.usage_available).length,
    usage_missing_calls: metrics.filter((metric) => !metric?.usage_available).length,
  };
}

function summarizeLlmMetrics(metrics = []) {
  const values = Array.isArray(metrics) ? metrics : [];
  const byStage = new Map();
  for (const metric of values) {
    const stage = metric?.stage || "unknown";
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(metric);
  }
  return {
    ...summarizeLlmMetricGroup(values),
    by_stage: Object.fromEntries([...byStage.entries()].map(([stage, stageMetrics]) => [stage, summarizeLlmMetricGroup(stageMetrics)])),
  };
}

export class AgentOrchestrator {
  constructor({
    sessionService,
    retrievalService,
    evidenceService,
    answerBuilder,
    sourceSelectionService,
    llmGateway,
    safetyService,
    sourceStore,
    logger = null,
    now = () => new Date(),
    maxQueries = 4,
    idFactory = randomUUID,
  } = {}) {
    for (const [name, dependency] of Object.entries({ sessionService, retrievalService, evidenceService, answerBuilder, sourceSelectionService, llmGateway, safetyService, sourceStore })) {
      if (!dependency) throw new TypeError(`AgentOrchestrator requires ${name}`);
    }
    this.sessionService = sessionService;
    this.retrievalService = retrievalService;
    this.evidenceService = evidenceService;
    this.answerBuilder = answerBuilder;
    this.sourceSelectionService = sourceSelectionService;
    this.llmGateway = llmGateway;
    this.safetyService = safetyService;
    this.sourceStore = sourceStore;
    this.logger = logger;
    this.now = now;
    this.maxQueries = maxQueries;
    this.idFactory = idFactory;
    this.turnsInFlight = new Map();
  }

  #setStatus(session, nextStatus) {
    assertTransition(session.status, nextStatus);
    session.status = nextStatus;
  }

  async #log(event) {
    if (!this.logger?.log) return;
    try { await this.logger.log(event); } catch { /* audit logging is best effort for the business flow */ }
  }

  async #logTurnCompleted({ requestId, sessionId, messageId, result, startedAt, llmMetrics }) {
    await this.#log({
      event_type: "turn_completed",
      request_id: requestId,
      session_id: sessionId,
      stage: result.action,
      message_id: messageId,
      state: result.state,
      source_ids: result.retrieval?.source_ids ?? [],
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      llm_metrics: summarizeLlmMetrics(llmMetrics),
    });
  }

  async handleMessage(sessionId, options = {}) {
    const clientTurnId = options.clientTurnId ?? null;
    if (!clientTurnId) return this.#handleMessage(sessionId, options);
    const key = `${sessionId}:${clientTurnId}`;
    const existing = this.turnsInFlight.get(key);
    if (existing) return existing;
    const operation = this.#handleMessage(sessionId, options);
    this.turnsInFlight.set(key, operation);
    operation.finally(() => this.turnsInFlight.delete(key)).catch(() => {});
    return operation;
  }

  async #handleMessage(sessionId, { text, clientTurnId = null, requestId = `req_${this.idFactory()}`, signal } = {}) {
    if (typeof text !== "string" || !text.trim()) throw appError("INVALID_REQUEST", { message: "message text is required" });
    if (text.length > 8_000) throw appError("INVALID_REQUEST", { message: "message text is too long" });
    let session = await this.sessionService.get(sessionId);
    const existingResult = await this.sessionService.getTurnResult(session, clientTurnId);
    if (existingResult) return existingResult;
    if (session.analysis?.status === "running") throw appError("ANALYSIS_IN_PROGRESS");

    const startedAt = performance.now();
    const llmMetrics = [];
    const safety = this.safetyService.check(text, { session });
    const appended = await this.sessionService.appendUserMessage(sessionId, {
      text,
      clientTurnId,
      updateProblemStatement: safety.preserve_context !== false,
    });
    session = appended.session;
    const message = appended.message;
    await this.#log({
      event_type: "user_message_received",
      request_id: requestId,
      session_id: sessionId,
      stage: "safety",
      message_id: message.message_id,
      message_length: message.text.length,
      safety_category: safety.category,
    });

    if (safety.requires_special_handling) {
      this.#setStatus(session, "SAFETY_HANDLING");
      const result = {
        action: "safety",
        session_id: sessionId,
        message_id: message.message_id,
        safety: { category: safety.category, user_message: safety.user_message },
        state: session.status,
      };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
      return result;
    }

    if (session.status === "CONFIRMING_TOPIC" && session.pending_topic) {
      const affirmative = /^(是|好|确认|对|可以|开始|换吧|是的)/u.test(text.trim());
      const negative = /^(否|不是|算了|不用|继续|不换)/u.test(text.trim());
      if (affirmative || negative) {
        if (affirmative) {
          session.context_version += 1;
          for (const retrieval of session.retrievals) retrieval.status = "stale";
          for (const packet of session.evidence_packets) packet.status = "stale";
          session.current_understanding = {
            problem_statement: session.pending_topic.proposed_text.replace(/^(换个话题|另一个问题|其实我想问|我想改问)[:：]?\s*/u, "").trim(),
            context_items: [],
            blocking_unknowns: [],
            assumptions: [],
            contradictions: [],
          };
        }
        session.pending_topic = null;
        this.#setStatus(session, "COLLECTING_CONTEXT");
        const result = {
          action: "confirm_topic",
          session_id: sessionId,
          message_id: message.message_id,
          confirmed: affirmative,
          reason: affirmative ? "已开启独立话题，上一个话题的证据不会自动带入。" : "保留当前话题，继续使用现有上下文。",
          state: session.status,
        };
        await this.sessionService.saveTurnResult(session, clientTurnId, result);
        await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
        return result;
      }
      const result = {
        action: "confirm_topic",
        session_id: sessionId,
        message_id: message.message_id,
        awaiting_confirmation: true,
        reason: "请先确认是否开启独立话题；确认前不会继续使用模型或旧证据。",
        current_problem_statement: session.current_understanding.problem_statement,
        state: session.status,
      };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
      return result;
    }

    if (isTopicSwitch(text) && session.current_understanding.problem_statement) {
      this.#setStatus(session, "CONFIRMING_TOPIC");
      session.pending_topic = { proposed_text: text, message_id: message.message_id };
      const result = {
        action: "confirm_topic",
        session_id: sessionId,
        message_id: message.message_id,
        reason: "这条消息看起来可能改变了当前问题，先确认是否要开启独立的话题上下文。",
        current_problem_statement: session.current_understanding.problem_statement,
        state: session.status,
      };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
      return result;
    }

    const previousProblem = session.current_understanding.problem_statement;
    if (!previousProblem) session.current_understanding.problem_statement = text;
    if (previousProblem && previousProblem !== session.current_understanding.problem_statement) {
      session.context_version += 1;
      for (const retrieval of session.retrievals) {
        if (retrieval.context_version !== session.context_version && retrieval.status !== "stale") retrieval.status = "stale";
      }
    }
    session.current_understanding.context_items.push({
      label: "用户当前表达",
      value: text,
      source: "user",
      certainty: "explicit",
      message_ids: [message.message_id],
      updated_at: this.now().toISOString(),
    });
    await this.sessionService.save(session);

    let decision;
    try {
      decision = assertAgentDecision(await this.llmGateway.decideNextAction(publicSessionView(session), { signal, requestId, metrics: llmMetrics }));
    } catch (error) {
      this.#setStatus(session, "FAILED_RECOVERABLE");
      await this.sessionService.save(session);
      await this.#log({ event_type: "orchestrator_failed", request_id: requestId, session_id: sessionId, stage: "decision", error_code: error.code ?? "LLM_INVALID_RESPONSE", latency_ms: Math.max(0, Math.round(performance.now() - startedAt)), llm_metrics: summarizeLlmMetrics(llmMetrics) });
      throw error.code ? error : appError("LLM_INVALID_RESPONSE", { cause: error });
    }

    const previousQuestion = String(session.pending_question?.text ?? "").trim();
    const nextQuestion = String(decision.question?.text ?? "").trim();
    if (decision.action === "ask" && previousQuestion && nextQuestion && previousQuestion === nextQuestion) {
      decision = {
        ...decision,
        action: "retrieve",
        question: null,
        queries: contextQueries(session),
        reason: "模型重复了上一轮追问，先基于你已经提供的信息寻找可回看的经历。",
      };
      await this.#log({
        event_type: "repeated_question_guard",
        request_id: requestId,
        session_id: sessionId,
        stage: "decision",
        previous_question: previousQuestion,
        action: "retrieve",
        query_count: decision.queries.length,
      });
    }
    session.current_understanding.blocking_unknowns = clone(decision.blocking_unknowns ?? []);
    session.current_understanding.assumptions = clone(decision.assumptions ?? []);
    await this.#log({
      event_type: "agent_decision",
      request_id: requestId,
      session_id: sessionId,
      stage: "decision",
      action: decision.action,
      reason: decision.reason,
      blocking_unknown_count: decision.blocking_unknowns?.length ?? 0,
      query_count: decision.queries?.length ?? 0,
    });

    if (decision.action === "ask") {
      if (session.question_count >= session.max_questions) {
        decision = { ...decision, action: "retrieve", queries: normalizeQueries([], session.current_understanding.problem_statement), reason: "追问预算已用尽，先基于当前信息给出暂定参照。" };
      } else {
        session.question_count += 1;
        session.pending_question = clone(decision.question);
        this.#setStatus(session, "COLLECTING_CONTEXT");
        const result = { action: "ask", session_id: sessionId, message_id: message.message_id, decision: clone(decision), state: session.status };
        await this.sessionService.saveTurnResult(session, clientTurnId, result);
        await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
        return result;
      }
    }

    if (decision.action === "confirm_topic") {
      this.#setStatus(session, "CONFIRMING_TOPIC");
      const result = { action: "confirm_topic", session_id: sessionId, message_id: message.message_id, decision: clone(decision), state: session.status };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
      return result;
    }

    if (decision.action === "safety") {
      this.#setStatus(session, "SAFETY_HANDLING");
      const result = { action: "safety", session_id: sessionId, message_id: message.message_id, decision: clone(decision), state: session.status };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
      return result;
    }

    let result;
    try {
      if (decision.action === "retrieve") {
      this.#setStatus(session, "RETRIEVING");
      const queries = normalizeQueries(decision.queries, session.current_understanding.problem_statement);
      const retrievalResult = await this.retrievalService.searchMany(queries, {
        limit: 5,
        requestId,
        sessionId,
        signal,
      }, { maxQueries: this.maxQueries });
      const sources = await this.sourceStore.saveMany(retrievalResult.documents ?? []);
      const retrievalId = `retrieval_${this.idFactory()}`;
      const packets = this.evidenceService.buildPackets({ sources, session, retrievalId });
      this.evidenceService.addToSession(session, packets);
      session.retrievals.push({
        retrieval_id: retrievalId,
        turn_id: message.message_id,
        context_version: session.context_version,
        queries,
        reason: decision.reason,
        status: "validated",
        source_ids: sources.map((source) => source.source_id),
        meta: clone(retrievalResult.meta),
        created_at: this.now().toISOString(),
      });
      this.#setStatus(session, "REVIEWING_EVIDENCE");
      const allSources = await this.sourceStore.list();
      const currentPackets = this.evidenceService.currentPackets(session).filter((packet) => packet.retrieval_id === retrievalId);
      const sourceSelection = await this.sourceSelectionService.build({
        session,
        evidencePackets: currentPackets,
        sources: allSources,
        retrievalMeta: retrievalResult.meta,
        retrievalId,
        signal,
        requestId,
        metrics: llmMetrics,
      });
      const analysis = {
        analysis_id: `analysis_${this.idFactory()}`,
        context_version: session.context_version,
        selection_id: sourceSelection.selection_id,
        status: "running",
        started_at: this.now().toISOString(),
        error: null,
      };
      session.source_selection = sourceSelection;
      session.analysis = analysis;
      this.#setStatus(session, "PRESENTING");
      session.pending_question = null;
      await this.#log({
        event_type: "source_selection_completed",
        request_id: requestId,
        session_id: sessionId,
        stage: "selection",
        selection_id: sourceSelection.selection_id,
        retrieval_id: retrievalId,
        selection_status: sourceSelection.status,
        selected_source_ids: sourceSelection.source_ids,
        group_count: sourceSelection.groups.length,
        llm_metrics: summarizeLlmMetrics(llmMetrics),
      });
      const selectedIds = new Set(selectedSourceIds(sourceSelection));
      const selectedPackets = currentPackets.filter((packet) => selectedIds.has(packet.source_id));
      const answer = await this.answerBuilder.build({
        session,
        evidencePackets: selectedPackets,
        sources: allSources,
        retrievalMeta: retrievalResult.meta,
        signal,
        requestId,
        metrics: llmMetrics,
      });
      for (const packet of session.evidence_packets) {
        if (selectedIds.has(packet.source_id) && packet.status !== "stale" && packet.status !== "rejected") packet.status = "used";
      }
      const currentRetrieval = session.retrievals.find((item) => item.retrieval_id === retrievalId);
      if (currentRetrieval) currentRetrieval.status = "used";
      session.current_answer = answer;
      session.answer_history.push({ answer_id: `answer_${this.idFactory()}`, created_at: this.now().toISOString(), context_version: session.context_version, answer });
      this.#setStatus(session, "WAITING_FOR_FOLLOW_UP");
      session.analysis = {
        ...analysis,
        status: "completed",
        completed_at: this.now().toISOString(),
        error: null,
        llm_metrics: summarizeLlmMetrics(llmMetrics),
      };
      result = {
        action: "respond",
        session_id: sessionId,
        message_id: message.message_id,
        reason: decision.reason,
        retrieval: { queries, source_ids: sources.map((source) => source.source_id), meta: retrievalResult.meta },
        source_selection: sourceSelection,
        analysis: session.analysis,
        answer,
        state: session.status,
      };
      } else {
        this.#setStatus(session, "PRESENTING");
        const answer = await this.answerBuilder.build({
          session,
          evidencePackets: this.evidenceService.currentPackets(session),
          sources: await this.sourceStore.list(),
          retrievalMeta: { provider: "existing" },
          signal,
          requestId,
          metrics: llmMetrics,
        });
        session.current_answer = answer;
        session.answer_history.push({ answer_id: `answer_${this.idFactory()}`, created_at: this.now().toISOString(), context_version: session.context_version, answer });
        this.#setStatus(session, "WAITING_FOR_FOLLOW_UP");
        result = { action: "respond", session_id: sessionId, message_id: message.message_id, reason: decision.reason, answer, state: session.status };
      }
    } catch (error) {
      if (session.analysis?.status === "running") {
        session.analysis = {
          ...session.analysis,
          status: "failed",
          completed_at: this.now().toISOString(),
          error: { code: error.code ?? "ANSWER_INVALID", retryable: Boolean(error.retryable) },
          llm_metrics: summarizeLlmMetrics(llmMetrics),
        };
      }
      this.#setStatus(session, "FAILED_RECOVERABLE");
      await this.sessionService.save(session);
      await this.#log({
        event_type: "orchestrator_failed",
        request_id: requestId,
        session_id: sessionId,
        stage: decision.action,
        error_code: error.code ?? "RETRIEVAL_FAILED",
        latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        llm_metrics: summarizeLlmMetrics(llmMetrics),
      });
      throw error;
    }
    await this.sessionService.saveTurnResult(session, clientTurnId, result);
    await this.#logTurnCompleted({ requestId, sessionId, messageId: message.message_id, result, startedAt, llmMetrics });
    return result;
  }
}
