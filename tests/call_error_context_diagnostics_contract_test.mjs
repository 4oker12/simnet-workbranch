import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const eventCenter = readFileSync(new URL('../src/ui/call-error-context-ui.js', import.meta.url), 'utf8');
const consoleDiag = readFileSync(new URL('../src/ui/call-console-diagnostics.js', import.meta.url), 'utf8');
const fetchDiag = readFileSync(new URL('../src/features/call/transcription/transcriber-fetch-diagnostics.js', import.meta.url), 'utf8');
const backgroundEntry = readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

test('event center renders concrete stage, function, operation, last success and cause', () => {
  assert.match(eventCenter, /<b>Этап:<\/b>/);
  assert.match(eventCenter, /<b>Функция:<\/b>/);
  assert.match(eventCenter, /<b>Вызов:<\/b>/);
  assert.match(eventCenter, /<b>Последний успешный этап:<\/b>/);
  assert.match(eventCenter, /<b>Причина:<\/b>/);
  assert.match(eventCenter, /POST http:\/\/127\.0\.0\.1:8090\/transcribe/);
  assert.match(eventCenter, /HTTP 4xx\/5xx не получен/);
});

test('console diagnostics seeds historical failures on startup instead of replaying them', () => {
  assert.match(consoleDiag, /if \(reason === 'startup'\)/);
  assert.match(consoleDiag, /for \(const call of calls\) remember\(call\)/);
  assert.match(consoleDiag, /CALL_PROCESSING_CHANGED/);
});

test('transcriber fetch diagnostics probes health after network failure', () => {
  assert.match(fetchDiag, /pathname === '\/transcribe'/);
  assert.match(fetchDiag, /new URL\('\/health', url\.origin\)/);
  assert.match(fetchDiag, /Локальный SSH-туннель\/listener\/backend недоступен/);
  assert.match(fetchDiag, /health отвечает OK, но POST \/transcribe оборвался/);
  assert.match(backgroundEntry, /transcriber-fetch-diagnostics\.js/);
});

test('call error context UI loads after call-userside-link so it extends the final event-center render', () => {
  const entry = manifest.content_scripts.find(item => (item.matches || []).includes('https://userside.simnet.kiev.ua/*'));
  const scripts = entry?.js || [];
  const linkIndex = scripts.indexOf('src/ui/call-userside-link.js');
  const diagIndex = scripts.indexOf('src/ui/call-error-context-ui.js');
  assert.ok(linkIndex >= 0);
  assert.equal(diagIndex, linkIndex + 1);
});
