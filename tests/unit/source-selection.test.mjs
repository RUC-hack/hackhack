import assert from "node:assert/strict";
import test from "node:test";

import { assertSourceSelection, selectedSourceIds, validateSourceSelection } from "../../src/server/contracts/source-selection.mjs";
import { SourceSelectionService } from "../../src/server/services/source-selection-service.mjs";

const sources = [
  { source_id: "zhihu:answer:1", title: "经历一", author: "答主一", summary: "关于选择的经历", url: "https://www.zhihu.com/question/1/answer/1", content_type: "answer", retrieved_at: "2026-01-01T00:00:00.000Z", provider: "mock" },
  { source_id: "zhihu:answer:2", title: "经历二", author: "答主二", summary: "关于另一种选择的经历", url: "https://www.zhihu.com/question/2/answer/2", content_type: "answer", retrieved_at: "2026-01-01T00:00:00.000Z", provider: "mock" },
  { source_id: "zhihu:answer:3", title: "经历三", author: "答主三", summary: "关于第三种选择的经历", url: "https://www.zhihu.com/question/3/answer/3", content_type: "answer", retrieved_at: "2026-01-01T00:00:00.000Z", provider: "mock" },
];

const packets = sources.map((source) => ({ source_id: source.source_id, status: "validated", raw_summary: source.summary }));

test("source selection validates a closed set with three groups and three items each", () => {
  const selection = {
    groups: [
      { key: "one", title: "第一组", description: "第一组材料", items: [{ source_id: sources[0].source_id, reason: "直接相关" }, { source_id: sources[1].source_id, reason: "直接相关" }] },
      { key: "two", title: "第二组", description: "第二组材料", items: [{ source_id: sources[2].source_id, reason: "直接相关" }] },
    ],
  };
  assert.doesNotThrow(() => assertSourceSelection(selection, { sourceIds: new Set(sources.map((source) => source.source_id)) }));
  assert.deepEqual(selectedSourceIds(selection), [sources[0].source_id, sources[1].source_id, sources[2].source_id]);
  assert.doesNotThrow(() => assertSourceSelection({
    groups: [{ key: "all", title: "同方向经历", description: "三条材料", items: sources.map((source) => ({ source_id: source.source_id, reason: "直接相关" })) }],
  }, { sourceIds: new Set(sources.map((source) => source.source_id)) }));
});

test("source selection rejects overflow and duplicate or unknown sources", () => {
  const sourceIds = new Set(sources.map((source) => source.source_id));
  const tooMany = {
    groups: Array.from({ length: 4 }, (_, index) => ({ key: `group-${index}`, title: "组", description: "说明", items: [{ source_id: sources[0].source_id, reason: "相关" }] })),
  };
  const duplicate = {
    groups: [{ key: "one", title: "组", description: "说明", items: [{ source_id: sources[0].source_id, reason: "相关" }, { source_id: sources[0].source_id, reason: "重复" }] }],
  };
  const tooManyItems = {
    groups: [{ key: "one", title: "组", description: "说明", items: [
      ...sources.map((source) => ({ source_id: source.source_id, reason: "相关" })),
      { source_id: "zhihu:answer:4", reason: "相关" },
    ] }],
  };
  assert.ok(validateSourceSelection(tooMany, { sourceIds }).errors.includes("source_selection_groups_too_many"));
  assert.ok(validateSourceSelection(tooManyItems, { sourceIds: new Set([...sourceIds, "zhihu:answer:4"]) }).errors.includes("source_selection_group_0_items_invalid"));
  assert.ok(validateSourceSelection(duplicate, { sourceIds }).errors.some((error) => error.startsWith("source_selection_duplicate_source_")));
  assert.ok(validateSourceSelection({ groups: [{ key: "one", title: "组", description: "说明", items: [{ source_id: "missing", reason: "相关" }] }] }, { sourceIds }).errors.includes("source_selection_source_id_not_found_missing"));
});

test("source selection service enriches selected ids with public source views", async () => {
  const service = new SourceSelectionService({
    llmGateway: { async selectSources() { return { groups: [{ key: "one", title: "相关经历", description: "与问题相关", items: [{ source_id: sources[0].source_id, reason: "讨论了相似选择" }] }] }; } },
    idFactory: () => "selection-id",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const selection = await service.build({
    session: { session_id: "session-1", context_version: 2, current_understanding: { problem_statement: "选择", context_items: [] } },
    evidencePackets: packets,
    sources,
    retrievalId: "retrieval-1",
  });
  assert.equal(selection.selection_id, "selection_selection-id");
  assert.equal(selection.groups[0].items[0].source.author, "答主一");
  assert.equal(selection.groups[0].items[0].source.url, "https://www.zhihu.com/question/1/answer/1");
});

test("source selection service falls back to ordered candidates when the selector is unavailable", async () => {
  const service = new SourceSelectionService({
    llmGateway: { async selectSources() { throw Object.assign(new Error("filtered"), { code: "LLM_CONTENT_FILTER" }); } },
    idFactory: () => "fallback-id",
  });
  const selection = await service.build({
    session: { session_id: "session-1", context_version: 1, current_understanding: { problem_statement: "选择", context_items: [] } },
    evidencePackets: packets,
    sources,
  });
  assert.equal(selection.status, "fallback");
  assert.equal(selection.groups[0].items.length, 3);
});
