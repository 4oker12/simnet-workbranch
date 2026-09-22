'use strict';

/**
 * Fact-level evidence gate.
 *
 * Contract:
 *   tool.ok === true  ≠  requested fact is known
 *   neighboring field ≠ requested field
 *
 * Status vocabulary for required facts after resolution attempt:
 *   KNOWN | ABSENT | UNKNOWN | UNAVAILABLE | NOT_APPLICABLE
 *
 * This module is pure and fixture-agnostic. Diagnostic examples in product
 * specs (pause labels, specific logins, amounts) must not appear here as rules.
 */

export const FACT_RESOLUTION_STATUS = Object.freeze({
  KNOWN: 'KNOWN',
  ABSENT: 'ABSENT',
  UNKNOWN: 'UNKNOWN',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
});

function clean(value, max = 400) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * General product / catalog tariff question — not "my current tariff".
 * Uses request shape, not specific product names or service states.
 */
export function isTariffCatalogScope(requestText = '') {
  const request = clean(requestText, 800).toLowerCase();
  if (!request) return false;

  const subscriberCurrent = /(?:у\s+меня|у\s+мене|мой|мій|текущ|поточн|сейчас\s+у|зараз\s+у).{0,40}(?:тариф|пакет)|(?:какой|який)\s+(?:у\s+меня|у\s+мене)\s+(?:тариф|пакет)/iu.test(request);
  if (subscriberCurrent) return false;

  const catalogShape = (
    /(?:какие|які|какой\s+есть|який\s+є|покажи|показать|покажіть).{0,50}(?:тариф|пакет|линейк|каталог)/iu.test(request)
    || /(?:тариф|пакет).{0,40}(?:доступн|есть\s+у\s+вас|є\s+у\s+вас|предлагаете|пропонуєте|варианты|варіанти|на\s+выбор|на\s+вибір)/iu.test(request)
    || /(?:обычн|звичайн).{0,24}(?:стандарт|тариф|пакет)/iu.test(request)
    || /(?:тарифн\w*\s+линейк|каталог\s+тариф)/iu.test(request)
  );
  return catalogShape;
}

/**
 * Subscriber current-tariff question shape.
 */
export function isSubscriberCurrentTariffScope(requestText = '') {
  const request = clean(requestText, 800).toLowerCase();
  if (isTariffCatalogScope(request)) return false;
  return (
    /(?:какой|який|мой|мій|текущ|поточн).{0,40}(?:тариф|пакет)/iu.test(request)
    || /(?:тариф|пакет).{0,30}(?:сейчас|зараз|у\s+меня|у\s+мене)/iu.test(request)
    || /(?:что|що).{0,20}по\s+(?:тариф|пакет)/iu.test(request)
  );
}

/**
 * Map one canonical evidence row into a resolution status.
 */
export function statusFromCanonicalEvidence(row = {}) {
  const status = String(row?.status || '').toLowerCase();
  const code = String(row?.code || '').toUpperCase();

  if (status === 'known') return FACT_RESOLUTION_STATUS.KNOWN;
  if (status === 'absent') return FACT_RESOLUTION_STATUS.ABSENT;

  if (code === 'SOURCE_UNAVAILABLE' || code === 'FRESH_DATA_UNAVAILABLE' || code === 'UNKNOWN_TOOL') {
    return FACT_RESOLUTION_STATUS.UNAVAILABLE;
  }
  if (code === 'NOT_APPLICABLE') return FACT_RESOLUTION_STATUS.NOT_APPLICABLE;
  return FACT_RESOLUTION_STATUS.UNKNOWN;
}

/**
 * Every requested canonical fact must receive an explicit resolution state.
 * Missing evidence rows become UNKNOWN (never silently dropped).
 */
