import assert from "node:assert/strict";
import test from "node:test";

import {
  ZhihuSearchClient,
  validateZhihuSearchResponse,
} from "../../src/server/integrations/zhihu-search-client.mjs";
import { successResponse, zhihuItem } from "../fixtures/zhihu-search-response.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("client sends the documented request and returns a valid raw response", async () => {
  let capturedUrl;
  let capturedOptions;
  const client = new ZhihuSearchClient({
    accessSecret: "test-secret",
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return jsonResponse(successResponse());
    },
  });

  const result = await client.search({ query: "考研还是工作", count: 5 });

  assert.equal(capturedUrl.searchParams.get("Query"), "考研还是工作");
  assert.equal(capturedUrl.searchParams.get("Count"), "5");
  assert.equal(capturedOptions.headers.Authorization, "Bearer test-secret");
  assert.equal(capturedOptions.headers["X-Request-Timestamp"], "1700000000");
  assert.equal(result.body.Code, 0);
  assert.equal(result.validation.valid, true);
});

test("Code 30001 is classified as rate limiting and is never retried", async () => {
  let calls = 0;
  const client = new ZhihuSearchClient({
    accessSecret: "test-secret",
    maxRetries: 3,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ Code: 30001, Message: "rate limit exceeded", Data: null });
    },
  });

  await assert.rejects(
    client.search({ query: "考研", count: 1 }),
    (error) => error.code === "ZHIHU_RATE_LIMITED" && error.retryable === false,
  );
  assert.equal(calls, 1);
});

test("Code 90001 can be retried a bounded number of times", async () => {
  let calls = 0;
  const client = new ZhihuSearchClient({
    accessSecret: "test-secret",
    maxRetries: 1,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ Code: 90001, Message: "internal error", Data: null })
        : jsonResponse(successResponse());
    },
  });

  const result = await client.search({ query: "考研", count: 1 });
  assert.equal(result.body.Code, 0);
  assert.equal(result.attemptCount, 2);
  assert.equal(calls, 2);
});

test("schema validation reports missing source fields", () => {
  const item = zhihuItem();
  delete item.Url;
  const validation = validateZhihuSearchResponse(successResponse([item]));
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, ["item_0_missing_Url"]);
});
