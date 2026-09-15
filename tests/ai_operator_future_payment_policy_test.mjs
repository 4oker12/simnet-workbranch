import assert from 'node:assert/strict';
import {
  guardFuturePaymentDecision,
  hasConfirmedFutureAmount,
  isFuturePaymentQuestion
} from '../src/features/ai-operator/finance-safety-policy.js';

assert.equal(isFuturePaymentQuestion('сколько на следующий месяц надо заплатить?'), true);
assert.equal(isFuturePaymentQuestion('сколько надо доплатить до конца 2026?'), true);
assert.equal(isFuturePaymentQuestion('какой у меня баланс сейчас?'), false);

const toolDecision = {
  action: 'tool_required',
  intent: 'next_month_payment',
  tool: 'billing.next_charge',
  toolArgs: {}
};
assert.equal(
  guardFuturePaymentDecision({ customerText: 'сколько на следующий месяц?', decision: toolDecision, toolResults: [] }),
  toolDecision,
  'future-payment guard must not block a legitimate read-tool request'
);

const unsafeReply = {
  action: 'reply',
  intent: 'next_month_payment',
  language: 'ru',
  tool: '',
  toolArgs: {},
  reply: 'На следующий месяц нужно 449 грн, потому что добавился остаток прошлых начислений.',
  reason: 'used tariff totalDue',
  confidence: 0.99
};
const guarded = guardFuturePaymentDecision({
  customerText: 'сколько на следующий месяц надо заплатить?',
  decision: unsafeReply,
  toolResults: [
    {
      tool: 'billing.next_charge',
      ok: false,
      code: 'DATA_NOT_AVAILABLE',
      data: { message: 'future amount unavailable' }
    },
    {
      tool: 'billing.tariff',
      ok: true,
      code: 'OK',
      data: {
        currentTariff: 'Тест 100',
        price: 99,
        totalDue: 449
      }
    }
  ]
});
assert.equal(guarded.intent, 'future_payment_unconfirmed');
assert.match(guarded.reply, /не вернул отдельный расчёт следующего начисления/i);
assert.match(guarded.reply, /99\s*грн/i, 'known current tariff price may be explained as current evidence');
assert.doesNotMatch(guarded.reply, /449/, 'current totalDue must not leak into an unsupported future-payment answer');
assert.doesNotMatch(guarded.reply, /остаток прошлых начислений/i, 'unsupported debt explanation must be removed');

assert.equal(hasConfirmedFutureAmount([
  { tool: 'billing.next_charge', ok: true, data: { amount: 449 } }
]), true);

const confirmedReply = {
  ...unsafeReply,
  reply: 'На следующий месяц подтверждённая сумма — 449 грн.'
};
assert.equal(
  guardFuturePaymentDecision({
    customerText: 'сколько на следующий месяц?',
    decision: confirmedReply,
    toolResults: [{ tool: 'billing.next_charge', ok: true, data: { amount: 449 } }]
  }),
  confirmedReply,
  'explicit next-charge amount must allow the model answer through'
);

console.log('ai_operator_future_payment_policy_test: PASS');
