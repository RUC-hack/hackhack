import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonObject } from "../../src/server/integrations/resilient-llm-client.mjs";

test("balanced JSON extraction tolerates prose and fenced output", () => {
  const value = extractJsonObject('说明如下：```json\n{"text":"brace } in string","nested":{"ok":true}}\n```');
  assert.deepEqual(value, { text: "brace } in string", nested: { ok: true } });
});

test("balanced JSON extraction rejects incomplete output", () => {
  assert.throws(() => extractJsonObject('{"nested":{"ok":true}'), (error) => error.code === "LLM_INVALID_RESPONSE");
});

