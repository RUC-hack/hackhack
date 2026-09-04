(() => {
  "use strict";

  const frameworks = [
    { no: "01", title: "识我", en: "SELF", text: "辨认价值排序、风险偏好、关系依赖、时间偏好、核心恐惧，以及反复出现的人生母题。" },
    { no: "02", title: "见众", en: "SIMILAR OTHERS", text: "寻找具有相似性格、困境与价值冲突的人，形成可被观察的相似人生簇。" },
    { no: "03", title: "观路", en: "TRAJECTORY", text: "把人生整理为起点、选择、代价、转折与后来；看见相似的人如何经过同一问题。" },
    { no: "04", title: "定位", en: "REFERENCE", text: "不输出唯一答案，而是在相似样本中重新理解自己此刻所处的阶段与位置。" }
  ];

  const trajectories = [
    { label: "A", path: ["起步较晚", "尝试", "失败", "转向", "长期方向"], quote: "他没有在很早的时候，就想明白自己的一生。" },
    { label: "B", path: ["稳定行业", "感到选错", "重新学习", "职业转换"], quote: "选择没有结束人生，它只是改变下一次选择的起点。" },
    { label: "C", path: ["继续深造", "仍然犹豫", "接受不确定"], quote: "有些人没有停止犹豫，只是学会了带着犹豫生活。" }
  ];

  const rehearsalPaths = {
    study: { tag: "PATH A", title: "继续读书", qualities: [["高自主", "生活组织"], ["长反馈周期", "时间感受"], ["身份不确定", "心理代价"], ["延迟经济回报", "现实条件"]], question: "这一种生活，你愿意过五年吗？" },
    work: { tag: "PATH B", title: "进入工作", qualities: [["更快进入现实", "生活组织"], ["较短反馈周期", "时间感受"], ["职业身份形成", "心理变化"], ["更早经济独立", "现实条件"]], question: "如果没人知道你的选择，你还会这样选吗？" },
    pause: { tag: "PATH C", title: "暂时不选", qualities: [["保留探索空间", "生活组织"], ["方向仍然开放", "时间感受"], ["承受同辈压力", "心理代价"], ["需要明确边界", "现实条件"]], question: "你愿意为一段有边界的不确定，承担什么？" }
  };

  const timelineItems = [
    { year: "2026", text: "我特别害怕考不上研究生。", note: "当时以为，这是决定一切的岔路。", resolved: true },
    { year: "2027", text: "它已经没有那么重要了。", note: "新的经历改变了旧问题的重量。", resolved: false },
    { year: "2029", text: "我很怕转行失败。", note: "另一个选择，再次成为当下的全部。", resolved: true },
    { year: "2031", text: "原来我已经走过来了。", note: "回望不是为了证明当初选对，而是看见自己如何成为现在的人。", resolved: false }
  ];

  // 无 API Key 时使用经语义筛选的静态 Unsplash CDN 图；有 Key 时使用官方 Search API。
  const imageRequirements = [
    { target: "hero", query: "young person alone landscape contemplative editorial", orientation: "landscape", concept: ["person", "nature", "landscape"], fallback: { id: "hero-landscape", url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee", photographer: "Unsplash", profile: "https://unsplash.com", page: "https://unsplash.com", position: "center" } },
    { target: "crowd", query: "people walking city crowd documentary neutral", orientation: "landscape", concept: ["people", "city", "crowd"], fallback: { id: "crowd-city", url: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac", photographer: "Unsplash", profile: "https://unsplash.com", page: "https://unsplash.com", position: "center" } },
   {
  target: "portrait",
  query: "SUV winding desert road Utah red rock editorial",
  orientation: "portrait",
  concept: [
    "desert road",
    "winding road",
    "SUV",
    "Utah",
    "red rocks",
    "journey"
  ],
  fallback: {
    id: "suv-desert-road",
    url: "https://images.unsplash.com/photo-1788119117647-c5d2a76593dd",
    photographer: "Clement Proust",
    profile: "https://unsplash.com/@clementproust",
    page: "https://unsplash.com/photos/ms0G5L_wN4U",
    position: "center"
  }
},
    { target: "road", query: "winding road fog landscape journey minimal", orientation: "landscape", concept: ["road", "fog", "landscape"], fallback: { id: "road-fog", url: "https://images.unsplash.com/photo-1500534623283-312aade485b7", photographer: "Unsplash", profile: "https://unsplash.com", page: "https://unsplash.com", position: "center" } },
    { target: "closing", query: "friends walking together landscape sunset cinematic", orientation: "landscape", concept: ["friends", "people", "together", "walking", "sunset"], fallback: { id: "together-sunset", url: "https://images.unsplash.com/photo-1527631746610-bca00a040d60", photographer: "Unsplash", profile: "https://unsplash.com", page: "https://unsplash.com/s/photos/friends-walking-together", position: "center" } }
  ];

  function renderContent() {
    document.querySelector("#framework-grid").innerHTML = frameworks.map((item, index) => `
      <article class="framework-card fade-up" style="transition-delay:${index * 80}ms">
        <span class="framework-number">${item.no}</span><h3>${item.title}</h3><span class="en">${item.en}</span><p>${item.text}</p>
      </article>`).join("");
    document.querySelector("#trajectory-list").innerHTML = trajectories.map((item, index) => `
      <article class="trajectory-item fade-up" style="transition-delay:${index * 90}ms">
        <span class="trajectory-label">${item.label}</span><div><div class="trajectory-path">${item.path.map((step, i) => `${i ? "<i></i>" : ""}<span>${step}</span>`).join("")}</div><blockquote>${item.quote}</blockquote></div>
      </article>`).join("");
    document.querySelector("#timeline").innerHTML = timelineItems.map(item => `
      <article class="timeline-item ${item.resolved ? "resolved" : ""}"><time>${item.year}</time><blockquote>${item.text}</blockquote><p>${item.note}</p></article>`).join("");
    renderRehearsal("study");
  }

  function renderRehearsal(key) {
    const item = rehearsalPaths[key];
    document.querySelector("#rehearsal-panel").innerHTML = `<div><span class="path-tag">${item.tag}</span><h3>${item.title}</h3></div><div class="quality-grid">${item.qualities.map(q => `<div class="quality"><strong>${q[0]}</strong><span>${q[1]}</span></div>`).join("")}</div><div class="rehearsal-question">${item.question}</div>`;
  }

  function initNavigation() {
    const header = document.querySelector("#site-header");
    const links = [...document.querySelectorAll(".nav-links a")];
    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 48);
    updateHeader(); window.addEventListener("scroll", updateHeader, { passive: true });
    const sectionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) links.forEach(link => link.classList.toggle("active", link.hash === `#${entry.target.id}`));
    }), { rootMargin: "-35% 0px -58%", threshold: 0 });
    links.forEach(link => { const section = document.querySelector(link.hash); if (section) sectionObserver.observe(section); });
  }

  function initMobileMenu() {
    const button = document.querySelector(".menu-toggle"); const menu = document.querySelector("#nav-links");
    const close = () => { button.classList.remove("open"); menu.classList.remove("open"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", "打开导航菜单"); document.body.style.overflow = ""; };
    button.addEventListener("click", () => { const open = !menu.classList.contains("open"); menu.classList.toggle("open", open); button.classList.toggle("open", open); button.setAttribute("aria-expanded", String(open)); button.setAttribute("aria-label", open ? "关闭导航菜单" : "打开导航菜单"); document.body.style.overflow = open ? "hidden" : ""; });
    menu.addEventListener("click", event => { if (event.target.matches("a")) close(); });
    window.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  }

  function initScrollAnimations() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { document.querySelectorAll(".fade-up").forEach(el => el.classList.add("visible")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } }), { threshold: .14 });
    document.querySelectorAll(".fade-up").forEach(el => observer.observe(el));
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener("click", event => { const target = document.querySelector(link.hash); if (!target) return; event.preventDefault(); target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }));
  }

  function buildUnsplashQuery(requirement) { return `${requirement.query} editorial muted colors`; }
  async function searchUnsplashPhotos(requirement, key) {
    const params = new URLSearchParams({ query: buildUnsplashQuery(requirement), orientation: requirement.orientation, per_page: "12", order_by: "relevant", content_filter: "high" });
    const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, { headers: { Authorization: `Client-ID ${key}` } });
    if (!response.ok) throw new Error(`Unsplash API ${response.status}`);
    return (await response.json()).results;
  }
  function scorePhotoCandidate(photo, requirement, used) {
    const ratio = photo.width / photo.height; const orientationFit = requirement.orientation === "landscape" ? ratio > 1.3 : ratio < .9;
    const haystack = `${photo.alt_description || ""} ${(photo.tags || []).map(t => t.title).join(" ")}`.toLowerCase();
    const semantic = requirement.concept.filter(word => haystack.includes(word)).length * 18;
    return semantic + (orientationFit ? 35 : 0) + (photo.width >= 1600 ? 15 : 0) - (used.has(photo.id) ? 100 : 0) + Math.min(photo.likes || 0, 400) / 40;
  }
  function normalizePhoto(photo) { return { id: photo.id, url: photo.urls.regular, photographer: photo.user.name, profile: photo.user.links.html, page: photo.links.html, downloadLocation: photo.links.download_location, position: "center" }; }
  async function trackUnsplashDownload(photo, key) { if (!key || !photo.downloadLocation) return; try { await fetch(photo.downloadLocation, { headers: { Authorization: `Client-ID ${key}` } }); } catch (_) { /* 追踪失败不阻断展示 */ } }
  function sizedUrl(url, target) { const join = url.includes("?") ? "&" : "?"; return `${url}${join}w=${target === "hero" ? 2000 : target === "portrait" ? 900 : 1600}&q=82&auto=format&fit=crop`; }
  function renderAttribution(target, photo) {
    const source = document.querySelector(`[data-credit-for="${target}"]`); if (!source) return;
    const utm = "?utm_source=jianzhong_demo&utm_medium=referral";
    source.innerHTML = `Photo by <a href="${photo.profile}${utm}" target="_blank" rel="noopener">${photo.photographer}</a> on <a href="${photo.page}${utm}" target="_blank" rel="noopener">Unsplash</a>`;
  }
  function applyImage(requirement, photo) {
    const el = document.querySelector(`[data-image-target="${requirement.target}"]`); if (!el) return;
    const url = sizedUrl(photo.url, requirement.target);
    if (el.tagName === "IMG") { el.src = url; el.onerror = () => { el.removeAttribute("src"); el.classList.add("image-fallback"); }; }
    else { const probe = new Image(); probe.onload = () => { el.style.backgroundImage = `url("${url}")`; }; probe.onerror = () => el.classList.add("image-fallback"); probe.src = url; }
    renderAttribution(requirement.target, photo);
  }
  async function initUnsplashImages(force = false) {
    const key = window.APP_CONFIG?.unsplashAccessKey?.trim(); const cacheKey = "jianzhongImageCacheV4"; const used = new Set(); let cache = {};
    if (!force) { try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch (_) { cache = {}; } }
    for (const requirement of imageRequirements) {
      let photo = cache[requirement.target];
      if (!photo && key) { try { const results = await searchUnsplashPhotos(requirement, key); photo = normalizePhoto(results.sort((a,b) => scorePhotoCandidate(b, requirement, used) - scorePhotoCandidate(a, requirement, used))[0]); await trackUnsplashDownload(photo, key); } catch (error) { console.warn("Unsplash 检索失败，使用策展回退图。", error); } }
      photo ||= requirement.fallback; used.add(photo.id); cache[requirement.target] = photo; applyImage(requirement, photo);
    }
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (_) { /* 隐私模式下忽略 */ }
    const credits = [...new Map(Object.values(cache).map(p => [p.photographer, p])).values()];
    document.querySelector("#all-credits").innerHTML = credits.map(p => `<a href="${p.profile}?utm_source=jianzhong_demo&utm_medium=referral" target="_blank" rel="noopener">${p.photographer}</a>`).join(" · ");
  }
  window.refreshImages = () => { localStorage.removeItem("jianzhongImageCacheV4"); return initUnsplashImages(true); };

  function initRehearsal() { document.querySelector(".rehearsal-tabs").addEventListener("click", event => { const button = event.target.closest("button[data-path]"); if (!button) return; document.querySelectorAll(".rehearsal-tabs button").forEach(item => item.setAttribute("aria-selected", String(item === button))); renderRehearsal(button.dataset.path); }); }
  function initConstellation() {
    const canvas = document.querySelector("#constellation-canvas"); const ctx = canvas.getContext("2d"); let points = [];
    const resize = () => { const dpr = Math.min(devicePixelRatio, 2); canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); const count = Math.min(90, Math.floor(canvas.clientWidth / 13)); points = Array.from({length:count},(_,i) => ({x:Math.random()*canvas.clientWidth,y:Math.random()*canvas.clientHeight,r:i%17===0?3:1.3,a:.2+Math.random()*.55})); draw(); };
    const draw = () => { ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight); points.forEach((p,i) => { points.slice(i+1).forEach(q => { const d=Math.hypot(p.x-q.x,p.y-q.y); if(d<105){ctx.strokeStyle=`rgba(209,194,164,${(1-d/105)*.14})`;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}});ctx.fillStyle=`rgba(225,211,183,${p.a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}); };
    resize(); window.addEventListener("resize", resize);
  }

  function initHeroScrollTransition() {
    const hero = document.querySelector(".hero");
    const heroContent = document.querySelector(".hero-content");
    const heroBackground = document.querySelector(".hero-bg");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!hero || !heroContent || !heroBackground || reducedMotion.matches) return;

    let ticking = false;
    const updateHeroScroll = () => {
      const height = Math.max(hero.offsetHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / height, 0), 1);
      heroContent.style.opacity = String(Math.max(1 - progress * 1.35, 0));
      heroContent.style.transform = `translate3d(0, ${-progress * 56}px, 0)`;
      heroBackground.style.transform = `scale(${1.03 + progress * .05})`;
      ticking = false;
    };
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateHeroScroll);
    };

    updateHeroScroll();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
  }

  function initReducedMotion() { document.documentElement.dataset.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full"; }

  document.addEventListener("DOMContentLoaded", async () => { renderContent(); initReducedMotion(); initNavigation(); initMobileMenu(); initRehearsal(); initScrollAnimations(); initSmoothScroll(); initConstellation(); initHeroScrollTransition(); await initUnsplashImages(); });
})();
