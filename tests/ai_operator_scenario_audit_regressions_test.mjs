import assert from 'node:assert/strict';
import { applyDialoguePolicy, DIALOGUE_VIOLATION } from '../src/features/ai-operator/dialogue-policy.js';
import { deriveDiscourseAct, DISCOURSE_ACT, isConsumptionStartQuestion, updateDialogueMemory } from '../src/features/ai-operator/dialogue-runtime-state.js';
import { extractStandaloneSubscriberIdentity, resolveSubscriberIdentityHints } from '../src/features/ai-operator/subscriber-identity.js';
import { compactTurnOutcome } from '../src/features/ai-operator/scenario-replay.js';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';
import { canonicalEvidenceFallbackResult } from '../src/features/ai-operator/semantic-tool-broker-core.js';

// "договор" contains the letters "оговор" but is NOT a correction discourse act.
assert.notEqual(
  deriveDiscourseAct({ analysis: {}, requestText: 'А какой тариф сейчас стоит именно на этом договоре?' }),
  DISCOURSE_ACT.CORRECT
);
assert.notEqual(
  deriveDiscourseAct({ analysis: {}, requestText: 'Хозяйка квартиры не против.' }),
  DISCOURSE_ACT.CORRECT
);
assert.equal(
  deriveDiscourseAct({ analysis: {}, requestText: 'Ой, оптоволокно имел в виду, слово перепутал.' }),
  DISCOURSE_ACT.CORRECT
);

// Network vocabulary inside free dialogue must never become subscriber identity.
const ethernetQuestion = [{ role: 'customer', text: 'И как я подключён сейчас: оптика или Ethernet?' }];
assert.deepEqual(extractStandaloneSubscriberIdentity(ethernetQuestion), {});
assert.deepEqual(resolveSubscriberIdentityHints(ethernetQuestion, {}, { login: 'ethernet' }), {});
assert.deepEqual(resolveSubscriberIdentityHints(ethernetQuestion, { probe: { ids: { login: 'ethernet' } } }, null), {});

// Named login still works when it is literal and identity-labelled/standalone.
assert.equal(extractStandaloneSubscriberIdentity([{ role: 'customer', text: 'giv1984' }]).login, 'giv1984');
assert.equal(extractStandaloneSubscriberIdentity([{ role: 'customer', text: 'giv1984 номер договора' }]).login, 'giv1984');
assert.equal(extractStandaloneSubscriberIdentity([{ role: 'customer', text: 'логин giv1984' }]).login, 'giv1984');

// Literal address rebind accepts a normal one-word street + house number, but
// cannot switch to a different house/address invented by a parser.
const addressTurn = [{ role: 'customer', text: 'Адрес Кикабидзе 9' }];
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Кикабидзе 9' }), { address: 'Кикабидзе 9' });
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Кикабидзе 19' }), {});
assert.deepEqual(resolveSubscriberIdentityHints(addressTurn, {}, { address: 'Салютная 9' }), {});

// Unknown support/bundle fields are diagnostic only; only requested unknowns may make a turn incomplete.
const replayOutcome = compactTurnOutcome({
  user: 'Сколько нужно оплатить?',
  turnIndex: 0,
  outcome: {
    toolState: {},
    experiment: {
      analysis: { probe: { requiredFacts: ['subscriber.finance.balance.account'], unresolvedRequests: [] }, knowledge: {} },
      variants: [{
        label: 'v',
        reply: 'Баланс проверен.',
        factDiagnostics: {
          returnedFacts: ['subscriber.finance.balance.account'],
          unknownFacts: ['subscriber.finance.balance.withoutTemporary', 'subscriber.finance.temporaryPayment']
        },
        factEvidence: [
          { path: 'subscriber.finance.balance.account', status: 'known', value: -10 },
          { path: 'subscriber.finance.balance.withoutTemporary', status: 'unknown', value: null },
          { path: 'subscriber.finance.temporaryPayment', status: 'unknown', value: null }
        ],
        toolTrace: []
      }],
      activeVariant: 'v'
    }
  }
});
assert.equal(replayOutcome.status, 'complete');
assert.deepEqual(replayOutcome.unknownFacts, []);
assert.deepEqual(replayOutcome.supportUnknownFacts.sort(), [
  'subscriber.finance.balance.withoutTemporary',
  'subscriber.finance.temporaryPayment'
].sort());

// Raw internal KB must be blocked, not just labelled.
const leakedStatement = applyDialoguePolicy({
  requestText: 'Хозяйка квартиры не против.',
  reply: 'Договор = лицевой = особовий рахунок; login abon+4..6 цифр или именной.'
});
assert.ok(leakedStatement.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.RAW_KNOWLEDGE_LEAK));
assert.equal(leakedStatement.reply, 'Понял.');
assert.ok(!/abon\+|лицевой\s*=/.test(leakedStatement.reply));

const leakedQuestion = applyDialoguePolicy({
  requestText: 'Что сейчас по оплате?',
  reply: 'Канон финансовых полей Billing: текущий баланс, цена тарифа, расчётные суммы.'
});
assert.ok(leakedQuestion.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.RAW_KNOWLEDGE_LEAK));
assert.ok(leakedQuestion.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.NON_ANSWER));
assert.ok(!/Канон финансовых/.test(leakedQuestion.reply));

