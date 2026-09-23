'use strict';

function money(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const normalized = String(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}
function cents(value) { const numeric = money(value); return numeric === null ? null : Math.round(numeric * 100); }

export function calculateBalanceCoverage({ balance, recurringAmount } = {}) {
  const balanceCents = cents(balance); const recurringCents = cents(recurringAmount);
  if (balanceCents === null || recurringCents === null || recurringCents <= 0) {
    return { status: 'unknown', fullCharges: null, remainder: null, balance: money(balance), recurringAmount: money(recurringAmount) };
  }
  const spendable = Math.max(0, balanceCents);
  const fullCharges = Math.floor(spendable / recurringCents);
  const remainderCents = spendable - fullCharges * recurringCents;
  return { status: 'known', fullCharges, remainder: remainderCents / 100, balance: balanceCents / 100, recurringAmount: recurringCents / 100 };
}


export function calculateConnectionUpfrontPayment({ firstConnection, optical } = {}) {
  if (typeof firstConnection !== 'boolean' || typeof optical !== 'boolean') {
    return { status: 'unknown', total: null, items: [], includesTariffCharge: false };
  }
  const items = [];
  if (firstConnection) items.push({ code: 'initial_advance', label: 'Стартовый аванс', amount: 300 });
  if (optical) items.push({ code: 'optical_terminal', label: 'Оптический терминал ONU/ONT', amount: 500 });
  return {
    status: 'known',
    total: items.reduce((sum, item) => sum + item.amount, 0),
    items,
    includesTariffCharge: false
  };
}

export function isInactiveReturnNegativeBalanceQuestion(requestText = '') {
  const request = String(requestText || '').toLowerCase();
  if (!request) return false;
  const returning = /(?:восстанов|віднов|возобнов|поверн|вернул|верну|снова\s+польз|знов\s+корист|хочу[^.!?]{0,80}польз)/iu.test(request);
  const inactive = /(?:не\s+польз|не\s+корист|отсутств|відсут|не\s+жил|не\s+жив|уезж|виїж|давно|\b\d+\s*(?:год|года|лет|месяц|месяца|месяцев|рок|роки|років|місяц))/iu.test(request);
  const negativeBalance = /(?:минус|долг|задолж|борг|отрицател|від['’]?єм)/iu.test(request);
  return returning && inactive && negativeBalance;
}

export function isBalanceCoverageQuestion(requestText = '') {
  const request = String(requestText || '').toLowerCase();
  return /(?:до\s+какого|на\s+сколько|на\s+скільки|сколько\s+месяц|скільки\s+місяц|хватит|вистачить|проплачен|оплачен.*(?:до|на)|покрыва.*месяц|покрива.*місяц)/iu.test(request);
}

export function financeRequiredFacts(requestText = '') {
  if (isInactiveReturnNegativeBalanceQuestion(requestText)) {
    return ['subscriber.finance.balance.account', 'subscriber.finance.totalDue'];
  }
  return isBalanceCoverageQuestion(requestText)
    ? ['subscriber.finance.balance.account', 'subscriber.finance.recurringTotal']
    : [];
}

function evidenceMap(evidence = []) { return new Map((Array.isArray(evidence) ? evidence : []).map(item => [String(item?.path || ''), item])); }
function knownValue(map, path) { const item = map.get(path); return item && item.status === 'known' ? item.value : null; }

export function deriveFinanceDecisionEvidence({ requestText = '', evidence = [] } = {}) {
  const map = evidenceMap(evidence);

  if (isInactiveReturnNegativeBalanceQuestion(requestText)) {
    const balance = money(knownValue(map, 'subscriber.finance.balance.account'));
    const totalDue = money(knownValue(map, 'subscriber.finance.totalDue'));
    if (balance !== null && balance < 0 && totalDue === 0) {
      const source = 'deterministic.finance.inactive-return-review';
      const decision = {
        type: 'inactive_return_negative_balance_review',
        status: 'known',
        historicalBalance: balance,
        totalDue,
        historicalMinusMustBePaidBeforeReview: false,
        nextAction: 'finance_ticket',
        temporaryPaymentBridgeAllowed: true,
        writeOffGuaranteed: false
      };
      return { decision, evidence: [
        { path: 'derived.finance.inactiveReturn.financeReviewRequired', status: 'known', observed: true, value: true, source, derived: true },
        { path: 'derived.finance.inactiveReturn.historicalMinusMustBePaidBeforeReview', status: 'known', observed: true, value: false, source, derived: true },
        { path: 'derived.finance.inactiveReturn.temporaryPaymentBridgeAllowed', status: 'known', observed: true, value: true, source, derived: true },
        { path: 'derived.finance.inactiveReturn.writeOffGuaranteed', status: 'known', observed: true, value: false, source, derived: true },
        { path: 'derived.finance.inactiveReturn.observedNegativeBalance', status: 'known', observed: true, value: balance, source, derived: true },
        { path: 'derived.finance.inactiveReturn.observedTotalDue', status: 'known', observed: true, value: totalDue, source, derived: true }
      ]};
    }
  }

  if (!isBalanceCoverageQuestion(requestText)) return { decision: null, evidence: [] };
  const balance = knownValue(map, 'subscriber.finance.balance.account');
  const recurringAmount = knownValue(map, 'subscriber.finance.recurringTotal');
  const decision = calculateBalanceCoverage({ balance, recurringAmount });
  if (decision.status !== 'known') return { decision, evidence: [] };
  const source = 'deterministic.finance.coverage';
  return { decision, evidence: [
    { path: 'derived.finance.coverage.fullCharges', status: 'known', observed: true, value: decision.fullCharges, source, derived: true },
    { path: 'derived.finance.coverage.remainder', status: 'known', observed: true, value: decision.remainder, source, derived: true },
    { path: 'derived.finance.coverage.recurringAmount', status: 'known', observed: true, value: decision.recurringAmount, source, derived: true },
    { path: 'derived.finance.coverage.calendarMappingAllowed', status: 'known', observed: true, value: false, source, derived: true, provenance: 'No source-backed next-charge calendar anchor is supplied by this arithmetic node' }
  ]};
}
