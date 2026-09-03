'use strict';

import { EVIDENCE_TYPES, EVIDENCE_TYPE_SET } from '../config.js';

const clean = (value, max = 240) => String(value == null ? '' : value)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const digits = (value, max = 16) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const factValue = raw => raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')
  ? raw.value
  : raw;

export function normalizeCallIdentity(raw = {}) {
  const identity = raw.identity || raw;
  const login = clean(factValue(identity.login), 48);
  const contract = digits(factValue(identity.contract) || login.replace(/^abon/i, ''), 16);
  return {
    caseId: clean(factValue(identity.caseId), 100),
    customerId: digits(factValue(identity.customerId), 14),
    billingId: digits(factValue(identity.billingId), 14),
    contract,
    login: login || (contract ? `abon${contract}` : ''),
    fullName: clean(factValue(identity.fullName) || factValue(raw.fullName), 140)
  };
}

export function identityAliases(identity = {}) {
  const normalized = normalizeCallIdentity(identity);
  return [
    normalized.caseId && `case:${normalized.caseId}`,
    normalized.customerId && `customer:${normalized.customerId}`,
    normalized.billingId && `billing:${normalized.billingId}`,
    normalized.contract && `contract:${normalized.contract}`,
    normalized.login && `login:${normalized.login.toLowerCase()}`
  ].filter(Boolean);
}

export function mergeCallIdentity(left = {}, right = {}) {
  const a = normalizeCallIdentity(left);
  const b = normalizeCallIdentity(right);
  const pick = key => a[key] || b[key] || '';
  return {
    caseId: pick('caseId'),
    customerId: pick('customerId'),
    billingId: pick('billingId'),
    contract: pick('contract'),
    login: pick('login'),
    fullName: pick('fullName')
  };
}

export function evidenceTypeFromLegacy(raw = {}) {
  const explicit = String(raw.type || '').toUpperCase().replace(/[-\s]+/g, '_');
  if (EVIDENCE_TYPE_SET.has(explicit)) return explicit;
  const kind = String(raw.kind || raw.type || '').toLowerCase();
  if (kind === 'submit' || kind === 'query' || kind === 'search-submit' || kind === 'search-query') return EVIDENCE_TYPES.SEARCH_SUBMIT;
  if (kind === 'resolved' || kind === 'search-resolved') return EVIDENCE_TYPES.SEARCH_RESOLVED;
  if (kind === 'result-open' || kind === 'search-result-open') return EVIDENCE_TYPES.SEARCH_RESULT_OPEN;
  if (kind === 'visit' || kind === 'subscriber-visit') return EVIDENCE_TYPES.SUBSCRIBER_VISIT;
  if (kind === 'handoff') return EVIDENCE_TYPES.HANDOFF;
  return '';
}

export function normalizeEvidenceEvent(raw = {}, options = {}) {
  const type = evidenceTypeFromLegacy(raw);
  const ts = Math.max(0, Number(raw.ts || options.nowMs || Date.now()));
  const source = ['billing', 'userside'].includes(String(raw.source || '').toLowerCase())
    ? String(raw.source).toLowerCase()
    : '';
  if (!type || !ts || !source) return null;

  const targetSubscriberId = digits(raw.targetSubscriberId || raw.targetCustomerId || raw.subscriberId, 14);
  let identity = normalizeCallIdentity(raw.identity || {});
  if (!identity.caseId && raw.caseId) identity.caseId = clean(raw.caseId, 100);
  if (type === EVIDENCE_TYPES.SUBSCRIBER_VISIT) {
    if (source === 'billing' && !identity.billingId) identity.billingId = digits(raw.billingId || raw.subscriberId, 14);
    if (source === 'userside' && !identity.customerId) identity.customerId = digits(raw.customerId || raw.subscriberId, 14);
    // contract is never inferred from Billing's internal entity/subscriber id.
    const legacyContract = digits(raw.contractId, 16);
    const safeLegacyContract = source === 'billing' && legacyContract === identity.billingId ? '' : legacyContract;
    identity.contract = digits(raw.contract || identity.contract || safeLegacyContract, 16);
    if (!identity.login && identity.contract) identity.login = `abon${identity.contract}`;
  } else if (targetSubscriberId) {
    if (source === 'billing' && !identity.billingId) identity.billingId = targetSubscriberId;
    if (source === 'userside' && !identity.customerId) identity.customerId = targetSubscriberId;
  }

  const searchId = clean(raw.searchId, 120);
  const parentSearchTs = Math.max(0, Number(raw.parentSearchTs || 0));
  const event = {
    id: clean(raw.id, 120) || `${type}:${source}:${ts}:${searchId || targetSubscriberId || clean(raw.pageType, 40)}`,
    ts,
    type,
    source,
    tabId: raw.tabId == null || !Number.isFinite(Number(raw.tabId)) ? null : Number(raw.tabId),
    searchId,
    parentSearchTs,
    query: clean(raw.query, 180),
    searchKind: clean(raw.searchKind || 'generic', 24),
    targetSubscriberId,
    resolution: clean(raw.resolution, 60),
    resultCount: Math.max(0, Math.min(50, Number(raw.resultCount || 0) || 0)),
    pageType: clean(raw.pageType, 40),
    pageUrl: clean(raw.pageUrl || raw.url, 240),
    identity,
    handoff: raw.handoff && typeof raw.handoff === 'object' ? {
      purpose: clean(raw.handoff.purpose, 80),
      token: clean(raw.handoff.token, 100)
    } : null
  };
  if (type === EVIDENCE_TYPES.SEARCH_SUBMIT && !event.query) return null;
  if ([EVIDENCE_TYPES.SEARCH_RESOLVED, EVIDENCE_TYPES.SEARCH_RESULT_OPEN].includes(type)
      && !event.targetSubscriberId) return null;
  if ([EVIDENCE_TYPES.SUBSCRIBER_VISIT, EVIDENCE_TYPES.HANDOFF].includes(type)
      && !identityAliases(event.identity).length) return null;
  return event;
}

export function compactEvidenceCopy(event = {}) {
  const identity = normalizeCallIdentity(event.identity || {});
  return {
    id: clean(event.id, 120),
    ts: Number(event.ts || 0),
    type: evidenceTypeFromLegacy(event),
    source: clean(event.source, 16),
    tabId: event.tabId == null ? null : Number(event.tabId),
    searchId: clean(event.searchId, 120),
    parentSearchTs: Number(event.parentSearchTs || 0),
    query: clean(event.query, 180),
    searchKind: clean(event.searchKind, 24),
    targetSubscriberId: digits(event.targetSubscriberId, 14),
    resolution: clean(event.resolution, 60),
    pageType: clean(event.pageType, 40),
    identity
  };
}
