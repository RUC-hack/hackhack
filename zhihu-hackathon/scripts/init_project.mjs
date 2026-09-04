import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOfficialSkill } from './install_official_skill.mjs';

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    if (arg === '--skip-cli-install') flags.add(arg);
    else values.set(arg, argv[++index]);
  }
  return { values, flags };
}

function slugify(value) {
  const slug = String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'zhihu-oauth-demo';
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value === '::1' || value === '0.0.0.0') return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function execFileResult(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { ...options, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: stdout?.toString().trim() || '',
        stderr: stderr?.toString().trim() || '',
      });
    });
  });
}

function parseStatus(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

const { values, flags } = parseArgs(process.argv.slice(2));
const projectName = String(values.get('--project-name') || '').trim();
const oauthMode = String(values.get('--oauth') || '').trim();
const requestedPort = values.get('--port') ? Number(values.get('--port')) : null;
const appId = String(values.get('--app-id') || '').trim();
const redirectUriText = String(values.get('--redirect-uri') || '').trim();
const target = values.get('--project-dir') ? path.resolve(values.get('--project-dir')) : null;

try {
  if (!target || !projectName || !['enabled', 'disabled'].includes(oauthMode)) {
    throw new Error('Required: --project-dir, --project-name, --oauth <enabled|disabled>.');
  }
  if (oauthMode === 'enabled' && !/^\d+$/.test(appId)) {
    throw new Error('OAuth mode requires --app-id. The public redirect URI may be configured after deployment.');
  }
  const redirectUri = oauthMode === 'enabled' && redirectUriText ? new URL(redirectUriText) : null;
  if (redirectUri && (redirectUri.protocol !== 'https:' || isLocalHostname(redirectUri.hostname))) {
    throw new Error('OAuth redirect URI must be a public HTTPS address. Local addresses cannot complete Zhihu login.');
  }
  if (redirectUri && !redirectUri.pathname.endsWith('/auth/callback')) {
    throw new Error('OAuth redirect URI must end with /auth/callback.');
  }
  if (requestedPort !== null && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error('Port must be an integer between 1024 and 65535.');
  }
  if ([path.parse(target).root, homedir(), skillRoot].includes(target)) throw new Error('Refusing unsafe project directory.');

  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length > 0) throw new Error('Project directory must be empty.');
  const templateDir = path.join(
    skillRoot,
    'assets',
    oauthMode === 'enabled' ? 'hello-world-oauth' : 'hello-world-basic',
  );
  await cp(templateDir, target, { recursive: true, errorOnExist: true });

  const projectSlug = slugify(projectName);
  const pathId = createHash('sha256').update(target).digest('hex').slice(0, 10);
  const port = requestedPort || 4173;
  const config = {
    schemaVersion: 1,
    projectName,
    projectSlug,
    oauth: { enabled: oauthMode === 'enabled' },
    host: '127.0.0.1',
    port,
  };
  if (oauthMode === 'enabled') {
    config.oauth.appId = appId;
    config.oauth.redirectUri = redirectUri?.toString() || null;
    config.oauth.credentialService = `zhihu-hackathon:${projectSlug}:${pathId}`;
    config.oauth.credentialAccount = 'oauth-app-key';
  }
  await writeFile(path.join(target, 'hackathon.config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const templateTextFiles = ['README.md', 'server.mjs', 'public/index.html'];
  for (const relativePath of templateTextFiles) {
    const filePath = path.join(target, relativePath);
    const rendered = (await readFile(filePath, 'utf8'))
      .replaceAll('__PROJECT_NAME__', projectName)
      .replaceAll('__REDIRECT_URI__', config.oauth.redirectUri || '部署后配置')
      .replaceAll('__PORT__', String(port));
    await writeFile(filePath, rendered, 'utf8');
  }

  const officialSkill = await installOfficialSkill(target);
  const runScript = path.join(officialSkill.target, 'scripts', 'run.sh');
  let statusResult = await execFileResult('/bin/bash', [runScript, 'status'], { cwd: target });
  let cliStatus = parseStatus(statusResult.stdout);
  let setupAttempted = false;

  if (!flags.has('--skip-cli-install') && cliStatus?.installed === false) {
    setupAttempted = true;
    const setupScript = path.join(officialSkill.target, 'scripts', 'setup.sh');
    await execFileResult('/bin/bash', [setupScript], { cwd: target });
    statusResult = await execFileResult('/bin/bash', [runScript, 'status'], { cwd: target });
    cliStatus = parseStatus(statusResult.stdout);
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      projectDir: target,
      oauthEnabled: config.oauth.enabled,
      demoUrl: `http://${config.host}:${config.port}/`,
      callbackToRegister: config.oauth.redirectUri || null,
      officialSkill: { installed: true, sha256: officialSkill.sha256 },
      cli: {
        setupAttempted,
        installed: cliStatus?.installed ?? null,
        compatible: cliStatus?.compatible ?? null,
      },
      next: config.oauth.enabled
        ? [
            'set_app_key',
            ...(config.oauth.redirectUri ? [] : ['deploy_then_configure_callback']),
            'doctor',
            'configure_access_secret_if_needed',
            'npm_test',
            'npm_start',
          ]
        : ['doctor', 'configure_access_secret_if_needed', 'npm_test', 'npm_start'],
    })}\n`,
  );
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}
