import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAddressRequest } from '../src/features/ai-operator/billing-live-search.js';
import { resolveSubscriberIdentityHints } from '../src/features/ai-operator/subscriber-identity.js';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';

const streets = [
  { value: '1', label: 'вул. Синтетична (СБ)' },
  { value: '2', label: 'вул. Синтетична (с. Святопетровское)' },
  { value: '3', label: 'вул. Рожева (СБ)' },
  { value: '4', label: 'вул. Южная (СБ)' }
];
test('locality marker cannot identify unrelated streets and compound house remains literal', () => {
  const result = resolveAddressRequest(streets, 'ул. Синтетична СБ 42/10 кв 9 шо там по счету меня?');
  assert.equal(result.ok, true);
  assert.equal(result.streetId, '1');
  assert.equal(result.building, '42/10');
  assert.equal(result.apartment, '9');
  assert.equal(resolveAddressRequest(streets, 'ул. Несуществующая СБ 42 кв 9').code, 'ADDRESS_STREET_NOT_FOUND');
});
test('same street still requires locality, expanded clarification selects the SB option', () => {
  assert.equal(resolveAddressRequest(streets, 'Синтетична 42 кв 9').code, 'ADDRESS_STREET_AMBIGUOUS');
  assert.equal(resolveAddressRequest(streets, 'Синтетична 42 кв 9, Софиевская Борщаговка').streetId, '1');
});
test('later literal locality clarifies the new address rather than reviving an old login', () => {
  const address = 'ул. Синтетична 42/10 кв 9 шо там по счету меня?';
  const transcript = [
    { role: 'customer', text: 'abon70001' },
    { role: 'customer', text: address },
    { role: 'agent', text: 'Это Софиевская Борщаговка?' },
    { role: 'customer', text: 'не, это другой договор...да, Софиевская' }
  ];
  const identity = resolveSubscriberIdentityHints(transcript, {}, { address });
  assert.deepEqual(identity, { address: 'ул. Синтетична 42/10 кв 9, Софиевская' });
  assert.equal(resolveAddressRequest(streets, identity.address).streetId, '1');
  const facts = augmentRequiredFactsForTurn({ transcript, analysis: { probe: { requiredFacts: ['building.canConnectSubscribers'] } } });
  assert.ok(facts.includes('subscriber.finance.balance.account'));
  assert.equal(facts.some(path => path.startsWith('building.')), false);
});
test('a new non-financial request does not resurrect the previous balance request', () => {
  const facts = augmentRequiredFactsForTurn({ transcript: [
    { role: 'customer', text: 'ул. Синтетична 42 кв 9 по счету?' },
    { role: 'customer', text: 'Какие каналы в Omega TV?' }
  ] });
  assert.equal(facts.includes('subscriber.finance.balance.account'), false);
});
