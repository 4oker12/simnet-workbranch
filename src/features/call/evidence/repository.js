'use strict';

import {
  EVIDENCE_RETENTION_MS,
  MAX_EVIDENCE_EVENTS,
  EVIDENCE_TYPES
} from '../config.js';
import { normalizeEvidenceEvent } from './normalizer.js';

export function createEvidenceState(events = [], updatedAt = '') {
  return {
    schema: 'simnet-call-evidence-buffer',
    schemaVersion: 1,
    events: Array.isArray(events) ? events : [],
    updatedAt: String(updatedAt || '')
  };
}

function semanticDuplicate(left = {}, right = {}) {
  if (left.type !== right.type || left.source !== right.source) return false;
  if (left.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT) {
    const a = left.identity || {};
    const b = right.identity || {};
    const sameIdentity = Boolean(
      (a.caseId && a.caseId === b.caseId)
      || (a.customerId && a.customerId === b.customerId)
      || (a.billingId && a.billingId === b.billingId)
      || (a.contract && a.contract === b.contract)
    );
    return sameIdentity
      && left.pageType === right.pageType
      && (left.tabId == null || right.tabId == null || left.tabId === right.tabId)
      && Math.abs(Number(left.ts || 0) - Number(right.ts || 0)) <= 2500;
  }
  return left.searchKind === right.searchKind
    && left.query === right.query
    && left.targetSubscriberId === right.targetSubscriberId
    && (left.tabId == null || right.tabId == null || left.tabId === right.tabId)
    && Math.abs(Number(left.ts || 0) - Number(right.ts || 0)) <= 1500;
}

export function cleanupEvidenceBuffer(buffer = createEvidenceState(), atMs = Date.now()) {
  const cutoff = Number(atMs) - EVIDENCE_RETENTION_MS;
  const events = (Array.isArray(buffer.events) ? buffer.events : [])
    .filter(event => Number(event?.ts || 0) >= cutoff)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
    .slice(-MAX_EVIDENCE_EVENTS);
  buffer.events = events;
  return buffer;
}

export function appendEvidenceEvent(buffer = createEvidenceState(), raw = {}, options = {}) {
  cleanupEvidenceBuffer(buffer, options.nowMs ?? Date.now());
  const event = normalizeEvidenceEvent(raw, options);
  if (!event) return { accepted: false, added: false, event: null, buffer };

  const previous = buffer.events[buffer.events.length - 1] || null;
  if (previous && semanticDuplicate(previous, event)) {
    // Immutable ledger semantics: a duplicate read never moves the original ts.
    return { accepted: true, added: false, duplicate: true, event: previous, buffer };
  }
  buffer.events.push(event);
  buffer.events = buffer.events.slice(-MAX_EVIDENCE_EVENTS);
  buffer.updatedAt = options.nowIso || new Date(Number(options.nowMs ?? Date.now())).toISOString();
  return { accepted: true, added: true, duplicate: false, event, buffer };
}

export function evidenceInWindow(buffer = createEvidenceState(), startMs = 0, endMs = 0) {
  return (Array.isArray(buffer.events) ? buffer.events : []).filter(event => {
    const ts = Number(event?.ts || 0);
    return ts >= Number(startMs || 0) && ts <= Number(endMs || 0);
  });
}

export function resolveSearchSession(buffer = createEvidenceState(), event = {}, atMs = Date.now()) {
  const source = String(event.source || '');
  const tabId = event.tabId == null ? null : Number(event.tabId);
  const kind = String(event.type || '');
  const searches = Array.isArray(buffer.events) ? buffer.events : [];
  if (kind === EVIDENCE_TYPES.SEARCH_SUBMIT) {
    if (String(event.searchKind || '') !== 'address') return event.searchId;
    const prior = [...searches].reverse().find(item => (
      item.type === EVIDENCE_TYPES.SEARCH_SUBMIT
      && item.source === source
      && item.searchKind === 'address'
      && (tabId == null || item.tabId == null || Number(item.tabId) === tabId)
      && Number(atMs) - Number(item.ts || 0) >= 0
      && Number(atMs) - Number(item.ts || 0) <= 60_000
    ));
    return prior?.searchId || event.searchId;
  }
  const prior = [...searches].reverse().find(item => (
    item.type === EVIDENCE_TYPES.SEARCH_SUBMIT
    && item.source === source
    && (tabId == null || item.tabId == null || Number(item.tabId) === tabId)
    && Number(atMs) - Number(item.ts || 0) >= 0
    && Number(atMs) - Number(item.ts || 0) <= 180_000
  ));
  return prior?.searchId || event.searchId;
}

export const EvidenceRepository = Object.freeze({
  create: createEvidenceState,
  append: appendEvidenceEvent,
  cleanup: cleanupEvidenceBuffer,
  inWindow: evidenceInWindow,
  resolveSearchSession
});
