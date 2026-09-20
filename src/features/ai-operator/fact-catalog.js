// SIMNET source semantics live here, not in the language model's prompt.
// Durations are cache policy, not claims about CRM update frequency.
export {
  CANONICAL_FACT_CATALOG,
  CANONICAL_SOURCE_CATALOG,
  LEGACY_FACT_ALIASES,
  canonicalFactPath,
  normalizeCanonicalFacts
} from './canonical-fact-catalog.js';

const billing = (path, type = 'text') => ({ source: 'customer.snapshot', path, type, ttlMs: 120000 });
export const FACT_CATALOG = Object.freeze({
  accountBalance: billing('finance.accountBalance', 'money'),
  monthlyTotal: billing('finance.totalDue', 'money'),
  balanceAfterCurrentPeriod: billing('finance.balanceAfterTariff', 'money'),
  currentTariff: billing('service.currentTariff'),
  nextTariff: billing('service.nextTariff', 'optionalText'),
  nextTariffPrice: billing('service.nextTariffPrice', 'money'),
  activeServicesTotal: billing('service.activeServicesTotal', 'money'),
  group: billing('service.group'),
  accessState: billing('service.accessState'),
  serviceState: billing('service.serviceState'),
  startDay: billing('service.startDay', 'number'),
  accessTechnology: billing('service.connectionFamily'),
  nextChargeAt: billing('finance.nextChargeAt'),
  payments: { source: 'billing.payments', path: 'payments', type: 'array', ttlMs: 120000 },
  sessionStatus: { source: 'network.session', path: 'status', type: 'text', ttlMs: 45000 },
  onuStatus: { source: 'pon.onu', path: 'status', type: 'text', ttlMs: 60000 }
});

// Recipes describe facts, never customer phrasings. Period is an independent axis.
export const FACT_RECIPES = Object.freeze({
  'balance.amount': ['accountBalance'],
  'recurring_charge.amount': ['monthlyTotal', 'balanceAfterCurrentPeriod', 'nextTariff', 'group', 'currentTariff', 'accessState', 'startDay'],
  'recurring_charge.coverage': ['balanceAfterCurrentPeriod', 'group', 'currentTariff', 'accessState', 'startDay'],
  'recurring_charge.timing': ['nextChargeAt'],
  'tariff.info': ['currentTariff'],
  'payment.history': ['payments'],
  'service.status': ['group', 'currentTariff', 'accessState', 'startDay'],
  'network.cause': ['group', 'currentTariff', 'accessState', 'startDay', 'accessTechnology']
});

export const RULE_VERSION = 'simnet-finance-2';
export const STATIC_IP_PRICE_KOP = 5000;
export function periodAt(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(new Date(now));
}
export function moneyKop(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const raw = String(value).trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const kop = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(kop) ? (negative ? -kop : kop) : null;
}
export function formatMoney(kop, language = 'ru') {
  return (kop / 100).toLocaleString(language === 'uk' ? 'uk-UA' : 'ru-RU', { minimumFractionDigits: kop % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' грн';
}
function at(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}
function typed(value, type) {
  if (type === 'money') return moneyKop(value);
  if (type === 'number') return value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === 'array') return Array.isArray(value) ? value : null;
  if (type === 'optionalText') return typeof value === 'string' ? value.trim() : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function readFact(store, name, caseId, now, period = periodAt(now)) {
  const fact = store?.[name];
  return fact && fact.caseId === caseId && fact.period === period && fact.expiresAt > now ? fact : null;
}
export function ingestFacts(store, result, caseId, now, invalidatedAt = 0) {
  if (!result?.ok || !caseId) return store;
  const data = result.data || {};
  // A cached adapter read does not make the observation newer.
  const timestamp = result.tool === 'customer.snapshot' && data.evidence
    ? data.evidence.observedAt || data.evidence.billingSnapshotObservedAt || ''
    : data.observedAt ?? result.observedAt;
  const sourceObservedAt = Date.parse(timestamp || '');
  for (const [name, spec] of Object.entries(FACT_CATALOG)) {
    if (spec.source !== result.tool) continue;
    const times = data.evidence?.fieldObservedAt;
    const observedAt = times ? Date.parse(times[spec.path] || '') : sourceObservedAt;
    const value = typed(at(data, spec.path), spec.type);
    // Missing fields in a newer snapshot invalidate their previous values.
    delete store[name];
    if (value === null || !Number.isFinite(observedAt) || observedAt < invalidatedAt || observedAt > now + 5000) continue;
    store[name] = { name, value, caseId, period: periodAt(observedAt), provenance: 'direct', source: result.tool,
      observedAt, expiresAt: observedAt + spec.ttlMs, version: `${observedAt}:${JSON.stringify(value)}` };
  }
  return store;
}
export function subscriberStatus(values) {
  const removed = /^(?:удаленные|удалённые|видалені)$/i.test(values.group || '') &&
    /^(?:заблокирован|заблоковано|заблокований)$/i.test(values.currentTariff || '') &&
    /^(?:запрещен|запрещён|заборонено|заборонений)$/i.test(values.accessState || '') && values.startDay < 0;
  if (removed) return 'inactive_removed';
  if (/^(?:запрещен|запрещён|заборонено|заборонений)$/i.test(values.accessState || '')) return 'access_denied';
  if (values.startDay < 0) return 'inactive_unknown';
  if (/^(?:разрешен|разрешён|дозволено|дозволений)$/i.test(values.accessState || '') && values.startDay >= 0 && values.currentTariff) return 'active';
  return 'unknown';
}
export function derivePayment(values, question, now) {
  const status = subscriberStatus(values);
  if (status !== 'active') return { ok: false, gap: 'service_state' };
  if (!Number.isSafeInteger(values.monthlyTotal)) return { ok: false, gap: 'monthlyTotal' };
  const current = periodAt(now);
  const [year, month] = current.split('-').map(Number);
  if (question.period === 'current') return { ok: true, monthlyTotal: values.monthlyTotal, period: current };
  if (!Object.hasOwn(values, 'nextTariff')) return { ok: false, gap: 'nextTariff' };
  let monthlyTotal = values.monthlyTotal;
  if (values.nextTariff) {
    if (!Number.isSafeInteger(values.nextTariffPrice) || !Number.isSafeInteger(values.activeServicesTotal)) return { ok: false, gap: 'nextTariffPrice' };
    monthlyTotal = values.nextTariffPrice + values.activeServicesTotal;
  }
  const targetYear = question.year || year;
  const months = question.period === 'year_end' ? (targetYear - year) * 12 + 12 - month : 1;
  if (months < 0 || months > 120) return { ok: false, gap: 'period' };
  const charges = monthlyTotal * months;
  const balance = values.balanceAfterCurrentPeriod;
  if (!Number.isSafeInteger(balance)) return { ok: false, gap: 'balanceAfterCurrentPeriod', monthlyTotal };
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return { ok: true, monthlyTotal, charges, months, available: balance,
    requiredTopUp: Math.max(0, charges - balance),
    period: question.period === 'year_end' ? `${next}/${targetYear}-12` : next,
    assumption: question.period === 'year_end' ? 'unchanged_recurring_services' : null };
}
