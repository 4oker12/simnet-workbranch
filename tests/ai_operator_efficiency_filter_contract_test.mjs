import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from '../src/features/ai-operator/knowledge/index.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('knowledge retrieval uses the active turn instead of stale transcript topics', () => {
  const query = knowledgeQueryFromUnderstanding({
    probe: {
      whatUserWants: 'узнать условия дружественного кешбека',
      latestMessageMeans: 'клиент спрашивает, начислят ли кешбек после оплаты',
      refersTo: 'текущая оплата',
      underlyingGoal: 'понять условия кешбека',
      factsSaidByUser: ['собирается оплатить сейчас']
    },
    transcript: [{ role: 'customer', text: 'старый разговор про GPON тариф Smart TV' }],
    latestCustomer: { text: 'дружественный кешбек, щас оплачу, зачислите?' }
  });
  assert.doesNotMatch(query, /GPON|Smart TV/i);
  assert.match(query, /кешбек/i);
});

test('semantic probe skips empty/weak KB retrieval before another LLM call', () => {
  const source = read('src/features/ai-operator/semantic-probe.js');
  assert.match(source, /searchKnowledgeLibrary\(query, \{ limit: 4, minScore: 4 \}\)/);
  assert.match(source, /candidateArticles\.length/);
  assert.match(source, /no_relevant_articles/);
  assert.match(source, /understanding: \{ \.\.\.probe, unresolvedRequests: \[\] \}/);
});

test('relevance gate does not treat unrelated READ payloads as proof', () => {
  const source = read('src/features/ai-operator/answer-relevance-gate.js');
  assert.match(source, /whatUserWants \|\| latestCustomer/);
  assert.match(source, /кешбек\|кэшбек\|cashback/);
  assert.match(source, /smart\\s\*tv/);
  assert.match(source, /стоим\|цен\|варт\|оборуд/);
});

test('cashback policy questions are not routed to payment history', () => {
  const source = read('src/features/ai-operator/semantic-tool-broker-core.js');
  assert.match(source, /кешбек\|кэшбек\|cashback/);
  assert.match(source, /return '';/);
});

test('current-turn cashback query does not retrieve stale tariff article at strict threshold', () => {
  const query = knowledgeQueryFromUnderstanding({
    probe: {
      whatUserWants: 'узнать условия дружественного кешбека',
      latestMessageMeans: 'начислят ли кешбек после оплаты',
      factsSaidByUser: ['оплачу сейчас']
    },
    latestCustomer: { text: 'дружественный кешбек, щас оплачу, зачислите?' }
  });
  const candidates = searchKnowledgeLibrary(query, { limit: 4, minScore: 4 });
  assert.equal(candidates.some(item => item.id === 'tariff.residential'), false);
});