export function summarizeCanonicalFactResolution({
  requestedFacts = [],
  evidence = [],
  sourceTrace = []
} = {}) {
  const paths = (Array.isArray(requestedFacts) ? requestedFacts : [])
    .map(item => String(typeof item === 'string' ? item : item?.path || '').trim())
    .filter(Boolean);

  const byPath = new Map();
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const path = String(row?.path || '').trim();
    if (path) byPath.set(path, row);
  }

  const sourceByFact = new Map();
  for (const trace of Array.isArray(sourceTrace) ? sourceTrace : []) {
    for (const path of Array.isArray(trace?.requestedFacts) ? trace.requestedFacts : []) {
      sourceByFact.set(path, trace);
    }
  }

  const facts = paths.map(path => {
    const row = byPath.get(path);
    if (!row) {
      const trace = sourceByFact.get(path);
      const code = !trace
        ? 'FACT_NOT_ATTEMPTED'
        : (!trace.ok ? clean(trace.code || 'SOURCE_UNAVAILABLE', 80) : 'FIELD_NOT_OBSERVED');
      const status = code === 'SOURCE_UNAVAILABLE' || code === 'UNKNOWN_TOOL' || code === 'FRESH_DATA_UNAVAILABLE'
        ? FACT_RESOLUTION_STATUS.UNAVAILABLE
        : FACT_RESOLUTION_STATUS.UNKNOWN;
      return { path, status, observed: false, code };
    }
    const status = statusFromCanonicalEvidence(row);
    return {
      path,
      status,
      observed: Boolean(row.observed),
      code: row.code || undefined,
      value: row.value
    };
  });

  const known = facts.filter(f => f.status === FACT_RESOLUTION_STATUS.KNOWN).map(f => f.path);
  const unknown = facts.filter(f => f.status === FACT_RESOLUTION_STATUS.UNKNOWN).map(f => f.path);
  const unavailable = facts.filter(f => f.status === FACT_RESOLUTION_STATUS.UNAVAILABLE).map(f => f.path);
  const absent = facts.filter(f => f.status === FACT_RESOLUTION_STATUS.ABSENT).map(f => f.path);
  const notApplicable = facts.filter(f => f.status === FACT_RESOLUTION_STATUS.NOT_APPLICABLE).map(f => f.path);

  const unresolved = facts
    .filter(f => f.status === FACT_RESOLUTION_STATUS.UNKNOWN || f.status === FACT_RESOLUTION_STATUS.UNAVAILABLE)
    .map(f => f.path);

  const allRequiredResolved = paths.length > 0 && unresolved.length === 0;
  const requestClosed = allRequiredResolved;

  return {
    facts,
    known,
    unknown,
    unavailable,
    absent,
    notApplicable,
    unresolved,
    allRequiredResolved,
    requestClosed
  };
}

/**
 * Legacy tool.ok coverage: tool success does not imply requested fact coverage.
 */
