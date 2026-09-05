import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../../src/server/app.mjs";

test("real composition falls back to the local dataset when live Zhihu calls are disabled", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackhack-degraded-flow-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const app = createApp({
    env: {
      APP_ENV: "development",
      DATA_PROVIDER: "zhihu",
      ALLOW_LIVE_EXTERNAL_CALLS: "false",
      MAX_QUESTIONS: "0",
      RUNTIME_STATE_DIR: path.join(root, "state"),
      RUNTIME_LOG_DIR: path.join(root, "logs"),
      RUNTIME_CACHE_DIR: path.join(root, "cache"),
    },
    logger: { async log() {} },
  });
  const session = await app.services.sessionService.create({ problemStatement: "考研还是工作" });
  const result = await app.services.orchestrator.handleMessage(session.session_id, { text: "请先基于当前信息回答", clientTurnId: "degraded-1" });
  assert.equal(result.action, "respond");
  assert.equal(result.retrieval.meta.degraded, true);
  assert.equal(result.retrieval.meta.degraded_from, "zhihu");
  assert.equal(result.analysis.status, "completed");
  const completed = await app.services.sessionService.get(session.session_id);
  assert.equal(completed.analysis.status, "completed");
  assert.match(JSON.stringify(result.answer.limitations), /本地案例库/u);
});
