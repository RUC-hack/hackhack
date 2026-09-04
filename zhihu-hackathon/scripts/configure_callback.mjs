import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value === '::1' || value === '0.0.0.0') return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

try {
  const projectDirValue = valueAfter('--project-dir');
  const redirectUriValue = valueAfter('--redirect-uri');
  if (!projectDirValue || !redirectUriValue) throw new Error('Required: --project-dir and --redirect-uri.');
  const projectDir = path.resolve(projectDirValue);
  const configPath = path.join(projectDir, 'hackathon.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.oauth?.enabled !== true) throw new Error('OAuth is disabled for this project.');

  const redirectUri = new URL(redirectUriValue);
  if (redirectUri.protocol !== 'https:' || isLocalHostname(redirectUri.hostname)) {
    throw new Error('OAuth redirect URI must be a public HTTPS address. Local addresses cannot complete Zhihu login.');
  }
  if (!redirectUri.pathname.endsWith('/auth/callback')) {
    throw new Error('OAuth redirect URI must end with /auth/callback.');
  }

  config.oauth.redirectUri = redirectUri.toString();
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    redirectUri: config.oauth.redirectUri,
    registerTheSameAddressOnZhihuOpenPlatform: true,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}
