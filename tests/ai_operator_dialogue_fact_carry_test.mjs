import assert from 'node:assert/strict';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';
import { financeRequiredFacts } from '../src/features/ai-operator/finance-decision-nodes.js';

const labState = { domainContext: { dialogue: { activeRequiredFacts: ['subscriber.access.connectionFamily'], activeRequests: ['узнать технологию'] } } };
const correction = { probe: { latestMessageMeans: 'клиент исправляет термин из прошлого сообщения', refersTo: 'предыдущий вопрос', requiredFacts: [], unresolvedRequests: [] } };
const facts = augmentRequiredFactsForTurn({
  analysis: correction,
  transcript: [{ role:'customer', text:'предыдущая реплика без исправления' }],
  requestText: 'Ой, оптоволокно имел в виду, слово перепутал.',
  labState
});
assert.ok(facts.includes('subscriber.access.connectionFamily'), 'CORRECT must carry parent required fact before resolver using current turn text');

assert.deepEqual(financeRequiredFacts('до какого у меня проплачено?'), ['subscriber.finance.balance.account','subscriber.tariff.current.price']);
const finance = augmentRequiredFactsForTurn({ analysis:{probe:{requiredFacts:[]}}, transcript:[], requestText:'на сколько месяцев хватит денег?', labState:{} });
assert.ok(finance.includes('subscriber.finance.balance.account'));
assert.ok(finance.includes('subscriber.tariff.current.price'));
console.log('ai_operator_dialogue_fact_carry_test: ok');
