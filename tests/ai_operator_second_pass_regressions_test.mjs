import assert from 'node:assert/strict';
import { applyDialoguePolicy, DIALOGUE_VIOLATION } from '../src/features/ai-operator/dialogue-policy.js';
import { updateDialogueMemory } from '../src/features/ai-operator/dialogue-runtime-state.js';
import { resolveSubscriberIdentityHints } from '../src/features/ai-operator/subscriber-identity.js';
import { canonicalEvidenceFallbackResult } from '../src/features/ai-operator/semantic-tool-broker-core.js';

// Address evidence: a normal street + house is sufficient, prefixes do not
// break matching, but a different house/street cannot be invented by a parser.
const addressTurn = [{ role: 'customer', text: 'Адрес Кикабидзе 9' }];
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Кикабидзе 9' }), { address: 'Кикабидзе 9' });
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'ул. Кикабидзе 9' }), { address: 'ул. Кикабидзе 9' });
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Кикабидзе 19' }), {});
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Салютная 9' }), {});

// Semantic identity hints need token boundaries. Substrings cannot rebind.
assert.deepEqual(
  resolveSubscriberIdentityHints([{ role: 'customer', text: 'xabon123y' }], { probe: { ids: { login: 'abon123' } } }, null),
  {}
);
assert.deepEqual(
  resolveSubscriberIdentityHints([{ role: 'customer', text: 'номер 1408980' }], { probe: { ids: { contract: '40898' } } }, null),
  {}
);

// A fetched/resolved fact is not automatically a fact already communicated.
const memory = updateDialogueMemory({
  labState: { domainContext: { dialogue: { alreadyExplainedFacts: [] } } },
  analysis: { probe: { requiredFacts: ['subscriber.finance.balance.account'], unresolvedRequests: ['Какой баланс?'] } },
  requestText: 'Какой баланс?',
  factResolution: {
    requestedFacts: ['subscriber.finance.balance.account'],
    evidence: [{ path: 'subscriber.finance.balance.account', status: 'known', value: 500 }]
  }
});
assert.deepEqual(memory.domainContext.dialogue.alreadyExplainedFacts, []);
assert.deepEqual(memory.domainContext.dialogue.activeRequiredFacts, []);

// Burn out proactive operational offers without deleting the factual clause.
const commaOffer = applyDialoguePolicy({
  requestText: 'Какой у меня тариф?',
  reply: 'Текущий тариф — Безліміт 250, могу создать заявку на смену.'
});
assert.ok(commaOffer.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER));
assert.ok(commaOffer.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.match(commaOffer.reply, /Безліміт 250/);
assert.ok(!/могу создать|заявк/i.test(commaOffer.reply));

const explicitUnsupported = applyDialoguePolicy({
  requestText: 'Можете создать заявку?',
  reply: 'Да, могу создать заявку.'
});
assert.ok(explicitUnsupported.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.equal(explicitUnsupported.reply, 'Сейчас я не могу выполнить это действие из чата.');

const honestBoundary = applyDialoguePolicy({
  requestText: 'Создайте заявку.',
  reply: 'Сейчас я не могу создать заявку из этого чата.'
});
assert.ok(!honestBoundary.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.equal(honestBoundary.reply, 'Сейчас я не могу создать заявку из этого чата.');

// Canonical fallback completeness means every requested fact was actually
// rendered, not merely resolved/absent in source evidence.
const partial = canonicalEvidenceFallbackResult({
  requestText: 'Какой баланс и состояние услуги?',
  factResolution: {
    requestedFacts: ['subscriber.finance.balance.account', 'subscriber.service.serviceState'],
    evidence: [
      { path: 'subscriber.finance.balance.account', status: 'known', value: 500 },
      { path: 'subscriber.service.serviceState', status: 'absent', value: null }
    ]
  }
});
assert.equal(partial.complete, false);
assert.deepEqual(partial.representedRequestedFacts, ['subscriber.finance.balance.account']);

console.log('ai_operator_second_pass_regressions_test: ok');
