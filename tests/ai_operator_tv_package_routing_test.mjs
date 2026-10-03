import test from 'node:test';
import assert from 'node:assert/strict';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';
test('TV package question does not manufacture internet tariff reads', () => {
  const facts = augmentRequiredFactsForTurn({ requestText: 'В какой пакет Omega TV входят Viasat? У меня есть подключение.', analysis: { probe: { requiredFacts: [], whatUserWants: 'Узнать пакет телеканалов Viasat' } } });
  assert.equal(facts.includes('subscriber.tariff.current.name'), false);
  assert.equal(facts.includes('subscriber.tariff.current.price'), false);
});
test('explicit internet tariff question still reads its price beside TV context', () => {
  const facts = augmentRequiredFactsForTurn({ requestText: 'Какой у меня интернет тариф и есть ли Omega TV?', analysis: { probe: { requiredFacts: [] } } });
  assert.ok(facts.includes('subscriber.tariff.current.name'));
  assert.ok(facts.includes('subscriber.tariff.current.price'));
});
