import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/call-pbx-recovery.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/features/call/userside-call-list-bridge.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('UserSide parser binds CALL id and PBX recordId from the same rendered row', () => {
  assert.match(bridge, /getrec\.php\\\?id=\(\[0-9\]\{9,12\}\\\.\[0-9\]\{1,12\}\)/);
  assert.match(bridge, /loadRecordFile\\\(\\s\*\(\\d\+\)\\s\*,/);
  assert.match(bridge, /recordId,/);
  assert.match(bridge, /usersideCallId,/);
});

test('WAIT_PBX recovery performs bounded fresh UserSide call-list refresh and resumes exact callKey', () => {
  assert.match(source, /MAX_ATTEMPTS = 6/);
  assert.match(source, /PBX_RECENT_CALLS_QUERY/);
  assert.match(source, /fresh: true/);
  assert.match(source, /forceRefresh: true/);
  assert.match(source, /current\?\.pbxRecordId/);
  assert.match(source, /await request\(RETRY, \{ callKey: key \}\)/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test('PBX recovery content script is loaded after event-center bridge', () => {
  const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  const bridgeIndex = scripts.indexOf('src/ui/call-attention-bridge.js');
  const recoveryIndex = scripts.indexOf('src/ui/call-pbx-recovery.js');
  assert.ok(bridgeIndex >= 0);
  assert.equal(recoveryIndex, bridgeIndex + 1);
});
