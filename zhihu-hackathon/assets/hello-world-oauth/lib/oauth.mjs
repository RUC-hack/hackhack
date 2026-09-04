import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const userInterfaces = [
  ['contents', '我的创作', '/api/v1/user/contents'],
  ['followees', '我的关注', '/api/v1/user/followees'],
  ['favlists', '收藏夹', '/api/v1/user/favlists'],
  ['favlist_contents', '收藏内容', '/api/v1/user/favlist_contents'],
  ['collections', '近期收藏', '/api/v1/user/collections'],
].map(([id, name, endpoint]) => ({ id, name, endpoint }));

function keychain(service, account) {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], (error, stdout) => {
      resolve(!error ? stdout.toString().trim() : null);
    });
  });
}

function runCurl(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || '网络请求失败'));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
      catch { reject(new Error('知乎开放平台返回了无法解析的响应')); }
    });
    child.stdin.end(`${lines.join('\n')}\n`);
  });
}

function safe(value) {
  if (!value || /[\r\n"\\]/.test(value)) throw new Error('凭证格式无效');
  return value;
}

function fingerprint(value) {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null;
}

function payloadError(payload, fallback) {
  const data = payload?.data ?? payload?.Data;
  const message = typeof data === 'string' ? data : data?.message || payload?.message || payload?.Message || fallback;
  const error = new Error(String(message).slice(0, 200));
  error.code = payload?.code ?? payload?.Code ?? 'OAUTH_FAILED';
  return error;
}

function cookieId(request) {
  const value = (request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('zhihu_hackathon_session='));
  return value ? decodeURIComponent(value.slice(value.indexOf('=') + 1)) : null;
}

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function firstItem(payload) {
  return Array.isArray(payload?.Data?.Items) ? payload.Data.Items[0] || null : null;
}

function userRequestConfig(accessSecret, oauthToken, url) {
  return [
    'silent', 'show-error', 'max-time = 30', 'request = "GET"', `url = "${url}"`,
    `header = "Authorization: Bearer ${safe(accessSecret)}"`,
    `header = "X-OAuth-Token: ${safe(oauthToken)}"`,
    `header = "X-Request-Timestamp: ${Math.floor(Date.now() / 1000)}"`,
    'header = "Content-Type: application/json"',
  ];
}

export function createOAuth(config) {
  const sessions = new Map();
  const oauthConfig = config.oauth;

  function session(request, response) {
    let id = cookieId(request);
    let current = id ? sessions.get(id) : null;
    if (!current) {
      id = randomBytes(24).toString('base64url');
      current = { id, state: null, token: null, expiresAt: null, profile: null, stateVerified: null, error: null, debug: null };
      sessions.set(id, current);
      response.setHeader('Set-Cookie', `zhihu_hackathon_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
    }
    return current;
  }

  async function credentialDetails() {
    const [keychainAppKey, keychainAccessSecret] = await Promise.all([
      process.env.ZHIHU_OAUTH_APP_KEY ? null : keychain(oauthConfig.credentialService, oauthConfig.credentialAccount),
      process.env.ZHIHU_ACCESS_SECRET ? null : keychain('zhihu-cli', 'access-secret'),
    ]);
    const appKey = process.env.ZHIHU_OAUTH_APP_KEY || keychainAppKey || '';
    const accessSecret = process.env.ZHIHU_ACCESS_SECRET || keychainAccessSecret || '';
    return {
      appKey,
      accessSecret,
      diagnostics: {
        appKey: {
          source: process.env.ZHIHU_OAUTH_APP_KEY ? 'env:ZHIHU_OAUTH_APP_KEY' : appKey ? 'macOS Keychain' : 'missing',
          configured: Boolean(appKey),
          length: appKey.length,
          sha256Prefix: fingerprint(appKey),
        },
        accessSecret: {
          source: process.env.ZHIHU_ACCESS_SECRET ? 'env:ZHIHU_ACCESS_SECRET' : accessSecret ? 'macOS Keychain' : 'missing',
          configured: Boolean(accessSecret),
          length: accessSecret.length,
          sha256Prefix: fingerprint(accessSecret),
        },
      },
    };
  }

  async function credentials() {
    const { appKey, accessSecret } = await credentialDetails();
    return { appKey, accessSecret };
  }

  function credentialWarnings(diagnostics) {
    const warnings = [];
    if (diagnostics.appKey.configured && diagnostics.appKey.length <= 8) {
      warnings.push({
        code: 'APP_KEY_TOO_SHORT',
        message: 'ZHIHU_OAUTH_APP_KEY 看起来过短，请确认没有填成 App ID。',
      });
    }
    if (
      diagnostics.appKey.configured &&
      oauthConfig.appId &&
      diagnostics.appKey.sha256Prefix === fingerprint(String(oauthConfig.appId))
    ) {
      warnings.push({
        code: 'APP_ID_USED_AS_APP_KEY',
        message: 'OAuth app_key 看起来等于 App ID。',
      });
    }
    if (
      diagnostics.appKey.configured &&
      diagnostics.accessSecret.configured &&
      diagnostics.appKey.sha256Prefix === diagnostics.accessSecret.sha256Prefix
    ) {
      warnings.push({
        code: 'APP_KEY_USED_AS_ACCESS_SECRET',
        message: 'ZHIHU_ACCESS_SECRET 看起来等于 OAuth App Key。',
      });
    }
    return warnings;
  }

  function exchangeDebug(code, diagnostics) {
    return {
      stage: 'callback_received',
      codeReceived: Boolean(code),
      codeLength: String(code || '').length,
      tokenExchange: {
        url: 'https://openapi.zhihu.com/access_token',
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        appId: oauthConfig.appId,
        appKeySource: diagnostics.appKey.source,
        appKeyLength: diagnostics.appKey.length,
        appKeySha256Prefix: diagnostics.appKey.sha256Prefix,
        grantType: 'authorization_code',
        redirectUri: oauthConfig.redirectUri,
        codeField: 'code',
        codeLength: String(code || '').length,
      },
      accessSecret: diagnostics.accessSecret,
      credentialWarnings: credentialWarnings(diagnostics),
    };
  }

  async function status(request, response) {
    const current = session(request, response);
    const { appKey, accessSecret, diagnostics } = await credentialDetails();
    if (current.expiresAt && current.expiresAt <= Date.now()) {
      current.token = null;
      current.profile = null;
      current.error = { code: 'TOKEN_EXPIRED', message: '授权已过期，请重新连接。' };
    }
    return {
      configured: Boolean(appKey && accessSecret && oauthConfig.redirectUri),
      callbackConfigured: Boolean(oauthConfig.redirectUri),
      authorized: Boolean(current.token),
      appId: oauthConfig.appId,
      redirectUri: oauthConfig.redirectUri,
      profile: current.profile,
      stateVerified: current.stateVerified,
      expiresAt: current.expiresAt ? new Date(current.expiresAt).toISOString() : null,
      error: current.error,
      debug: current.debug,
      credentialDiagnostics: diagnostics,
      credentialWarnings: credentialWarnings(diagnostics),
      interfaces: userInterfaces,
    };
  }

  async function start(request, response) {
    const current = session(request, response);
    if (!oauthConfig.redirectUri) {
      throw Object.assign(new Error('本地地址无法完成知乎登录。请先部署应用并配置公网回调地址。'), { code: 'DEPLOYMENT_REQUIRED' });
    }
    const { appKey } = await credentials();
    if (!appKey) throw Object.assign(new Error('OAuth app_key 尚未配置'), { code: 'APP_KEY_REQUIRED' });
    current.state = randomBytes(24).toString('base64url');
    current.error = null;
    const url = new URL('https://openapi.zhihu.com/authorize');
    url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
    url.searchParams.set('app_id', oauthConfig.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', current.state);
    return url.toString();
  }

  async function callback(request, response, url) {
    const current = session(request, response);
    const code = url.searchParams.get('authorization_code') || url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const details = await credentialDetails();
    current.debug = exchangeDebug(code, details.diagnostics);
    if (!code) throw Object.assign(new Error('回调缺少 authorization_code'), { code: 'CODE_MISSING' });
    if (returnedState && !equal(returnedState, current.state)) {
      throw Object.assign(new Error('state 校验失败'), { code: 'STATE_MISMATCH' });
    }
    const { appKey, accessSecret } = details;
    if (!appKey || !accessSecret) throw new Error('后端凭证配置不完整');
    current.debug.stage = 'token_exchange_started';
    const form = new URLSearchParams({
      app_id: oauthConfig.appId,
      app_key: safe(appKey),
      grant_type: 'authorization_code',
      redirect_uri: oauthConfig.redirectUri,
      code: safe(code),
    }).toString();
    const payload = await runCurl([
      'silent', 'show-error', 'max-time = 20', 'request = "POST"',
      'url = "https://openapi.zhihu.com/access_token"',
      'header = "Content-Type: application/x-www-form-urlencoded"', `data = "${form}"`,
    ]);
    const token = payload?.access_token || payload?.data?.access_token || payload?.Data?.access_token;
    if (!token) throw payloadError(payload, '未获得 OAuth access token');
    const expiresIn = Number(payload?.expires_in ?? payload?.data?.expires_in ?? payload?.Data?.expires_in);
    current.debug.stage = 'token_exchange_succeeded';
    current.debug.tokenReceived = Boolean(token);
    current.debug.expiresIn = Number.isFinite(expiresIn) ? expiresIn : null;
    current.token = token;
    current.expiresAt = Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null;
    current.stateVerified = Boolean(returnedState);
    current.state = null;
    current.error = null;

    try {
      current.debug.stage = 'profile_fetch_started';
      const profilePayload = await runCurl(userRequestConfig(accessSecret, token, 'https://openapi.zhihu.com/user'));
      const source = profilePayload?.data || profilePayload?.Data || profilePayload?.user || null;
      if (source && typeof source === 'object') {
        current.profile = {
          name: source.name || source.Fullname || source.fullname || null,
          avatarUrl: source.avatar_url || source.AvatarUrl || null,
          headline: source.headline || source.Headline || null,
          url: source.url || source.Url || null,
        };
      }
      current.debug.profileFetched = Boolean(current.profile);
    } catch { current.profile = null; current.debug.profileFetched = false; }
    current.debug.stage = 'authorized';
  }

  async function runAll(request, response) {
    const current = session(request, response);
    if (!current.token) throw Object.assign(new Error('请先完成知乎账号授权'), { code: 'LOGIN_REQUIRED' });
    const { accessSecret } = await credentials();
    if (!accessSecret) throw new Error('开放平台 Access Secret 未配置');
    const context = {};
    const results = [];
    for (const definition of userInterfaces) {
      let query = { Limit: '1' };
      if (definition.id === 'contents') query = { ...query, ContentType: 'all', Offset: '0', SortField: 'ts', SortOrder: 'desc' };
      if (definition.id === 'followees') query.Offset = '0';
      if (definition.id === 'favlist_contents') {
        if (!context.favlistToken) {
          results.push({ ...definition, status: 'empty', item: null, message: '账号没有可用于测试的收藏夹。' });
          continue;
        }
        query = { ...query, FavlistUrlToken: String(context.favlistToken), Offset: '0' };
      }
      try {
        const payload = await runCurl(userRequestConfig(
          accessSecret,
          current.token,
          `https://developer.zhihu.com${definition.endpoint}?${new URLSearchParams(query)}`,
        ));
        if (payload?.Code !== 0) throw payloadError(payload, '用户数据接口失败');
        const item = firstItem(payload);
        if (definition.id === 'favlists' && item?.UrlToken) context.favlistToken = item.UrlToken;
        results.push({ ...definition, status: item ? 'success' : 'empty', item, message: item ? null : '接口成功但没有数据。' });
      } catch (error) {
        results.push({ ...definition, status: 'error', item: null, message: error.message });
      }
    }
    return results;
  }

  function logout(request, response) {
    const current = session(request, response);
    current.token = null; current.expiresAt = null; current.profile = null; current.state = null; current.stateVerified = null; current.error = null;
    current.debug = null;
  }

  function record(request, response, error) {
    const current = session(request, response);
    if (current.debug) current.debug.failedStage = current.debug.stage;
    current.error = { code: String(error.code || 'OAUTH_FAILED'), message: String(error.message).slice(0, 200) };
  }

  return { status, start, callback, runAll, logout, record };
}
