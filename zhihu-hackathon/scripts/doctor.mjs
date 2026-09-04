import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

function execFileResult(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { ...options, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => resolve({
      ok: !error,
      stdout: stdout?.toString().trim() || '',
      stderr: stderr?.toString().trim() || '',
    }));
  });
}

function configPathFromArgs() {
  const index = process.argv.indexOf('--project-dir');
  return index >= 0 && process.argv[index + 1]
    ? path.join(path.resolve(process.argv[index + 1]), 'hackathon.config.json')
    : null;
}

function isPublicHttps(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const local = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '0.0.0.0' ||
      /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
      (() => { const match = hostname.match(/^172\.(\d{1,3})\./); return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31); })();
    return url.protocol === 'https:' && !local && url.pathname.endsWith('/auth/callback');
  } catch {
    return false;
  }
}

function fingerprint(value) {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null;
}

async function secretDetails({ envName, service, account }) {
  const envValue = process.env[envName] || '';
  if (envValue) {
    return {
      configured: true,
      source: `env:${envName}`,
      length: envValue.length,
      sha256Prefix: fingerprint(envValue),
    };
  }
  if (!service || !account || process.platform !== 'darwin') {
    return { configured: false, source: null, length: 0, sha256Prefix: null };
  }
  const result = await execFileResult('/usr/bin/security', [
    'find-generic-password',
    '-s',
    service,
    '-a',
    account,
    '-w',
  ]);
  const value = result.ok ? result.stdout : '';
  return {
    configured: Boolean(value),
    source: value ? 'macOS Keychain' : null,
    length: value.length,
    sha256Prefix: fingerprint(value),
  };
}

function credentialWarnings({ config, appKey, accessSecret }) {
  const warnings = [];
  const appId = String(config.oauth?.appId || '');
  if (config.oauth?.enabled !== true) return warnings;
  if (appKey.configured && appKey.length <= 8) {
    warnings.push({
      code: 'APP_KEY_TOO_SHORT',
      message: 'ZHIHU_OAUTH_APP_KEY / OAuth app_key is suspiciously short; check that App ID was not entered here.',
    });
  }
  if (appKey.configured && appId && appKey.length === appId.length && appKey.sha256Prefix === fingerprint(appId)) {
    warnings.push({
      code: 'APP_ID_USED_AS_APP_KEY',
      message: 'OAuth app_key appears to equal the App ID. Put App ID in oauth.appId, not ZHIHU_OAUTH_APP_KEY.',
    });
  }
  if (appKey.configured && accessSecret.configured && appKey.sha256Prefix === accessSecret.sha256Prefix) {
    warnings.push({
      code: 'APP_KEY_USED_AS_ACCESS_SECRET',
      message: 'ZHIHU_ACCESS_SECRET appears to equal OAuth app_key. Access Secret and OAuth App Key are different credentials.',
    });
  }
  return warnings;
}

try {
  const configPath = configPathFromArgs();
  if (!configPath) throw new Error('Required: --project-dir.');
  const projectDir = path.dirname(configPath);
  const configText = await readFile(configPath, 'utf8');
  const config = JSON.parse(configText);
  const requiredFiles = ['server.mjs', 'public/index.html', 'public/styles.css', '.codex/skills/zhihu/SKILL.md'];
  if (config.oauth?.enabled === true) requiredFiles.push('public/app.js', 'lib/oauth.mjs');
  const fileChecks = await Promise.all(requiredFiles.map(async (file) => {
    try {
      await access(path.join(projectDir, file));
      return [file, true];
    } catch {
      return [file, false];
    }
  }));

  const appKey = config.oauth?.enabled === true
    ? await secretDetails({
        envName: 'ZHIHU_OAUTH_APP_KEY',
        service: config.oauth.credentialService,
        account: config.oauth.credentialAccount,
      })
    : { configured: false, source: null, length: 0, sha256Prefix: null };
  const accessSecret = await secretDetails({
    envName: 'ZHIHU_ACCESS_SECRET',
    service: 'zhihu-cli',
    account: 'access-secret',
  });
  const runScript = path.join(projectDir, '.codex', 'skills', 'zhihu', 'scripts', 'run.sh');
  const officialStatus = await execFileResult('/bin/bash', [runScript, 'status'], { cwd: projectDir });
  let status = null;
  try { status = JSON.parse(officialStatus.stdout); } catch { status = null; }
  const topLevel = await readdir(projectDir);
  const configTextForScan = JSON.stringify(config);
  const unsafeConfigKeys = ['appKey', 'accessSecret', 'accessToken', 'authorizationCode'].filter((key) =>
    new RegExp(`"${key}"`, 'i').test(configTextForScan),
  );

  const appKeyConfigured = appKey.configured;
  const accessSecretConfigured = accessSecret.configured ||
    status?.auth?.configured === true || status?.auth?.source === 'keychain';
  const warnings = credentialWarnings({ config, appKey, accessSecret });
  const report = {
    ok: true,
    projectDir,
    files: Object.fromEntries(fileChecks),
    configuration: {
      oauthEnabled: config.oauth?.enabled === true,
      appId: config.oauth?.enabled === true ? Boolean(config.oauth.appId) : null,
      redirectUri: config.oauth?.enabled === true ? isPublicHttps(config.oauth.redirectUri) : null,
      localPreviewOnly: config.oauth?.enabled === true ? !isPublicHttps(config.oauth.redirectUri) : null,
      unsafeConfigKeys,
      dotEnvPresent: topLevel.some((name) => name === '.env' || name.startsWith('.env.')),
    },
    appKey: config.oauth?.enabled === true
      ? { required: true, ...appKey }
      : { required: false, configured: false, storage: null },
    accessSecret: {
      configured: accessSecretConfigured,
      source: accessSecret.source ?? status?.auth?.source ?? null,
      length: accessSecret.length,
      sha256Prefix: accessSecret.sha256Prefix,
    },
    credentialWarnings: warnings,
    cli: { installed: status?.installed ?? null, compatible: status?.compatible ?? null },
  };
  report.readyForLocalPreview =
    Object.values(report.files).every(Boolean) &&
    report.configuration.unsafeConfigKeys.length === 0 &&
    !report.configuration.dotEnvPresent &&
    report.cli.installed === true &&
    report.cli.compatible !== false;
  report.readyForOAuth =
    report.readyForLocalPreview &&
    (!report.configuration.oauthEnabled || report.configuration.redirectUri === true) &&
    (!report.appKey.required || report.appKey.configured) &&
    report.accessSecret.configured === true &&
    report.credentialWarnings.length === 0;
  report.ready = report.readyForOAuth;
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, ready: false, error: error.message })}\n`);
  process.exit(1);
}
