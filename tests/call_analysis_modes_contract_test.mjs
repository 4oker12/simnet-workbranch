import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const toggle = fs.readFileSync(new URL('../src/ui/call-record-toggle.js', import.meta.url), 'utf8');
const writer = fs.readFileSync(new URL('../src/features/call/transcription/userside-writer.js', import.meta.url), 'utf8');
const postprocessor = fs.readFileSync(new URL('../src/features/call/transcription/ai-postprocessor.js', import.meta.url), 'utf8');
const reanalysis = fs.readFileSync(new URL('../src/features/call/transcription/call-reanalysis.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/ui/call-analysis-actions.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-analysis-actions.js'));
assert.ok(entry.includes("import './features/call/transcription/call-reanalysis.js';"));
assert.ok(messages.includes("CALL_PROCESSING_REANALYZE: 'CALL_PROCESSING_REANALYZE'"));

assert.ok(toggle.includes('Короткий разбор'));
assert.ok(toggle.includes('Глубокий разбор'));
assert.match(toggle, /data-wb-analysis-mode="brief"/);
assert.match(toggle, /data-wb-analysis-mode="deep"/);
assert.ok(toggle.includes('analysisMode: normalizedMode'));
assert.ok(toggle.includes("'registration-submit'"));

assert.ok(postprocessor.includes('export function normalizeAnalysisMode'));
assert.ok(postprocessor.includes('analysisCacheKey(callKey, mode)'));
assert.ok(postprocessor.includes('КОРОТКИЙ РЕЖИМ'));
assert.ok(postprocessor.includes('ГЛУБОКИЙ РЕЖИМ'));
assert.ok(postprocessor.includes('DEEP_COMPLETION_TOKENS'));

assert.ok(writer.includes('AI-разбор звонка CALL #'));
assert.ok(writer.includes('Суть:'));
assert.ok(writer.includes('Причина обращения:'));
assert.ok(writer.includes('Что сделано:'));
assert.ok(writer.includes('Результат:'));
assert.ok(writer.includes('Дальше:'));
assert.doesNotMatch(writer, /Текст:\s*\$\{/);
assert.doesNotMatch(writer, /lines\.push\([^\n]*cleanText/);

assert.ok(reanalysis.includes("import { readTranscript } from './background.js';"));
assert.ok(reanalysis.includes("reanalysisSource = 'saved-transcript'"));
assert.ok(reanalysis.includes('whisperSkipped: true'));
assert.ok(reanalysis.includes('Whisper повторно не запускается'));
assert.doesNotMatch(reanalysis, /\btranscribeRecord\b/);
assert.doesNotMatch(reanalysis, /CALL_TRANSCRIBE_RECORD/);

assert.ok(actions.includes("const REANALYZE = 'CALL_PROCESSING_REANALYZE';"));
assert.ok(actions.includes('Глубокий разбор'));
assert.ok(actions.includes('Whisper повторно не запускался'));

console.log('call analysis modes contract: ok');
