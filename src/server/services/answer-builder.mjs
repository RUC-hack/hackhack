import { appError } from "../contracts/errors.mjs";
import { assertAnswerEnvelope, validateAnswerEnvelope } from "../contracts/answer.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class AnswerBuilder {
  constructor({ llmGateway } = {}) {
    if (!llmGateway || typeof llmGateway.buildGroundedAnswer !== "function") throw new TypeError("AnswerBuilder requires an LLM gateway");
    this.llmGateway = llmGateway;
  }

  async build({ session, evidencePackets = [], sources = [], retrievalMeta = {}, signal, requestId = null, metrics = null } = {}) {
    const validPackets = evidencePackets.filter((packet) => packet.status !== "stale" && packet.status !== "rejected");
    const packetSourceIds = new Set(validPackets.map((packet) => packet.source_id));
    const availableSourceIds = new Set(sources.map((source) => source.source_id));
    if ([...packetSourceIds].some((sourceId) => !availableSourceIds.has(sourceId))) {
      throw appError("EVIDENCE_INVALID", { message: "Evidence refers to a source that is not stored" });
    }
    const input = {
      session: {
        session_id: session.session_id,
        context_version: session.context_version,
        current_understanding: clone(session.current_understanding),
      },
      evidence_packets: clone(validPackets),
      retrieval_meta: clone(retrievalMeta),
    };
    let answer;
    try {
      answer = await this.llmGateway.buildGroundedAnswer(input, { signal, requestId, metrics });
    } catch (error) {
      if (error?.code) throw error;
      throw appError("ANSWER_INVALID", { cause: error });
    }
    const validation = validateAnswerEnvelope(answer, { sourceIds: packetSourceIds });
    if (!validation.valid) throw appError("ANSWER_INVALID", { details: { errors: validation.errors } });
    assertAnswerEnvelope(answer, { sourceIds: packetSourceIds });
    const limitations = Array.isArray(answer.limitations) ? [...answer.limitations] : [];
    if (!limitations.some((item) => /样本|预测|摘要/u.test(String(item)))) {
      limitations.push("这些材料是公开经验样本，不代表总体，也不能预测你的结果；知乎摘要可能不完整。");
    }
    if (retrievalMeta.degraded && !limitations.some((item) => /本地|降级/u.test(String(item)))) {
      limitations.push("本次检索使用了本地案例库作为降级来源。");
    }
    return {
      ...clone(answer),
      assumptions: Array.isArray(answer.assumptions) ? answer.assumptions : [],
      unknowns: Array.isArray(answer.unknowns) ? answer.unknowns : [],
      limitations,
      next_actions: Array.isArray(answer.next_actions) ? answer.next_actions : [],
    };
  }
}
