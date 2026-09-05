(() => {
  "use strict";

  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || "http://127.0.0.1:3000").replace(/\/$/u, "");
  const routeOverride = new URLSearchParams(window.location.search).get("mode");
  const CURATED_TOPIC_PATTERN = /(?:毕业|就业|校招|应届|求职|找工作|工作机会|先工作|读博|博士|大厂|回家乡|返乡)/iu;
  const STUDY_WORK_PATTERN = /(?:(?:考研|读研).{0,12}(?:工作|就业)|(?:工作|就业).{0,12}(?:考研|读研))/iu;
  const curatedData = window.JIANZHONG_CURATED_DATA || { sources: {}, answer: null };
  const DEMO_SOURCES = curatedData.sources;
  const DEMO_ANSWER = curatedData.answer;
  const FAVORITES_KEY = "jianzhong:favorite-sources:v1";
  const OPEN_PEEPS_IDS = Object.freeze([47, 24, 55, 31, 48, 37, 84, 42, 57, 21, 35, 63]);

  function shouldUseCuratedFlow(value) {
    if (routeOverride === "live") return false;
    if (routeOverride === "curated") return true;
    const problem = String(value || "").replace(/\s+/gu, " ").trim();
    return CURATED_TOPIC_PATTERN.test(problem) || STUDY_WORK_PATTERN.test(problem);
  }
  const state = {
    sessionId: null,
    busy: false,
    turn: 0,
    ritualTimers: [],
    sourceCache: new Map(),
    matchedPaths: [],
    activePathIndex: 0,
    activeSourceId: null,
    demoStep: 0,
    flowMode: null,
    view: "question",
  };
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    startForm: $("#start-form"),
    questionPage: $("#qa-question-page"),
    workspace: $("#qa-workspace"),
    problemInput: $("#problem-input"),
    modeBadge: $("#qa-mode-badge"),
    pageProgress: $("#qa-page-progress"),
    headerReset: $("#qa-header-reset"),
    conversation: $("#conversation"),
    dialogue: $("#qa-dialogue"),
    searchRitual: $("#qa-search-ritual"),
    searchEyebrow: $("#qa-search-eyebrow"),
    searchTitle: $("#qa-search-title"),
    analysisStages: $("#qa-analysis-stages"),
    searchResult: $("#qa-search-result"),
    crowdStream: $("#qa-crowd-stream"),
    messages: $("#qa-messages"),
    status: $("#qa-status"),
    startError: $("#qa-start-error"),
    error: $("#qa-error"),
    messageForm: $("#message-form"),
    messageInput: $("#message-input"),
    reset: $("#reset-button"),
    results: $("#qa-results"),
    resultQuestion: $("#qa-result-question"),
    resultSummary: $("#qa-result-summary"),
    pathList: $("#qa-path-list"),
    peopleTitle: $("#qa-people-title"),
    peopleDescription: $("#qa-people-description"),
    personList: $("#qa-person-list"),
    personDetail: $("#qa-person-detail"),
    answerContext: $("#qa-answer-context"),
    contextGrid: $("#qa-context-grid"),
  };

  function setQaView(view, { scroll = true } = {}) {
    const allowedViews = new Set(["question", "processing", "dialogue", "results"]);
    const nextView = allowedViews.has(view) ? view : "question";
    state.view = nextView;
    document.body.dataset.qaView = nextView;
    refs.questionPage.hidden = nextView !== "question";
    refs.conversation.hidden = nextView !== "processing" && nextView !== "dialogue";
    refs.dialogue.hidden = nextView !== "dialogue";
    if (nextView !== "processing") {
      refs.searchRitual.hidden = true;
      refs.searchRitual.setAttribute("aria-hidden", "true");
    }
    refs.results.hidden = nextView !== "results";
    refs.pageProgress.textContent = nextView === "question" ? "01 / 03" : nextView === "results" ? "03 / 03" : "02 / 03";
    if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
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
      CURATED_DATA_UNAVAILABLE: "精选演示数据没有正确加载，请刷新页面后重试。",
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

  function setStatus(text) { refs.status.textContent = text || ""; }
  function showError(error) {
    const target = refs.conversation.hidden ? refs.startError : refs.error;
    target.textContent = explainError(error);
    target.hidden = false;
  }
  function clearError() {
    for (const target of [refs.startError, refs.error]) {
      target.textContent = "";
      target.hidden = true;
    }
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

  function setFlowMode(mode) {
    state.flowMode = mode;
    refs.modeBadge.hidden = false;
    refs.modeBadge.dataset.mode = mode;
    refs.modeBadge.textContent = mode === "curated"
      ? "精选演示内容 · 使用固定公开样本，不调用后端"
      : "实时链路 · 回答与来源由当前后端生成";
  }

  function resetFlowModeLabel() {
    state.flowMode = null;
    refs.modeBadge.hidden = true;
    refs.modeBadge.removeAttribute("data-mode");
    refs.modeBadge.textContent = "";
    if (routeOverride === "curated" || routeOverride === "live") setFlowMode(routeOverride);
  }

  function readFavorites() {
    try {
      const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function isFavorite(sourceId) {
    return Boolean(readFavorites()[sourceId]);
  }

  function toggleFavorite(source) {
    const favorites = readFavorites();
    if (favorites[source.source_id]) {
      delete favorites[source.source_id];
    } else {
      favorites[source.source_id] = {
        source_id: source.source_id,
        title: source.title || "未命名来源",
        author: source.author || "知乎未署名答主",
        url: source.url,
        saved_at: new Date().toISOString(),
      };
    }
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      return false;
    }
    return Boolean(favorites[source.source_id]);
  }

  function figureMarkup(index, className = "qa-path-person") {
    const figure = OPEN_PEEPS_IDS[Math.abs(Number(index) || 0) % OPEN_PEEPS_IDS.length];
    return `<img class="${className}" src="assets/people/openpeeps/openpeeps${figure}.svg" width="120" height="160" alt="人生样本插画" decoding="async">`;
  }

  const ritualModes = {
    understanding: {
      eyebrow: "SEARCHING THE HUMAN ARCHIVE",
      title: "正在寻找可能与你有<br>相似经历的知友……",
      result: "正在让你的问题进入一片更大的人生样本。",
      stages: [
        ["读取问题", "先保留你真正说出来的部分，不替你补写前提。"],
        ["识别核心变量", "辨认真正困扰、时间边界、现实条件、关系影响与可逆程度。"],
        ["生成待确认问题", "找到最值得先向你确认的一处空白。"],
        ["准备匹配经历", "让下一次检索更接近你真实面对的选择。"],
      ],
    },
    retrieval: {
      eyebrow: "SEARCHING THE HUMAN ARCHIVE",
      title: "正在寻找可能与你有<br>相似经历的知友……",
      result: "正在让你的问题进入一片更大的人生样本。",
      stages: [
        ["读取补充信息", "把你刚刚说的背景放回问题里。"],
        ["识别选择与代价", "比较时间边界、现实条件、关系影响与愿意承担的代价。"],
        ["匹配公开经历", "从公开分享里寻找真正走过相似道路的人。"],
        ["整理不同路径", "保留来源和阅读边界，只留下可以回看的经验参照。"],
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
    refs.conversation.setAttribute("aria-busy", "false");
  }

  function startSearchRitual(mode) {
    stopSearchRitual();
    setQaView("processing");
    const ritual = ritualModes[mode] || ritualModes.understanding;
    refs.searchEyebrow.textContent = ritual.eyebrow;
    refs.searchTitle.innerHTML = ritual.title;
    refs.searchResult.textContent = ritual.result;
    refs.searchResult.classList.remove("is-found");
    refs.analysisStages.replaceChildren();
    ritual.stages.forEach(([title, body], index) => {
      const stage = document.createElement("li");
      stage.className = "qa-analysis-stage";
      const label = document.createElement("span");
      label.className = "qa-analysis-label";
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
    refs.conversation.setAttribute("aria-busy", "true");
    refs.searchRitual.hidden = false;
    refs.searchRitual.setAttribute("aria-hidden", "false");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const schedule = reducedMotion ? [40, 100, 160, 220] : [180, 720, 1500, 2350];
    const stages = [...refs.analysisStages.children];
    stages.forEach((stage, index) => {
      state.ritualTimers.push(window.setTimeout(() => stage.classList.add("is-visible"), schedule[index]));
    });
    window.requestAnimationFrame(() => {
      if (mode === "retrieval") refs.searchRitual.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    });
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
    article.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return article;
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
    return article;
  }

  function waitForDemoRitual() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 420 : 3400));
  }

  function setDemoBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle("is-demo-busy", busy);
    refs.messageInput.disabled = busy;
    refs.messageForm.querySelector("button").disabled = busy;
  }

  async function runDemoInitial(problem) {
    if (!DEMO_ANSWER || !Object.keys(DEMO_SOURCES).length) {
      const error = new Error("curated data unavailable");
      error.code = "CURATED_DATA_UNAVAILABLE";
      throw error;
    }
    state.sessionId = "local-demo";
    state.demoStep = 0;
    appendMessage("user", problem);
    setDemoBusy(true);
    startSearchRitual("understanding");
    setStatus("正在听见你的问题…");
    await waitForDemoRitual();
    stopSearchRitual();
    appendAssistantWithActions(
      "如果只能先确认一件事：你此刻更想看清哪一种代价？这会改变我们优先回看的经历。",
      ["更担心错过工作机会", "更担心放弃研究兴趣", "更在意离家与生活成本"],
    );
    state.demoStep = 1;
    setStatus("任选一项，或直接输入一句话。");
    setDemoBusy(false);
    setQaView("dialogue");
    refs.messageInput.focus({ preventScroll: true });
  }

  async function runDemoTurn(message) {
    if (!message || state.busy || state.demoStep !== 1) return;
    clearError();
    appendMessage("user", message);
    refs.messageInput.value = "";
    setDemoBusy(true);
    startSearchRitual("retrieval");
    setStatus("正在整理与你的问题有关的人生路径…");
    await waitForDemoRitual();
    stopSearchRitual();
    appendAnswer(DEMO_ANSWER);
    await renderMatchedPaths(DEMO_ANSWER);
    state.demoStep = 2;
    setStatus("参照已整理完成，你可以展开路径并回看公开来源。");
    setDemoBusy(false);
    refs.messageInput.disabled = true;
    refs.messageInput.placeholder = "这次参照已整理完成，可点击“重新开始”再次梳理。";
    refs.messageForm.querySelector("button").disabled = true;
  }

  function appendAnswer(answer) {
    const article = appendMessage("assistant", answer?.summary || "我整理了一组可以回看的经验参照。");
    const body = document.createElement("div");
    body.className = "qa-answer-body";
    for (const section of answer?.sections || []) {
      const block = document.createElement("div");
      block.className = "qa-answer-block";
      const title = document.createElement("h3");
      title.textContent = section.title || "一组参照";
      const content = document.createElement("p");
      content.textContent = typeof section.content === "string" ? section.content : JSON.stringify(section.content, null, 2);
      block.append(title, content);
      body.append(block);
      const sourceIds = Array.isArray(section.source_ids) ? section.source_ids : [];
      if (sourceIds.length) loadSources(sourceIds, block);
    }
    const answerNotes = [
      ["assumptions", "当前假设"],
      ["unknowns", "尚未确认"],
      ["limitations", "阅读边界"],
      ["next_actions", "可以立刻做"],
    ];
    for (const [field, label] of answerNotes) {
      const items = Array.isArray(answer?.[field]) ? answer[field].filter(Boolean) : [];
      if (!items.length) continue;
      const note = document.createElement("section");
      note.className = `qa-answer-note qa-answer-note-${field.replace("_", "-")}`;
      const heading = document.createElement("strong");
      heading.textContent = label;
      const list = document.createElement("ul");
      for (const item of items) {
        const row = document.createElement("li");
        row.textContent = typeof item === "string" ? item : JSON.stringify(item);
        list.append(row);
      }
      note.append(heading, list);
      body.append(note);
    }
    article.append(body);
    return article;
  }

  async function loadSources(sourceIds, container) {
    const sources = document.createElement("div");
    sources.className = "qa-sources";
    sources.textContent = "来源加载中…";
    container.append(sources);
    const requestedIds = sourceIds.slice(0, 8);
    const results = await Promise.all(requestedIds.map(async (sourceId) => ({ sourceId, source: await getSource(sourceId) })));
    sources.textContent = "";
    for (const { sourceId, source } of results) {
      if (!source) {
        const unavailable = document.createElement("span");
        unavailable.className = "qa-source-unavailable";
        unavailable.textContent = `来源暂时无法读取（${sourceId}）`;
        sources.append(unavailable);
        continue;
      }
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
    if (DEMO_SOURCES[sourceId]) return Promise.resolve(DEMO_SOURCES[sourceId]);
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

  function renderAnswerContext(answer) {
    const groups = [
      ["assumptions", "当前假设", "这些判断依赖什么"],
      ["unknowns", "尚未确认", "哪些信息仍然缺失"],
      ["limitations", "阅读边界", "这份结果不能替你证明什么"],
      ["next_actions", "下一步", "可以怎样继续验证"],
    ];
    refs.contextGrid.replaceChildren();
    for (const [field, title, description] of groups) {
      const items = Array.isArray(answer?.[field]) ? answer[field].filter(Boolean) : [];
      if (!items.length) continue;
      const section = document.createElement("section");
      section.className = "qa-context-card";
      const eyebrow = document.createElement("p");
      eyebrow.className = "qa-context-description";
      eyebrow.textContent = description;
      const heading = document.createElement("h3");
      heading.textContent = title;
      const list = document.createElement("ul");
      for (const item of items) {
        const row = document.createElement("li");
        row.textContent = typeof item === "string" ? item : JSON.stringify(item);
        list.append(row);
      }
      section.append(eyebrow, heading, list);
      refs.contextGrid.append(section);
    }
    refs.answerContext.hidden = refs.contextGrid.childElementCount === 0;
  }

  function renderPathList() {
    refs.pathList.innerHTML = state.matchedPaths.map((path, index) => {
      const people = path.sources.length ? path.sources.slice(0, 3) : [null, null, null];
      const active = index === state.activePathIndex;
      return `<button class="journey-path" type="button" data-answer-path-index="${index}" aria-current="${active}">
        <span class="journey-path-number">${escapeHTML(path.number)}</span>
        <span class="journey-path-copy"><h3>${escapeHTML(path.title)} <span class="journey-viewed"${active ? "" : " hidden"}>VIEWED</span></h3><span class="journey-path-count">${path.sourceIds.length} 条可回看来源</span><p>${escapeHTML(path.excerpt)}</p></span>
        <span class="journey-path-people" aria-hidden="true">${people.map((_, personIndex) => figureMarkup(index * 3 + personIndex, "qa-path-person")).join("")}</span>
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
    const unavailableCount = path.sources.filter((source) => source.unavailable).length;
    refs.peopleDescription.textContent = path.sourceIds.length
      ? unavailableCount
        ? `这条路径关联 ${path.sourceIds.length} 条来源，其中 ${unavailableCount} 条本次暂时无法读取；来源编号仍被保留。`
        : "这些公开来源被放在同一条路径里。先看不同的人怎样经历它，再回到你自己的问题。"
      : "这条路径暂时没有绑定可回读的公开来源。";
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
      const author = source.unavailable ? "来源暂时无法读取" : source.author?.trim() || "未署名作者";
      const title = source.unavailable ? source.source_id : source.title || "一条公开来源";
      const personLabel = source.content_type === "question" ? author : `Hi，我是${author}`;
      return `<button class="journey-person-select${source.unavailable ? " is-unavailable" : ""}" type="button" role="option" data-answer-source-id="${escapeHTML(source.source_id)}" aria-selected="${source.source_id === state.activeSourceId || (!state.activeSourceId && index === 0)}">
        ${figureMarkup(index, "qa-source-person")}
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
    if (source.unavailable) {
      refs.personDetail.innerHTML = `<div class="qa-person-empty"><p class="eyebrow">SOURCE UNAVAILABLE</p><h3>来源暂时无法读取</h3><p>回答仍然保留了来源编号 ${escapeHTML(source.source_id)}，但本次没有取回来源详情。刷新或重新请求后可以再次尝试，不会用虚构人物补位。</p></div>`;
      return;
    }
    const author = source.author?.trim() || "未署名作者";
    const directAuthorUrl = source.author_url || source.metadata?.author_url || "";
    const authorUrl = directAuthorUrl || source.url;
    const authorLinkLabel = directAuthorUrl ? "查看答主主页 ↗" : "查看公开页面 ↗";
    const sourceUrl = source.url;
    const contentLabel = source.content_type === "article" ? "文章" : source.content_type === "question" ? "讨论" : "回答";
    const providerLabel = source.provider === "local" ? "本地案例库（降级）" : source.provider === "demo" ? "精选演示" : source.provider === "mock" ? "Mock 测试样本" : source.provider === "zhihu" ? "知乎" : "公开来源";
    const sourceType = `${providerLabel}${contentLabel}`;
    const votes = Number.isFinite(Number(source.metadata?.vote_up_count)) ? ` · ${source.metadata.vote_up_count} 赞同` : "";
    const path = state.matchedPaths[state.activePathIndex];
    const sourceEyebrow = source.provider === "local" ? "LOCAL FALLBACK SAMPLE" : source.provider === "demo" ? "CURATED DEMO SAMPLE" : source.provider === "mock" ? "MOCK TEST SAMPLE" : "PUBLIC SOURCE";
    const sourceLinkLabel = source.content_type === "question" ? "打开原讨论 ↗" : "打开原文 ↗";
    const responseHeading = source.content_type === "question" ? "讨论里看到了什么" : "来源中说了什么";
    const identity = source.identity || `${author} 的一条${sourceType}，被放进「${path?.title || "当前路径"}」作为经历参照。`;
    const reasons = Array.isArray(source.match_reasons) && source.match_reasons.length
      ? source.match_reasons
      : ["这条内容与当前路径的主题直接相关。", "它保留了对选择、日常或代价的公开描述。", "它需要和其他样本一起阅读，不能代表所有人的情况。"];
    const provenanceText = source.provider === "demo"
      ? "这是固定的精选演示样本，不代表本次调用了知乎或 DeepSeek；可通过原文入口核对公开页面。"
      : source.provider === "local"
        ? "实时检索不可用时由后端返回的本地案例，页面保留降级标识，不将它包装成实时知乎结果。"
        : source.provider === "mock"
          ? "这是后端 Mock provider 返回的测试样本，用于验证完整交互，不代表本次调用了知乎。"
          : "来源由后端保存，可通过原文入口查看完整上下文。";
    const saved = isFavorite(source.source_id);
    refs.personDetail.innerHTML = `<header class="journey-person-identity"><div><p class="eyebrow">${sourceEyebrow}</p><h3><a href="${escapeHTML(authorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(author)}</a></h3><p><a class="qa-source-title-link" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || "打开这条知乎来源")}</a></p><p class="qa-source-meta">${sourceType}${votes}</p></div>${figureMarkup(source.source_id.length, "qa-detail-person")}</header>
      <section class="journey-detail-section"><h4>这是谁的经验</h4><p>${escapeHTML(identity)}</p></section>
      <section class="journey-detail-section"><h4>${responseHeading}</h4><p class="qa-source-answer">${escapeHTML(source.summary || "知乎没有返回可展示的回答摘要。")}</p></section>
      <section class="journey-detail-section"><h4>为什么匹配到这里</h4><ul class="journey-match-reasons">${reasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul></section>
      <section class="journey-detail-section"><h4>这条来源</h4><div class="journey-detail-timeline"><div class="journey-detail-event"><time>${escapeHTML(providerLabel)} · ${escapeHTML(source.content_type || "answer")}</time><p>${escapeHTML(source.title || "未命名来源")}</p></div><div class="journey-detail-event"><time>有限摘要 · 保留原链</time><p>${escapeHTML(provenanceText)}</p></div></div></section>
      <div class="journey-detail-actions"><a class="button button-dark" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${sourceLinkLabel}</a><a class="button journey-outline-button" href="${escapeHTML(authorUrl)}" target="_blank" rel="noopener noreferrer">${authorLinkLabel}</a><button class="button journey-outline-button${saved ? " is-saved" : ""}" id="qa-favorite-source" type="button">${saved ? "已收藏（本机）" : "收藏这条来源"}</button></div>
      <p class="qa-favorite-note">收藏仅保存在当前浏览器，不会发送给知乎或后端。</p>`;
    refs.personDetail.querySelector("#qa-favorite-source")?.addEventListener("click", (event) => {
      const nowSaved = toggleFavorite(source);
      event.currentTarget.classList.toggle("is-saved", nowSaved);
      event.currentTarget.textContent = nowSaved ? "已收藏（本机）" : "收藏这条来源";
    });
  }

  async function renderMatchedPaths(answer) {
    state.matchedPaths = buildMatchedPaths(answer);
    state.activePathIndex = 0;
    state.activeSourceId = null;
    const resultQuestion = refs.problemInput.value.trim().replace(/[\r\n]+/g, " ");
    refs.resultQuestion.textContent = resultQuestion.length > 28 ? `${resultQuestion.slice(0, 28)}…` : resultQuestion;
    refs.resultSummary.textContent = answer?.summary || "这里没有一条被计算出的正确道路。先看看不同的人怎样选择、承担，再回到自己的处境。";
    renderAnswerContext(answer);
    setQaView("results");
    refs.results.classList.remove("is-visible");
    renderPathList();
    refs.peopleTitle.textContent = "这条路上的人";
    refs.peopleDescription.textContent = "正在把本次回答中的知乎来源整理成可以回看的样本。";
    refs.personList.innerHTML = `<p class="qa-results-loading">正在读取知乎来源…</p>`;
    refs.personDetail.innerHTML = `<div class="qa-person-empty"><p class="eyebrow">LOADING SOURCES</p><h3>正在整理人物样本</h3><p>很快就会把答主和原回答放在这里。</p></div>`;
    window.requestAnimationFrame(() => refs.results.classList.add("is-visible"));
    const sourceIds = [...new Set(state.matchedPaths.flatMap((path) => path.sourceIds))];
    const sourceResults = await Promise.all(sourceIds.map((sourceId) => getSource(sourceId)));
    const sourceMap = new Map(sourceResults.filter(Boolean).map((source) => [source.source_id, source]));
    state.matchedPaths.forEach((path) => {
      path.sources = path.sourceIds.map((sourceId) => sourceMap.get(sourceId) || { source_id: sourceId, unavailable: true });
    });
    selectMatchedPath(0, false);
  }

  function renderTurn(result) {
    setStatus(result.state ? `当前状态：${result.state}` : "");
    if (result.action === "ask") {
      const question = result.decision?.question;
      appendAssistantWithActions(question?.text || result.decision?.reason || "你愿意再补充一点背景吗？", question?.suggestions || []);
      setQaView("dialogue");
      return;
    }
    if (result.action === "confirm_topic") {
      const article = appendAssistantWithActions(result.decision?.reason || "这似乎是一个新的话题。要开启独立的参照吗？", ["确认，开启独立话题", "继续当前问题"]);
      article.classList.add("qa-confirmation");
      setQaView("dialogue");
      return;
    }
    if (result.action === "safety") {
      appendMessage("assistant", result.safety?.user_message || result.decision?.reason || "我先陪你处理眼前最重要的事情。");
      setQaView("dialogue");
      return;
    }
    if (result.action === "respond") {
      appendAnswer(result.answer);
      void renderMatchedPaths(result.answer);
      setStatus("参照已整理完成，你可以继续补充或追问。");
      return;
    }
    appendMessage("assistant", result.reason || "我还需要一点信息，才能继续。");
    setQaView("dialogue");
  }

  async function sendTurn(text, { initial = false, ritualAlreadyStarted = false } = {}) {
    const message = String(text || "").trim();
    if (!message || !state.sessionId || state.busy) return;
    if (state.flowMode === "curated") {
      await runDemoTurn(message);
      return;
    }
    clearError();
    appendMessage("user", message);
    refs.messageInput.value = "";
    state.busy = true;
    state.turn += 1;
    refs.messageForm.querySelector("button").disabled = true;
    if (!ritualAlreadyStarted) startSearchRitual(initial ? "understanding" : "retrieval");
    setStatus(initial ? "正在听见你的问题…" : "正在寻找相似人生并整理参照…");
    try {
      const result = await request(`/api/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ message, client_turn_id: makeTurnId() }),
      }, { timeoutMs: 190_000 });
      renderTurn(result);
    } catch (error) {
      setQaView("dialogue");
      showError(error);
      setStatus("本轮没有完成，可以修改内容后再次发送。");
    } finally {
      stopSearchRitual();
      state.busy = false;
      refs.messageForm.querySelector("button").disabled = false;
      if (state.view === "dialogue") refs.messageInput.focus({ preventScroll: true });
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
      setFlowMode(shouldUseCuratedFlow(problem) ? "curated" : "live");
      if (state.flowMode === "curated") {
        await runDemoInitial(problem);
        return;
      }
      startSearchRitual("understanding");
      await ensureBackendReady();
      const session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ problem_statement: "" }) });
      state.sessionId = session.session_id;
      await sendTurn(problem, { initial: true, ritualAlreadyStarted: true });
    } catch (error) {
      stopSearchRitual();
      setQaView("question");
      showError(error);
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "完成回答";
    }
  }

  function resetSession() {
    stopSearchRitual();
    state.sessionId = null;
    state.busy = false;
    state.turn = 0;
    state.demoStep = 0;
    resetFlowModeLabel();
    refs.messages.replaceChildren();
    refs.messageInput.value = "";
    refs.messageInput.disabled = false;
    refs.messageInput.placeholder = "补充你的情况，或回答我们的问题。";
    refs.messageForm.querySelector("button").disabled = false;
    refs.startForm.hidden = false;
    refs.workspace.hidden = false;
    refs.results.hidden = true;
    refs.results.classList.remove("is-visible");
    refs.pathList.replaceChildren();
    refs.personList.replaceChildren();
    refs.personDetail.replaceChildren();
    refs.contextGrid.replaceChildren();
    refs.answerContext.hidden = true;
    state.matchedPaths = [];
    state.activePathIndex = 0;
    state.activeSourceId = null;
    clearError();
    setStatus("");
    setQaView("question");
    refs.problemInput.focus();
  }

  function initNavigation() {
    const header = $("#site-header");
    const menuButton = header.querySelector(".menu-toggle");
    const menu = header.querySelector(".nav-links");
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

  refs.startForm.addEventListener("submit", startSession);
  refs.problemInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!refs.startForm.querySelector('button[type="submit"]').disabled) refs.startForm.requestSubmit();
    }
  });
  refs.messageForm.addEventListener("submit", (event) => { event.preventDefault(); void sendTurn(refs.messageInput.value); });
  refs.reset.addEventListener("click", resetSession);
  refs.headerReset.addEventListener("click", resetSession);
  initNavigation();
  initTopLinks();
  resetFlowModeLabel();
  setQaView("question", { scroll: false });
})();
