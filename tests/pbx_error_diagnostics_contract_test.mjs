import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pbx/pbx-error-diagnostics.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('PBX diagnostics exposes failed stage, function, request, trigger and cause', () => {
  assert.match(source, /<b>Этап:<\/b>/);
  assert.match(source, /<b>Функция:<\/b>/);
  assert.match(source, /<b>Сломанный вызов:<\/b>/);
  assert.match(source, /<b>Что запустило:<\/b>/);
  assert.match(source, /<b>Последний успешный этап:<\/b>/);
  assert.match(source, /<b>Причина:<\/b>/);
  assert.match(source, /transcribeRecord\(\)/);
  assert.match(source, /postprocessTranscript\(\)/);
  assert.match(source, /writeTranscriptToUserSide\(\)/);
});

test('PBX diagnostics reads persisted CallRecord failures and stays event-driven', () => {
  assert.match(source, /simnet_workbench_state_v5/);
  assert.match(source, /CALL_PROCESSING_CHANGED/);
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('PBX diagnostics loads after PBX shell so it can extend the existing panel', () => {
  const pbxEntry = manifest.content_scripts.find(entry => (entry.matches || []).includes('https://pbx.simnet.kiev.ua/*'));
  const scripts = pbxEntry?.js || [];
  const shellIndex = scripts.indexOf('src/pbx/pbx-workbench-shell.js');
  const diagnosticsIndex = scripts.indexOf('src/pbx/pbx-error-diagnostics.js');
  assert.ok(shellIndex >= 0);
  assert.equal(diagnosticsIndex, shellIndex + 1);
});
