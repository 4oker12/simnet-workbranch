import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.safe.json', import.meta.url), 'utf8'));
const router = readFileSync(new URL('../src/ai/provider-router.js', import.meta.url), 'utf8');

const forbiddenHosts = [
  'https://stargroup.helpcrunch.com/*',
  'http://127.0.0.1/*',
  'http://localhost/*',
  'https://api.groq.com/*',
  'https://api.deepseek.com/*'
];

test('SAFE DEMO manifest has no external or loopback host permissions', () => {
  assert.match(String(manifest.version_name || ''), /safe-demo/i);
  for (const host of forbiddenHosts) {
    assert.equal(manifest.host_permissions.includes(host), false, host);
  }
});

test('SAFE DEMO does not inject the HelpCrunch page bridge', () => {
  const matches = manifest.content_scripts.flatMap(entry => entry.matches || []);
  assert.equal(matches.some(match => String(match).includes('stargroup.helpcrunch.com')), false);
});

test('SAFE DEMO service worker has an explicit outbound guard', () => {
  assert.match(router, /SAFE_DEMO_MODE/);
  assert.match(router, /SAFE DEMO blocks external network access/);
});
