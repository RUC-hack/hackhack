import assert from "node:assert/strict";
import test from "node:test";

import { assertAnswerEnvelope, validateAnswerEnvelope } from "../../src/server/contracts/answer.mjs";
import { assertEvidencePacket, validateEvidencePacket } from "../../src/server/contracts/evidence.mjs";
import { assertTransition, canTransition, createSession, publicSessionView } from "../../src/server/contracts/session.mjs";
import { assertSourceDocument, validateSourceDocument } from "../../src/server/contracts/source-document.mjs";

const source = {
  source_id: "local:1",
  title: "匿名样例",
  author: "匿名作者",
  summary: "先工作，再重新学习。",
  url: "https://www.zhihu.com/question/1/answer/1",
  content_type: "answer",
  retrieved_at: "2026-01-01T00:00:00.000Z",
  provider: "local",
};

test("source contract requires plain text and stable technical fields", () => {
  assert.equal(validateSourceDocument({ ...source, summary: "<em>unsafe</em>" }).valid, false);
  assert.doesNotThrow(() => assertSourceDocument(source));
});

test("session public view preserves raw messages but omits idempotency internals", () => {
  const session = createSession({ id: "session-1", problemStatement: "考研还是工作" });
  session.turn_results = { turn: { action: "ask" } };
  const view = publicSessionView(session);
  assert.equal(view.session_id, "session-1");
  assert.equal("turn_results" in view, false);
  assert.equal(view.current_understanding.problem_statement, "考研还是工作");
});

test("state transition table permits the MVP flow and rejects arbitrary jumps", () => {
  assert.equal(canTransition("COLLECTING_CONTEXT", "RETRIEVING"), true);
  assert.equal(canTransition("RETRIEVING", "REVIEWING_EVIDENCE"), true);
  assert.throws(() => assertTransition("COLLECTING_CONTEXT", "UNKNOWN"));
});

test("evidence validates each quoted fragment against the preserved raw summary", () => {
  const packet = {
    case_id: "case-1",
    source_id: source.source_id,
    raw_summary: source.summary,
    narrative: source.summary,
    observations: [{ label: "经历", value: "先工作", evidence: "先工作", certainty: "explicit" }],
    tensions: [],
    unknowns: [],
    candidate_relations: [],
    status: "validated",
  };
  assert.equal(validateEvidencePacket(packet, { sourceIds: new Set([source.source_id]) }).valid, true);
  assert.throws(() => assertEvidencePacket({ ...packet, observations: [{ ...packet.observations[0], evidence: "不存在" }] }, { sourceIds: new Set([source.source_id]) }));
});

test("answer contract keeps unknown section kinds and validates citations", () => {
  const answer = { summary: "当前综合", sections: [{ kind: "timeline_v2", title: "动态结构", content: "文本", source_ids: [source.source_id] }], assumptions: [], unknowns: [], limitations: ["不是预测"], next_actions: [] };
  assert.equal(validateAnswerEnvelope(answer, { sourceIds: new Set([source.source_id]) }).valid, true);
  assert.doesNotThrow(() => assertAnswerEnvelope(answer, { sourceIds: new Set([source.source_id]) }));
  assert.equal(validateAnswerEnvelope({ ...answer, sections: [{ ...answer.sections[0], source_ids: ["missing"] }] }, { sourceIds: new Set([source.source_id]) }).valid, false);
});

test("answer contract bounds the visible answer shape", () => {
  const answer = {
    summary: "当前综合",
    sections: Array.from({ length: 5 }, (_, index) => ({ kind: "case", title: `经历 ${index}`, content: "内容", source_ids: [source.source_id] })),
    assumptions: [],
    unknowns: ["未知"],
    limitations: [],
    next_actions: [],
  };
  const validation = validateAnswerEnvelope(answer, { sourceIds: new Set([source.source_id]) });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("sections_too_many"));
});

test("answer contract allows three cited sources and rejects a fourth", () => {
  const answer = {
    summary: "当前综合",
    sections: [{ kind: "case", title: "经历", content: "文本", source_ids: ["local:1", "local:2", "local:3"] }],
    assumptions: [],
    unknowns: [],
    limitations: [],
    next_actions: [],
  };
  const validation = validateAnswerEnvelope(answer, { sourceIds: new Set(["local:1", "local:2", "local:3"]) });
  assert.equal(validation.valid, true);

  const overflow = validateAnswerEnvelope({
    ...answer,
    sections: [{ ...answer.sections[0], source_ids: ["local:1", "local:2", "local:3", "local:4"] }],
  }, { sourceIds: new Set(["local:1", "local:2", "local:3", "local:4"]) });
  assert.equal(overflow.valid, false);
  assert.ok(overflow.errors.includes("section_0_sources_too_many"));
});
