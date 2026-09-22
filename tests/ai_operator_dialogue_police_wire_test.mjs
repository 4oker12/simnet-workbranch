import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDialoguePolicy, DIALOGUE_VIOLATION } from '../src/features/ai-operator/dialogue-policy.js';

/**
 * Mirrors the post-relevance gate call site in semantic-tool-broker.js
 * groundSubscriberReply — police runs on the gated reply before client sees it.
 */
function finalizeLikeBroker({ gatedReply, requestText, labState = {}, toolTrace = [] }) {
  const actionToolsCalled = (Array.isArray(toolTrace) ? toolTrace : [])
    .filter(item => item?.ok)
    .map(item => String(item?.tool || ''))
    .filter(Boolean);
  const policed = applyDialoguePolicy({
    reply: gatedReply,
    requestText,
    labState,
    alreadyExplainedFacts: Array.isArray(labState.alreadyExplainedFacts) ? labState.alreadyExplainedFacts : [],
    offeredActions: Array.isArray(labState.offeredActions) ? labState.offeredActions : [],
    actionToolsCalled,
    hasWriteCapability: false
  });
  return {
    reply: policed.reply || gatedReply,
    dialoguePolice: policed.dialoguePolice
  };
}

test('wire: unsolicited offer stripped from client reply, violation recorded', () => {
  const out = finalizeLikeBroker({
    gatedReply: 'На счету 100 грн. Могу зафиксировать обращение и передать в отдел.',
    requestText: 'сколько на счету?'
  });
  assert.ok(!/зафиксир/i.test(out.reply));
  assert.ok(out.reply.includes('100'));
  assert.ok(out.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER));
  assert.equal(out.dialoguePolice.cleaned, true);
});

test('wire: capability overclaim without write tools flagged', () => {
  const out = finalizeLikeBroker({
    gatedReply: 'Я зарегистрирую заявку и вам перезвонят.',
    requestText: 'почему нет интернета?',
    toolTrace: [{ tool: 'billing.balance', ok: true }]
  });
  assert.ok(out.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM));
});

test('wire: clean factual reply passes without violations', () => {
  const out = finalizeLikeBroker({
    gatedReply: 'На счету 320.99 грн.',
    requestText: 'сколько на счету?'
  });
  assert.equal(out.reply, 'На счету 320.99 грн.');
  assert.deepEqual(out.dialoguePolice.violations, []);
  assert.equal(out.dialoguePolice.cleaned, false);
});

test('wire: unnecessary address on general tariff question flagged', () => {
  const out = finalizeLikeBroker({
    gatedReply: 'Чтобы подсказать тарифы, уточните пожалуйста ваш адрес.',
    requestText: 'Какие у вас обычные тарифы?'
  });
  assert.ok(out.dialoguePolice.violations.includes(DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST));
});
