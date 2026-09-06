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
  const mainHtml = await main.text();
  assert.match(mainHtml, /问答测试/u);
  assert.match(mainHtml, /assets\/brand\/logo-mark\.svg/u);

  const qa = await fetch(`http://127.0.0.1:${port}/qa.html`);
  assert.equal(qa.status, 200);
  const qaHtml = await qa.text();
  assert.match(qaHtml, /有什么让你纠结了/u);
  assert.match(qaHtml, /href="journey\.css"/u);
  assert.match(qaHtml, /assets\/brand\/logo-mark\.svg/u);
  assert.doesNotMatch(qaHtml, /demo\/curated-data\.js/u);
  assert.match(qaHtml, /qa\.js/u);

  const session = await fetch(`http://127.0.0.1:${port}/qa-session.html`);
  assert.equal(session.status, 200);
  const sessionHtml = await session.text();
  assert.match(sessionHtml, /一段正在展开的对话/u);
  assert.match(sessionHtml, /qa-search-ritual/u);
  assert.match(sessionHtml, /qa-message-form/u);
  assert.doesNotMatch(sessionHtml, /demo\/curated-data\.js/u);

  const results = await fetch(`http://127.0.0.1:${port}/qa-results.html`);
  assert.equal(results.status, 200);
  const resultsHtml = await results.text();
  assert.match(resultsHtml, /THREE DIRECTIONS/u);
  assert.match(resultsHtml, /JIANZHONG'S RESPONSE/u);
  assert.match(resultsHtml, /qa-answer-view/u);
  assert.match(resultsHtml, /PEOPLE IN THIS ANSWER/u);
  assert.doesNotMatch(resultsHtml, /demo\/curated-data\.js/u);

  const qaScript = await fetch(`http://127.0.0.1:${port}/qa.js`);
  assert.equal(qaScript.status, 200);
  const qaScriptText = await qaScript.text();
  assert.doesNotMatch(qaScriptText, /shouldUseCuratedFlow|runDemoInitial|runDemoTurn|DEMO_ANSWER|DEMO_SOURCES/u);

  const journeyStyles = await fetch(`http://127.0.0.1:${port}/journey.css`);
  assert.equal(journeyStyles.status, 200);
  assert.match(await journeyStyles.text(), /\.journey-person-detail/u);

  const archivedFrontend = await fetch(`http://127.0.0.1:${port}/prototypes/frontend-a/index.html`);
  assert.equal(archivedFrontend.status, 200);
  assert.match(await archivedFrontend.text(), /进入策展叙事/u);

  const figures = await fetch(`http://127.0.0.1:${port}/assets/people/figures.svg`);
  assert.equal(figures.status, 200);
  assert.equal(figures.headers.get("content-type"), "image/svg+xml");
  assert.match(await figures.text(), /symbol id="person-1"/u);

  const openPeep = await fetch(`http://127.0.0.1:${port}/assets/people/openpeeps/openpeeps47.svg`);
  assert.equal(openPeep.status, 200);
  assert.equal(openPeep.headers.get("content-type"), "image/svg+xml");
  assert.match(await openPeep.text(), /<svg/u);

  const logo = await fetch(`http://127.0.0.1:${port}/assets/brand/logo-mark.svg`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/svg+xml");
  assert.match(await logo.text(), /见众四人标志/u);

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
