import assert from "node:assert/strict";
import test from "node:test";

import { buildAnswerPrompt, buildDecisionPrompt, compactAnswerForRepair } from "../../src/server/services/prompts.mjs";

function packet(index) {
  const summary = `经历 ${index}：${"这是一段较长的知乎经历摘要。".repeat(120)}`;
  return {
    source_id: `zhihu:answer:${index}`,
    raw_summary: summary,
    narrative: summary,
    observations: [{ label: "摘要中明确出现的经历", value: summary, evidence: summary }],
    unknowns: ["完整原文可能不在摘要中。"],
    candidate_relations: [],
  };
}

test("answer prompt compresses duplicated evidence without changing the source input contract", () => {
  const packets = Array.from({ length: 19 }, (_, index) => packet(index));
  const prompt = buildAnswerPrompt({
    session: {
      session_id: "session-prompt-test",
      context_version: 1,
      current_understanding: { problem_statement: "考研还是工作", context_items: [], blocking_unknowns: [], assumptions: [] },
    },
    evidence_packets: packets,
    retrieval_meta: { provider: "zhihu", query_count: 4, result_count: 19, degraded: false },
  });

  assert.match(prompt, /original_count.*19/u);
  assert.match(prompt, /included_count.*9/u);
  assert.match(prompt, /摘要已压缩/u);
  assert.ok(prompt.length < 20_000);
  assert.equal(prompt.includes("candidate_relations"), false);
  assert.equal(prompt.includes("observations"), false);
});

test("decision and answer prompts expose the expanded round and citation budgets", () => {
  assert.match(buildDecisionPrompt({ max_questions: 4 }), /最多允许 4 轮追问/u);
  assert.match(buildAnswerPrompt({
    session: { current_understanding: { problem_statement: "选择", context_items: [] } },
    evidence_packets: [],
  }), /每节最多引用 3 个 source_ids/u);
});

test("decision prompt prioritizes the lived dilemma over bundled profile questions", () => {
  const prompt = buildDecisionPrompt({ max_questions: 4 });

  assert.match(prompt, /正在经历的选择、想比较的维度、最担心的代价/u);
  assert.match(prompt, /不要把学历、专业、年龄、城市、收入、家庭、伴侣等个人画像当作默认必填信息/u);
  assert.match(prompt, /每次 action=ask 只能提出一个具体、容易回答的问题/u);
  assert.match(prompt, /blocking_unknowns 最多列出一个缺口/u);
  assert.match(prompt, /question\.suggestions.*2-3 个简短选项/u);
});

test("answer repair input is compacted while preserving source ids", () => {
  const value = {
    summary: "总结",
    sections: Array.from({ length: 12 }, (_, index) => ({
      kind: "case",
      title: `经历 ${index}`,
      content: "内容".repeat(1_000),
      source_ids: [`zhihu:answer:${index}`],
    })),
    assumptions: ["假设"],
    unknowns: [],
    limitations: [],
    next_actions: [],
  };
  const compacted = compactAnswerForRepair(value);
  assert.equal(compacted.sections.length, 3);
  assert.deepEqual(compacted.sections[0].source_ids, ["zhihu:answer:0"]);
  assert.ok(compacted.sections[0].content.length <= 700);
});
