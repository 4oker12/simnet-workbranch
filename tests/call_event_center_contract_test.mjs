import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../src/ui/call-attention-bridge.js', import.meta.url), 'utf8');
const processing = readFileSync(new URL('../src/features/call/transcription/call-processing.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('call processing is surfaced through the bell event center', () => {
  assert.match(bridge, /<b>Центр событий<\/b>/);
  assert.match(bridge, /Требуют внимания/);
  assert.match(bridge, /В работе/);
  assert.match(bridge, /История/);
  assert.match(bridge, /data-call-action="retry"/);
  assert.match(bridge, /data-call-action="cancel"/);
  assert.match(bridge, /data-call-action="dismiss"/);
  assert.match(bridge, />Повторить<\/button>/);
  assert.match(bridge, />Отменить<\/button>/);
  assert.match(bridge, />Скрыть<\/button>/);
});

test('event center binds actions after the rail shadow root is mounted', () => {
  assert.match(bridge, /function ensureBindings\(\)/);
  assert.match(bridge, /rail\.shadow\.addEventListener\('click', handleShadowClick, true\)/);
  assert.match(bridge, /ensureBindings\(\);/);
  assert.doesNotMatch(bridge, /rail\.shadow\?\.addEventListener\('click'/);
});

test('bell counter counts attention only, not successful or queued calls', () => {
  assert.match(bridge, /const attentionCalls = calls\.filter\(call => call\.needsAttention\)/);
  assert.match(bridge, /const count = baseItems\.length \+ attentionCalls\.length/);
  assert.doesNotMatch(bridge, /calls\.filter\(call => call\.status === 'DONE'\).*count/s);
  assert.doesNotMatch(bridge, /WORK_STATUSES.*count/s);
});

test('work tab is a FIFO queue and history contains only calls outside active work', () => {
  assert.match(bridge, /const WORK_STATUSES = new Set/);
  assert.match(bridge, /'QUEUED'/);
  assert.match(bridge, /function isWorkCall\(/);
  assert.match(bridge, /function isHistoryCall\(/);
  assert.match(bridge, /function sortQueue\(/);
  assert.match(bridge, /queueTime\(a\) - queueTime\(b\)/);
  assert.match(bridge, /calls\.filter\(isWorkCall\)/);
  assert.match(bridge, /calls\.filter\(isHistoryCall\)/);
  assert.match(bridge, /Ожидает завершения предыдущего звонка/);
  assert.match(bridge, /Обработка завершена\. Звонок находится в истории/);
});

test('PBX waiting and queued states are separated', () => {
  assert.match(processing, /if \(!call\.pbxRecordId\) return 'WAIT_PBX'/);
  assert.match(processing, /lastSuccessfulStage \|\| ''\) !== 'pbx'/);
  assert.match(processing, /execution\?\.state === 'queued'\s*\? 'QUEUED'/s);
  assert.match(processing, /&& !execution\s*&& ageMs >= AUTO_LOCK_WINDOW_MS/s);
  assert.match(bridge, /status === 'WAIT_PBX' && call\.needsAttention && !call\.pbxRecordId/);
});

test('retry stays inside the FIFO executor and reuses a saved transcript', () => {
  assert.match(processing, /\['cancelled', 'stale', 'failed'\]\.includes/);
  assert.match(processing, /p\.state = 'waiting'/);
  assert.match(processing, /if \(initial\.transcript\?\.storageKey && !force\)/);
  assert.match(processing, /const cached = await readTranscript\(\{ callKey: key \}\)/);
  assert.match(processing, /return processUsersideWrite\(key, cached, signal\)/);
  assert.match(processing, /return processCall\(callKey, \{ force: force === true \}\)/);
  assert.doesNotMatch(processing, /if \(call\?\.transcript\?\.storageKey\)\s*\{\s*return processUsersideWrite\(callKey\)/s);
});

test('service worker restart requeues interrupted calls instead of waiting for a stale timeout', () => {
  assert.match(processing, /async function recoverInterruptedCalls\(\)/);
  assert.match(processing, /requeued_after_worker_restart/);
  assert.match(processing, /прервано перезапуском Service Worker; возвращено в очередь/);
  assert.match(processing, /await recoverInterruptedCalls\(\);\s*await syncRegisteredCalls\(\);/);
  assert.doesNotMatch(processing, /STALE_RUNNING_MS/);
});

test('automatic queue starts cannot leak unhandled rejections', () => {
  assert.match(processing, /function reportAutoStartFailure\(/);
  assert.match(processing, /processCall\(callKey\)\.catch\(error => reportAutoStartFailure\(callKey, error\)\)/);
});

test('legacy left CALL jobs panel is not injected', () => {
  const contentScripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  assert.ok(contentScripts.includes('src/ui/call-attention-bridge.js'));
  assert.ok(!contentScripts.some(path => /call-transcription-jobs/i.test(path)));
  assert.doesNotMatch(bridge, /CALL jobs/i);
});
