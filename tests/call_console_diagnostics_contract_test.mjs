import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/call-console-diagnostics.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('call console diagnostics reports exact pipeline context', () => {
  assert.match(source, /PBX recordId не найден/);
  assert.match(source, /Транскрипция не состоялась/);
  assert.match(source, /functionName/);
  assert.match(source, /operation/);
  assert.match(source, /reason/);
  assert.match(source, /lastSuccessfulStage/);
  assert.match(source, /POST http:\/\/127\.0\.0\.1:8090\/transcribe/);
  assert.match(source, /GET https:\/\/pbx\.simnet\.kiev\.ua\/fop2\/getrec\.php\?id=/);
});

test('call console diagnostics is event-driven and deduplicates repeated state', () => {
  assert.match(source, /CALL_PROCESSING_CHANGED/);
  assert.match(source, /const seen = new Map\(\)/);
  assert.match(source, /seen\.get\(key\) === signature/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('call console diagnostics is loaded after call attention bridge', () => {
  const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  const attentionIndex = scripts.indexOf('src/ui/call-attention-bridge.js');
  const diagnosticsIndex = scripts.indexOf('src/ui/call-console-diagnostics.js');
  assert.ok(attentionIndex >= 0);
  assert.equal(diagnosticsIndex, attentionIndex + 1);
});
