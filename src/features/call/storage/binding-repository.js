'use strict';

import { BINDING_RETENTION_MS, MAX_ASSIGNMENT_LOG, MAX_BINDINGS } from '../config.js';
import { canonicalCallKey } from './call-repository.js';
import { normalizeCallIdentity } from '../evidence/normalizer.js';

export function createBindingStore() {
  return { schema: 'simnet-call-binding-repository-v1', bindings: {}, assignmentLog: [], updatedAt: '' };
}

export function getBinding(store = createBindingStore(), rawCallKey = '') {
  const key = canonicalCallKey(rawCallKey);
  return key ? store.bindings?.[key] || null : null;
}

export function putBinding(store = createBindingStore(), raw = {}, options = {}) {
  const callKey = canonicalCallKey(raw.callKey || '');
  if (!callKey) throw new Error('Invalid canonical call key');
  const identity = normalizeCallIdentity(raw.identity || raw);
  if (!identity.caseId && !identity.customerId && !identity.billingId && !identity.contract) {
    throw new Error('Binding requires subscriber identity');
  }
  const existing = store.bindings?.[callKey] || null;
  if (existing && existing.identity?.caseId && identity.caseId && existing.identity.caseId !== identity.caseId) {
    throw new Error('Call is already bound to another Case');
  }
  const at = String(options.nowIso || new Date().toISOString());
  const binding = {
    ...(existing || {}),
    schema: 'simnet-call-binding-v1',
    callKey,
    identity: { ...(existing?.identity || {}), ...identity },
    caseId: identity.caseId,
    customerId: identity.customerId,
    caseLabel: String(raw.caseLabel || existing?.caseLabel || identity.fullName || identity.login || identity.caseId || ''),
    snapshotFrozenAt: String(raw.snapshotFrozenAt || existing?.snapshotFrozenAt || ''),
    liveBoundAt: String(raw.liveBoundAt || existing?.liveBoundAt || ''),
    candidateConfidence: Number(raw.candidateConfidence ?? existing?.candidateConfidence ?? 0),
    mode: String(raw.mode || existing?.mode || 'snapshot-candidate'),
    explicit: true,
    registrationStatus: raw.registrationStatus && typeof raw.registrationStatus === 'object'
      ? raw.registrationStatus
      : (existing?.registrationStatus || { state: 'unknown', source: 'unknown' }),
    operatorOverride: raw.operatorOverride || existing?.operatorOverride || null,
    boundAt: existing?.boundAt || at,
    updatedAt: at
  };
  store.bindings ||= {};
  store.bindings[callKey] = binding;
  store.updatedAt = at;
  return { binding, existing: Boolean(existing) };
}

export function updateRegistrationStatus(store = createBindingStore(), callKey, status = {}, at = new Date().toISOString()) {
  const binding = getBinding(store, callKey);
  if (!binding) throw new Error('Call binding not found');
  binding.registrationStatus = {
    state: ['registered', 'unregistered', 'unknown', 'submitting', 'review_required'].includes(String(status.state || ''))
      ? String(status.state)
      : 'unknown',
    source: ['userside', 'workbench-local', 'unknown'].includes(String(status.source || ''))
      ? String(status.source)
      : 'unknown'
  };
  binding.updatedAt = String(at);
  store.updatedAt = String(at);
  return binding;
}

export function appendAssignment(store = createBindingStore(), row = {}) {
  const callKey = canonicalCallKey(row.callKey || '');
  if (!callKey) return false;
  const next = (Array.isArray(store.assignmentLog) ? store.assignmentLog : []).filter(item => item.callKey !== callKey);
  next.unshift({ ...row, callKey });
  store.assignmentLog = next.slice(0, MAX_ASSIGNMENT_LOG);
  return true;
}

export function cleanupBindings(store = createBindingStore(), atMs = Date.now()) {
  const cutoff = Number(atMs) - BINDING_RETENTION_MS;
  const entries = Object.entries(store.bindings || {})
    .filter(([, binding]) => (Date.parse(String(binding?.updatedAt || binding?.boundAt || '')) || 0) >= cutoff)
    .sort((a, b) => (Date.parse(b[1]?.updatedAt || '') || 0) - (Date.parse(a[1]?.updatedAt || '') || 0))
    .slice(0, MAX_BINDINGS);
  store.bindings = Object.fromEntries(entries);
  store.assignmentLog = (Array.isArray(store.assignmentLog) ? store.assignmentLog : []).slice(0, MAX_ASSIGNMENT_LOG);
  return store;
}

export const BindingRepository = Object.freeze({
  create: createBindingStore,
  get: getBinding,
  put: putBinding,
  updateRegistrationStatus,
  appendAssignment,
  cleanup: cleanupBindings
});
