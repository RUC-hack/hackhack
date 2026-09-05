import assert from "node:assert/strict";
import test from "node:test";

import { LocalDatasetProvider } from "../../src/server/providers/local-dataset-provider.mjs";
import { MockProvider } from "../../src/server/providers/mock-provider.mjs";

const fields = ["source_id", "title", "author", "summary", "url", "content_type", "retrieved_at", "provider"];

test("local and mock providers expose the same minimum SourceDocument contract", async () => {
  const local = new LocalDatasetProvider({ dataset: [{
    source_id: "local:test", title: "测试", author: "匿名", summary: "一段经历", url: "https://www.zhihu.com/a", content_type: "answer", retrieved_at: "2026-01-01T00:00:00.000Z", provider: "local",
  }] });
  const mock = new MockProvider();
  for (const provider of [local, mock]) {
    const result = await provider.search("测试", { limit: 2 });
    assert.ok(Array.isArray(result.documents));
    result.documents.forEach((document) => fields.forEach((field) => assert.equal(typeof document[field], "string")));
  }
});
