'use strict';

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

export function mergePresent(base = {}, overlay = {}) {
  const merged = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay && typeof overlay === 'object' && !Array.isArray(overlay) ? overlay : {})) {
    if (!present(value)) continue;
    merged[key] = value;
  }
  return merged;
}

export function normalizeBillingMainSnapshot({ billingId = '', liveData = {}, baseData = {}, observedAt = '', cache = '' } = {}) {
  const live = liveData && typeof liveData === 'object' ? liveData : {};
  const base = baseData && typeof baseData === 'object' ? baseData : {};
  const evidence = mergePresent(base.evidence, live.evidence);
  if (observedAt) evidence.observedAt = observedAt;

  return {
    identity: mergePresent(base.identity, { billingId }),
    service: mergePresent(base.service, live.service),
    finance: mergePresent(base.finance, live.finance),
    network: mergePresent(base.network, live.network),
    technical: mergePresent({}, base.technical),
    address: mergePresent({}, base.address),
    contacts: mergePresent({}, base.contacts),
    customer: mergePresent({}, base.customer),
    payments: Array.isArray(base.payments) ? base.payments.slice(0, 6) : [],
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
