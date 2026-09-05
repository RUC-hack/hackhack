import assert from "node:assert/strict";
import { test } from "node:test";

import { createFrontendServer } from "../../scripts/frontend-server.mjs";

test("frontend server serves the main page, QA page, and local images", async (t) => {
  const server = createFrontendServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const main = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(main.status, 200);
  assert.match(await main.text(), /问答测试/u);

  const qa = await fetch(`http://127.0.0.1:${port}/qa.html`);
  assert.equal(qa.status, 200);
  const qaHtml = await qa.text();
  assert.match(qaHtml, /一段正在展开的对话/u);
  assert.match(qaHtml, /staging_src\/journey\.css/u);
  assert.match(qaHtml, /qa-results/u);

  const figures = await fetch(`http://127.0.0.1:${port}/assets/people/figures.svg`);
  assert.equal(figures.status, 200);
  assert.equal(figures.headers.get("content-type"), "image/svg+xml");
  assert.match(await figures.text(), /symbol id="person-1"/u);

  const config = await fetch(`http://127.0.0.1:${port}/app-config.js`);
  assert.equal(config.status, 200);
  assert.match(await config.text(), /apiBaseUrl/u);

  for (const filename of ["hero.jpg", "crowd.jpg", "portrait.jpg", "road.jpg", "closing.jpg"]) {
    const image = await fetch(`http://127.0.0.1:${port}/assets/images/${filename}`);
    assert.equal(image.status, 200, filename);
    assert.equal(image.headers.get("content-type"), "image/jpeg", filename);
    assert.ok((await image.arrayBuffer()).byteLength > 1_000, filename);
  }

  const missing = await fetch(`http://127.0.0.1:${port}/assets/images/not-found.jpg`);
  assert.equal(missing.status, 404);
});
