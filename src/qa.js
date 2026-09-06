(() => {
  "use strict";

  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || "http://127.0.0.1:3000").replace(/\/$/u, "");
  const pageKind = document.body?.dataset.qaPage || (location.pathname.endsWith("qa-results.html") ? "results" : location.pathname.endsWith("qa-session.html") ? "session" : "start");
  const QA_HANDOFF_KEY = "jianzhong.qa.handoff";
  const QA_RESULT_KEY = "jianzhong.qa.result";
  const LONG_RESPONSE_FALLBACK_MS = 8_000;
  const state = {
    sessionId: null,
    busy: false,
    turn: 0,
    questionsAsked: 0,
    maxQuestions: 4,
    ritualTimers: [],
    sourceCache: new Map(),
    matchedPaths: [],
    activePathIndex: 0,
    activeSourceId: null,
    flowMode: "live",
    problemText: "",
    pendingWaitTimer: null,
  };
  const SAVED_SOURCES_KEY = "jianzhong.savedPeople";
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    startForm: $("#start-form"),
    workspace: $("#qa-workspace"),
    problemInput: $("#problem-input"),
    conversation: $("#conversation"),
    searchRitual: $("#qa-search-ritual"),
    searchEyebrow: $("#qa-search-eyebrow"),
    searchTitle: $("#qa-search-title"),
    analysisStages: $("#qa-analysis-stages"),
    searchResult: $("#qa-search-result"),
    crowdStream: $("#qa-crowd-stream"),
    messages: $("#qa-messages"),
    status: $("#qa-status"),
    error: $("#qa-error"),
    startError: $("#qa-start-error"),
    messageForm: $("#message-form"),
    messageInput: $("#message-input"),
    reset: $("#reset-button"),
    results: $("#qa-results"),
    resultQuestion: $("#qa-result-question"),
    pathList: $("#qa-path-list"),
    peopleTitle: $("#qa-people-title"),
    peopleDescription: $("#qa-people-description"),
    personList: $("#qa-person-list"),
    personDetail: $("#qa-person-detail"),
    continueQuestion: $("#qa-continue-question"),
    answerView: $("#qa-answer-view"),
    answerSummary: $("#qa-answer-summary"),
    answerSections: $("#qa-answer-sections"),
    answerNotes: $("#qa-answer-notes"),
  };

  function getProblemText() {
    return String(state.problemText || refs.problemInput?.value || "").trim();
  }

  function readSessionStorage(key) {
    try {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function writeSessionStorage(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 存储受限时仍保留当前页面流程 */ }
  }

  function navigateWithTransition(pathname, params = {}) {
    const url = new URL(pathname, location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      location.assign(url.href);
      return;
    }
    document.body.classList.add("is-leaving");
    window.setTimeout(() => location.assign(url.href), 300);
  }

  function saveHandoff({ mode, sessionId = null, problem, prompt = "" }) {
    writeSessionStorage(QA_HANDOFF_KEY, { mode, sessionId, problem, prompt, savedAt: Date.now() });
  }

  function makeTurnId() {
    return globalThis.crypto?.randomUUID?.() || `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function explainError(error) {
    const messages = {
      FAILED: "这次请求没有完成，可以稍后重试。",
      INVALID_REQUEST: "输入内容不符合要求，请稍微调整后再试。",
      LOCAL_DATASET_UNAVAILABLE: "本地经验样本暂时不可用，请检查后端配置。",
      RETRIEVAL_FAILED: "经验检索暂时不可用，请稍后重试。",
      LLM_NOT_CONFIGURED: "当前使用离线测试模式，暂时无法调用在线模型。",
      LLM_TIMEOUT: "回答等待超时，请稍后重试。",
      LLM_INVALID_RESPONSE: "在线模型返回格式不符合问答协议，请检查模型配置或运行 live smoke test。",
      LLM_OUTPUT_TRUNCATED: "在线模型输出被截断，请把 DEEPSEEK_MAX_TOKENS 设置为 8000 或更高。",
      LLM_NETWORK_ERROR: "在线模型连接失败，请检查 DeepSeek 地址、密钥和网络。",
      ANSWER_INVALID: "在线模型的回答格式暂时无法解析，请稍后重试。",
      ZHIHU_AUTH_FAILED: "知乎鉴权失败，请检查 ZHIHU_ACCESS_SECRET。",
      ZHIHU_RATE_LIMITED: "知乎请求触发频率限制，请稍后重试。",
      ZHIHU_HTTP_ERROR: "知乎服务暂时不可用，请稍后重试。",
      ZHIHU_INVALID_RESPONSE: "知乎返回格式暂时无法解析，请检查接口配置。",
      BACKEND_UNAVAILABLE: `无法连接后端服务，请先在项目根目录执行 npm start（当前地址：${apiBaseUrl}）。`,
      REQUEST_TIMEOUT: "这次回答等待时间较长，请检查后端日志后再重试。",
    };
    return messages[error?.code] || "页面和后端的连接出现问题，请确认后端已经启动。";
  }

  async function request(pathname, options = {}, { timeoutMs = 15_000 } = {}) {
    let response;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(`${apiBaseUrl}${pathname}`, {
        ...options,
        signal: options.signal || controller.signal,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      });
    } catch (error) {
      const wrapped = new Error("backend unavailable", { cause: error });
      wrapped.code = error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "BACKEND_UNAVAILABLE";
      throw wrapped;
    } finally {
      window.clearTimeout(timeout);
    }
    let payload;
    try { payload = await response.json(); } catch { throw Object.assign(new Error("invalid response"), { code: "FAILED" }); }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error?.message || "request failed");
      error.code = payload.error?.code || "FAILED";
      throw error;
    }
    return payload.data;
  }

  async function ensureBackendReady() {
    const health = await request("/api/health", {}, { timeoutMs: 5_000 });
    if (!health || health.status !== "ok") {
      const error = new Error("backend health check failed");
      error.code = "BACKEND_UNAVAILABLE";
      throw error;
    }
    return health;
  }

  function setStatus(text) { if (refs.status) refs.status.textContent = text || ""; }
  function showError(error) {
    const message = explainError(error);
    if (refs.error) {
      refs.error.textContent = message;
      refs.error.hidden = false;
    }
    if (refs.startError) refs.startError.textContent = state.sessionId ? "" : message;
  }
  function clearError() {
    if (refs.error) {
      refs.error.textContent = "";
      refs.error.hidden = true;
    }
    if (refs.startError) refs.startError.textContent = "";
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function displayAuthor(value) {
    const author = String(value || "").trim();
    return author && !/^(?:知乎(?:公开|未署名)?|匿名)答主$/u.test(author) ? author : "未署名答主";
  }

  function getSavedSources() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_SOURCES_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
    } catch (_) {
      return new Set();
    }
  }

  function toggleSavedSource(sourceId) {
    const saved = getSavedSources();
    if (saved.has(sourceId)) saved.delete(sourceId);
    else saved.add(sourceId);
    try { localStorage.setItem(SAVED_SOURCES_KEY, JSON.stringify([...saved])); } catch (_) { /* 隐私模式下忽略 */ }
    return saved.has(sourceId);
  }

  function makePersonQuestion(source) {
    const author = displayAuthor(source.author);
    const title = source.title || "这条经历";
    return `看完${author}的「${title}」，我也在面对“${getProblemText()}”。如果回到当时，哪一个具体日常或代价最影响你的选择？`;
  }

  const OPEN_PEEPS_IDS = Object.freeze([47, 24, 55, 31, 48, 37, 84, 42, 57, 21, 35, 63]);

  function scrollToMessageForm() {
    if (!refs.messageForm) return;
    const header = document.querySelector("#site-header");
    const headerHeight = header?.getBoundingClientRect().height || 78;
    const top = Math.max(0, refs.messageForm.getBoundingClientRect().top + window.scrollY - headerHeight - 24);
    window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function figureMarkup(index, className = "qa-path-person") {
    const figure = OPEN_PEEPS_IDS[Math.abs(Number(index) || 0) % OPEN_PEEPS_IDS.length];
    return `<img class="${className}" src="assets/people/openpeeps/openpeeps${figure}.svg" width="120" height="160" alt="人生样本插画" loading="lazy" decoding="async">`;
  }

  // 以来源 ID 做稳定映射：同一个知乎来源在路径卡、左侧人物栏和右侧详情中
  // 始终使用同一个 OpenPeeps 形象，避免用户误以为是不同的人。
  function figureIndexForSource(sourceId) {
    const value = String(sourceId || "");
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function figureMarkupForSourceId(sourceId, className) {
    return figureMarkup(figureIndexForSource(sourceId), className);
  }

  const ritualModes = {
    understanding: {
      eyebrow: "LISTENING TO YOUR QUESTION",
      title: "先听清你，再寻找参照。",
      result: "正在把你的话整理成可以继续追问的线索。",
      stages: [
        ["读取问题", "先保留你真正说出来的部分。"],
        ["识别核心变量", "分辨选择、在意的事与还没说出口的担心。"],
        ["生成待确认问题", "准备一个更接近你当前处境的追问。"],
        ["打开一段对话", "先不急着给答案。"],
      ],
    },
    retrieval: {
      eyebrow: "SEARCHING THE HUMAN ARCHIVE",
      title: "正在寻找可能与你有<br>相似经历的知友……",
      result: "正在让你的问题进入一片更大的人生样本。",
      stages: [
        ["读取补充信息", "把你刚刚说的背景放回问题里。"],
        ["识别选择与代价", "看见每条路需要承担的日常。"],
        ["匹配公开经历", "从公开分享里寻找走过相似道路的人。"],
        ["整理不同路径", "只留下可以被回看的经验参照。"],
      ],
    },
  };

  function buildCrowdStream() {
    if (refs.crowdStream.childElementCount) return;
    const tracks = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 2 : 3;
    for (let row = 0; row < tracks; row += 1) {
      const track = document.createElement("div");
      track.className = "journey-people-track qa-people-track";
      for (let index = 0; index < 11; index += 1) {
        track.insertAdjacentHTML("beforeend", figureMarkup(row * 11 + index, "qa-crowd-figure"));
      }
      refs.crowdStream.append(track);
    }
  }

  function stopSearchRitual() {
    state.ritualTimers.forEach((timer) => window.clearTimeout(timer));
    state.ritualTimers = [];
    refs.searchRitual.classList.remove("is-active", "is-understanding", "is-retrieval");
    refs.conversation.classList.remove("is-searching");
    refs.searchRitual.hidden = true;
    refs.searchRitual.setAttribute("aria-hidden", "true");
  }

  function startSearchRitual(mode) {
    stopSearchRitual();
    const ritual = ritualModes[mode] || ritualModes.understanding;
    refs.searchEyebrow.textContent = ritual.eyebrow;
    refs.searchTitle.innerHTML = ritual.title;
    refs.searchResult.textContent = ritual.result;
    refs.searchResult.classList.remove("is-found");
    refs.analysisStages.replaceChildren();
    ritual.stages.forEach(([title, body], index) => {
      const stage = document.createElement("li");
      stage.className = "journey-analysis-stage qa-analysis-stage";
      const label = document.createElement("span");
      label.className = "journey-analysis-label qa-analysis-label";
      label.textContent = `0${index + 1}`;
      const heading = document.createElement("strong");
      heading.textContent = title;
      const description = document.createElement("p");
      description.textContent = body;
      stage.append(label, heading, description);
      refs.analysisStages.append(stage);
    });
    buildCrowdStream();
    refs.crowdStream.querySelectorAll(".is-matched").forEach((person) => person.classList.remove("is-matched"));
    refs.searchRitual.classList.add("is-active", `is-${mode}`);
    refs.conversation.classList.add("is-searching");
    refs.searchRitual.hidden = false;
    refs.searchRitual.setAttribute("aria-hidden", "false");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const schedule = reducedMotion ? [40, 100, 160, 220] : [180, 720, 1500, 2350];
    const stages = [...refs.analysisStages.children];
    stages.forEach((stage, index) => {
      state.ritualTimers.push(window.setTimeout(() => stage.classList.add("is-visible"), schedule[index]));
    });
    state.ritualTimers.push(window.setTimeout(() => {
      refs.searchResult.classList.add("is-found");
      refs.searchResult.textContent = mode === "retrieval" ? "找到一组可以回看的生活参照。" : "你的问题已经有了继续展开的方向。";
      [...refs.crowdStream.querySelectorAll(".qa-crowd-figure")].filter((_, index) => index % 9 === 2).forEach((person) => person.classList.add("is-matched"));
    }, reducedMotion ? 280 : 3000));
    window.requestAnimationFrame(() => refs.searchRitual.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
  }

  function appendMessage(role, text) {
    const article = document.createElement("article");
    article.className = `qa-message ${role}`;
    const label = document.createElement("span");
    label.className = "qa-message-label";
    label.textContent = role === "user" ? "YOU" : "JIANZHONG";
    const content = document.createElement("p");
    content.textContent = text;
    article.append(label, content);
    refs.messages.append(article);
    scrollMessagesToEnd();
    return article;
  }

  function scrollMessagesToEnd() {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.requestAnimationFrame(() => {
      if (!refs.messages) return;
      refs.messages.scrollTo({ top: refs.messages.scrollHeight, behavior });
    });
  }

  function appendAssistantWithActions(text, suggestions = []) {
    const article = appendMessage("assistant", text);
    if (!suggestions.length) return article;
    const actions = document.createElement("div");
    actions.className = "qa-message-actions";
    for (const suggestion of suggestions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qa-suggestion";
      button.textContent = suggestion;
      button.addEventListener("click", () => sendTurn(suggestion));
      actions.append(button);
    }
    article.append(actions);
    scrollMessagesToEnd();
    return article;
  }

  function waitForRitual() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 420 : 3400));
  }

  function armLongResponseFallback(mode) {
    if (state.pendingWaitTimer) window.clearTimeout(state.pendingWaitTimer);
    const limit = LONG_RESPONSE_FALLBACK_MS;
    state.pendingWaitTimer = window.setTimeout(() => {
      state.pendingWaitTimer = null;
      if (!state.busy || refs.conversation?.classList.contains("is-searching")) return;
      startSearchRitual(mode);
      setStatus(mode === "retrieval" ? "这轮回答需要更久，正在寻找相似人生并整理参照…" : "这轮回答需要更久，正在继续整理…");
    }, limit);
    return limit;
  }

  function clearLongResponseFallback() {
    if (!state.pendingWaitTimer) return;
    window.clearTimeout(state.pendingWaitTimer);
    state.pendingWaitTimer = null;
  }

  function renderAnswerView(answer) {
    if (!refs.answerView) return;
    refs.answerSummary.textContent = answer?.summary || "我整理了一组可以回看的经验参照。";
    refs.answerSections.replaceChildren();
    for (const section of answer?.sections || []) {
      const block = document.createElement("div");
      block.className = "qa-answer-block";
      const title = document.createElement("h3");
      title.textContent = section.title || "一组参照";
      const content = document.createElement("p");
      content.textContent = typeof section.content === "string" ? section.content : JSON.stringify(section.content, null, 2);
      block.append(title, content);
      refs.answerSections.append(block);
      const sourceIds = Array.isArray(section.source_ids) ? section.source_ids : [];
      if (sourceIds.length) loadSources(sourceIds, block);
    }
    refs.answerNotes.replaceChildren();
    const noteGroups = [
      ["前提", answer?.assumptions],
      ["仍然未知", answer?.unknowns],
      ["阅读说明", answer?.limitations],
      ["可以继续想想", answer?.next_actions],
    ];
    for (const [title, values] of noteGroups) {
      if (!Array.isArray(values) || !values.length) continue;
      const note = document.createElement("div");
      note.className = "qa-answer-note";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const text = document.createElement("p");
      text.textContent = values.join("\n");
      note.append(heading, text);
      refs.answerNotes.append(note);
    }
    refs.answerView.hidden = false;
  }

  function appendAnswer(answer) {
    if (refs.answerView) {
      renderAnswerView(answer);
      return refs.answerView;
    }
    const article = appendMessage("assistant", answer?.summary || "我整理了一组可以回看的经验参照。");
    return article;
  }

  function openResultsPage(answer) {
    const problem = getProblemText();
    writeSessionStorage(QA_RESULT_KEY, {
      sessionId: state.sessionId,
      mode: state.flowMode || "live",
      problem,
      answer,
      savedAt: Date.now(),
    });
    navigateWithTransition("qa-results.html", { session_id: state.sessionId, mode: state.flowMode || "live" });
  }

  function scrollToLiveSession() {
    if (!refs.conversation) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // 等待 workspace 从文档流移除后再计算位置，避免滚动落在旧布局的位置。
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const header = document.querySelector("#site-header");
      const headerHeight = header?.getBoundingClientRect().height || 78;
      const top = Math.max(0, refs.conversation.getBoundingClientRect().top + window.scrollY - headerHeight - 12);
      window.scrollTo({ top, behavior });
    }));
  }

  function finishStartLayout() {
    refs.workspace?.classList.add("session-started");
    refs.workspace?.setAttribute("aria-hidden", "true");
    refs.conversation?.classList.add("live-session-active");
    scrollToLiveSession();
  }

  async function loadSources(sourceIds, container) {
    const sources = document.createElement("div");
    sources.className = "qa-sources";
    sources.textContent = "来源加载中…";
    container.append(sources);
    const results = await Promise.all(sourceIds.slice(0, 8).map((sourceId) => getSource(sourceId)));
    sources.textContent = "";
    for (const source of results.filter(Boolean)) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${source.title || "查看来源"} ↗`;
      sources.append(link);
    }
    if (!sources.childElementCount) sources.remove();
  }

  function getSource(sourceId) {
    if (!sourceId) return Promise.resolve(null);
    if (!state.sourceCache.has(sourceId)) {
      const pending = request(`/api/sources/${encodeURIComponent(sourceId)}`).catch(() => null);
      state.sourceCache.set(sourceId, pending);
    }
    return state.sourceCache.get(sourceId);
  }

  function answerSectionText(section) {
    if (typeof section?.content === "string") return section.content;
    if (section?.content === undefined || section?.content === null) return "这部分暂时没有可展示的回答内容。";
    try { return JSON.stringify(section.content, null, 2); } catch { return String(section.content); }
  }

  function normalizePathTitle(value, index) {
    const fallback = `一条可以回看的路径 ${index + 1}`;
    let title = String(value || fallback).trim();
    title = title.replace(/优势与劣势/gu, "侧重与代价");
    title = title.replace(/核心优势|个人优势|优势/gu, "可迁移能力");
    title = title.replace(/劣势/gu, "限制");
    title = title.replace(/最优选择|最佳选择|正确答案/gu, "可回看的选择");
    title = title.replace(/成功路径/gu, "走过的路径");
    title = title.replace(/适合人群/gu, "相似处境");
    return title || fallback;
  }

  function buildMatchedPaths(answer) {
    const sections = Array.isArray(answer?.sections) ? answer.sections : [];
    const paths = sections.map((section, index) => ({
      id: `answer-path-${index + 1}`,
      number: String(index + 1).padStart(2, "0"),
      title: normalizePathTitle(section?.title, index),
      description: answerSectionText(section),
      excerpt: answerSectionText(section).length > 190 ? `${answerSectionText(section).slice(0, 190)}…` : answerSectionText(section),
      sourceIds: Array.isArray(section?.source_ids) ? [...new Set(section.source_ids.filter(Boolean))] : [],
      sources: [],
    }));
    return paths.length ? paths : [{
      id: "answer-path-1",
      number: "01",
      title: "先把问题放回真实生活",
      description: answer?.summary || "这次回答暂时没有拆出更多路径，但仍可以从知乎原文中继续回看。",
      excerpt: answer?.summary || "这次回答暂时没有拆出更多路径，但仍可以从知乎原文中继续回看。",
      sourceIds: [],
      sources: [],
    }];
  }

  function renderPathList() {
    refs.pathList.innerHTML = state.matchedPaths.map((path, index) => {
      const people = path.sourceIds.slice(0, 3);
      const active = index === state.activePathIndex;
      return `<button class="journey-path" type="button" data-answer-path-index="${index}" aria-current="${active}">
        <span class="journey-path-number">${escapeHTML(path.number)}</span>
        <span class="journey-path-copy"><h3>${escapeHTML(path.title)} <span class="journey-viewed"${active ? "" : " hidden"}>VIEWED</span></h3><span class="journey-path-count">${path.sourceIds.length} 条知乎来源</span><p>${escapeHTML(path.excerpt)}</p></span>
        <span class="journey-path-people" aria-hidden="true">${people.map((sourceId) => figureMarkupForSourceId(sourceId, "qa-path-person")).join("")}</span>
      </button>`;
    }).join("");
    refs.pathList.onclick = (event) => {
      const button = event.target.closest("[data-answer-path-index]");
      if (button) selectMatchedPath(button.dataset.answerPathIndex, true);
    };
  }

  function selectMatchedPath(index, shouldScroll = false) {
    const safeIndex = Math.min(Math.max(Number(index) || 0, 0), Math.max(state.matchedPaths.length - 1, 0));
    const path = state.matchedPaths[safeIndex];
    if (!path) return;
    state.activePathIndex = safeIndex;
    renderPathList();
    refs.peopleTitle.textContent = `${path.title}的人`;
    refs.peopleDescription.textContent = path.sourceIds.length
      ? `这些知乎回答被放在同一条路径里，先看看不同答主怎样经历它，再回到你自己的问题。`
      : "这条路径暂时没有可回读的知乎来源。";
    renderPeople(path);
    if (shouldScroll) refs.results.querySelector("#qa-people-pool").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPeople(path) {
    if (!path.sources.length) {
      refs.personList.innerHTML = `<p class="qa-results-empty">这条路径暂时没有可展示的来源。</p>`;
      refs.personDetail.innerHTML = `<div class="qa-person-empty"><p class="eyebrow">NO SOURCE YET</p><h3>先回到上面的路径</h3><p>当前回答没有把具体来源绑定到这一节，暂时不补写人物信息。</p></div>`;
      return;
    }
    refs.personList.innerHTML = path.sources.map((source, index) => {
      const author = displayAuthor(source.author);
      const title = source.title || "一条知乎回答";
      const personLabel = source.content_type === "question" ? author : `Hi，我是${author}`;
      return `<button class="journey-person-select" type="button" role="option" data-answer-source-id="${escapeHTML(source.source_id)}" aria-selected="${source.source_id === state.activeSourceId || (!state.activeSourceId && index === 0)}">
        ${figureMarkupForSourceId(source.source_id, "qa-source-person")}
        <span><strong>${escapeHTML(personLabel)}</strong><span>${escapeHTML(title)}</span></span>
      </button>`;
    }).join("");
    refs.personList.onclick = (event) => {
      const button = event.target.closest("[data-answer-source-id]");
      if (button) selectSource(button.dataset.answerSourceId, window.innerWidth <= 900);
    };
    const initial = path.sources.find((source) => source.source_id === state.activeSourceId) || path.sources[0];
    selectSource(initial.source_id, false);
  }

  function selectSource(sourceId, shouldScroll = false) {
    const path = state.matchedPaths[state.activePathIndex];
    const source = path?.sources.find((item) => item.source_id === sourceId) || path?.sources[0];
    if (!source) return;
    state.activeSourceId = source.source_id;
    refs.personList.querySelectorAll("[data-answer-source-id]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.answerSourceId === source.source_id));
    });
    refs.personDetail.classList.add("is-changing");
    window.setTimeout(() => {
      renderSourceDetail(source);
      refs.personDetail.classList.remove("is-changing");
      if (shouldScroll) refs.personDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  }

  function renderSourceDetail(source) {
    const author = displayAuthor(source.author);
    const directAuthorUrl = source.author_url || source.metadata?.author_url || "";
    const authorUrl = directAuthorUrl || source.url;
    const authorLinkLabel = directAuthorUrl ? "查看答主主页 ↗" : "查看公开页面 ↗";
    const sourceUrl = source.url || "https://www.zhihu.com";
    const sourceType = source.content_type === "article" ? "知乎文章" : source.content_type === "question" ? "知乎讨论" : "知乎回答";
    const votes = Number.isFinite(Number(source.metadata?.vote_up_count)) ? ` · ${source.metadata.vote_up_count} 赞同` : "";
    const path = state.matchedPaths[state.activePathIndex];
    const sourceEyebrow = sourceType === "知乎文章" ? "PUBLIC ZHIHU ARTICLE" : sourceType === "知乎讨论" ? "PUBLIC ZHIHU DISCUSSION" : "PUBLIC ZHIHU ANSWER";
    const sourceLinkLabel = sourceType === "知乎文章" ? "在知乎打开原文 ↗" : sourceType === "知乎讨论" ? "在知乎打开讨论 ↗" : "在知乎打开原回答 ↗";
    const responseHeading = sourceType === "知乎讨论" ? "讨论里看到了什么" : "TA 的回答";
    const identity = source.identity || `${author} 的一条公开${sourceType}，被放进「${path?.title || "当前路径"}」作为经历参照。`;
    const reasons = Array.isArray(source.match_reasons) && source.match_reasons.length
      ? source.match_reasons
      : ["这条内容与当前路径的主题直接相关。", "它保留了对选择、日常或代价的公开描述。", "它需要和其他样本一起阅读，不能代表所有人的情况。"];
    const provenanceText = source.provider === "demo"
      ? "这里只保留一段有限摘要；点击入口可回到知乎查看公开页面与完整上下文。"
      : "来源已由后端保存，可通过原文入口回到知乎查看完整内容。";
    refs.personDetail.innerHTML = `<header class="journey-person-identity"><div><p class="eyebrow">${sourceEyebrow}</p><h3><a href="${escapeHTML(authorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(author)}</a></h3><p><a class="qa-source-title-link" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || "打开这条知乎来源")}</a></p><p class="qa-source-meta">${sourceType}${votes}</p></div>${figureMarkupForSourceId(source.source_id, "qa-detail-person")}</header>
      <section class="journey-detail-section"><h4>这是谁的经验</h4><p>${escapeHTML(identity)}</p></section>
      <section class="journey-detail-section"><h4>${responseHeading}</h4><p class="qa-source-answer">${escapeHTML(source.summary || "知乎没有返回可展示的回答摘要。")}</p></section>
      <section class="journey-detail-section"><h4>为什么匹配到这里</h4><ul class="journey-match-reasons">${reasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul></section>
      <section class="journey-detail-section"><h4>这条来源</h4><div class="journey-detail-timeline"><div class="journey-detail-event"><time>知乎 · ${escapeHTML(source.content_type || "answer")}</time><p>${escapeHTML(source.title || "未命名回答")}</p></div><div class="journey-detail-event"><time>有限摘要 · 保留原链</time><p>${escapeHTML(provenanceText)}</p></div></div></section>
      <div class="journey-detail-actions"><a class="button button-dark" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${sourceLinkLabel}</a><a class="button journey-outline-button" href="${escapeHTML(authorUrl)}" target="_blank" rel="noopener noreferrer">${authorLinkLabel}</a><button class="button journey-outline-button" type="button" data-ask-source>带回对话</button><button class="button journey-outline-button" type="button" data-save-source aria-pressed="false">存入我的样本库</button></div><div class="journey-person-composer" data-person-composer hidden></div>`;
    const saveButton = refs.personDetail.querySelector("[data-save-source]");
    const askButton = refs.personDetail.querySelector("[data-ask-source]");
    const composer = refs.personDetail.querySelector("[data-person-composer]");
    const saved = getSavedSources().has(source.source_id);
    saveButton.classList.toggle("is-saved", saved);
    saveButton.setAttribute("aria-pressed", String(saved));
    saveButton.textContent = saved ? "已存入我的样本库 ✓" : "存入我的样本库";
    saveButton.addEventListener("click", () => {
      const isSaved = toggleSavedSource(source.source_id);
      saveButton.classList.toggle("is-saved", isSaved);
      saveButton.setAttribute("aria-pressed", String(isSaved));
      saveButton.textContent = isSaved ? "已存入我的样本库 ✓" : "存入我的样本库";
    });
    askButton.addEventListener("click", () => {
      const question = makePersonQuestion(source);
      composer.hidden = false;
      composer.innerHTML = `<h4>继续追问这一段经历</h4><label class="sr-only" for="source-question">写下你想确认的细节</label><textarea id="source-question" rows="4">${escapeHTML(question)}</textarea><button class="button button-dark" type="button" data-send-source-question>带回当前对话</button><p class="journey-inline-status" data-source-question-status aria-live="polite"></p>`;
      const textarea = composer.querySelector("textarea");
      const sendButton = composer.querySelector("[data-send-source-question]");
      sendButton.addEventListener("click", () => {
        const value = textarea.value.trim();
        if (!value) return;
        if (refs.messageInput) {
          refs.messageInput.value = value;
          composer.querySelector("[data-source-question-status]").textContent = "问题已带回对话输入框，可以继续发送。";
          refs.messageInput.focus();
          scrollToMessageForm();
          return;
        }
        saveHandoff({ mode: state.flowMode || "live", sessionId: state.sessionId, problem: getProblemText(), prompt: value });
        navigateWithTransition("qa-session.html", { session_id: state.sessionId, mode: state.flowMode || "live", resume: "1" });
      });
      textarea.focus();
    });
  }

  async function renderMatchedPaths(answer) {
    state.matchedPaths = buildMatchedPaths(answer);
    state.activePathIndex = 0;
    state.activeSourceId = null;
    refs.resultQuestion.textContent = getProblemText().replace(/[\r\n]+/g, " ").slice(0, 42);
    refs.results.hidden = false;
    refs.results.classList.remove("is-visible");
    renderPathList();
    renderAnswerView(answer);
    refs.peopleTitle.textContent = "这条路上的人";
    refs.peopleDescription.textContent = "正在把本次回答中的知乎来源整理成可以回看的样本。";
    refs.personList.innerHTML = `<p class="qa-results-loading">正在读取知乎来源…</p>`;
    refs.personDetail.innerHTML = `<div class="qa-person-empty"><p class="eyebrow">LOADING SOURCES</p><h3>正在整理人物样本</h3><p>很快就会把答主和原回答放在这里。</p></div>`;
    window.requestAnimationFrame(() => refs.results.classList.add("is-visible"));
    const sourceIds = [...new Set(state.matchedPaths.flatMap((path) => path.sourceIds))];
    const sourceResults = await Promise.all(sourceIds.map((sourceId) => getSource(sourceId)));
    const sourceMap = new Map(sourceResults.filter(Boolean).map((source) => [source.source_id, source]));
    state.matchedPaths.forEach((path) => { path.sources = path.sourceIds.map((sourceId) => sourceMap.get(sourceId)).filter(Boolean); });
    selectMatchedPath(0, false);
    window.requestAnimationFrame(() => refs.results.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function renderTurn(result) {
    setStatus(result.state ? `当前状态：${result.state}` : "");
    if (result.action === "ask") {
      state.questionsAsked += 1;
      const question = result.decision?.question;
      appendAssistantWithActions(question?.text || result.decision?.reason || "你愿意再补充一点背景吗？", question?.suggestions || []);
      return;
    }
    if (result.action === "confirm_topic") {
      const article = appendAssistantWithActions(result.decision?.reason || "这似乎是一个新的话题。要开启独立的参照吗？", ["确认，开启独立话题", "继续当前问题"]);
      article.classList.add("qa-confirmation");
      return;
    }
    if (result.action === "safety") {
      appendMessage("assistant", result.safety?.user_message || result.decision?.reason || "我先陪你处理眼前最重要的事情。");
      return;
    }
    if (result.action === "respond") {
      // 只有所有追问结束、后端已经拿到最终回答后，才展示“寻找相似人生”过渡。
      // 这样普通追问不会反复进入加载页，同时在线检索和回答也有完整的视觉收束。
      startSearchRitual("retrieval");
      setStatus("正在寻找相似人生并整理参照…");
      await waitForRitual();
      openResultsPage(result.answer);
      return;
    }
    appendMessage("assistant", result.reason || "我还需要一点信息，才能继续。");
  }

  async function sendTurn(text, { initial = false } = {}) {
    const message = String(text || "").trim();
    if (!message || !state.sessionId || state.busy) return;
    clearError();
    appendMessage("user", message);
    refs.messageInput.value = "";
    state.busy = true;
    state.turn += 1;
    refs.messageForm.querySelector("button").disabled = true;
    const directAnswerRequest = /(?:直接回答|马上回答|立即回答|不用问|跳过|先回答)/u.test(message);
    const showRetrievalRitual = directAnswerRequest || (!initial && state.questionsAsked >= state.maxQuestions);
    const delayedRitualMode = showRetrievalRitual || (!initial && state.questionsAsked >= Math.max(1, state.maxQuestions - 1)) ? "retrieval" : "understanding";
    if (showRetrievalRitual) {
      startSearchRitual("retrieval");
      setStatus("正在寻找相似人生并整理参照…");
    } else {
      setStatus(initial ? "正在听见你的问题…" : "正在记录这条补充…");
    }
    armLongResponseFallback(delayedRitualMode);
    try {
      const result = await request(`/api/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ message, client_turn_id: makeTurnId() }),
      }, { timeoutMs: 190_000 });
      await renderTurn(result);
    } catch (error) {
      showError(error);
      setStatus("本轮没有完成，可以修改内容后再次发送。");
    } finally {
      clearLongResponseFallback();
      stopSearchRitual();
      state.busy = false;
      refs.messageForm.querySelector("button").disabled = false;
      refs.messageInput.focus();
    }
  }

  async function startSession(event) {
    event.preventDefault();
    const problem = refs.problemInput.value.trim();
    if (problem.length < 8) {
      const error = new Error("demo question too short");
      error.code = "INVALID_REQUEST";
      showError(error);
      return;
    }
    clearError();
    const button = refs.startForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.querySelector("span").textContent = "正在进入…";
    try {
      state.flowMode = "live";
      await ensureBackendReady();
      const session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ problem_statement: "" }) });
      state.sessionId = session.session_id;
      state.problemText = problem;
      state.maxQuestions = Number(session.max_questions) || 4;
      state.questionsAsked = 0;
      saveHandoff({ mode: "live", sessionId: session.session_id, problem });
      navigateWithTransition("qa-session.html", { mode: "live", session_id: session.session_id });
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "开始寻找";
    }
  }

  function resetSession() {
    if (!refs.startForm) {
      navigateWithTransition("qa.html");
      return;
    }
    stopSearchRitual();
    clearLongResponseFallback();
    state.sessionId = null;
    state.busy = false;
    state.turn = 0;
    state.questionsAsked = 0;
    state.maxQuestions = 4;
    state.flowMode = "live";
    refs.messages.replaceChildren();
    refs.messageInput.value = "";
    refs.messageInput.disabled = false;
    refs.messageInput.placeholder = "补充你的情况，或回答我们的问题。";
    refs.messageForm.querySelector("button").disabled = false;
    refs.startForm.hidden = false;
    refs.workspace.hidden = false;
    refs.workspace.classList.remove("is-exiting", "session-started");
    refs.workspace.removeAttribute("aria-hidden");
    refs.conversation.hidden = true;
    refs.conversation.classList.remove("live-session-active");
    refs.results.hidden = true;
    refs.results.classList.remove("is-visible");
    refs.pathList.replaceChildren();
    refs.personList.replaceChildren();
    refs.personDetail.replaceChildren();
    state.matchedPaths = [];
    state.activePathIndex = 0;
    state.activeSourceId = null;
    clearError();
    setStatus("");
    refs.problemInput.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function continueQuestion() {
    if (!refs.messageInput) {
      saveHandoff({ mode: state.flowMode || "live", sessionId: state.sessionId, problem: getProblemText() });
      navigateWithTransition("qa-session.html", { session_id: state.sessionId, mode: state.flowMode || "live", resume: "1" });
      return;
    }
    refs.messageInput.focus();
    scrollToMessageForm();
  }

  function renderSessionHistory(session, handoff) {
    refs.messages.replaceChildren();
    for (const message of session.raw_messages || []) {
      appendMessage(message.role === "assistant" ? "assistant" : "user", message.text);
    }
    if (session.pending_question?.text) {
      appendAssistantWithActions(session.pending_question.text, session.pending_question.suggestions || []);
    }
    if (handoff?.prompt && refs.messageInput) {
      refs.messageInput.value = handoff.prompt;
      refs.messageInput.focus();
    }
  }

  async function initSessionPage() {
    if (!refs.conversation || !refs.messageForm) return;
    const params = new URLSearchParams(location.search);
    const handoff = readSessionStorage(QA_HANDOFF_KEY) || {};
    const requestedSessionId = params.get("session_id") || handoff.sessionId || null;
    const sessionId = requestedSessionId === "local-demo" ? null : requestedSessionId;
    const resume = params.get("resume") === "1";
    const problem = String(handoff.problem || params.get("problem") || "").trim();
    state.flowMode = "live";
    state.sessionId = sessionId;
    state.problemText = problem;
    refs.conversation.hidden = false;
    refs.conversation.classList.add("live-session-active");

    if (!sessionId || !problem) {
      showError(Object.assign(new Error("missing session handoff"), { code: "INVALID_REQUEST" }));
      return;
    }
    try {
      await ensureBackendReady();
      const session = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
      state.maxQuestions = Number(session.max_questions) || 4;
      state.questionsAsked = Number(session.question_count) || 0;
      state.problemText = session.current_understanding?.problem_statement || problem;
      if (resume || session.raw_messages?.length) {
        renderSessionHistory(session, handoff);
        setStatus(session.status ? `当前状态：${session.status}` : "");
      } else {
        await sendTurn(state.problemText, { initial: true });
      }
      scrollToLiveSession();
    } catch (error) {
      showError(error);
      setStatus("本轮没有完成，可以修改内容后再次发送。");
    }
  }

  async function initResultsPage() {
    if (!refs.results) return;
    const params = new URLSearchParams(location.search);
    const stored = readSessionStorage(QA_RESULT_KEY) || {};
    const requestedSessionId = params.get("session_id") || stored.sessionId || null;
    const sessionId = requestedSessionId === "local-demo" ? null : requestedSessionId;
    const storedMatchesSession = !sessionId || !stored.sessionId || String(stored.sessionId) === String(sessionId);
    const isLegacyCuratedResult = params.get("mode") === "curated" || stored.mode === "curated" || requestedSessionId === "local-demo";
    const storedResult = storedMatchesSession && !isLegacyCuratedResult ? stored : {};
    state.sessionId = sessionId;
    state.flowMode = "live";
    state.problemText = storedResult.problem || "";
    let answer = storedResult.answer || null;
    if (!answer && sessionId) {
      try {
        await ensureBackendReady();
        const session = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
        answer = session.current_answer;
        state.problemText = session.current_understanding?.problem_statement || state.problemText;
      } catch (error) {
        showError(error);
      }
    }
    if (!answer) {
      navigateWithTransition("qa.html");
      return;
    }
    await renderMatchedPaths(answer);
  }

  function initNavigation() {
    const header = $("#site-header");
    if (!header) return;
    const menuButton = header.querySelector(".menu-toggle");
    const menu = header.querySelector(".nav-links");
    if (!menuButton || !menu) return;
    const close = () => { menu.classList.remove("open"); menuButton.classList.remove("open"); menuButton.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; };
    menuButton.addEventListener("click", () => { const open = !menu.classList.contains("open"); menu.classList.toggle("open", open); menuButton.classList.toggle("open", open); menuButton.setAttribute("aria-expanded", String(open)); document.body.style.overflow = open ? "hidden" : ""; });
    menu.addEventListener("click", (event) => { if (event.target.matches("a")) close(); });
  }

  function initTopLinks() {
    document.querySelectorAll("a[href^='#'], [data-scroll-top]").forEach((link) => link.addEventListener("click", (event) => {
      if (link.dataset.scrollTop !== undefined || link.hash === "#main") {
        event.preventDefault();
        window.scrollTo(0, 0);
      }
    }));
  }

  refs.startForm?.addEventListener("submit", startSession);
  refs.messageForm?.addEventListener("submit", (event) => { event.preventDefault(); void sendTurn(refs.messageInput.value); });
  refs.reset?.addEventListener("click", resetSession);
  refs.continueQuestion?.addEventListener("click", continueQuestion);
  initNavigation();
  initTopLinks();
  if (pageKind === "session") void initSessionPage();
  if (pageKind === "results") void initResultsPage();
})();