// Unsolicited operational offers are removed even when phrased with verbs that
// used to slip through the narrower guard.
const unsolicitedCreate = applyDialoguePolicy({
  requestText: 'Какой у меня тариф?',
  reply: 'Текущий тариф — Безліміт 250. Если хотите, могу создать заявку на смену.'
});
assert.ok(unsolicitedCreate.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER));
assert.ok(unsolicitedCreate.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.match(unsolicitedCreate.reply, /Безліміт 250/);
assert.ok(!/могу создать|заявк/i.test(unsolicitedCreate.reply));

const explicitUnsupportedAction = applyDialoguePolicy({
  requestText: 'Создайте заявку.',
  reply: 'Могу создать заявку прямо сейчас.'
});
assert.ok(explicitUnsupportedAction.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.equal(explicitUnsupportedAction.reply, 'Сейчас я не могу выполнить это действие из чата.');

const honestCapabilityBoundary = applyDialoguePolicy({
  requestText: 'Создайте заявку.',
  reply: 'Сейчас я не могу создать заявку из этого чата.'
});
assert.ok(!honestCapabilityBoundary.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
assert.equal(honestCapabilityBoundary.reply, 'Сейчас я не могу создать заявку из этого чата.');

// Consumption-start date is a distinct business fact and cannot fall back to contract date.
const consumptionText = 'А день начала потребления услуги какой указан по договору?';
assert.equal(isConsumptionStartQuestion(consumptionText), true);
const consumptionFacts = augmentRequiredFactsForTurn({
  analysis: { probe: { requiredFacts: ['subscriber.contract.date', 'subscriber.contract.number'] } },
  requestText: consumptionText,
  transcript: [],
  labState: {}
});
assert.ok(!consumptionFacts.includes('subscriber.contract.date'));
assert.ok(consumptionFacts.includes('subscriber.contract.number'));

// Resolving a canonical fact is not proof that the final answer actually told it
// to the customer. Do not poison DELTA memory with merely fetched facts.
const memoryAfterResolution = updateDialogueMemory({
  labState: { domainContext: { dialogue: { alreadyExplainedFacts: [] } } },
  analysis: {
    probe: {
      requiredFacts: ['subscriber.finance.balance.account'],
      unresolvedRequests: ['Какой баланс?']
    }
  },
  requestText: 'Какой баланс?',
  factResolution: {
    requestedFacts: ['subscriber.finance.balance.account'],
    evidence: [{ path: 'subscriber.finance.balance.account', status: 'known', value: 500 }]
  }
});
assert.deepEqual(memoryAfterResolution.domainContext.dialogue.alreadyExplainedFacts, []);
assert.deepEqual(memoryAfterResolution.domainContext.dialogue.activeRequiredFacts, []);

// When synthesis fails after canonical facts are already known, fallback must
// surface the facts instead of asking the operator/customer to repeat the turn.
const ambiguousRestoreFallback = canonicalEvidenceFallbackResult({
  requestText: 'Сколько нужно оплатить, чтобы интернет снова работал?',
  factResolution: {
    requestedFacts: [
      'subscriber.finance.totalDue',
      'subscriber.finance.balance.account',
      'subscriber.service.accessState',
      'subscriber.service.serviceState'
    ],
    evidence: [
      { path: 'subscriber.finance.totalDue', status: 'known', value: 0 },
      { path: 'subscriber.finance.balance.account', status: 'known', value: -132.33 },
      { path: 'subscriber.service.accessState', status: 'known', value: 'Запрещен' },
      { path: 'subscriber.service.serviceState', status: 'known', value: 'ПАУЗА' }
    ]
  }
});
assert.equal(ambiguousRestoreFallback.used, true);
assert.equal(ambiguousRestoreFallback.complete, false, 'conflicting finance/service facts must not become an invented activation amount');
assert.match(ambiguousRestoreFallback.reply, /-132[,.]33|132[,.]33/);
assert.match(ambiguousRestoreFallback.reply, /ПАУЗА/);
assert.match(ambiguousRestoreFallback.reply, /однозначно определить нельзя/);
assert.ok(!/повторите.*ход/i.test(ambiguousRestoreFallback.reply));

const simpleBalanceFallback = canonicalEvidenceFallbackResult({
  requestText: 'Какой у меня баланс?',
  factResolution: {
    requestedFacts: ['subscriber.finance.balance.account'],
    evidence: [{ path: 'subscriber.finance.balance.account', status: 'known', value: 500 }]
  }
});
assert.equal(simpleBalanceFallback.complete, true);
assert.match(simpleBalanceFallback.reply, /500/);

const absentFactFallback = canonicalEvidenceFallbackResult({
  requestText: 'Какой баланс и состояние услуги?',
  factResolution: {
    requestedFacts: ['subscriber.finance.balance.account', 'subscriber.service.serviceState'],
    evidence: [
      { path: 'subscriber.finance.balance.account', status: 'known', value: 500 },
      { path: 'subscriber.service.serviceState', status: 'absent', value: null }
    ]
  }
});
assert.equal(absentFactFallback.complete, false, 'an absent fact that was not rendered cannot count as a complete fallback answer');
assert.deepEqual(absentFactFallback.representedRequestedFacts, ['subscriber.finance.balance.account']);

console.log('ai_operator_scenario_audit_regressions_test: ok');
