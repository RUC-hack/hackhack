import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { envInteger } from "../../src/server/config/env.mjs";
import { redact } from "../../src/server/storage/redaction.mjs";
import { AuditLogger } from "../../src/server/storage/audit-logger.mjs";
import { ZhihuProvider } from "../../src/server/providers/zhihu-provider.mjs";
import { rawSuccess, zhihuItem } from "../fixtures/zhihu-search-response.mjs";

test("environment integer parser rejects trailing non-numeric characters", () => {
  assert.throws(() => envInteger("10abc", 1, { name: "TEST" }), /integer/);
  assert.throws(() => envInteger("1.2", 1, { name: "TEST" }), /integer/);
  assert.equal(envInteger(" 10 ", 1, { name: "TEST" }), 10);
});

test("redaction removes credentials without changing business values", () => {
  const value = redact({ access_secret: "secret-value", authorization: "Bearer token-value", text: "正常内容" });
  assert.equal(value.access_secret, "[REDACTED]");
  assert.equal(value.authorization, "[REDACTED]");
  assert.equal(value.text, "正常内容");
});

test("same Zhihu cache key shares one in-flight upstream request", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-inflight-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const provider = new ZhihuProvider({
    client: { accessSecret: "secret", async search() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return rawSuccess([zhihuItem()]); } },
    cacheDir: path.join(root, "cache"), logDir: path.join(root, "logs"), now: () => new Date("2026-09-04T00:00:00.000Z"),
  });
  const [first, second] = await Promise.all([provider.search("同一问题", { requestId: "one" }), provider.search("同一问题", { requestId: "two" })]);
  assert.equal(calls, 1);
  assert.deepEqual(first.documents, second.documents);
});

test("Zhihu HTML highlights become plain text and cache failures do not hide success", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-html-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const warnings = [];
  const provider = new ZhihuProvider({
    client: { accessSecret: "secret", async search() { return rawSuccess([zhihuItem({ ContentText: "<em>先工作</em>&amp;再学习" })]); } },
    cacheDir: path.join(root, "cache"), logDir: path.join(root, "logs"), now: () => new Date("2026-09-04T00:00:00.000Z"), onWarning: (warning) => warnings.push(warning),
  });
  const result = await provider.search("html", { requestId: "html" });
  assert.equal(result.documents[0].summary, "先工作&再学习");
  assert.equal(result.meta.cache_write_failed, undefined);
  assert.equal(warnings.length, 0);
});

test("audit logger best effort output never contains a fake secret", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-audit-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const logger = new AuditLogger({ logDir: root, now: () => new Date("2026-09-04T00:00:00.000Z") });
  await logger.log({ event_type: "test", session_id: "s1", api_key: "super-secret", message: "Bearer token-secret" });
  const text = await readFile(path.join(root, "conversations", "2026-09-04", "session-s1.jsonl"), "utf8");
  assert.equal(text.includes("super-secret"), false);
  assert.equal(text.includes("token-secret"), false);
});
