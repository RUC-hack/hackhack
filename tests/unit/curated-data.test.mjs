import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { validateAnswerEnvelope } from "../../src/server/contracts/answer.mjs";

test("curated frontend data is isolated and follows the production answer shape", async () => {
  const filename = path.resolve("src/demo/curated-data.js");
  const source = await fs.readFile(filename, "utf8");
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { filename });

  const curated = context.window.JIANZHONG_CURATED_DATA;
  assert.ok(curated);
  const sourceIds = new Set(Object.keys(curated.sources));
  assert.ok(sourceIds.size > 0);
  for (const [sourceId, document] of Object.entries(curated.sources)) {
    assert.match(sourceId, /^demo:/u);
    assert.equal(document.source_id, sourceId);
    assert.equal(document.provider, "demo");
    assert.match(document.url, /^https:\/\//u);
  }

  assert.deepEqual(validateAnswerEnvelope(curated.answer, { sourceIds }), { valid: true, errors: [] });
  assert.ok(curated.answer.next_actions.length > 0);

  const qaSource = await fs.readFile(path.resolve("src/qa.js"), "utf8");
  assert.doesNotMatch(qaSource, /demo:zhihu:/u);
});
