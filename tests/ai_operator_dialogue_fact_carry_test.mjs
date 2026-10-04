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


const addressState = {
  confirmedCaseId: 'billing-live:42',
  confirmedSubscriber: {
    address: 'вул. Планерна, буд. 1, блок 28, кв. 3'
  },
  domainContext: {
    activeServiceAddress: {
      fullAddress: 'вул. Планерна, буд. 1, блок 28, кв. 3'
    }
  }
};
const addressCoverageFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['building.gpon', 'building.canConnectSubscribers'] } },
  requestText: 'По дому есть GPON или гигабитная возможность?',
  transcript: [],
  labState: addressState
});
assert.ok(addressCoverageFacts.includes('building.gpon'));
assert.ok(addressCoverageFacts.includes('building.canConnectSubscribers'));
assert.ok(addressCoverageFacts.includes('subscriber.serviceAddress.fullAddress'), 'known service address must scope support evidence');
assert.ok(addressCoverageFacts.includes('subscriber.access.connectionFamily'), 'existing line technology is useful qualified support evidence');
assert.ok(addressCoverageFacts.includes('subscriber.tariff.current.speed'), 'existing gigabit tariff is useful qualified support evidence');

const genericTariffFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['building.gpon', 'subscriber.tariff.current.name'] } },
  requestText: 'Какие обычные тарифы можно выбрать для квартиры?',
  transcript: [],
  labState: addressState
});
assert.ok(!genericTariffFacts.includes('building.gpon'), 'general tariff question must not become a building coverage lookup just because address is known');
assert.ok(genericTariffFacts.includes('subscriber.tariff.current.name'));

const afterPaymentFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['building.gpon', 'building.canConnectSubscribers'] } },
  requestText: 'После оплаты что произойдёт?',
  transcript: [],
  labState: addressState
});
assert.ok(!afterPaymentFacts.some(path => path.startsWith('building.')), 'payment/process follow-up must not drag building coverage into the turn');


const colloquialCoverageFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['building.gpon'] } },
  requestText: 'Гиг на доме есть вообще?',
  transcript: [],
  labState: addressState
});
assert.ok(colloquialCoverageFacts.includes('subscriber.tariff.current.speed'));
assert.ok(colloquialCoverageFacts.includes('subscriber.serviceAddress.fullAddress'));

const ironyCoverageFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['building.gpon'] } },
  requestText: 'Гигабит этому дому цивилизация уже принесла?',
  transcript: [],
  labState: addressState
});
assert.ok(ironyCoverageFacts.includes('subscriber.tariff.current.speed'));
