import assert from 'node:assert/strict';
import { routeBasicCase } from '../src/features/ai-operator/basic-case-router.js';

const labState = {
  confirmedCaseId: 'billing-live:12345',
  confirmedSubscriber: { contract: '100057' }
};

const tariffResult = {
  tool: 'billing.tariff',
  ok: true,
  code: 'OK',
  data: {
    currentTariff: 'Тариф 250 (100 Mbit) - (15.10.2024)',
    nextTariff: '',
    nextTariffDelay: 'в следующем месяце'
  }
};

const needsBalance = routeBasicCase({
  customerText: 'что у меня по тарифу?',
  latestCustomerText: 'что у меня по тарифу?',
  labState,
  toolResults: [tariffResult]
});
assert.equal(needsBalance.action, 'tool_required');
assert.equal(needsBalance.tool, 'billing.balance');

const withoutFinance = routeBasicCase({
  customerText: 'что у меня по тарифу?',
  latestCustomerText: 'что у меня по тарифу?',
  labState,
  toolResults: [
    tariffResult,
    {
      tool: 'billing.balance',
      ok: false,
      code: 'DATA_NOT_AVAILABLE',
      data: {}
    }
  ]
});
assert.equal(withoutFinance.action, 'reply');
assert.equal(withoutFinance.model, 'deterministic-basic-router');
assert.equal(withoutFinance.reply, 'У вас тариф 250 грн, скорость до 100 Мбит/с.');
assert.doesNotMatch(withoutFinance.reply, /15\.10\.2024/);
assert.doesNotMatch(withoutFinance.reply, /следующ/i);
assert.doesNotMatch(withoutFinance.reply, /действует до/i);

const paidMonth = routeBasicCase({
  customerText: 'какой у меня тариф?',
  latestCustomerText: 'какой у меня тариф?',
  labState,
  toolResults: [
    tariffResult,
    {
      tool: 'billing.balance',
      ok: true,
      code: 'OK',
      data: { balanceAfterTariff: 42.5 }
    }
  ]
});
assert.equal(
  paidMonth.reply,
  'У вас тариф 250 грн, скорость до 100 Мбит/с. Текущий месяц по тарифу оплачен.'
);

const noPaidClaimWithoutProof = routeBasicCase({
  customerText: 'какой у меня тариф?',
  latestCustomerText: 'какой у меня тариф?',
  labState,
  toolResults: [
    tariffResult,
    {
      tool: 'billing.balance',
      ok: true,
      code: 'OK',
      data: { accountBalance: 500, balanceAfterTariff: null }
    }
  ]
});
assert.doesNotMatch(noPaidClaimWithoutProof.reply, /оплачен/i);

console.log('ai_operator_basic_tariff_reply_test: PASS');
