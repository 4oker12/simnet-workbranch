import assert from 'node:assert/strict';
import { calculateBalanceCoverage, calculateConnectionUpfrontPayment, deriveFinanceDecisionEvidence, financeRequiredFacts, isBalanceCoverageQuestion, isInactiveReturnNegativeBalanceQuestion } from '../src/features/ai-operator/finance-decision-nodes.js';
assert.deepEqual(calculateBalanceCoverage({ balance: 500, recurringAmount: 250 }), { status: 'known', fullCharges: 2, remainder: 0, balance: 500, recurringAmount: 250 });
assert.deepEqual(calculateBalanceCoverage({ balance: 775.5, recurringAmount: 300 }), { status: 'known', fullCharges: 2, remainder: 175.5, balance: 775.5, recurringAmount: 300 });
assert.equal(isBalanceCoverageQuestion('до какого у меня проплачено?'), true);
assert.deepEqual(financeRequiredFacts('на сколько месяцев хватит денег?'), ['subscriber.finance.balance.account', 'subscriber.finance.recurringTotal']);
const derived = deriveFinanceDecisionEvidence({ requestText: 'на сколько месяцев хватит денег?', evidence: [{ path: 'subscriber.finance.balance.account', status: 'known', value: 500 }, { path: 'subscriber.finance.recurringTotal', status: 'known', value: 250 }] });
assert.equal(derived.decision.fullCharges, 2);
assert.equal(derived.evidence.find(item => item.path === 'derived.finance.coverage.calendarMappingAllowed')?.value, false);

const firstPon = calculateConnectionUpfrontPayment({ firstConnection: true, optical: true });
assert.equal(firstPon.status, 'known');
assert.equal(firstPon.total, 800);
assert.equal(firstPon.includesTariffCharge, false);
assert.deepEqual(firstPon.items.map(item => [item.code, item.amount]), [['initial_advance', 300], ['optical_terminal', 500]]);

const opticalMigration = calculateConnectionUpfrontPayment({ firstConnection: false, optical: true });
assert.equal(opticalMigration.total, 500);
assert.deepEqual(opticalMigration.items.map(item => item.code), ['optical_terminal']);

const firstNonOptical = calculateConnectionUpfrontPayment({ firstConnection: true, optical: false });
assert.equal(firstNonOptical.total, 300);
assert.equal(calculateConnectionUpfrontPayment({}).status, 'unknown');

assert.equal(isInactiveReturnNegativeBalanceQuestion('два года отсутствовал, хочу восстановить услугу, откуда минус?'), true);
assert.deepEqual(
  financeRequiredFacts('два года отсутствовал, хочу восстановить услугу, откуда минус?'),
  ['subscriber.finance.balance.account', 'subscriber.finance.totalDue']
);
const inactiveReturn = deriveFinanceDecisionEvidence({
  requestText: 'два года отсутствовал, хочу восстановить услугу, откуда минус?',
  evidence: [
    { path: 'subscriber.finance.balance.account', status: 'known', value: -372 },
    { path: 'subscriber.finance.totalDue', status: 'known', value: 0 }
  ]
});
assert.equal(inactiveReturn.decision.type, 'inactive_return_negative_balance_review');
assert.equal(inactiveReturn.decision.historicalMinusMustBePaidBeforeReview, false);
assert.equal(inactiveReturn.decision.nextAction, 'finance_ticket');
assert.equal(inactiveReturn.decision.temporaryPaymentBridgeAllowed, true);
assert.equal(inactiveReturn.decision.writeOffGuaranteed, false);
assert.equal(inactiveReturn.evidence.find(item => item.path === 'derived.finance.inactiveReturn.historicalMinusMustBePaidBeforeReview')?.value, false);

const currentDue = deriveFinanceDecisionEvidence({
  requestText: 'два года отсутствовал, хочу восстановить услугу, откуда минус?',
  evidence: [
    { path: 'subscriber.finance.balance.account', status: 'known', value: -372 },
    { path: 'subscriber.finance.totalDue', status: 'known', value: 150 }
  ]
});
assert.equal(currentDue.decision, null, 'non-zero current totalDue must not be reclassified as historical-minus review');

console.log('ai_operator_finance_decision_nodes_test: ok');