export function evaluateLegacyToolFactCoverage(item = {}) {
  if (!item?.ok) {
    return { covered: false, reason: 'tool_not_ok' };
  }
  if (Array.isArray(item?.requestedFacts) && item.requestedFacts.length > 0) {
    return { covered: false, reason: 'canonical_source_trace_use_fact_evidence' };
  }

  const tool = String(item?.tool || '');
  if (['customer.lookup', 'customer.confirm'].includes(tool)) {
    return { covered: true, reason: 'identity_tool' };
  }

  const data = item?.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  const request = `${clean(item?.requestedBy?.field, 320)} ${clean(item?.requestedBy?.why, 420)}`.toLowerCase();

  const hasOwn = (key, { allowEmpty = false } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
    const value = data[key];
    if (allowEmpty) return value !== undefined && value !== null;
    if (Array.isArray(value)) return true;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  };
  const hasAny = (keys, options) => keys.some(key => hasOwn(key, options));

  if (tool === 'billing.tariff' || tool === 'billing.main_summary') {
    if (isTariffCatalogScope(request)) {
      return {
        covered: false,
        reason: 'tariff_catalog_request_not_satisfied_by_subscriber_current_tariff'
      };
    }
  }

  if (tool === 'billing.balance') {
    const asksPaymentMoment = /(?:дата|когда|коли|последн|останн).{0,40}(?:плат[её]ж|платіж|оплат|payment)|(?:плат[её]ж|платіж|оплат|payment).{0,40}(?:дата|когда|коли|последн|останн)/iu.test(request);
    if (asksPaymentMoment) return { covered: false, reason: 'payment_moment_not_in_balance_payload' };
    if (/долг|борг|задолж|заборг|к\s+оплат|до\s+сплат|total\s*due/iu.test(request)) {
      return hasOwn('totalDue')
        ? { covered: true, reason: 'totalDue_observed' }
        : { covered: false, reason: 'totalDue_missing' };
    }
    if (/временн.*плат|тимчасов.*плат|temporary/iu.test(request)) {
      return hasOwn('temporaryPayment', { allowEmpty: true })
        ? { covered: true, reason: 'temporaryPayment_observed' }
        : { covered: false, reason: 'temporaryPayment_missing' };
    }
    if (/цен|стоим|варт|абонплат|price/iu.test(request)) {
      return hasOwn('price')
        ? { covered: true, reason: 'price_observed' }
        : { covered: false, reason: 'price_missing' };
    }
    if (/баланс|balance|на\s+сч[её]т|на\s+рахунк/iu.test(request)) {
      return hasOwn('accountBalance')
        ? { covered: true, reason: 'accountBalance_observed' }
        : { covered: false, reason: 'accountBalance_missing' };
    }
    return hasAny(['accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment', 'totalDue', 'price'])
      ? { covered: true, reason: 'finance_field_observed' }
      : { covered: false, reason: 'finance_fields_missing' };
  }

  if (tool === 'billing.tariff') {
    if (/smart\s*tv|смарт\s*тв|телевид|\bтв\b|\btv\b/iu.test(request)) {
      return hasAny(['smartTv', 'smartTV', 'tv', 'tvPackage', 'television', 'services'])
        ? { covered: true, reason: 'tv_field_observed' }
        : { covered: false, reason: 'tv_field_missing' };
    }
    if (/скорост|швидк|speed/iu.test(request)) {
      const speedText = clean(data?.currentTariff || data?.tariffDisplay || '', 420);
      const hasSpeed = hasAny(['speed', 'tariffSpeed', 'speedMbit', 'speedMbps'])
        || /\b\d+(?:[.,]\d+)?\s*(?:m(?:bit|bps)|мб(?:ит|іт)(?:\/с)?|гб(?:ит|іт)(?:\/с)?)/iu.test(speedText);
      return hasSpeed
        ? { covered: true, reason: 'speed_observed' }
        : { covered: false, reason: 'speed_missing' };
    }
    if (/цен|стоим|варт|абонплат|price|сколько\s+стоит|скільки\s+кошту/iu.test(request)) {
      return hasOwn('price') || /^\s*тариф\s+\d+(?:[.,]\d+)?\b/iu.test(clean(data?.currentTariff || data?.tariffDisplay || '', 420))
        ? { covered: true, reason: 'tariff_price_observed' }
        : { covered: false, reason: 'tariff_price_missing' };
    }
    if (/следующ|наступн|next|future/iu.test(request)) {
      return hasOwn('nextTariff', { allowEmpty: true })
        ? { covered: true, reason: 'nextTariff_observed' }
        : { covered: false, reason: 'nextTariff_missing' };
    }
    if (isSubscriberCurrentTariffScope(request) || /тариф|tariff|пакет/iu.test(request)) {
      return hasAny(['currentTariff', 'tariffDisplay'])
        ? { covered: true, reason: 'current_tariff_observed' }
        : { covered: false, reason: 'current_tariff_missing' };
    }
    return hasAny(['currentTariff', 'tariffDisplay', 'price', 'nextTariff'], { allowEmpty: true })
      ? { covered: true, reason: 'tariff_payload_observed' }
      : { covered: false, reason: 'tariff_payload_empty' };
  }

  if (request && Object.keys(data).filter(k => !/^(?:source|observedAt|evidence|message|warning|warnings)$/i.test(k)).length === 0) {
    return { covered: false, reason: 'empty_payload' };
  }
  return { covered: meaningfulGenericData(data), reason: meaningfulGenericData(data) ? 'generic_payload' : 'no_meaningful_data' };
}

function meaningfulGenericData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.entries(data).some(([key, value]) => {
    if (/^(?:source|observedAt|evidence|message|warning|warnings)$/i.test(key)) return false;
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return true;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

export function isRequestedLegacyFactCovered(item = {}) {
  return evaluateLegacyToolFactCoverage(item).covered;
}
