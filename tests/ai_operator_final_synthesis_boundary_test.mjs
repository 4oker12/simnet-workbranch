import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-core.js', import.meta.url), 'utf8');

test('final synthesis receives the real pre-tool draft, never an injected fallback', () => {
  assert.match(source, /const rawDraftReply = block\(draft\?\.reply, 2200\)/);
  assert.match(source, /const safeDraft = ensureNonEmptyReply\(rawDraftReply, analysis, cycle\.trace\)/);
  assert.match(
    source,
    /synthesisMessages\(\{ transcript, latestCustomer, analysis, draft: \{ \.\.\.draft, reply: rawDraftReply \}, toolTrace: cycle\.trace, useKnowledge \}\)/
  );
  assert.doesNotMatch(
    source,
    /synthesisMessages\([^]*draft: \{ \.\.\.draft, reply: safeDraft \}/,
    'subscriber fallback text must not masquerade as a model draft inside final synthesis'
  );
});

test('Billing evidence is projected before final synthesis', () => {
  assert.match(source, /function synthesisEvidenceData\(/);
  assert.match(source, /item\?\.tool === 'billing\.balance'/);
  assert.match(source, /'accountBalance'/);
  assert.match(source, /item\?\.tool === 'billing\.tariff'/);
  assert.match(source, /'currentTariff'/);
  assert.match(source, /data: synthesisEvidenceData\(item\)/);
  assert.match(source, /requested_by: compactObject\(item\.requestedBy \|\| \{\}\)/);
});

test('final synthesis is instructed not to leak adjacent returned fields', () => {
  assert.match(source, /соседние возвращённые поля не обязаны попадать в ответ/);
  assert.match(source, /не перечисляй договор, access\/service state, тип подключения/);
});
