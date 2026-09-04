import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function projectDirFromArgs() {
  const index = process.argv.indexOf('--project-dir');
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : null;
}

function deleteExisting(service, account) {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], () => resolve());
  });
}

function addSecretInteractively(service, account) {
  return new Promise((resolve) => {
    const child = spawn(
      '/usr/bin/security',
      ['add-generic-password', '-U', '-s', service, '-a', account, '-w'],
      { stdio: 'inherit' },
    );
    child.on('close', (exitCode) => resolve({ ok: exitCode === 0, exitCode }));
  });
}

try {
  if (process.platform !== 'darwin') throw new Error('This Skill currently supports secure app_key storage on macOS only.');
  const projectDir = projectDirFromArgs();
  if (!projectDir) throw new Error('Required: --project-dir.');
  const config = JSON.parse(await readFile(path.join(projectDir, 'hackathon.config.json'), 'utf8'));
  if (config.oauth?.enabled !== true) throw new Error('OAuth is disabled for this project.');
  await deleteExisting(config.oauth.credentialService, config.oauth.credentialAccount);
  const result = await addSecretInteractively(config.oauth.credentialService, config.oauth.credentialAccount);
  if (!result.ok) throw new Error('Unable to store app_key in macOS Keychain.');
  process.stdout.write(`${JSON.stringify({ ok: true, configured: true, storage: 'macOS Keychain' })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}
