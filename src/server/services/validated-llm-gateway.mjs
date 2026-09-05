import { appError } from "../contracts/errors.mjs";
import { validateAgentDecision, validateAnswerEnvelope } from "../contracts/answer.mjs";
import { buildAnswerPrompt, buildDecisionPrompt } from "./prompts.mjs";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sourceIdsFrom(input) {
  return new Set((input?.evidence_packets ?? []).map((packet) => packet?.source_id).filter(Boolean));
}

function validate(type, value, input) {
  return type === "decision"
    ? validateAgentDecision(value)
    : validateAnswerEnvelope(value, { sourceIds: sourceIdsFrom(input) });
}

function schemaRules(type, input) {
  if (type === "decision") {
    return [
      "AgentDecision 必须包含 action、reason、blocking_unknowns、queries、assumptions。",
      "action=ask 时 question 必须是含非空 text 的对象且 queries=[]。",
      "action=retrieve 时 queries 必须含 1-4 个非空字符串；其他 action 的 queries 必须为空数组。",
    ].join("\n");
  }
  const allowed = [...sourceIdsFrom(input)];
  return [
    "AnswerEnvelope 必须包含 summary、sections、assumptions、unknowns、limitations、next_actions。",
    "sections 必须是对象数组；每节包含 kind、title、content、source_ids。其余四个复数字段必须是数组。",
    `source_ids 只能取自以下 ID：${JSON.stringify(allowed)}`,
    "不要出现“成功率”“成功概率”或伪统计。",
  ].join("\n");
}

function repairUser(type, invalidValue, errors) {
  const label = type === "decision" ? "AgentDecision" : "AnswerEnvelope";
  return [
    `上一次 ${label} 未通过校验。`,
    `校验错误：${JSON.stringify(errors)}`,
    `上一次 JSON：${JSON.stringify(invalidValue)}`,
    "只返回修复后的完整 JSON，不要解释，不要添加输入中不存在的事实。",
  ].join("\n");
}

export class ValidatedLlmGateway {
  constructor({ client, maxRepairAttempts = 2 } = {}) {
    if (!client || typeof client.chatJson !== "function") throw new TypeError("ValidatedLlmGateway requires an LLM client");
    if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts < 0 || maxRepairAttempts > 3) {
      throw new TypeError("maxRepairAttempts must be an integer from 0 to 3");
    }
    this.client = client;
    this.maxRepairAttempts = maxRepairAttempts;
  }

  status() {
    return { ...(this.client.status?.() ?? { provider: "llm", configured: true }), validation: "contract-and-source-ids", max_repair_attempts: this.maxRepairAttempts };
  }

  async #validated(type, input, { signal, requestId = null, metrics = null } = {}) {
    const basePrompt = type === "decision" ? buildDecisionPrompt(input) : buildAnswerPrompt(input);
    const invalidCode = type === "decision" ? "LLM_INVALID_RESPONSE" : "ANSWER_INVALID";
    let invalidValue = null;
    let errors = ["model_output_unavailable"];
    const sessionId = type === "decision" ? input?.session_id : input?.session?.session_id;

    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      try {
        const value = await this.client.chatJson({
          system: `${basePrompt}\n${schemaRules(type, input)}`,
          user: attempt === 0
            ? (type === "decision" ? "根据当前会话决定下一步。" : "根据证据生成当前综合。")
            : repairUser(type, invalidValue, errors),
          signal,
          requestId,
          sessionId,
          stage: type,
          callLabel: `${type}_validation_${attempt + 1}`,
          onMetrics: (metric) => {
            if (Array.isArray(metrics)) metrics.push(metric);
          },
        });
        const validation = validate(type, value, input);
        if (validation.valid) return value;
        invalidValue = clone(value);
        errors = validation.errors;
      } catch (error) {
        if (error?.code !== "LLM_INVALID_RESPONSE" || attempt === this.maxRepairAttempts) {
          if (error?.code && error.code !== "LLM_INVALID_RESPONSE") throw error;
          throw appError(invalidCode, { cause: error, details: { errors } });
        }
        invalidValue = null;
        errors = [error.code];
      }
    }

    throw appError(invalidCode, { details: { errors } });
  }

  decideNextAction(sessionView, options = {}) {
    return this.#validated("decision", sessionView, options);
  }

  buildGroundedAnswer(answerInput, options = {}) {
    return this.#validated("answer", answerInput, options);
  }
}

