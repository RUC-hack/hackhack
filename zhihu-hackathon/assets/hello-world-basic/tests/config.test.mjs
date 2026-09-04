import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('basic template excludes OAuth configuration', async () => {
  const config = JSON.parse(await readFile(new URL('../hackathon.config.json', import.meta.url), 'utf8'));
  assert.equal(config.oauth.enabled, false);
  assert.equal('appId' in config.oauth, false);
  assert.equal('redirectUri' in config.oauth, false);
  assert.equal('credentialService' in config.oauth, false);
});
