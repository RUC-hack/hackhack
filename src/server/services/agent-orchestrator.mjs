import { randomUUID } from "node:crypto";

import { appError } from "../contracts/errors.mjs";
import { assertAgentDecision } from "../contracts/answer.mjs";
import { assertTransition, publicSessionView } from "../contracts/session.mjs";

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

export class AgentOrchestrator {
  constructor({
    sessionService,
    retrievalService,
    evidenceService,
    answerBuilder,
    llmGateway,
    safetyService,
    sourceStore,
    logger = null,
    now = () => new Date(),
    maxQueries = 4,
    idFactory = randomUUID,
  } = {}) {
    for (const [name, dependency] of Object.entries({ sessionService, retrievalService, evidenceService, answerBuilder, llmGateway, safetyService, sourceStore })) {
      if (!dependency) throw new TypeError(`AgentOrchestrator requires ${name}`);
    }
    this.sessionService = sessionService;
    this.retrievalService = retrievalService;
    this.evidenceService = evidenceService;
    this.answerBuilder = answerBuilder;
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

    const startedAt = performance.now();
    const safety = this.safetyService.check(text);
    const appended = await this.sessionService.appendUserMessage(sessionId, { text, clientTurnId });
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
      decision = assertAgentDecision(await this.llmGateway.decideNextAction(publicSessionView(session), { signal, requestId }));
    } catch (error) {
      this.#setStatus(session, "FAILED_RECOVERABLE");
      await this.sessionService.save(session);
      await this.#log({ event_type: "orchestrator_failed", request_id: requestId, session_id: sessionId, stage: "decision", error_code: error.code ?? "LLM_INVALID_RESPONSE" });
      throw error.code ? error : appError("LLM_INVALID_RESPONSE", { cause: error });
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
        return result;
      }
    }

    if (decision.action === "confirm_topic") {
      this.#setStatus(session, "CONFIRMING_TOPIC");
      const result = { action: "confirm_topic", session_id: sessionId, message_id: message.message_id, decision: clone(decision), state: session.status };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
      return result;
    }

    if (decision.action === "safety") {
      this.#setStatus(session, "SAFETY_HANDLING");
      const result = { action: "safety", session_id: sessionId, message_id: message.message_id, decision: clone(decision), state: session.status };
      await this.sessionService.saveTurnResult(session, clientTurnId, result);
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
        created_at: this.now().toISOString(),
      });
      this.#setStatus(session, "REVIEWING_EVIDENCE");
      const answer = await this.answerBuilder.build({
        session,
        evidencePackets: this.evidenceService.currentPackets(session),
        sources: await this.sourceStore.list(),
        retrievalMeta: retrievalResult.meta,
        signal,
      });
      for (const packet of session.evidence_packets) {
        if (packet.status !== "stale" && packet.status !== "rejected") packet.status = "used";
      }
      const currentRetrieval = session.retrievals.find((retrieval) => retrieval.retrieval_id === retrievalId);
      if (currentRetrieval) currentRetrieval.status = "used";
      this.#setStatus(session, "WAITING_FOR_FOLLOW_UP");
      session.current_answer = answer;
      session.pending_question = null;
      session.answer_history.push({ answer_id: `answer_${this.idFactory()}`, created_at: this.now().toISOString(), context_version: session.context_version, answer });
      result = {
        action: "respond",
        session_id: sessionId,
        message_id: message.message_id,
        reason: decision.reason,
        retrieval: { queries, source_ids: sources.map((source) => source.source_id), meta: retrievalResult.meta },
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
        });
        session.current_answer = answer;
        session.answer_history.push({ answer_id: `answer_${this.idFactory()}`, created_at: this.now().toISOString(), context_version: session.context_version, answer });
        this.#setStatus(session, "WAITING_FOR_FOLLOW_UP");
        result = { action: "respond", session_id: sessionId, message_id: message.message_id, reason: decision.reason, answer, state: session.status };
      }
    } catch (error) {
      this.#setStatus(session, "FAILED_RECOVERABLE");
      await this.sessionService.save(session);
      await this.#log({
        event_type: "orchestrator_failed",
        request_id: requestId,
        session_id: sessionId,
        stage: decision.action,
        error_code: error.code ?? "RETRIEVAL_FAILED",
      });
      throw error;
    }
    await this.sessionService.saveTurnResult(session, clientTurnId, result);
    await this.#log({
      event_type: "turn_completed",
      request_id: requestId,
      session_id: sessionId,
      stage: result.action,
      message_id: message.message_id,
      state: session.status,
      source_ids: result.retrieval?.source_ids ?? [],
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return result;
  }
}
