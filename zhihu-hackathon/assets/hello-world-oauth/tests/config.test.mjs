import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { userInterfaces } from '../lib/oauth.mjs';

test('OAuth template has public configuration but no secrets', async () => {
  const text = await readFile(new URL('../hackathon.config.json', import.meta.url), 'utf8');
  const config = JSON.parse(text);
  assert.equal(config.oauth.enabled, true);
  assert.match(config.oauth.appId, /^\d+$/);
  if (config.oauth.redirectUri !== null) {
    const redirectUri = new URL(config.oauth.redirectUri);
    assert.equal(redirectUri.protocol, 'https:');
    assert.ok(redirectUri.pathname.endsWith('/auth/callback'));
    assert.notEqual(redirectUri.hostname, 'localhost');
    assert.notEqual(redirectUri.hostname, '127.0.0.1');
  }
  assert.equal(/appKey|accessSecret|accessToken|authorizationCode/i.test(text), false);
});

test('OAuth template covers five documented user interfaces', () => {
  assert.equal(userInterfaces.length, 5);
  assert.equal(new Set(userInterfaces.map(({ endpoint }) => endpoint)).size, 5);
});
