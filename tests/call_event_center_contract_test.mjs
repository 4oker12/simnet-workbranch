import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../src/ui/call-attention-bridge.js', import.meta.url), 'utf8');
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

test('bell counter counts attention only, not successful calls', () => {
  assert.match(bridge, /const callAttention = calls\.filter\(call => call\.needsAttention\)/);
  assert.match(bridge, /const count = baseItems\.length \+ callAttention\.length/);
  assert.doesNotMatch(bridge, /calls\.filter\(call => call\.status === 'DONE'\).*count/s);
});

test('legacy left CALL jobs panel is not injected', () => {
  const contentScripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  assert.ok(contentScripts.includes('src/ui/call-attention-bridge.js'));
  assert.ok(!contentScripts.some(path => /call-transcription-jobs/i.test(path)));
  assert.doesNotMatch(bridge, /CALL jobs/i);
});
