import assert from 'node:assert/strict';
import {
  SIMNET_KNOWLEDGE,
  searchKnowledgeLibrary
} from '../src/features/ai-operator/knowledge/index.js';

const ids = SIMNET_KNOWLEDGE.map(article => article.id);
assert.equal(new Set(ids).size, ids.length, 'knowledge article ids must stay unique');

for (const article of SIMNET_KNOWLEDGE) {
  assert.match(article.id, /^(billing|tariff|promotion|technical|service|connection)\.[a-z0-9-]+$/,
    `invalid stable knowledge id: ${article.id}`);
  assert.ok(String(article.title || '').trim(), `${article.id}: title is required`);
  assert.ok(String(article.summary || '').trim(), `${article.id}: summary is required`);
  assert.ok(Array.isArray(article.tags) && article.tags.length > 0, `${article.id}: tags are required`);
  assert.ok(String(article.text || '').trim().length >= 80, `${article.id}: article text is too small`);
}

function topIds(query, limit = 6) {
  return searchKnowledgeLibrary(query, { limit, minScore: 1 }).map(article => article.id);
}

assert.ok(
  topIds('есть акции для новых абонентов? три месяца по 89').includes('promotion.new-connection-89x3'),
  'new-customer promotion questions must retrieve promotion.new-connection-89x3'
);

assert.ok(
  topIds('какая у меня скорость по тарифу 100 мбит').includes('tariff.residential'),
  'tariff speed wording must retrieve tariff.residential'
);

assert.ok(
  topIds('как оплатить интернет через онлайн банкинг по номеру договора').includes('billing.payment'),
  'payment instructions must retrieve billing.payment'
);

assert.ok(
  topIds('поменял роутер, новый роутер надо авторизовать?').includes('technical.router-replacement'),
  'router replacement questions must retrieve technical.router-replacement'
);

const promo = SIMNET_KNOWLEDGE.find(article => article.id === 'promotion.new-connection-89x3');
assert.ok(promo, 'promotion.new-connection-89x3 must exist');
assert.match(promo.text, /3 месяца по 89 грн/i, 'promotion must preserve the confirmed 3x89 fact');
assert.match(promo.text, /не додумывай условия/i, 'promotion article must explicitly guard unverified conditions');
assert.doesNotMatch(
  promo.text,
  /если подключение выполнено в сентябре, сентябрь, октябрь и ноябрь/i,
  'promotion article must not encode an unverified calendar-month example'
);

console.log('ai_operator_knowledge_regression_test: PASS');
