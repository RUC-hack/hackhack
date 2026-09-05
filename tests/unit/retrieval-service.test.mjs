import assert from "node:assert/strict";
import test from "node:test";

import { ZhihuSearchError } from "../../src/server/integrations/zhihu-search-client.mjs";
import { RetrievalService } from "../../src/server/services/retrieval-service.mjs";

test("retrieval service falls back on a classified Zhihu availability failure", async () => {
  const service = new RetrievalService({
    primaryProvider: {
      async search() {
        throw new ZhihuSearchError("rate limited", { code: "ZHIHU_RATE_LIMITED" });
      },
    },
    fallbackProvider: {
      async search() {
        return {
          documents: [],
          meta: { provider: "local", cached: true },
        };
      },
    },
  });

  const result = await service.search("考研还是工作");
  assert.equal(result.meta.provider, "local");
  assert.equal(result.meta.degraded, true);
  assert.equal(result.meta.degraded_from, "zhihu");
  assert.equal(result.meta.degradation_reason, "ZHIHU_RATE_LIMITED");
});

test("retrieval service does not hide invalid user input behind fallback", async () => {
  let fallbackCalled = false;
  const service = new RetrievalService({
    primaryProvider: {
      async search() {
        throw new ZhihuSearchError("bad query", { code: "ZHIHU_INVALID_ARGUMENT" });
      },
    },
    fallbackProvider: {
      async search() {
        fallbackCalled = true;
        return { documents: [], meta: { provider: "local" } };
      },
    },
  });

  await assert.rejects(service.search(""), (error) => error.code === "ZHIHU_INVALID_ARGUMENT");
  assert.equal(fallbackCalled, false);
});

test("retrieval service uses local fallback when the primary returns no documents", async () => {
  const result = await new RetrievalService({
    primaryProvider: { name: "zhihu", async search() { return { documents: [], meta: { provider: "zhihu" } }; } },
    fallbackProvider: { async search() { return { documents: [{ source_id: "local:1" }], meta: { provider: "local" } }; } },
  }).search("没有结果");
  assert.equal(result.meta.degraded, true);
  assert.equal(result.meta.degradation_reason, "ZHIHU_EMPTY_RESULT");
  assert.equal(result.documents[0].source_id, "local:1");
});

test("retrieval service preserves both errors when fallback also fails", async () => {
  await assert.rejects(
    new RetrievalService({
      primaryProvider: { name: "zhihu", async search() { throw new ZhihuSearchError("offline", { code: "ZHIHU_TIMEOUT" }); } },
      fallbackProvider: { async search() { throw Object.assign(new Error("dataset broken"), { code: "LOCAL_DATASET_UNAVAILABLE" }); } },
    }).search("测试"),
    (error) => error.code === "RETRIEVAL_FAILED" && error.details.primary_error.code === "ZHIHU_TIMEOUT" && error.details.fallback_error.code === "LOCAL_DATASET_UNAVAILABLE",
  );
});
