import assert from 'node:assert/strict';
import { calculateFuturePayment, futurePaymentHorizonFromText } from '../src/features/ai-operator/future-payment-calculator.js';
import { routeBasicCase } from '../src/features/ai-operator/basic-case-router.js';

const service = {
  currentTariff: 'Гігабіт 350 - (15.10.2024)',
  nextTariff: '',
  activeServices: [{ name: 'MEGOGO', amount: 99, amountText: '99 грн' }],
  activeServicesTotal: 99,
  derivedBaseTariffAmount: 350
};
const finance = {
  totalDue: 449,
  accountBalance: 300
};

assert.deepEqual(futurePaymentHorizonFromText('сколько на следующий месяц надо заплатить?'), { kind: 'next_month', year: null });
assert.deepEqual(futurePaymentHorizonFromText('сколько нужно до конца 2026 года?'), { kind: 'year_end', year: 2026 });
assert.deepEqual(futurePaymentHorizonFromText('сколько плачу в месяц?'), { kind: 'monthly', year: null });

const yearEnd = calculateFuturePayment({
  service,
  finance,
  horizon: { kind: 'year_end', year: 2026 },
  now: new Date('2026-09-15T12:00:00Z')
});
assert.equal(yearEnd.ok, true);
assert.equal(yearEnd.months, 3, 'September 2026 -> October, November, December remain');
assert.equal(yearEnd.monthlyRecurringTotal, 449);
assert.equal(yearEnd.futureCharges, 1347);
assert.equal(yearEnd.requiredTopUpNow, 1047);
assert.equal(yearEnd.baseTariffAmount, 350);
assert.equal(yearEnd.addOnsTotal, 99);

const initialLookup = routeBasicCase({
  customerText: 'abon472532 мой договор, сколько на следующий месяц надо заплатить?',
  latestCustomerText: 'abon472532 мой договор, сколько на следующий месяц надо заплатить?',
  labState: {},
  toolResults: []
});
assert.equal(initialLookup.tool, 'customer.lookup');
assert.deepEqual(initialLookup.toolArgs, { query: 'abon472532' });

const pending = {
  pendingCandidate: {
    contract: '472532',
    login: 'abon472532',
    address: '',
    ip: '192.0.2.10'
  }
};
const confirmAsk = routeBasicCase({
  customerText: 'abon472532 мой договор, сколько на следующий месяц надо заплатить?',
  latestCustomerText: 'abon472532 мой договор, сколько на следующий месяц надо заплатить?',
  labState: pending,
  toolResults: [{ tool: 'customer.lookup', ok: true, data: { count: 1 } }]
});
assert.equal(confirmAsk.action, 'ask');
assert.equal(confirmAsk.reply, 'Нашёл договор 472532. Это ваше подключение?');
assert.doesNotMatch(confirmAsk.reply, /имя|на имя|Багацька/i);

const confirmYes = routeBasicCase({
  customerText: 'abon472532 мой договор, сколько на следующий месяц надо заплатить?',
  latestCustomerText: 'да',
  labState: pending,
  toolResults: []
});
assert.equal(confirmYes.tool, 'customer.confirm');
assert.deepEqual(confirmYes.toolArgs, { confirmed: true });

const confirmed = {
  confirmedCaseId: 'login:abon472532',
  confirmedSubscriber: { contract: '472532', billingId: '47253', login: 'abon472532' }
};

const routeToCalc = routeBasicCase({
  customerText: 'сколько до конца 2026 чтобы закрыть?',
  labState: confirmed,
  toolResults: []
});
assert.equal(routeToCalc.action, 'tool_required');
assert.equal(routeToCalc.tool, 'billing.future_payment');
assert.deepEqual(routeToCalc.toolArgs.horizon, { kind: 'year_end', year: 2026 });

const finalYearReply = routeBasicCase({
  customerText: 'сколько до конца 2026 чтобы закрыть?',
  labState: confirmed,
  toolResults: [{ tool: 'billing.future_payment', ok: true, data: yearEnd }]
});
assert.equal(finalYearReply.action, 'reply');
assert.match(finalYearReply.reply, /3\s*×\s*449\s*грн\s*=\s*1[\s ]?347\s*грн/i);
assert.match(finalYearReply.reply, /доплатить нужно\s+1[\s ]?047\s*грн/i);
assert.doesNotMatch(finalYearReply.reply, /если понадобится|дайте знать|остаток предыдущих/i);

const nextMonth = calculateFuturePayment({
  service,
  finance: { totalDue: 449, accountBalance: 0 },
  horizon: { kind: 'next_month' },
  now: new Date('2026-09-15T12:00:00Z')
});
const finalNextReply = routeBasicCase({
  customerText: 'сколько на следующий месяц надо заплатить?',
  labState: confirmed,
  toolResults: [{ tool: 'billing.future_payment', ok: true, data: nextMonth }]
});
assert.match(finalNextReply.reply, /449\s*грн/i);
assert.match(finalNextReply.reply, /интернет\s+350\s*грн/i);
assert.match(finalNextReply.reply, /MEGOGO\s+99\s*грн/i);

const balanceRoute = routeBasicCase({
  customerText: 'какой баланс?',
  labState: confirmed,
  toolResults: []
});
assert.equal(balanceRoute.tool, 'billing.balance');
const balanceReply = routeBasicCase({
  customerText: 'какой баланс?',
  labState: confirmed,
  toolResults: [{ tool: 'billing.balance', ok: true, data: { accountBalance: 300 } }]
});
assert.equal(balanceReply.reply, 'На счёте сейчас 300 грн.');

const contractReply = routeBasicCase({
  customerText: 'какой мой номер договора?',
  labState: confirmed,
  toolResults: []
});
assert.match(contractReply.reply, /472532/);

const paymentReply = routeBasicCase({
  customerText: 'как оплатить интернет?',
  labState: confirmed,
  toolResults: []
});
assert.match(paymentReply.reply, /онлайн-банкинг/i);
assert.match(paymentReply.reply, /472532/);

console.log('ai_operator_basic_cases_test: PASS');
