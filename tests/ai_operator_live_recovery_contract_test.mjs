import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const broker = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');
const semantic = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');

test('live degraded path never prepends knowledge reflection', () => {
  assert.match(broker, /const hasLiveToolActivity = toolTrace\.length > 0/);
  assert.match(broker, /generationDegraded && !hasLiveToolActivity/);
  assert.doesNotMatch(broker, /\$\{knowledgeReply\}\\n\\n\$\{String\(delegated\.reply\)/);
});

test('fully confirmed requested live facts can recover generation failure', () => {
  assert.match(broker, /function allRequestedLiveFactsConfirmed/);
  assert.match(broker, /relevance\?\.gate\?\.reason === 'deterministic_confirmed_facts_recovery'/);
  assert.match(broker, /degraded: recoveredFromGenerationFailure \? false/);
  assert.match(broker, /generationDegraded/);
  assert.match(broker, /generationDegradationReason/);
});

test('UNDERSTANDING owns semantic evidence planning without choosing tools', () => {
  assert.match(semantic, /"live_data_need":"none\|needed"/);
  assert.match(semantic, /"evidence_needs"/);
  assert.match(semantic, /факты, а НЕ tools и НЕ команды/);
  assert.match(semantic, /Не пиши названия функций вроде billing\.balance/);
  assert.match(semantic, /liveDataNeed: evidenceNeeds\.length \? 'needed' : liveDataNeed/);
  assert.match(semantic, /evidenceNeeds/);
});
