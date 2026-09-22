import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const lab = read('src/features/ai-operator/lab-background.js');
const batch = read('src/features/ai-operator/lab-batch-background.js');
const entry = read('src/background-entry.js');
const html = read('src/ui/settings.html');
const ui = read('src/ui/ai-operator-batch.js');

assert.match(lab, /export\s+async\s+function\s+runIsolatedLabCase\s*\(/, 'Lab must export an isolated full-pipeline case runner.');
assert.doesNotMatch(lab, /toLegacyBehaviorCompatibility|runtimeBehavior\s*\(/, 'Lab must no longer translate native behavior back to legacy scales.');
assert.match(lab, /behavior:\s*lab\.behavior/, 'Full Lab pipeline must pass the native behavior profile to semantic runtime.');

assert.match(batch, /const MAX_CASES = 20;/, 'Batch size must stay bounded at 20 cases.');
for (const type of ['AI_OPERATOR_BATCH_GENERATE', 'AI_OPERATOR_BATCH_RUN', 'AI_OPERATOR_BATCH_GET', 'AI_OPERATOR_BATCH_CLEAR']) {
  assert.ok(batch.includes(type), `Missing batch message type ${type}`);
}
assert.match(batch, /runIsolatedLabCase\s*\(/, 'Batch must use the same isolated full Lab pipeline.');
assert.match(batch, /toolState:\s*clone\(baseToolState\)/, 'Every variant must receive an independent copy of the same starting tool state.');
assert.doesNotMatch(batch, /helpcrunch[^\n]{0,80}send/i, 'Batch runtime must not enable HelpCrunch SEND.');

const providerIndex = entry.indexOf("import './ai/provider-router.js';");
const batchIndex = entry.indexOf("import './features/ai-operator/lab-batch-background.js';");
assert.ok(providerIndex >= 0 && batchIndex > providerIndex, 'Provider router must load before batch runtime.');
assert.ok(entry.includes("import './features/ai-operator/lab-background.js';"), 'Lab runtime import is required.');
assert.ok(batchIndex > entry.indexOf("import './features/ai-operator/lab-background.js';"), 'Batch runtime must load after Lab runtime.');

for (const id of ['aiBatchSeed', 'aiBatchCount', 'aiBatchVariants', 'aiBatchGenerate', 'aiBatchRun', 'aiBatchExport', 'aiBatchClear', 'aiBatchStatus', 'aiBatchSummary', 'aiBatchResults']) {
  assert.ok(html.includes(`id=\"${id}\"`), `Settings must expose ${id}.`);
}
assert.ok(html.includes('ai-operator-batch.css'), 'Settings must load batch CSS.');
assert.ok(html.includes('ai-operator-batch.js'), 'Settings must load batch UI JS.');
assert.match(ui, /AI_OPERATOR_BATCH_GENERATE/);
assert.match(ui, /AI_OPERATOR_BATCH_RUN/);
assert.match(ui, /AI_OPERATOR_BATCH_CLEAR/);
assert.match(ui, /Blob\(\[JSON\.stringify\(lastBatch/, 'Batch UI must export complete JSON results.');

console.log('AI Operator batch Lab contract: OK');
