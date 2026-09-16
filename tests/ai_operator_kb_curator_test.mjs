import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const curator = fs.readFileSync(new URL('../src/ui/ai-operator-kb-curator.js', import.meta.url), 'utf8');
const lightCss = fs.readFileSync(new URL('../src/ui/settings-light.css', import.meta.url), 'utf8');

// The curator must actually load in the Lab page.
assert.match(html, /<script src="ai-operator-kb-curator\.js"><\/script>/);

// Syntax guard for the classic extension-page script.
assert.doesNotThrow(() => new Function(curator), 'knowledge curator script must remain syntactically valid');

// Saved entries must keep enough context to merge them into the right KB section later.
assert.match(curator, /simnet_ai_operator_kb_gap_queue_v1/);
for (const field of [
  'proposedKnowledge',
  'operatorSource',
  'question',
  'whatUserWants',
  'knowledgeNeed',
  'knowledgeReason',
  'knowledgeGaps',
  'mustNotAssume',
  'usedArticles',
  'subscriberDataNeeded',
  'verificationNeeded',
  'toolTrace',
  'reply'
]) {
  assert.match(curator, new RegExp(`\\b${field}\\b`), `curator export must preserve ${field}`);
}
assert.match(curator, /AI_OPERATOR_LAB_GET/);
assert.match(curator, /Экспорт JSON/);
assert.match(curator, /simnet-ai-kb-gap-queue-/);
assert.match(curator, /schema:\s*'simnet-ai-kb-gap-queue\/v1'/);
assert.match(curator, /queue\.slice\(-500\)/, 'curation queue must be bounded');
assert.match(curator, /MutationObserver/, 'current gap should refresh after a Lab turn without polling timers');
assert.doesNotMatch(curator, /setInterval\s*\(/, 'curator must not use an endless polling timer');

// Contrast and warning state must be explicit instead of relying on pale inherited colors.
assert.match(lightCss, /\.ai-kb-curator\.has-gap/);
assert.match(lightCss, /background:#fff4d6/);
assert.match(lightCss, /\.ai-lab-diagnostic-row\.warn/);
assert.match(lightCss, /color:#6f4a00/);
assert.match(lightCss, /\.ai-kb-curator-input:focus/);

console.log('ai_operator_kb_curator_test: PASS');
