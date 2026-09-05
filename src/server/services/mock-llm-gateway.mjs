import { assertAgentDecision, assertAnswerEnvelope } from "../contracts/answer.mjs";
import { appError } from "../contracts/errors.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class MockLlmGateway {
  constructor({ decisionSequence = [], answerFactory = null } = {}) {
    this.decisionSequence = decisionSequence.map(clone);
    this.answerFactory = answerFactory;
    this.decisionCalls = 0;
    this.answerCalls = 0;
  }

  status() {
    return { provider: "mock-llm", configured: true, live_calls_allowed: false };
  }

  async decideNextAction(sessionView, { signal } = {}) {
    if (signal?.aborted) throw appError("LLM_CANCELLED");
    const preset = this.decisionSequence[this.decisionCalls++];
    if (preset) return assertAgentDecision(clone(preset));
    const latest = sessionView.raw_messages?.at(-1)?.text ?? "";
    const direct = /(直接回答|马上回答|立即回答|不用问|跳过|先回答)/u.test(latest);
    const questionCount = sessionView.question_count ?? 0;
    const maxQuestions = sessionView.max_questions ?? 2;
    if (!direct && questionCount < maxQuestions && sessionView.raw_messages?.length === 1 && latest.length < 40) {
      return assertAgentDecision({
        action: "ask",
        reason: "先确认你最想比较的代价，才能让检索覆盖真正相关的经历。",
        blocking_unknowns: ["当前选择中最需要被比较的代价"],
        question: {
          text: "在这个选择里，你现在最担心失去什么，或最想保留什么？",
          suggestions: ["短期收入和稳定", "继续探索的机会", "还说不清"],
          allow_free_text: true,
          allow_skip: true,
          allow_answer_now: true,
        },
        queries: [],
        assumptions: [],
      });
    }
    const problem = sessionView.current_understanding?.problem_statement || latest;
    return assertAgentDecision({
      action: "retrieve",
      reason: direct ? "你希望先基于当前信息查看参照。" : "当前信息已经足以从不同路径检索相关经历。",
      blocking_unknowns: [],
      question: null,
      queries: [problem, `${problem} 真实经历`, `${problem} 改变主意 转折`].slice(0, 3),
      assumptions: [],
    });
  }

  async buildGroundedAnswer(input, { signal } = {}) {
    if (signal?.aborted) throw appError("LLM_CANCELLED");
    this.answerCalls += 1;
    if (this.answerFactory) return assertAnswerEnvelope(await this.answerFactory(input));
    const packets = input.evidence_packets ?? [];
    const sourceIds = packets.map((packet) => packet.source_id);
    const cases = packets.map((packet) => `${packet.narrative}${packet.unknowns?.length ? `（仍未知：${packet.unknowns.join("；")}）` : ""}`).join("\n");
    return assertAnswerEnvelope({
      summary: packets.length
        ? "下面是基于当前问题和公开经验摘要整理出的参照，不是对你结果的预测。"
        : "当前还没有取得足够的公开经验材料，先保留这个问题，等你补充信息后再继续。",
      sections: packets.length ? [{
        kind: "case_mosaic",
        title: "材料中的几种人生质地",
        content: cases,
        source_ids: sourceIds,
      }] : [],
      assumptions: input.session?.current_understanding?.assumptions ?? [],
      unknowns: [...(input.session?.current_understanding?.blocking_unknowns ?? []), ...packets.flatMap((packet) => packet.unknowns ?? [])],
      limitations: [
        "这些是公开经验样本，不代表所有人的总体情况。",
        "知乎搜索返回的是摘要，可能不包含完整背景、动机或长期结果。",
        ...(input.retrieval_meta?.degraded ? ["本次检索使用了本地案例库作为降级来源。"] : []),
      ],
      next_actions: ["回看与你最相似的来源，再写下你愿意承担的代价。"],
    });
  }
}
