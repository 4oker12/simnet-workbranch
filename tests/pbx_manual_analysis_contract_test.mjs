import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = readFileSync(new URL('../src/features/call/transcription/pbx-manual-analysis.js', import.meta.url), 'utf8');
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
