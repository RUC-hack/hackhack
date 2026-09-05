(() => {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    question: "jianzhong.currentQuestion",
    questionType: "jianzhong.questionType",
    savedPeople: "jianzhong.savedPeople"
  });
  const DEFAULT_QUESTION = "我大四要毕业了，是继续读博、去互联网大厂工作，还是回家乡？";
  const DATA = window.JianzhongJourneyData || {};
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { dataset: null, activePath: null, activePerson: null, viewedPaths: new Set() };

  function getStoredQuestion() {
    try { return sessionStorage.getItem(STORAGE_KEYS.question)?.trim() || DEFAULT_QUESTION; }
    catch (_) { return DEFAULT_QUESTION; }
  }

  function saveQuestion(question) {
    const type = analyzeQuestion(question);
    try {
      sessionStorage.setItem(STORAGE_KEYS.question, question);
      sessionStorage.setItem(STORAGE_KEYS.questionType, type);
    } catch (_) { /* 无存储权限时仍可使用当前页面 */ }
    return type;
  }

  function analyzeQuestion(question) {
    const value = String(question || "").toLowerCase();
    const migrationKeywords = ["新西兰", "移民", "留学", "whv", "工签", "海外", "出国", "旅居"];
    const careerKeywords = ["读博", "博士", "毕业", "大厂", "工作", "就业", "研究生", "回家乡", "offer", "科研"];
    if (migrationKeywords.some(keyword => value.includes(keyword))) return "migration";
    if (careerKeywords.some(keyword => value.includes(keyword))) return "career";
    return "generic";
  }

  function getQuestionSummary(question, type = analyzeQuestion(question)) {
    if (type === "career") {
      const parts = [];
      if (/读博|博士|科研|研究生/.test(question)) parts.push("读博");
      if (/大厂/.test(question)) parts.push("去互联网大厂");
      else if (/工作|就业|offer/i.test(question)) parts.push("先去工作");
      if (/回家乡|家乡|回家/.test(question)) parts.push("回家乡");
      if (parts.length > 1) return `${parts.slice(0,-1).join("、")}，还是${parts.at(-1)}`;
    }
    if (type === "migration") return "去新西兰生活、留下，还是回来";
    const clean = String(question).replace(/[\r\n]+/g," ").replace(/[。！？!?]+$/g,"").trim();
    return clean.length > 32 ? `${clean.slice(0,31)}…` : clean;
  }

  function getDataset(type) { return DATA.datasets?.[type] || DATA.datasets?.generic; }
  function escapeHTML(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }
  function scrollBehavior() { return reducedMotion ? "auto" : "smooth"; }

  function navigateWithTransition(url) {
    document.body.classList.add("page-leaving");
    window.setTimeout(() => { window.location.href = url; }, reducedMotion ? 30 : 280);
  }

  function initQuestionPage() {
    const form = document.querySelector("#question-form");
    if (!form) return;
    const textarea = document.querySelector("#life-question");
    const submit = document.querySelector("#question-submit");
    const error = document.querySelector("#question-error");
    try { textarea.value = sessionStorage.getItem(STORAGE_KEYS.question) || ""; } catch (_) { /* ignore */ }
    const validate = () => {
      const valid = textarea.value.trim().length >= 8;
      submit.disabled = !valid;
      error.textContent = textarea.value.length && !valid ? "再多写一点，让我们更准确地理解这件事。" : "";
      return valid;
    };
    textarea.addEventListener("input", validate);
    textarea.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!validate()) { textarea.focus(); return; }
      saveQuestion(textarea.value.trim());
      navigateWithTransition("matching.html");
    });
    validate();
  }

  function renderMatchingAnalysis() {
    const root = document.querySelector("#matching-stages");
    if (!root) return [];
    const question = getStoredQuestion();
    const type = analyzeQuestion(question);
    const dataset = getDataset(type);
    saveQuestion(question);
    const stages = [
      { no:"01", title:"读取问题", body:escapeHTML(question) },
      { no:"02", title:"识别核心变量", values:dataset.variables },
      { no:"03", title:"生成待确认问题", body:escapeHTML(dataset.confirmationQuestions.join(" · ")) },
      { no:"04", title:"匹配公开经历", body:"正在从公开分享里寻找走过相似道路的人……" }
    ];
    root.innerHTML = stages.map(stage => `<li class="journey-analysis-stage"><span class="journey-analysis-label">${stage.no}</span><strong>${stage.title}</strong>${stage.values ? `<p class="journey-analysis-values">${stage.values.map(value => `<span>${escapeHTML(value)}</span>`).join("")}</p>` : `<p>${stage.body}</p>`}</li>`).join("");
    return [...root.children];
  }

  function buildCrowdStream() {
    const root = document.querySelector("#crowd-stream");
    if (!root) return [];
    const avatars = DATA.avatars || [];
    const tracks = reducedMotion ? 2 : 3;
    root.innerHTML = Array.from({length:tracks},(_,row) => `<div class="journey-people-track">${Array.from({length:10},(_,index) => `<img src="${escapeHTML(avatars[(row * 4 + index) % avatars.length])}" alt="" loading="eager">`).join("")}</div>`).join("");
    return [...root.querySelectorAll("img")];
  }

  function initMatchingPage() {
    if (!document.querySelector(".journey-matching")) return;
    const stages = renderMatchingAnalysis();
    const people = buildCrowdStream();
    const result = document.querySelector("#matching-result");
    const schedule = reducedMotion ? [80,180,300,430] : [600,1500,2600,3700];
    stages.forEach((stage,index) => window.setTimeout(() => stage.classList.add("is-visible"), schedule[index]));
    window.setTimeout(() => people.filter((_,index) => index % 9 === 2).forEach(person => person.classList.add("is-matched")), reducedMotion ? 480 : 3900);
    window.setTimeout(() => { result.textContent = "找到 5 条与你的问题相关的人生路径。"; result.classList.add("is-found"); }, reducedMotion ? 650 : 5000);
    window.setTimeout(() => navigateWithTransition("paths.html"), reducedMotion ? 1050 : 6100);
  }

  function renderPaths() {
    const root = document.querySelector("#path-list");
    if (!root) return;
    root.innerHTML = state.dataset.paths.map(path => `<button class="journey-path" type="button" data-path-id="${escapeHTML(path.id)}" aria-current="false">
      <span class="journey-path-number">${path.number}</span>
      <span class="journey-path-copy"><h3>${escapeHTML(path.title)} <span class="journey-viewed" hidden>VIEWED</span></h3><span class="journey-path-count">${path.count} 人走过</span><p>${escapeHTML(path.description)}</p></span>
      <span class="journey-path-people" aria-hidden="true">${path.people.slice(0,3).map(person => `<img src="${escapeHTML(person.avatar)}" alt="">`).join("")}</span>
    </button>`).join("");
    root.addEventListener("click", event => { const button = event.target.closest("[data-path-id]"); if (button) selectPath(button.dataset.pathId, true); });
  }

  function selectPath(pathId, shouldScroll = false) {
    const path = state.dataset.paths.find(item => item.id === pathId) || state.dataset.paths[0];
    state.activePath = path;
    state.viewedPaths.add(path.id);
    document.querySelectorAll("[data-path-id]").forEach(button => {
      const active = button.dataset.pathId === path.id;
      button.setAttribute("aria-current", String(active));
      const viewed = state.viewedPaths.has(button.dataset.pathId);
      const marker = button.querySelector(".journey-viewed");
      if (marker) marker.hidden = !viewed;
    });
    document.querySelector("#people-title").textContent = `${path.title}的人`;
    document.querySelector("#people-description").textContent = path.poolIntro;
    renderPeople();
    if (shouldScroll) document.querySelector("#people-pool").scrollIntoView({ behavior:scrollBehavior(), block:"start" });
  }

  function renderPeople() {
    const root = document.querySelector("#person-list");
    root.innerHTML = state.activePath.people.map((person,index) => `<button class="journey-person-select" type="button" role="option" data-person-id="${escapeHTML(person.id)}" aria-selected="${index === 0}"><img src="${escapeHTML(person.avatar)}" alt="${escapeHTML(person.name)}的人物插画"><span><strong>Hi，我是${escapeHTML(person.name)}</strong><span>${escapeHTML(person.tagline)}</span></span></button>`).join("");
    root.onclick = event => { const button = event.target.closest("[data-person-id]"); if (button) selectPerson(button.dataset.personId, window.innerWidth <= 900); };
    selectPerson(state.activePath.people[0].id, false);
  }

  function selectPerson(personId, shouldScroll = false) {
    const person = state.activePath.people.find(item => item.id === personId) || state.activePath.people[0];
    state.activePerson = person;
    document.querySelectorAll("[data-person-id]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.personId === person.id)));
    const detail = document.querySelector("#person-detail");
    detail.classList.add("is-changing");
    window.setTimeout(() => {
      renderPersonDetail(person);
      detail.classList.remove("is-changing");
      if (shouldScroll) detail.scrollIntoView({ behavior:scrollBehavior(), block:"start" });
    }, reducedMotion ? 0 : 210);
  }

  function getSavedPeople() {
    try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.savedPeople) || "[]"); return Array.isArray(parsed) ? parsed : []; }
    catch (_) { return []; }
  }

  function toggleSavedPerson(personId) {
    const saved = new Set(getSavedPeople());
    saved.has(personId) ? saved.delete(personId) : saved.add(personId);
    try { localStorage.setItem(STORAGE_KEYS.savedPeople, JSON.stringify([...saved])); } catch (_) { /* ignore */ }
    updateSaveButton(personId);
  }

  function updateSaveButton(personId) {
    const button = document.querySelector("#save-person");
    if (!button) return;
    const saved = getSavedPeople().includes(personId);
    button.classList.toggle("is-saved", saved);
    button.setAttribute("aria-pressed", String(saved));
    button.textContent = saved ? "已存入我的样本库 ✓" : "存入我的样本库";
  }

  function renderPersonDetail(person) {
    const detail = document.querySelector("#person-detail");
    const name = person.profileUrl ? `<a href="${escapeHTML(person.profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(person.name)}</a>` : escapeHTML(person.name);
    detail.innerHTML = `<header class="journey-person-identity"><div><p class="eyebrow">A LIFE SAMPLE</p><h3>${name}</h3><p>${escapeHTML(person.tagline)}</p></div><img src="${escapeHTML(person.avatar)}" alt="${escapeHTML(person.name)}的人物插画"></header>
      <section class="journey-detail-section"><h4>TA 是谁</h4><p>${escapeHTML(person.bio)}</p></section>
      <section class="journey-detail-section"><h4>为什么匹配到 TA</h4><ul class="journey-match-reasons">${person.matchReasons.map(reason => `<li>${escapeHTML(reason)}</li>`).join("")}</ul></section>
      <section class="journey-detail-section"><h4>TA 的经历时间线</h4><div class="journey-detail-timeline">${person.timeline.map(event => `<div class="journey-detail-event"><time>${escapeHTML(event.date)}</time><p>${escapeHTML(event.text)}</p></div>`).join("")}</div></section>
      <section class="journey-detail-section"><h4>TA 的经历</h4><ul class="journey-stories">${person.stories.map(story => `<li>${escapeHTML(story)}</li>`).join("")}</ul></section>
      <div class="journey-detail-actions"><button class="button button-dark" id="ask-person" type="button">向 TA 提问</button><button class="button journey-outline-button" id="save-person" type="button" aria-pressed="false">存入我的样本库</button></div>
      <div class="journey-person-composer" id="person-composer" hidden></div>`;
    updateSaveButton(person.id);
    detail.querySelector("#save-person").addEventListener("click", () => toggleSavedPerson(person.id));
    detail.querySelector("#ask-person").addEventListener("click", () => openPersonComposer(person));
  }

  function generatePersonQuestion(person) {
    const type = analyzeQuestion(getStoredQuestion());
    if (type === "migration") return `你好，我也在考虑去新西兰生活。想问问你，${person.tagline}的过程中，哪件事最改变你对“留下”的判断？`;
    if (type === "career") return `你好，我现在也正纠结毕业后读博还是先去工作。想问问你，当时是什么让你最终选择${state.activePath.title}？`;
    return `你好，我也在面对一个迟迟没有答案的问题。想问问你，走上这条路之前，什么最帮助你看清自己愿意承担的代价？`;
  }

  function openPersonComposer(person) {
    const root = document.querySelector("#person-composer");
    root.hidden = false;
    root.innerHTML = `<h4>你想问 TA 什么？</h4><label class="sr-only" for="person-question">写给 ${escapeHTML(person.name)} 的问题</label><textarea id="person-question" rows="5">${escapeHTML(generatePersonQuestion(person))}</textarea><button class="button button-dark" id="record-person-question" type="button">发送问题</button><p class="journey-inline-status" id="person-question-status" aria-live="polite"></p>`;
    root.querySelector("#record-person-question").addEventListener("click", () => {
      const value = root.querySelector("textarea").value.trim();
      const status = root.querySelector("#person-question-status");
      if (!value) { status.textContent = "请先写下你想问的问题。"; return; }
      root.querySelector("textarea").hidden = true;
      root.querySelector("button").hidden = true;
      status.textContent = "问题已经记下。正式版本将通过公开互动或经授权的方式连接经历分享者。";
    });
    root.querySelector("textarea").focus();
  }

  function generateCrowdPost() {
    const question = getStoredQuestion();
    const type = analyzeQuestion(question);
    if (type === "career") return {
      title:"大四毕业，读博、去大厂还是回家乡，你当时是怎么选的？",
      body:"最近一直在纠结毕业后的选择。\n\n我现在主要在考虑三条路：继续读博、去互联网大厂工作，或者回家乡发展。\n\n我真正担心的可能不只是选错一份工作，也包括机会成本、收入、长期职业方向，以及自己到底想在哪里生活。\n\n如果你也经历过类似阶段，很想知道：\n\n你当时有哪些选择？\n最后为什么这样决定？\n走了几年以后，你现在怎么看当时的自己？\n\n想听听真实走过这些路的人。"
    };
    if (type === "migration") return {
      title:"去新西兰生活、留下还是回来，你后来怎样选择？",
      body:`最近一直在想：${question}\n\n我想了解的不是一个标准答案，而是实际走过以后，生活、工作、关系与身份分别发生了什么变化。\n\n如果你也经历过类似阶段，想听听你当时有哪些选择、承担了什么，以及现在怎样理解那次决定。`
    };
    return { title:`${getQuestionSummary(question,type)}，你曾经怎样面对？`, body:`最近一直在想：${question}\n\n我还没有找到确定答案。比起建议，我更想听听真正经历过类似处境的人：你当时看见了哪些选择，最后承担了什么，又怎样理解后来的自己？` };
  }

  function renderCrowdComposer() {
    const root = document.querySelector("#crowd-composer");
    const post = generateCrowdPost();
    root.hidden = false;
    root.innerHTML = `<div id="crowd-form"><label for="crowd-title-input">标题</label><input id="crowd-title-input" type="text" value="${escapeHTML(post.title)}"><label for="crowd-body-input">正文</label><textarea id="crowd-body-input">${escapeHTML(post.body)}</textarea><p class="journey-composer-error" id="crowd-error" aria-live="polite"></p><div class="journey-composer-actions"><button class="button button-dark" id="publish-crowd" type="button">发布</button><a class="button journey-outline-button" href="index.html#top">返回见众</a></div></div>`;
    root.querySelector("#publish-crowd").addEventListener("click", publishCrowdPost);
    root.scrollIntoView({ behavior:scrollBehavior(), block:"start" });
  }

  function publishCrowdPost() {
    const title = document.querySelector("#crowd-title-input").value.trim();
    const body = document.querySelector("#crowd-body-input").value.trim();
    const error = document.querySelector("#crowd-error");
    if (!title || !body) { error.textContent = "标题和正文都需要保留一些内容。"; return; }
    document.querySelector("#crowd-composer").innerHTML = `<div class="journey-publish-complete" aria-live="polite"><p class="eyebrow">READY</p><h3>你的问题已经准备好了。</h3><p>Demo 中暂不连接真实发布接口。</p><div class="journey-composer-actions"><button class="button button-dark" id="copy-crowd" type="button">复制正文</button><a class="button journey-outline-button" href="index.html#top">返回见众</a></div><p class="journey-inline-status" id="copy-status" aria-live="polite"></p><textarea id="copy-fallback" class="sr-only">${escapeHTML(body)}</textarea></div>`;
    document.querySelector("#copy-crowd").addEventListener("click", async () => {
      const status = document.querySelector("#copy-status");
      try { await navigator.clipboard.writeText(body); status.textContent = "正文已复制。"; }
      catch (_) { const fallback = document.querySelector("#copy-fallback"); fallback.classList.remove("sr-only"); fallback.select(); status.textContent = "浏览器未允许自动复制，正文已选中，请手动复制。"; }
    });
  }

  function initPathsPage() {
    if (!document.querySelector(".journey-paths-page")) return;
    const question = getStoredQuestion();
    const type = analyzeQuestion(question);
    saveQuestion(question);
    state.dataset = getDataset(type);
    document.querySelector("#question-summary").textContent = getQuestionSummary(question,type);
    renderPaths();
    selectPath(state.dataset.paths[0].id,false);
    document.querySelector("#open-crowd-composer").addEventListener("click", renderCrowdComposer);

    // Dynamic people content changes the page height after the browser resolves a hash.
    // Re-align once rendering is complete so direct links such as #ask-crowd stay accurate.
    if (window.location.hash) {
      window.requestAnimationFrame(() => {
        let target = null;
        try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); }
        catch (_) { target = null; }
        if (target) target.scrollIntoView({ behavior:"auto", block:"start" });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.journeyPage;
    if (page === "question") initQuestionPage();
    if (page === "matching") initMatchingPage();
    if (page === "paths") initPathsPage();
  });
})();
