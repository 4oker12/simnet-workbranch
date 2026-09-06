import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/call-userside-link.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('CALL id links to the real UserSide call-list row id', () => {
  assert.match(source, /https:\/\/userside\.simnet\.kiev\.ua\/message\/call_list#audioRecordId\$\{id\}/);
  assert.match(source, /CALL\s\*#\(\\d\{4,24\}\)/);
  assert.match(source, /target = '_blank'/);
  assert.match(source, /noopener noreferrer/);
});

test('link enhancer is event-driven and does not scan the page continuously', () => {
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(source, /rail\.syncAttention = function syncAttentionWithUsersideLinks/);
});

test('link enhancer loads immediately after the event-center bridge', () => {
  const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  const bridgeIndex = scripts.indexOf('src/ui/call-attention-bridge.js');
  const linkIndex = scripts.indexOf('src/ui/call-userside-link.js');
  assert.ok(bridgeIndex >= 0);
  assert.equal(linkIndex, bridgeIndex + 1);
});
