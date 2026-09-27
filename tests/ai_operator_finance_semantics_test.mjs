import assert from 'node:assert/strict';
import { calculateFuturePayment } from '../src/features/ai-operator/future-payment-calculator.js';
import { routeBasicCase } from '../src/features/ai-operator/basic-case-router.js';
import { guardFuturePaymentDecision } from '../src/features/ai-operator/finance-safety-policy.js';

const service = {
  currentTariff: 'Безліміт 250 (100 Mbit) - (15.10.2024)',
  nextTariff: '',
  activeServices: [],
  activeServicesTotal: 0,
  derivedBaseTariffAmount: 250
};

const realBilling = calculateFuturePayment({
  service,
  finance: {
    totalDue: 250,
    accountBalance: 270.1,
    balanceAfterTariff: 20.1
  },
  horizon: { kind: 'next_month' },
  now: new Date('2026-09-15T12:00:00Z')
});

assert.equal(realBilling.ok, true);
assert.equal(realBilling.currentPeriodCovered, true);
assert.equal(realBilling.monthlyRecurringTotal, 250);
assert.equal(realBilling.availableBalanceForFuture, 20.1);
assert.equal(realBilling.balanceBasis, 'balanceAfterTariff');
assert.equal(realBilling.requiredTopUpNow, 229.9);
assert.equal(realBilling.calculation.requiredTopUpFormula, 'max(0, 250 - 20.1)');

const confirmed = {
  confirmedCaseId: 'billing-live:10590',
  confirmedSubscriber: { contract: '105906', billingId: '10590', login: 'abon105906' }
};
const rendered = routeBasicCase({
  customerText: 'сколько на следующий месяц надо заплатить?',
  labState: confirmed,
  toolResults: [{ tool: 'billing.future_payment', ok: true, data: realBilling }]
});
assert.equal(rendered.action, 'reply');
assert.match(rendered.reply, /на следующий месяц\s+—\s+250\s*грн/i);
assert.match(rendered.reply, /после уч[её]та стоимости текущего месяца оста[её]тся\s+20,1\s*грн/i);
assert.match(rendered.reply, /пополнить нужно на\s+229,9\s*грн/i);
assert.doesNotMatch(rendered.reply, /на сч[её]те сейчас\s+270,1/i, 'visible account balance must not be reused as money available after current-month charges');

const negativeCurrentMonth = calculateFuturePayment({
  service,
  finance: {
    totalDue: 250,
    accountBalance: 240.1,
    balanceAfterTariff: -9.9,
    balanceWithoutTemporary: 20.1
  },
  horizon: { kind: 'next_month' },
  now: new Date('2026-09-15T12:00:00Z')
});
assert.equal(negativeCurrentMonth.currentPeriodCovered, false, 'current month is not covered when post-tariff balance is negative');
assert.equal(negativeCurrentMonth.availableBalanceForFuture, -9.9, 'balanceWithoutTemporary is not the primary paid/current-month status');
assert.equal(negativeCurrentMonth.requiredTopUpNow, 259.9);

const llmDecision = {
  action: 'tool_required',
  domain: 'finance',
  intent: 'next_payment_amount',
  tool: 'billing.next_charge',
  toolArgs: {},
  reason: 'need next charge amount for subscriber',
  confidence: 0.96
};
const redirected = guardFuturePaymentDecision({
  customerText: 'так сколько на следующий заплатить надо?',
  decision: llmDecision,
  toolResults: []
});
assert.equal(redirected.tool, 'billing.future_payment');
assert.equal(redirected.intent, 'future_payment');
assert.deepEqual(redirected.toolArgs.horizon, { kind: 'next_month', year: null });

console.log('ai_operator_finance_semantics_test: PASS');
