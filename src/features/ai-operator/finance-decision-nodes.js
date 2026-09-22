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

export function isBalanceCoverageQuestion(requestText = '') {
  const request = String(requestText || '').toLowerCase();
  return /(?:до\s+какого|на\s+сколько|на\s+скільки|сколько\s+месяц|скільки\s+місяц|хватит|вистачить|проплачен|оплачен.*(?:до|на)|покрыва.*месяц|покрива.*місяц)/iu.test(request);
}

export function financeRequiredFacts(requestText = '') {
  return isBalanceCoverageQuestion(requestText)
    ? ['subscriber.finance.balance.account', 'subscriber.tariff.current.price']
    : [];
}

function evidenceMap(evidence = []) { return new Map((Array.isArray(evidence) ? evidence : []).map(item => [String(item?.path || ''), item])); }
function knownValue(map, path) { const item = map.get(path); return item && item.status === 'known' ? item.value : null; }

export function deriveFinanceDecisionEvidence({ requestText = '', evidence = [] } = {}) {
  if (!isBalanceCoverageQuestion(requestText)) return { decision: null, evidence: [] };
  const map = evidenceMap(evidence);
  const balance = knownValue(map, 'subscriber.finance.balance.account');
  const recurringAmount = knownValue(map, 'subscriber.tariff.current.price');
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
