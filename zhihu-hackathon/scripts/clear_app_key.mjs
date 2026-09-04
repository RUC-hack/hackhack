import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const index = process.argv.indexOf('--project-dir');
const projectDir = index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : null;

if (!projectDir) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'Required: --project-dir.' })}\n`);
  process.exit(2);
}

try {
  const config = JSON.parse(await readFile(path.join(projectDir, 'hackathon.config.json'), 'utf8'));
  if (config.oauth?.enabled !== true) {
    process.stdout.write(`${JSON.stringify({ ok: true, cleared: false, reason: 'oauth_disabled' })}\n`);
    process.exit(0);
  }
  const result = await new Promise((resolve) => {
    execFile(
      '/usr/bin/security',
      ['delete-generic-password', '-s', config.oauth.credentialService, '-a', config.oauth.credentialAccount],
      (error) => resolve({ cleared: !error, alreadyMissing: error?.code === 44 }),
    );
  });
  process.stdout.write(`${JSON.stringify({ ok: result.cleared || result.alreadyMissing, ...result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}
