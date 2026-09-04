const $ = (selector) => document.querySelector(selector);
const elements = {
  runtime: $('#runtime'), status: $('#status'), name: $('#name'), headline: $('#headline'), avatar: $('#avatar'),
  avatarPlaceholder: $('#avatar-placeholder'), appId: $('#app-id'), redirectUri: $('#redirect-uri'), message: $('#message'),
  debug: $('#debug'), login: $('#login'), refresh: $('#refresh'), logout: $('#logout'), results: $('#results'), summary: $('#summary'), grid: $('#grid'),
};

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || '请求失败');
  return payload;
}

function card(definition) {
  let node = document.querySelector(`[data-id="${definition.id}"]`);
  if (node) return node;
  node = document.createElement('article');
  node.dataset.id = definition.id;
  node.innerHTML = `<div><span>OAuth 用户数据</span><b class="state">未运行</b></div><h3></h3><code></code><div class="preview">授权后自动请求一条数据</div>`;
  node.querySelector('h3').textContent = definition.name;
  node.querySelector('code').textContent = definition.endpoint;
  elements.grid.append(node);
  return node;
}

function renderResult(result) {
  const node = card(result);
  const state = node.querySelector('.state');
  const preview = node.querySelector('.preview');
  state.textContent = result.status === 'success' ? '成功' : result.status === 'empty' ? '空数据' : '失败';
  state.className = `state ${result.status}`;
  preview.replaceChildren();
  if (result.status === 'success') {
    const strong = document.createElement('strong');
    strong.textContent = result.item?.Title || result.item?.Fullname || result.item?.Description || '已返回结构化数据';
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '查看第一条 JSON';
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(result.item, null, 2);
    details.append(summary, pre); preview.append(strong, details);
  } else preview.textContent = result.message || '没有可展示的数据';
}

async function runAll() {
  elements.summary.textContent = '正在请求';
  try {
    const payload = await api('/api/oauth/run-all', { method: 'POST', body: '{}' });
    payload.results.forEach(renderResult);
    const count = (status) => payload.results.filter((result) => result.status === status).length;
    elements.summary.textContent = `${count('success')} 成功 · ${count('empty')} 空数据 · ${count('error')} 失败`;
  } catch (error) { elements.summary.textContent = error.message; }
}

async function load() {
  try {
    const data = await api('/api/oauth/status');
    const diagnostics = data.error || data.credentialWarnings?.length ? {
      error: data.error,
      debug: data.debug,
      credentialDiagnostics: data.credentialDiagnostics,
      credentialWarnings: data.credentialWarnings,
    } : null;
    elements.debug.hidden = !diagnostics;
    elements.debug.textContent = diagnostics ? JSON.stringify(diagnostics, null, 2) : '';
    elements.runtime.textContent = !data.callbackConfigured
      ? '等待部署配置'
      : data.configured ? '登录环境已就绪' : '需要配置平台密钥';
    elements.appId.textContent = data.appId;
    elements.redirectUri.textContent = data.redirectUri || '部署后配置';
    data.interfaces.forEach(card);
    if (!data.authorized) {
      elements.status.textContent = data.error ? '授权失败' : '未授权';
      elements.message.textContent = data.error?.message || (data.callbackConfigured
        ? '点击按钮后前往知乎完成授权。'
        : '本地只能预览页面。请先部署到 Cloudflare、Sealos 等平台，再配置公网回调地址。');
      elements.login.disabled = !data.callbackConfigured;
      elements.login.hidden = false; elements.refresh.hidden = true; elements.logout.hidden = true; elements.results.hidden = true;
      return;
    }
    elements.status.textContent = '已授权';
    elements.name.textContent = data.profile?.name || '已授权知乎账号';
    elements.headline.textContent = data.profile?.headline || 'OAuth Token 已安全保存在本地后端';
    if (data.profile?.avatarUrl) { elements.avatar.src = data.profile.avatarUrl; elements.avatar.hidden = false; elements.avatarPlaceholder.hidden = true; }
    elements.message.textContent = data.stateVerified ? 'state 已校验。' : '平台未返回 state，本次仅适合临时联调。';
    elements.login.hidden = true; elements.refresh.hidden = false; elements.logout.hidden = false; elements.results.hidden = false;
    await runAll();
  } catch (error) { elements.runtime.textContent = '环境检查失败'; elements.message.textContent = error.message; }
}

elements.login.addEventListener('click', () => window.location.assign('/api/oauth/start'));
elements.refresh.addEventListener('click', runAll);
elements.logout.addEventListener('click', async () => { await api('/api/oauth/logout', { method: 'POST', body: '{}' }); window.location.assign('/'); });
load();
