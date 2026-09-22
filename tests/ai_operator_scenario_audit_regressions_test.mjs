import assert from 'node:assert/strict';
import { applyDialoguePolicy, DIALOGUE_VIOLATION } from '../src/features/ai-operator/dialogue-policy.js';
import { deriveDiscourseAct, DISCOURSE_ACT, isConsumptionStartQuestion } from '../src/features/ai-operator/dialogue-runtime-state.js';
import { extractStandaloneSubscriberIdentity, resolveSubscriberIdentityHints } from '../src/features/ai-operator/subscriber-identity.js';
import { compactTurnOutcome } from '../src/features/ai-operator/scenario-replay.js';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';

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

console.log('ai_operator_scenario_audit_regressions_test: ok');
