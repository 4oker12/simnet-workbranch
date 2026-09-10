import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const journal = readFileSync(new URL('../src/ui/journal-unified.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/ui/settings-enhancer.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/ai/runtime-service.js', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../src/ai/usage-ledger.js', import.meta.url), 'utf8');
const transcriptQa = readFileSync(new URL('../src/features/call/transcription/pbx-transcript-qa.js', import.meta.url), 'utf8');

test('rail journal is the single user-facing log surface', () => {
  const scripts = manifest.content_scripts.find(item => item.matches?.includes('https://userside.simnet.kiev.ua/*'))?.js || [];
  assert.ok(scripts.includes('src/ui/journal-unified.js'));
  assert.ok(!scripts.includes('src/ui/debug-log.js'));
  assert.ok(scripts.indexOf('src/ui/journal-unified.js') > scripts.indexOf('src/ui/rail.js'));
});

test('unified journal merges system logs and case journals without creating another persistent store', () => {
  assert.match(journal, /WB\.log\?\.recent/);
  assert.match(journal, /state\?\.cases/);
  assert.match(journal, /caseData\?\.journal/);
  assert.match(journal, /Все события/);
  assert.match(journal, /Этот абонент/);
  assert.match(journal, /Все источники/);
  assert.match(journal, /Все уровни/);
  assert.doesNotMatch(journal, /chrome\.storage\.local\.set/);
});

test('settings shows cumulative AI token usage returned by the runtime', () => {
  assert.match(settings, /data-ai-usage/);
  assert.match(settings, /Σ \$\{tokenNumber\(total\)\} ток\./);
  assert.match(settings, /AI_USAGE_LEDGER_KEY/);
  assert.match(runtime, /readAiUsageTotals/);
  assert.match(runtime, /usage/);
});

test('AI usage ledger covers companion, call analysis and transcript Q&A', () => {
  assert.match(ledger, /simnet_workbench_ai_usage_ledger_v1/);
  assert.match(ledger, /simnet_workbench_ai_sessions_v1/);
  assert.match(ledger, /simnet_workbench_call_ai_analysis_v1/);
  assert.match(ledger, /companion/);
  assert.match(ledger, /callAnalysis/);
  assert.match(ledger, /transcriptQa/);
  assert.match(ledger, /positiveDelta/);
  assert.match(ledger, /analysisSeen/);
});

test('PBX transcript questions add successful Groq usage to the global ledger', () => {
  assert.match(transcriptQa, /recordAiUsage/);
  assert.match(transcriptQa, /recordAiUsage\('transcript-qa', usage\)/);
  assert.match(transcriptQa, /normalizeUsage\(data\?\.usage/);
});
