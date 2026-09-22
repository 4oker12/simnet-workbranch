import assert from 'node:assert/strict';
import { compactRuntimeAnalysis } from '../src/features/ai-operator/runtime-projection.js';
import {
  BILLING_SETTLEMENT_CYCLE_KNOWLEDGE
} from '../src/features/ai-operator/knowledge/billing-settlement-cycle.js';
import {
  SIMNET_KNOWLEDGE_VERSION,
  searchKnowledgeLibrary
} from '../src/features/ai-operator/knowledge/index.js';

assert.equal(SIMNET_KNOWLEDGE_VERSION, 'simnet-encyclopedia-v3.3');

const article = BILLING_SETTLEMENT_CYCLE_KNOWLEDGE.find(item => item.id === 'billing.settlement-cycle');
assert.ok(article, 'billing.settlement-cycle must exist');
assert.match(article.title, /расчётный цикл|финансовая модель/i);
assert.ok(article.tags.includes('settlement') || article.tags.includes('расчётный период'));

for (const marker of ['CONFIRMED', 'WORKING HYPOTHESIS', 'NEEDS SIMNET VERIFICATION']) {
  assert.match(article.text, new RegExp(marker));
}

for (const concept of [
  'accountBalance',
  'balanceAfterTariff',
  'balanceWithoutTemporary',
  'temporaryPayment',
  'totalDue',
  'requiredForAccess',
  'перерасчёт',
  'пауза',
  'календарн'
]) {
  assert.match(article.text, new RegExp(concept, 'i'), `missing concept: ${concept}`);
}

assert.doesNotMatch(article.text, /20 сентября[^\n]{0,80}всегда/i);
assert.doesNotMatch(article.text, /−30[^\n]{0,40}всегда/i);
assert.doesNotMatch(article.text, /если клиент написал/i);

assert.match(article.text, /customer claim|слова абонента|«я оплатил/i);
assert.match(article.text, /предыдущий ответ AI не/i);

const retrieval = searchKnowledgeLibrary('почему минус после оплаты расчётный период временный платёж', { limit: 6 });
assert.ok(retrieval.some(item => item.id === 'billing.settlement-cycle'));

// Audit the actual retrieval budget and final projection, not only the full KB.
const candidates = searchKnowledgeLibrary('почему минус после оплаты расчётный период временный платёж', { limit: 3, minScore: 4 });
const projected = compactRuntimeAnalysis({ knowledge: { articleEvidence: candidates } });
const delivered = projected.knowledge.articleEvidence.find(item => item.id === article.id);
assert.ok(delivered, 'settlement model must survive the final article limit for this query');
assert.ok(delivered.text.length <= 900);
for (const concept of ['accountBalance', 'balanceAfterTariff', 'totalDue', 'temporaryPayment', 'accessState', 'payments', 'unknown', 'окончательный', 'NEEDS SIMNET VERIFICATION']) {
  assert.ok(delivered.text.includes(concept), `synthesis lost ${concept} through truncation`);
}
assert.match(delivered.text, /не автоматический долг/);
assert.match(delivered.text, /старый ответ AI не факты/);

console.log('ai_operator_settlement_cycle_knowledge_test: PASS');
