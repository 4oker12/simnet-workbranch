import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../src/features/call/transcription/pbx-transcript-qa.js', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../src/pbx/pbx-manual-analysis-polish.js', import.meta.url), 'utf8');

test('PBX transcript questions are loaded without re-running transcription', () => {
  assert.match(entry, /pbx-transcript-qa\.js/);
  assert.match(backend, /import \{ readTranscript \} from '\.\/background\.js'/);
  assert.doesNotMatch(backend, /transcribeRecord|\/transcribe/);
  assert.match(backend, /callKey: `pbx:\$\{recordId\}`/);
});

test('question prompt is grounded in the saved transcript and retains segment timestamps', () => {
  assert.match(backend, /\[\$\{start\}-\$\{end\}\]/);
  assert.match(backend, /Отвечай только по предоставленной расшифровке звонка/);
  assert.match(backend, /Если нужная информация не упоминалась/);
  assert.match(backend, /MAX_ANSWER_TOKENS = 450/);
});

test('PBX analysis polish exposes one arbitrary free-text question field', () => {
  const pbx = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'));
  assert.ok(pbx?.js.includes('src/pbx/pbx-manual-analysis-polish.js'));
  assert.match(polish, /Спросить по разговору/);
  assert.match(polish, /input\.type = 'text'/);
  assert.match(polish, /PBX_TRANSCRIPT_ASK/);
  assert.doesNotMatch(polish, /Скидки\?\].*Оборудование|quick-chip|preset-question/i);
});

test('compact PBX presentation removes AI branding from primary result state', () => {
  assert.match(polish, /\['AI готов', 'Готово'\]/);
  assert.match(polish, /badge\.textContent = '✓'/);
  assert.match(polish, /Технические данные/);
  assert.match(polish, /data-kind="summary"\].*\.l\{display:none/s);
});
