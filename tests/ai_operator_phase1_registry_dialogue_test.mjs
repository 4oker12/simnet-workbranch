import test from 'node:test';
import assert from 'node:assert/strict';

import { executeOperatorTool as executeLocalTool } from '../src/features/ai-operator/tool-runtime.js';
import {
  applyDiscourseToState,
  discourseActFromSpeechAct,
  newConversationState,
  unresolvedActiveIntents
} from '../src/features/ai-operator/dialogue-state.js';
import {
  DIALOGUE_VIOLATION,
  applyDialoguePolicy,
  evaluateDialoguePolicy,
  isGeneralProductQuestion
} from '../src/features/ai-operator/dialogue-policy.js';

test('billing.main_summary is a known local ACCOUNT tool alias, not UNKNOWN_TOOL', async () => {
  const out = await executeLocalTool({ tool: 'billing.main_summary', toolArgs: {}, labState: {} });
  assert.notEqual(out.code, 'UNKNOWN_TOOL');
});

test('unknown tool still returns UNKNOWN_TOOL', async () => {
  const unknown = await executeLocalTool({ tool: 'billing.not_a_real_tool', labState: {} });
  assert.equal(unknown.code, 'UNKNOWN_TOOL');
});

test('CORRECT preserves parent unresolved intent', () => {
  let state = newConversationState();
  state = applyDiscourseToState(state, {
    speechAct: 'new',
    questions: [{ entity: 'network', relation: 'info', period: 'current' }]
  }, { now: 1000 });
  assert.equal(unresolvedActiveIntents(state).length, 1);
  state = applyDiscourseToState(state, {
    speechAct: 'correct',
    questions: [{ entity: 'network', relation: 'info', period: 'current' }],
    ids: {}
  }, { now: 2000 });
  assert.equal(unresolvedActiveIntents(state).length, 1);
  assert.equal(state.lastDiscourseAct, 'CORRECT');
  assert.ok(unresolvedActiveIntents(state)[0].corrections.length >= 1);
  assert.equal(discourseActFromSpeechAct('correct'), 'CORRECT');
});

test('CANCEL marks unresolved intents cancelled', () => {
  let state = applyDiscourseToState(newConversationState(), {
    speechAct: 'new',
    questions: [{ entity: 'tariff', relation: 'info', period: 'current' }]
  }, { now: 1 });
  state = applyDiscourseToState(state, { speechAct: 'cancel', questions: [] }, { now: 2 });
  assert.equal(unresolvedActiveIntents(state).length, 0);
  assert.equal(state.lastDiscourseAct, 'CANCEL');
});

test('unsolicited action offer is flagged', () => {
  const result = evaluateDialoguePolicy({
    reply: 'На счету 100 грн. Могу зафиксировать обращение и передать в отдел.',
    requestText: 'сколько на счету?'
  });
  assert.ok(result.violations.some(item => item.code === DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER));
});

test('general tariff question does not require address', () => {
  assert.equal(isGeneralProductQuestion('Какие у вас обычные тарифы?'), true);
  const result = evaluateDialoguePolicy({
    reply: 'Чтобы подсказать тарифы, уточните пожалуйста ваш адрес.',
    requestText: 'Какие у вас обычные тарифы?',
    labState: {}
  });
  assert.ok(result.violations.some(item => item.code === DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST));
});

test('applyDialoguePolicy returns diagnostics codes', () => {
  const out = applyDialoguePolicy({
    reply: 'Извините, я не совсем понял ваш вопрос. Могу зафиксировать обращение.',
    requestText: 'баланс'
  });
  assert.ok(out.dialoguePolice.violations.length >= 1);
});
