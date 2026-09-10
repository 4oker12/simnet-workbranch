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

test('CALL hash focuses and highlights the exact UserSide table row', () => {
  assert.match(source, /HASH_RE = \/\^#audioRecordId/);
  assert.match(source, /document\.getElementById\(`audioRecordId\$\{id\}`\)/);
  assert.match(source, /\.closest\('tr'\)/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'center'/);
  assert.match(source, /HIGHLIGHT_CLASS = 'wb-userside-call-target'/);
  assert.match(source, /window\.addEventListener\('hashchange', focusHashCall\)/);
});

test('link enhancer is event-driven and does not scan the page continuously', () => {
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(source, /rail\.syncAttention = function syncAttentionWithUsersideLinks/);
});

test('link enhancer loads immediately after PBX recovery module', () => {
  const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  const bridgeIndex = scripts.indexOf('src/ui/call-attention-bridge.js');
  const recoveryIndex = scripts.indexOf('src/ui/call-pbx-recovery.js');
  const linkIndex = scripts.indexOf('src/ui/call-userside-link.js');
  assert.ok(bridgeIndex >= 0);
  assert.equal(recoveryIndex, bridgeIndex + 1);
  assert.equal(linkIndex, recoveryIndex + 1);
});
