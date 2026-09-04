import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ZhihuSearchError } from "../../src/server/integrations/zhihu-search-client.mjs";
import {
  ZhihuProvider,
  assertSourceDocument,
} from "../../src/server/providers/zhihu-provider.mjs";
import { rawSuccess, zhihuItem } from "../fixtures/zhihu-search-response.mjs";

test("provider normalizes, deduplicates, caches, and writes redacted logs", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hackhack-zhihu-provider-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  let calls = 0;
  const client = {
    accessSecret: "test-secret-must-not-appear",
    async search() {
      calls += 1;
      return rawSuccess([
        zhihuItem(),
        zhihuItem({ ContentID: "answer-duplicate", Url: "https://www.zhihu.com/question/1/answer/1#fragment" }),
      ]);
    },
  };
  const provider = new ZhihuProvider({
    client,
    cacheDir: path.join(temporaryRoot, "cache"),
    logDir: path.join(temporaryRoot, "logs"),
    now: () => new Date("2026-09-04T12:00:00.000Z"),
  });

  const first = await provider.search("考研还是工作", { limit: 10, requestId: "request-1" });
  const second = await provider.search("考研还是工作", { limit: 10, requestId: "request-2" });

  assert.equal(calls, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(first.documents.length, 1);
  assert.doesNotThrow(() => assertSourceDocument(first.documents[0]));
  assert.equal(first.documents[0].source_id, "zhihu:answer:answer-1");
  assert.equal(first.documents[0].provider, "zhihu");
  assert.equal(first.documents[0].summary, "我先工作两年，后来重新读研。这个摘要只作为测试数据。");

  const logText = await readFile(path.join(temporaryRoot, "logs", "zhihu", "2026-09-04.jsonl"), "utf8");
  assert.equal(logText.includes("test-secret-must-not-appear"), false);
  assert.equal(logText.includes("考研还是工作"), false);
  assert.equal(logText.trim().split(/\r?\n/u).length, 2);
});

test("provider exposes a stable rate-limit error and does not hide it", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hackhack-zhihu-rate-limit-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const client = {
    accessSecret: "test-secret",
    async search() {
      throw new ZhihuSearchError("rate limited", {
        code: "ZHIHU_RATE_LIMITED",
        providerCode: 30001,
        httpStatus: 200,
        retryable: false,
      });
    },
  };
  const provider = new ZhihuProvider({
    client,
    cacheDir: path.join(temporaryRoot, "cache"),
    logDir: path.join(temporaryRoot, "logs"),
    now: () => new Date("2026-09-04T12:00:00.000Z"),
  });

  await assert.rejects(
    provider.search("考研", { limit: 1 }),
    (error) => error.code === "ZHIHU_RATE_LIMITED"
      && error.providerCode === 30001
      && error.retryable === false,
  );
});

test("provider refuses live calls when the application safety gate is closed", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hackhack-zhihu-disabled-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  let called = false;
  const provider = new ZhihuProvider({
    client: {
      accessSecret: "test-secret",
      async search() {
        called = true;
        return rawSuccess();
      },
    },
    allowLiveCalls: false,
    cacheDir: path.join(temporaryRoot, "cache"),
    logDir: path.join(temporaryRoot, "logs"),
  });

  await assert.rejects(
    provider.search("考研", { limit: 1 }),
    (error) => error.code === "ZHIHU_LIVE_CALLS_DISABLED",
  );
  assert.equal(called, false);
});
