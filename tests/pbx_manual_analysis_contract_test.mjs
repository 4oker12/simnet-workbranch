import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = readFileSync(new URL('../src/features/call/transcription/pbx-manual-analysis.js', import.meta.url), 'utf8');
const transcriber = readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../src/features/call/transcription/ai-postprocessor.js', import.meta.url), 'utf8');
const messages = readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/pbx/pbx-manual-analysis-ui.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/pbx/pbx-workbench-shell.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

test('PBX history receives a dedicated manual-analysis content script', () => {
  const pbx = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'));
  assert.ok(pbx, 'PBX content-script block missing');
  assert.ok(pbx.js.includes('src/pbx/pbx-manual-analysis-ui.js'));
});

test('manual PBX analysis reuses transcription, AI and canonical CallRecord state', () => {
  assert.match(background, /CallStateStore/);
  assert.match(background, /callExecutionRegistry/);
  assert.match(background, /import \{ readTranscript, transcribeRecord \} from '\.\/background\.js'/);
  assert.match(background, /import \{ postprocessTranscript \} from '\.\/ai-postprocessor\.js'/);
  assert.match(entry, /pbx-manual-analysis\.js/);
  assert.doesNotMatch(background, /simnet_workbench_pbx_manual_analysis_jobs_v1/);
  assert.doesNotMatch(background, /save_call|CALL_REGISTRATION_SUBMIT|writeTranscriptToUserSide/);
});

test('PBX record becomes the same global call object instead of a second persisted job', () => {
  assert.match(background, /CallStateStore\.ensurePbx/);
  assert.match(background, /stored\.callKey/);
  assert.match(ui, /PBX_MANUAL_ANALYSIS_START/);
  assert.match(ui, /CALL_PROCESSING_CHANGED/);
  assert.match(ui, /run\.addEventListener\('click'/);
  assert.doesNotMatch(ui, /simnet_workbench_pbx_manual_analysis_jobs_v1/);
  assert.doesNotMatch(shell, /simnet_workbench_pbx_manual_analysis_jobs_v1/);
  assert.match(shell, /PBX_MANUAL_ANALYSIS_STATUS/);
  assert.doesNotMatch(ui, /setInterval\(/);
});

test('PBX hover result exposes AI summary, transcript and exact Groq token usage', () => {
  assert.match(ui, /record\.analysis\?\.summary/);
  assert.match(ui, /record\.analysis\?\.issue/);
  assert.match(ui, /record\.analysis\?\.actions/);
  assert.match(ui, /record\.analysis\?\.nextStep/);
  assert.match(ui, /AI \/ токены/);
  assert.match(ui, /totalTokens/);
  assert.match(ui, /promptTokens/);
  assert.match(ui, /completionTokens/);
  assert.match(ai, /data\?\.usage/);
  assert.match(ai, /usageAttempts/);
  assert.match(ai, /sumUsage/);
  assert.match(ai, /BRIEF_COMPLETION_TOKENS = 3200/);
  assert.match(ai, /isPlaceholderFact/);
  assert.match(ai, /заглушки вместо анализа/);
  assert.match(ui, /Транскрипт/);
  assert.doesNotMatch(ui, /CALL_REGISTRATION_SUBMIT|save_call/);
});

test('manual processing can be cancelled and continued from the PBX row', () => {
  assert.match(messages, /PBX_MANUAL_ANALYSIS_CANCEL/);
  assert.match(background, /callExecutionRegistry\.cancel/);
  assert.match(ui, /const CANCEL = 'PBX_MANUAL_ANALYSIS_CANCEL'/);
  assert.match(ui, /Отменить текущую обработку/);
  assert.match(ui, /Продолжить\/перезапустить разбор этого звонка/);
  assert.match(ui, /ACTIVE_STATUSES\.has\(record\.status\)/);
});

test('PBX manual UI is one-shot and event-driven, without MutationObserver rescans', () => {
  assert.match(ui, /function mountCurrentPage\(\)/);
  assert.match(ui, /mountCurrentPage\(\);/);
  assert.match(ui, /chrome\.runtime\.onMessage\.addListener/);
  assert.doesNotMatch(ui, /MutationObserver/);
  assert.doesNotMatch(ui, /mutationNeedsScan/);
  assert.doesNotMatch(ui, /scanTimer/);
});

test('manual controls keep a stable footprint while state badge changes', () => {
  assert.match(ui, /\.wb-pbx-manual-tools\{[^}]*width:52px/);
  assert.match(ui, /data-state="idle"\]\{visibility:hidden/);
});

test('stale runtime state is represented on the CallRecord and can be recovered', () => {
  assert.match(background, /status === 'interrupted'/);
  assert.match(ui, /record\.status === 'interrupted'/);
});

test('cancel signal propagates through Whisper HTTP and Groq requests', () => {
  assert.match(transcriber, /transcribeRecord\(payload = \{\}, onProgress = null, signal = null\)/);
  assert.match(transcriber, /fetchWithTimeout\(`\$\{config\.baseUrl\}\/transcribe`/);
  assert.match(ai, /postprocessTranscript\(job = \{\}, transcript = \{\}, signal = null\)/);
  assert.match(ai, /externalSignal\.addEventListener\('abort'/);
});
