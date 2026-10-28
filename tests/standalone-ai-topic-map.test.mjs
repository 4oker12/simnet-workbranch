import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicMap } from '../standalone-ai/topic-map.js';

function record(id, input, {
  intent = input,
  requiredFacts = [],
  toolTrace = [],
  reply = 'Проверка завершена'
} = {}) {
  return {
    customerMessageId: id,
    input,
    at: '2026-10-26T15:00:00Z',
    decision: { intent, reply, confidence: 0.93 },
    experiment: {
      customerMessageId: id,
      at: '2026-10-26T15:00:00Z',
      activeVariant: 'reply',
      analysis: { probe: { whatUserWants: intent, requiredFacts } },
      variants: [{ label: 'reply', reply, toolTrace }]
    }
  };
}
const read = (tool, ok = true, code = 'OK') => ({ tool, ok, code, observedAt: '2026-10-26T15:00:00Z', source: 'billing-live-read-only', data: {} });

test('a multi-question turn yields distinct color-coded topics sharing observed READ', () => {
  const lab = {
    turnRecords: [record('m1', 'Какой баланс, тариф и есть ли акции?', {
      requiredFacts: ['subscriber.finance.balance.account', 'subscriber.tariff.current.name'],
      toolTrace: [read('customer.lookup'), read('billing.main_summary')]
    })]
  };
  const topics = buildTopicMap(lab);
  assert.deepEqual(topics.map(t => t.id), ['balance', 'tariff', 'promotions']);
  assert.equal(topics[0].episodes[0].steps.some(s => s.label === 'billing.main_summary'), true);
  assert.equal(topics[1].episodes[0].steps.some(s => s.label === 'billing.main_summary'), true);
  assert.equal(topics[2].status, 'unverified');
  assert.equal(topics[0].status, 'read-ok');
});

test('follow-ups extend the same topic without duplicating a new thematic block', () => {
  const topics = buildTopicMap({ turnRecords: [
    record('m1', 'Сколько на балансе?', { toolTrace: [read('billing.balance')] }),
    record('m2', 'А после оплаты на счету сколько?', { toolTrace: [read('billing.balance')] }),
    record('m3', 'А тариф какой?', { toolTrace: [read('billing.tariff')] })
  ] });
  assert.equal(topics.find(t => t.id === 'balance').episodes.length, 2);
  assert.equal(topics.find(t => t.id === 'tariff').episodes.length, 1);
});

test('Billing unavailable is shown as failure, never as successful verified read', () => {
  const topics = buildTopicMap({ turnRecords: [
    record('m1', 'abon366882 мой договор, что по балансу?', {
      toolTrace: [read('customer.lookup', false, 'BILLING_TAB_REQUIRED')],
      reply: 'Не могу проверить: Billing недоступен.'
    })
  ] });
  const balance = topics.find(t => t.id === 'balance');
  assert.equal(balance.status, 'error');
  const node = balance.episodes[0].steps.find(s => s.label === 'customer.lookup');
  assert.equal(node.status, 'failure');
  assert.match(node.summary, /BILLING_TAB_REQUIRED/);
  assert.equal(balance.episodes[0].steps.at(-1).detail.reply, 'Не могу проверить: Billing недоступен.');
});

test('no stored turns means empty map; old Lab schema can display one last turn', () => {
  assert.deepEqual(buildTopicMap({}), []);
  const old = record('m7', 'Не работает интернет', { toolTrace: [read('network.session')] });
  const map = buildTopicMap({lastExperiment:old.experiment,lastDecision:old.decision,messages:[{id:'m7',role:'customer',text:'Не работает интернет'}]});
  assert.ok(map.some(topic=>topic.id==='connection'));
});

test('identity without service question forms own block; source trace remains observably scoped', () => {
  const topics = buildTopicMap({turnRecords: [
    record('m1','abon366882',{toolTrace:[read('customer.lookup')]})
  ]});
  assert.deepEqual(topics.map(t=>t.id), ['identity']);
  assert.equal(topics[0].episodes[0].steps.find(s=>s.label==='customer.lookup').status, 'success');
});
