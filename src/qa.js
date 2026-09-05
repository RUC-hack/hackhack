(() => {
  "use strict";

  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || "http://127.0.0.1:3000").replace(/\/$/u, "");
  const state = { sessionId: null, busy: false, turn: 0 };
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    startForm: $("#start-form"),
    workspace: $("#qa-workspace"),
    problemInput: $("#problem-input"),
    conversation: $("#conversation"),
    messages: $("#qa-messages"),
    status: $("#qa-status"),
    error: $("#qa-error"),
    messageForm: $("#message-form"),
    messageInput: $("#message-input"),
    reset: $("#reset-button"),
  };

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

  function setStatus(text) { refs.status.textContent = text || ""; }
  function showError(error) { refs.error.textContent = explainError(error); refs.error.hidden = false; }
  function clearError() { refs.error.textContent = ""; refs.error.hidden = true; }

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
    const limitations = Array.isArray(answer?.limitations) ? answer.limitations : [];
    if (limitations.length) {
      const note = document.createElement("div");
      note.className = "qa-limitations";
      const heading = document.createElement("strong");
      heading.textContent = "阅读说明";
      const text = document.createElement("span");
      text.textContent = limitations.join("\n");
      note.append(heading, text);
      body.append(note);
    }
    article.append(body);
    return article;
  }

  function scrollToLiveSession() {
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
    refs.workspace.classList.add("session-started");
    refs.workspace.setAttribute("aria-hidden", "true");
    refs.conversation.classList.add("live-session-active");
    scrollToLiveSession();
  }

  async function loadSources(sourceIds, container) {
    const sources = document.createElement("div");
    sources.className = "qa-sources";
    sources.textContent = "来源加载中…";
    container.append(sources);
    const results = await Promise.all(sourceIds.slice(0, 8).map(async (sourceId) => {
      try { return await request(`/api/sources/${encodeURIComponent(sourceId)}`); } catch { return null; }
    }));
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

  function renderTurn(result) {
    setStatus(result.state ? `当前状态：${result.state}` : "");
    if (result.action === "ask") {
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
      appendAnswer(result.answer);
      setStatus("参照已整理完成，你可以继续补充或追问。");
      return;
    }
    appendMessage("assistant", result.reason || "我还需要一点信息，才能继续。");
  }

  async function sendTurn(text) {
    const message = String(text || "").trim();
    if (!message || !state.sessionId || state.busy) return;
    clearError();
    appendMessage("user", message);
    refs.messageInput.value = "";
    state.busy = true;
    refs.messageForm.querySelector("button").disabled = true;
    setStatus("正在理解你的问题并整理参照…");
    try {
      const result = await request(`/api/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ message, client_turn_id: makeTurnId() }),
      }, { timeoutMs: 70_000 });
      renderTurn(result);
    } catch (error) {
      showError(error);
      setStatus("本轮没有完成，可以修改内容后再次发送。");
    } finally {
      state.busy = false;
      refs.messageForm.querySelector("button").disabled = false;
      refs.messageInput.focus();
    }
  }

  async function startSession(event) {
    event.preventDefault();
    const problem = refs.problemInput.value.trim();
    if (!problem) return;
    clearError();
    const button = refs.startForm.querySelector("button");
    button.disabled = true;
    button.querySelector("span").textContent = "正在进入…";
    try {
      await ensureBackendReady();
      const session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ problem_statement: "" }) });
      state.sessionId = session.session_id;
      refs.startForm.hidden = true;
      refs.conversation.hidden = false;
      refs.workspace.classList.add("is-exiting");
      await sendTurn(problem);
      finishStartLayout();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "开始对话";
    }
  }

  function resetSession() {
    state.sessionId = null;
    state.busy = false;
    refs.messages.replaceChildren();
    refs.messageInput.value = "";
    refs.startForm.hidden = false;
    refs.workspace.hidden = false;
    refs.workspace.classList.remove("is-exiting", "session-started");
    refs.workspace.removeAttribute("aria-hidden");
    refs.conversation.hidden = true;
    refs.conversation.classList.remove("live-session-active");
    clearError();
    setStatus("");
    refs.problemInput.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  refs.messageForm.addEventListener("submit", (event) => { event.preventDefault(); void sendTurn(refs.messageInput.value); });
  refs.reset.addEventListener("click", resetSession);
  initNavigation();
  initTopLinks();
})();
