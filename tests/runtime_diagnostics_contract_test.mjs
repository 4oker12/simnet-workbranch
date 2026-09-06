import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('service worker diagnostics persist into the same WB LOG store', async () => {
  const [runtimeLog, pageLog] = await Promise.all([
    read('src/infrastructure/runtime-log.js'),
    read('src/content/namespace.js')
  ]);

  assert.match(runtimeLog, /simnet_workbench_debug_log_v1/);
  assert.match(pageLog, /simnet_workbench_debug_log_v1/);
  assert.match(runtimeLog, /unhandledrejection/);
  assert.match(runtimeLog, /Unhandled worker error/);
  assert.match(runtimeLog, /SENSITIVE_KEY_RE/);
  assert.match(runtimeLog, /\[redacted\]/);
});

test('background entry attaches diagnostics before normal background modules', async () => {
  const source = await read('src/background-entry.js');
  const firstImport = source.split(/\r?\n/).find(line => line.trim().startsWith('import '));
  assert.equal(firstImport?.trim(), "import './infrastructure/runtime-log.js';");
  assert.match(source, /call-processing-diagnostics\.js/);
});

test('CALL diagnostics trace every critical processing stage and terminal failures', async () => {
  const source = await read('src/features/call/transcription/call-processing-diagnostics.js');
  for (const stage of ['pbx', 'audio', 'whisper', 'ai', 'userside']) {
    assert.match(source, new RegExp(`\\b${stage}\\b`));
  }
  assert.match(source, /Цепочка обработки остановлена/);
  assert.match(source, /Обработка ждёт вмешательства/);
  assert.match(source, /Звонок полностью обработан/);
  assert.match(source, /runtimeError/);
  assert.match(source, /runtimeWarn/);
});

test('AI runtime reports handled Groq failures without logging the API key payload', async () => {
  const source = await read('src/ai/runtime-service.js');
  assert.match(source, /runtimeError\('AI RUNTIME'/);
  assert.match(source, /Groq connectivity test · OK/);
  assert.doesNotMatch(source, /runtime(?:Info|Error)\([^\n]+groqApiKey/);
});

test('WB LOG UI supports level and subsystem filtering, text search and multiple sort modes', async () => {
  const source = await read('src/ui/debug-log.js');
  assert.match(source, /data-filter="level"/);
  assert.match(source, /data-filter="scope"/);
  assert.match(source, /data-filter="search"/);
  assert.match(source, /value="severity">Ошибки сверху/);
  assert.match(source, /value="scope">По подсистеме/);
  assert.match(source, /function viewEntries\(/);
  assert.match(source, /searchableText\(entry\)\.includes\(searchQuery\)/);
  assert.match(source, /severityRank\(a\.level\) - severityRank\(b\.level\)/);
  assert.match(source, /Копирование выгружает текущую выборку/);
});
