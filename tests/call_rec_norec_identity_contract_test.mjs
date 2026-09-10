import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const toggle = fs.readFileSync(new URL('../src/ui/call-record-toggle.js', import.meta.url), 'utf8');
const identityUx = fs.readFileSync(new URL('../src/ui/call-registration-identity-ux.js', import.meta.url), 'utf8');

const mainScripts = manifest.content_scripts?.find(item =>
  Array.isArray(item.matches) && item.matches.includes('https://userside.simnet.kiev.ua/*')
)?.js || [];

test('REC/NOREC policy is visibly loaded and survives lazy ShadowRoot rendering', () => {
  const toggleIndex = mainScripts.indexOf('src/ui/call-record-toggle.js');
  const uxIndex = mainScripts.indexOf('src/ui/call-registration-identity-ux.js');
  assert.ok(toggleIndex >= 0, 'REC/NOREC toggle must be loaded on UserSide');
  assert.ok(uxIndex > toggleIndex, 'identity UX patch must load after the REC/NOREC policy');
  assert.match(toggle, />NOREC<\/button>/);
  assert.match(toggle, />REC<\/button>/);
  assert.match(toggle, /shadowObserver\.observe\(shadow, \{ childList: true, subtree: true \}\)/);
  assert.match(toggle, /mode: enabled !== false \? 'REC' : 'NOREC'/);
});

test('record linkage follows the selected call target instead of a random opened card', () => {
  assert.match(toggle, /target\?\.customerId/);
  assert.match(toggle, /binding\?\.customerId/);
  assert.match(toggle, /focusCall\?\.customerId/);
  assert.match(toggle, /target\?\.isCurrentCase === true \? registration\?\.caseSnapshot\?\.customerId : ''/);
});

test('registration header identifies the call, not merely the currently opened subscriber card', () => {
  assert.match(identityUx, /CALL #\$\{callId\}/);
  assert.match(identityUx, /Открытая карточка абонента сама по себе звонок не привязывает/);
  assert.doesNotMatch(identityUx, /caseSnapshot\?\.fullName|caseSnapshot\?\.contract/);
});

test('history exposes canonical CALL to PBX linkage and subtle inferred-source marker', () => {
  assert.match(identityUx, /UserSide CALL #\$\{callId\}/);
  assert.match(identityUx, /PBX recordId \$\{recordId\}/);
  assert.match(identityUx, /digits\(call\.customerId, 14\).*return 'direct'/s);
  assert.match(identityUx, /return 'inferred'/);
  assert.match(identityUx, /◇ WB/);
  assert.match(identityUx, /PBX ✓/);
});
