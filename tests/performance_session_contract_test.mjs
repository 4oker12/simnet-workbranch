import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const entry = read('src/background-entry.js');
const messages = read('src/shared/messages.js');
const probe = read('src/core/perf-probe.js');
const popupHtml = read('src/ui/popup.html');
const popupJs = read('src/ui/popup.js');
const background = read('src/features/performance/background.js');

test('the passive probe is loaded on every supported CRM page', () => {
  const content = manifest.content_scripts.find(item => item.js?.includes('src/content/bootstrap.js'));
  assert.ok(content?.js?.includes('src/core/perf-probe.js'));
  assert.ok(entry.includes("./features/performance/background.js"));
  assert.match(probe, /PerformanceObserver/);
  assert.match(probe, /SESSION_FLUSH_MS\s*=\s*60\s*\*\s*1000/);
  assert.match(probe, /getBytesInUse/);
});

test('performance sessions use an explicit continuous message contract', () => {
  for (const type of [
    'PERF_SESSION_START',
    'PERF_SESSION_SAMPLE',
    'PERF_SESSION_STATUS',
    'PERF_SESSION_FINISH',
    'PERF_SESSION_EXPORT',
    'PERF_SESSION_FLUSH'
  ]) {
    assert.match(messages, new RegExp(`${type}: '${type}'`));
  }
  assert.match(background, /serialized/);
  assert.match(background, /session-mismatch/);
  assert.match(background, /AUTO_START/);
  assert.doesNotMatch(background, /deadlinePassed/);
});

test('popup creates an on-demand snapshot while passive collection keeps running', () => {
  assert.match(popupHtml, /Фоновая производительность/);
  assert.match(popupHtml, /Снять слепок и скачать/);
  assert.match(popupHtml, /Слепок не останавливает сбор/);
  assert.doesNotMatch(popupHtml, /30 мин/);
  assert.match(popupJs, /PERF_SESSION_EXPORT/);
  assert.match(popupJs, /PERF_SESSION_FLUSH/);
  assert.doesNotMatch(popupJs, /PERF_SESSION_DURATION_MS/);
  assert.doesNotMatch(probe, /sessionDeadlineTimer/);
});

test('exact Workbench action timings are retained in the exported timeline', () => {
  assert.match(probe, /captureSessionOperation/);
  assert.match(probe, /operations:\s*rotated\.operations/);
  assert.match(popupHtml, /точная хронология действий/);
});

test('route collection strips identifiers and does not retain query strings', () => {
  assert.match(probe, /replace\(\/\\d\{3,\}\/g, ':id'\)/);
  assert.match(probe, /\['a', 'section', 'tab'\]/);
  assert.doesNotMatch(probe, /searchParams\.toString/);
});
