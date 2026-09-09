import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../src/features/call/transcription/pbx-transcript-qa.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/pbx/pbx-manual-analysis-ui.js', import.meta.url), 'utf8');

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
  assert.match(backend, /Не показывай рассуждения/);
  assert.match(backend, /MAX_ANSWER_TOKENS = 450/);
});

test('PBX call analysis UI is isolated from PBX page CSS with Shadow DOM', () => {
  const pbx = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'));
  assert.ok(pbx?.js.includes('src/pbx/pbx-manual-analysis-ui.js'));
  assert.ok(!pbx?.js.includes('src/pbx/pbx-manual-analysis-polish.js'));
  assert.match(ui, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(ui, /:host\{all:initial\}/);
  assert.match(ui, /\.wb-pbx-manual-run,.wb-pbx-manual-result\{all:unset!important/);
});

test('PBX analysis exposes one arbitrary free-text question field', () => {
  assert.match(ui, /Спросить по разговору/);
  assert.match(ui, /input\.type = 'text'/);
  assert.match(ui, /const ASK = 'PBX_TRANSCRIPT_ASK'/);
  assert.doesNotMatch(ui, /quick-chip|preset-question/i);
});

test('primary PBX presentation contains only agreed analysis facts', () => {
  assert.match(ui, /addFact\(body, 'Причина обращения'/);
  assert.match(ui, /addFact\(body, 'Действия оператора'/);
  assert.match(ui, /addFact\(body, 'Результат'/);
  assert.doesNotMatch(ui, /addFact\(body, 'Следующий шаг'/);
  assert.doesNotMatch(ui, /Расшифровка ·/);
  assert.match(ui, /status === 'ready'\) return \{ text: 'Готово'/);
  assert.match(ui, /badge: '✓'/);
});

test('clicking a result can pin the analysis window and close control releases it', () => {
  assert.match(ui, /pinnedRecordId/);
  assert.match(ui, /Закрепить окно/);
  assert.match(ui, /closeCard\(\)/);
  assert.match(ui, /result\.addEventListener\('click'/);
});
