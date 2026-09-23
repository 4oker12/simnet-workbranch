import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const broker = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');
const brokerRuntimeBase = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-runtime-base.js', import.meta.url), 'utf8');
const brokerSources = `${broker}\n${brokerRuntimeBase}`;
const semantic = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');

test('live degraded path never prepends knowledge reflection', () => {
  assert.match(brokerSources, /const hasLiveToolActivity = toolTrace\.length > 0/);
  assert.match(brokerSources, /generationDegraded && !hasLiveToolActivity/);
  assert.doesNotMatch(brokerSources, /\$\{knowledgeReply\}\\n\\n\$\{String\(delegated\.reply\)/);
});

test('fully covered requested live facts can recover generation failure', () => {
  assert.doesNotMatch(brokerSources, /function allRequestedLiveFactsConfirmed/);
  assert.doesNotMatch(brokerSources, /relevance\?\.gate\?\.reason === 'deterministic_confirmed_facts_recovery'/);
  assert.match(brokerSources, /delegated\?\.evidenceFallback\?\.used/);
  assert.match(brokerSources, /delegated\?\.evidenceFallback\?\.complete/);
  assert.match(brokerSources, /degraded: recoveredFromGenerationFailure \? false/);
  assert.match(brokerSources, /generationDegraded/);
  assert.match(brokerSources, /generationDegradationReason/);
});

test('UNDERSTANDING owns semantic evidence planning without choosing tools', () => {
  assert.match(semantic, /"live_data_need":"none\|needed"/);
  assert.match(semantic, /"evidence_needs"/);
  assert.match(semantic, /факты, а НЕ tools и НЕ команды/);
  assert.match(semantic, /Не пиши названия функций вроде billing\.balance/);
  assert.match(semantic, /liveDataNeed: evidenceNeeds\.length \? 'needed' : liveDataNeed/);
  assert.match(semantic, /evidenceNeeds/);
});
