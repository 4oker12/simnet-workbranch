import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = readFileSync(new URL('../src/features/call/transcription/pbx-manual-analysis.js', import.meta.url), 'utf8');
const transcriber = readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../src/features/call/transcription/ai-postprocessor.js', import.meta.url), 'utf8');
const messages = readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/pbx/pbx-manual-analysis-ui.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

test('PBX history receives a dedicated manual-analysis content script', () => {
  const pbx = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'));
  assert.ok(pbx, 'PBX content-script block missing');
  assert.ok(pbx.js.includes('src/pbx/pbx-manual-analysis-ui.js'));
});

test('manual PBX analysis reuses the PR9 transcription and AI pipeline', () => {
  assert.match(background, /import \{ transcribeRecord \} from '\.\/background\.js'/);
  assert.match(background, /import \{ postprocessTranscript \} from '\.\/ai-postprocessor\.js'/);
  assert.match(entry, /pbx-manual-analysis\.js/);
  assert.doesNotMatch(background, /save_call|CALL_REGISTRATION_SUBMIT|writeTranscriptToUserSide/);
});

test('manual analysis is keyed by PBX record id and stays user-triggered', () => {
  assert.match(background, /callKey: `pbx:\$\{recordId\}`/);
  assert.match(ui, /PBX_MANUAL_ANALYSIS_START/);
  assert.match(ui, /run\.addEventListener\('click'/);
  assert.doesNotMatch(ui, /setInterval\(/);
});

test('PBX hover result exposes AI summary and transcript without UserSide submit', () => {
  assert.match(ui, /job\.analysis\?\.summary/);
  assert.match(ui, /job\.analysis\?\.issue/);
  assert.match(ui, /job\.analysis\?\.actions/);
  assert.match(ui, /job\.analysis\?\.nextStep/);
  assert.match(ui, /Транскрипт/);
  assert.doesNotMatch(ui, /CALL_REGISTRATION_SUBMIT|save_call/);
});

test('running manual jobs can be cancelled and restarted from the PBX row', () => {
  assert.match(messages, /PBX_MANUAL_ANALYSIS_CANCEL/);
  assert.match(background, /new AbortController\(\)/);
  assert.match(background, /active\.controller\.abort\('operator-cancel'\)/);
  assert.match(ui, /const CANCEL = 'PBX_MANUAL_ANALYSIS_CANCEL'/);
  assert.match(ui, /Отменить текущую обработку/);
  assert.match(ui, /Перезапустить разбор этого звонка/);
  assert.match(ui, /ACTIVE_STATUSES\.has\(job\.status\)/);
});

test('stale persisted busy jobs are recovered instead of staying AI… forever', () => {
  assert.match(background, /reconcileInterruptedJobs/);
  assert.match(background, /status: 'interrupted'/);
  assert.match(background, /Service Worker перезапустился/);
  assert.match(ui, /job\.status === 'interrupted'/);
});

test('cancel signal propagates through Whisper HTTP and Groq requests', () => {
  assert.match(transcriber, /transcribeRecord\(payload = \{\}, onProgress = null, signal = null\)/);
  assert.match(transcriber, /fetchWithTimeout\(`\$\{config\.baseUrl\}\/transcribe`/);
  assert.match(ai, /postprocessTranscript\(job = \{\}, transcript = \{\}, signal = null\)/);
  assert.match(ai, /externalSignal\.addEventListener\('abort'/);
});
