import { appError } from "../contracts/errors.mjs";
import { assertAgentDecision, assertAnswerEnvelope } from "../contracts/answer.mjs";
import { buildAnswerPrompt, buildDecisionPrompt } from "./prompts.mjs";

export class LlmGateway {
  constructor({ client, repair = true } = {}) {
    if (!client || typeof client.chatJson !== "function") throw new TypeError("LlmGateway requires an LlmClient");
    this.client = client;
    this.repair = repair;
  }

  status() {
    return this.client.status?.() ?? { provider: "llm", configured: true };
  }

  async #validated(type, input, signal) {
    try {
      const value = type === "decision"
        ? await this.client.chatJson({ system: buildDecisionPrompt(input), user: "根据当前会话决定下一步。", signal })
        : await this.client.chatJson({ system: buildAnswerPrompt(input), user: "根据证据生成当前综合。", signal });
      return type === "decision" ? assertAgentDecision(value) : assertAnswerEnvelope(value);
    } catch (error) {
      const invalidCode = type === "decision" ? "LLM_INVALID_RESPONSE" : "ANSWER_INVALID";
      const isValidationError = error instanceof TypeError;
      if (!this.repair || (!isValidationError && error?.code !== "LLM_INVALID_RESPONSE")) throw error;
      if (isValidationError) error = appError("LLM_INVALID_RESPONSE", { cause: error });
      const repairInput = type === "decision"
        ? { task: "repair decision JSON", session: input }
        : { task: "repair answer JSON", answer_input: input };
      const repaired = await this.client.chatJson({
        system: `只修复 JSON 结构并返回合法 ${type === "decision" ? "AgentDecision" : "AnswerEnvelope"}，不添加新事实。${buildAnswerPrompt(repairInput)}`,
        user: "上一次输出无法校验，请只返回修复后的 JSON。",
        signal,
      });
      try {
        return type === "decision" ? assertAgentDecision(repaired) : assertAnswerEnvelope(repaired);
      } catch (validationError) {
        throw appError(invalidCode, { cause: validationError });
      }
    }
  }

  decideNextAction(sessionView, { signal } = {}) {
    return this.#validated("decision", sessionView, signal);
  }

  buildGroundedAnswer(answerInput, { signal } = {}) {
    return this.#validated("answer", answerInput, signal);
  }
}
