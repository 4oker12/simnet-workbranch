'use strict';

function present(value) {
  return value !== null && value !== undefined && value !== '';
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function mergePresent(base = {}, overlay = {}) {
  const merged = { ...object(base) };
  for (const [key, value] of Object.entries(object(overlay))) {
    if (!present(value)) continue;
    merged[key] = value;
  }
  return merged;
}

function mergeSection(base = {}, live = {}, { emptyIsValue = [] } = {}) {
  const merged = mergePresent(base, live);
  for (const key of emptyIsValue) {
    if (Object.hasOwn(object(live), key) && live[key] !== null && live[key] !== undefined) merged[key] = live[key];
  }
  return merged;
}

function fieldTimes({ base = {}, live = {}, baseEvidence = {}, observedAt = '' } = {}) {
  const times = { ...object(baseEvidence.fieldObservedAt) };
  const baseObservedAt = String(baseEvidence.billingSnapshotObservedAt || baseEvidence.observedAt || '');
  for (const section of ['identity', 'service', 'finance', 'network']) {
    for (const key of Object.keys(object(base[section]))) {
      const path = `${section}.${key}`;
      if (!times[path] && baseObservedAt) times[path] = baseObservedAt;
    }
    for (const [key, value] of Object.entries(object(live[section]))) {
      const path = `${section}.${key}`;
      const emptyIsConfirmed = section === 'service' && key === 'nextTariff' && value === '';
      if ((present(value) || emptyIsConfirmed) && observedAt) times[path] = observedAt;
    }
  }
  return times;
}

export function normalizeBillingMainSnapshot({ billingId = '', liveData = {}, baseData = {}, observedAt = '', cache = '' } = {}) {
  const live = object(liveData);
  const base = object(baseData);
  const evidence = mergePresent(base.evidence, live.evidence);
  if (observedAt) {
    evidence.observedAt = observedAt;
    evidence.billingSnapshotObservedAt = observedAt;
  }
  evidence.fieldObservedAt = fieldTimes({ base, live, baseEvidence: object(base.evidence), observedAt });

  const identity = mergePresent(mergePresent(base.identity, live.identity), { billingId });
  const service = mergeSection(base.service, live.service, { emptyIsValue: ['nextTariff'] });
  const payments = Array.isArray(live.payments)
    ? live.payments.slice(0, 6)
    : Array.isArray(base.payments) ? base.payments.slice(0, 6) : [];

  return {
    identity,
    service,
    finance: mergeSection(base.finance, live.finance),
    network: mergeSection(base.network, live.network),
    technical: mergePresent({}, base.technical),
    address: mergePresent({}, base.address),
    contacts: mergePresent({}, base.contacts),
    customer: mergePresent({}, base.customer),
    payments,
    evidence,
    source: 'billing-main-live-read-only',
    cache: String(cache || '')
  };
}

export function hasBillingMainData(snapshot = {}) {
  const sections = ['identity', 'service', 'finance', 'network'];
  return sections.some(section => Object.values(snapshot?.[section] || {}).some(present));
}

export function billingBalanceView(snapshot = {}) {
  const finance = snapshot.finance || {};
  const service = snapshot.service || {};
  const network = snapshot.network || {};
  return {
    ...finance,
    currentTariff: service.currentTariff || '',
    accessState: service.accessState || '',
    serviceState: service.serviceState || '',
    activeServices: Array.isArray(service.activeServices) ? service.activeServices : [],
    activeServicesTotal: service.activeServicesTotal ?? null,
    recentOperations: Array.isArray(snapshot.payments) ? snapshot.payments : [],
    trafficIncomingBytes: network.trafficIncomingBytes || '',
    trafficOutgoingBytes: network.trafficOutgoingBytes || '',
    source: snapshot.source || 'billing-main-live-read-only',
    evidence: snapshot.evidence || {},
    cache: snapshot.cache || ''
  };
}

export function billingTariffView(snapshot = {}) {
  const finance = snapshot.finance || {};
  const service = snapshot.service || {};
  const network = snapshot.network || {};
  return {
    ...service,
    tariffDisplay: service.tariffDisplay || service.currentTariff || '',
    price: finance.price ?? '',
    totalDue: finance.totalDue ?? '',
    balanceAfterTariff: finance.balanceAfterTariff ?? '',
    trafficIncomingBytes: network.trafficIncomingBytes || '',
    trafficOutgoingBytes: network.trafficOutgoingBytes || '',
    source: snapshot.source || 'billing-main-live-read-only',
    evidence: snapshot.evidence || {},
    cache: snapshot.cache || ''
  };
}
