import { ANSWER_OUTPUT_LIMITS, assertAgentDecision, assertAnswerEnvelope } from "../contracts/answer.mjs";
import { appError } from "../contracts/errors.mjs";
import { assertSourceSelection, SOURCE_SELECTION_LIMITS } from "../contracts/source-selection.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class MockLlmGateway {
  constructor({ decisionSequence = [], selectionFactory = null, answerFactory = null } = {}) {
    this.decisionSequence = decisionSequence.map(clone);
    this.selectionFactory = selectionFactory;
    this.answerFactory = answerFactory;
    this.decisionCalls = 0;
    this.selectionCalls = 0;
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
    const maxQuestions = sessionView.max_questions ?? 4;
    const userTurnCount = (sessionView.raw_messages ?? []).filter((item) => item?.role === "user").length;
    if (!direct && questionCount < maxQuestions && userTurnCount >= 1 && latest.length < 18) {
      const questions = [
        "在这个选择里，你现在最担心失去什么，或最想保留什么？",
        "如果只看接下来两三年，你最希望这次选择带来什么变化？",
        "哪些现实条件会让其中一条路暂时走不通？",
        "你愿意为更想要的生活承担哪一种代价？",
      ];
      return assertAgentDecision({
        action: "ask",
        reason: "先确认你最想比较的代价，才能让检索覆盖真正相关的经历。",
        blocking_unknowns: ["当前选择中最需要被比较的代价"],
        question: {
          text: questions[Math.min(questionCount, questions.length - 1)],
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

  async selectSources(input, { signal } = {}) {
    if (signal?.aborted) throw appError("LLM_CANCELLED");
    this.selectionCalls += 1;
    if (this.selectionFactory) return assertSourceSelection(await this.selectionFactory(input));
    const sourceIds = (input.evidence_packets ?? []).map((packet) => packet.source_id).filter(Boolean);
    return assertSourceSelection({
      groups: sourceIds.length ? [{
        key: "case_mosaic",
        title: "相似处境中的不同走向",
        description: "先浏览与当前问题相关的公开经历，再进入综合分析。",
        items: sourceIds.slice(0, SOURCE_SELECTION_LIMITS.maxItemsPerGroup).map((sourceId) => ({
          source_id: sourceId,
          reason: "材料与当前问题的处境或选择直接相关。",
        })),
      }] : [],
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
        source_ids: sourceIds.slice(0, ANSWER_OUTPUT_LIMITS.maxSectionSources),
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
