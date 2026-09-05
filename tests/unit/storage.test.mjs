import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonlSessionStore } from "../../src/server/storage/jsonl-session-store.mjs";
import { createSession } from "../../src/server/contracts/session.mjs";
import { SourceStore } from "../../src/server/storage/source-store.mjs";

const source = { source_id: "local:restart", title: "测试", author: "匿名", summary: "摘要", url: "https://www.zhihu.com/a", content_type: "answer", retrieved_at: "2026-01-01T00:00:00.000Z", provider: "local" };

test("JSONL session store can restore the latest public session after a new instance", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-session-store-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const session = createSession({ id: "session-restart", problemStatement: "测试", now: () => new Date("2026-09-04T00:00:00.000Z") });
  session.raw_messages.push({ message_id: "m1", role: "user", text: "原话", created_at: "2026-09-04T00:00:00.000Z" });
  const firstStore = new JsonlSessionStore({ logDir: root, now: () => new Date("2026-09-04T00:00:00.000Z") });
  await firstStore.create(session);
  const restored = await new JsonlSessionStore({ logDir: root }).get("session-restart");
  assert.equal(restored.current_understanding.problem_statement, "测试");
  assert.equal(restored.raw_messages[0].text, "原话");
});

test("SourceStore can retrieve persisted source by source id", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-source-store-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await new SourceStore({ directory: root }).save(source);
  const restored = await new SourceStore({ directory: root }).getPublic(source.source_id);
  assert.equal(restored.source_id, source.source_id);
  assert.equal(restored.url, source.url);
});
