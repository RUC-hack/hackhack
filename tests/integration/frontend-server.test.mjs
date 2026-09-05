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
  const mainHtml = await (await fetch(`http://127.0.0.1:${port}/index.html`)).text();
  assert.match(mainHtml, /assets\/brand\/logo-mark\.svg/u);

  const qa = await fetch(`http://127.0.0.1:${port}/qa.html`);
  assert.equal(qa.status, 200);
  const qaHtml = await qa.text();
  assert.match(qaHtml, /一段正在展开的对话/u);
  assert.match(qaHtml, /href="journey\.css"/u);
  assert.doesNotMatch(qaHtml, /staging_src\//u);
  assert.match(qaHtml, /demo\/curated-data\.js/u);
  assert.match(qaHtml, /id="qa-start-error"/u);
  assert.match(qaHtml, /qa-results/u);
  assert.match(qaHtml, /data-qa-view="question"/u);
  assert.match(qaHtml, /assets\/brand\/logo-mark\.svg/u);
  assert.match(qaHtml, /id="qa-question-page"/u);
  assert.match(qaHtml, /id="qa-page-progress"/u);
  assert.match(qaHtml, /id="qa-dialogue"/u);
  assert.match(qaHtml, /href="#qa-paths-list"/u);
  assert.match(qaHtml, /href="#qa-people-pool"/u);
  assert.match(qaHtml, /href="#qa-answer-context"/u);
  assert.match(qaHtml, /Photo by/u);

  const journeyStyles = await fetch(`http://127.0.0.1:${port}/journey.css`);
  assert.equal(journeyStyles.status, 200);
  assert.match(await journeyStyles.text(), /\.journey-person-detail/u);

  const curatedData = await fetch(`http://127.0.0.1:${port}/demo/curated-data.js`);
  assert.equal(curatedData.status, 200);
  const curatedText = await curatedData.text();
  assert.match(curatedText, /JIANZHONG_CURATED_DATA/u);
  assert.match(curatedText, /demo:zhihu:/u);

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

  for (const filename of ["hero.jpg", "crowd.jpg", "portrait.jpg", "road.jpg", "closing.jpg", "matched-paths-lake.jpg"]) {
    const image = await fetch(`http://127.0.0.1:${port}/assets/images/${filename}`);
    assert.equal(image.status, 200, filename);
    assert.equal(image.headers.get("content-type"), "image/jpeg", filename);
    assert.ok((await image.arrayBuffer()).byteLength > 1_000, filename);
  }

  const missing = await fetch(`http://127.0.0.1:${port}/assets/images/not-found.jpg`);
  assert.equal(missing.status, 404);
});
