'use strict';

import { CALL_RETENTION_MS, MAX_CALLS } from '../config.js';
import { CallRecord } from '../domain/call-record.js';

const clean = (value, max = 160) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const normalizedPhone = value => {
  const raw = digits(value, 15);
  if (/^380\d{9}$/.test(raw)) return `0${raw.slice(3)}`;
  if (/^80\d{9}$/.test(raw)) return `0${raw.slice(2)}`;
  return raw;
};
const maskedPhone = value => {
  const phone = normalizedPhone(value);
  return phone.length >= 7 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : (phone ? '***' : '');
};

export function canonicalCallKey(raw = {}) {
  if (typeof raw === 'string') {
    const match = raw.match(/^call:(\d{1,24})$/);
    return match ? `call:${match[1]}` : '';
  }
  const usersideCallId = digits(raw.usersideCallId || raw.callId, 24);
  return usersideCallId ? `call:${usersideCallId}` : '';
}

export function legacyPbxKey(raw = {}) {
  const value = typeof raw === 'string' ? raw : raw.callKey || raw.recordId;
  const match = String(value || '').match(/(?:^pbx:)?(\d{9,12}\.\d{1,12})$/);
  return match ? `pbx:${match[1]}` : '';
}

export function normalizeCanonicalCall(raw = {}, observedAt = new Date().toISOString()) {
  const callKey = canonicalCallKey(raw);
  const usersideCallId = digits(raw.usersideCallId || raw.callId, 24);
  const startedAtMs = Math.max(0, Number(raw.startedAtMs || 0));
  const durationSeconds = Math.max(0, Math.min(86_400, Number(raw.durationSeconds || 0)));
  if (!callKey || !usersideCallId || !startedAtMs) return null;
  const completed = durationSeconds > 0 && raw.ongoing !== true;
  const recordId = String(raw.recordId || raw.pbxRecordId || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
  return {
    schema: 'simnet-call-record-v2',
    callKey,
    usersideCallId,
    pbxRecordId: recordId,
    legacyAliases: recordId ? [`pbx:${recordId}`] : [],
    source: 'userside:call_list',
    date: clean(raw.date, 16),
    time: clean(raw.time, 16),
    startedAtMs,
    endedAtMs: completed ? startedAtMs + durationSeconds * 1000 : 0,
    duration: clean(raw.duration, 20),
    durationSeconds,
    direction: clean(raw.direction, 20),
    callerId: normalizedPhone(raw.callerId),
    callerMasked: clean(raw.callerMasked, 24) || maskedPhone(raw.callerId),
    agent: clean(raw.agent, 120),
    agentExtension: clean(raw.agentExtension, 12),
    customerId: digits(raw.customerId, 14),
    customerCandidates: Array.isArray(raw.customerCandidates) ? raw.customerCandidates.slice(0, 12).map(item => ({
      customerId: digits(item?.customerId, 14),
      login: clean(item?.login, 48),
      fio: clean(item?.fio, 140)
    })).filter(item => item.customerId) : [],
    login: clean(raw.login, 48),
    contract: clean(raw.contract, 48),
    fio: clean(raw.fio, 140),
    status: completed ? 'completed' : (raw.ongoing === true ? 'ongoing' : 'unknown'),
    ongoing: raw.ongoing === true,
    bindable: completed,
    observedAt: clean(raw.observedAt || observedAt, 40),
    firstObservedAt: clean(raw.firstObservedAt || raw.observedAt || observedAt, 40),
    updatedAt: clean(observedAt, 40)
  };
}

export function createCallStore() {
  return { schema: 'simnet-call-repository-v2', calls: {}, unresolvedLegacy: [], updatedAt: '' };
}

function mergeCanonical(previous = null, observed = {}) {
  const preserved = previous || {};
  const next = {
    ...preserved,
    ...observed,
    schema: 'simnet-call-record-v2',
    firstObservedAt: preserved.firstObservedAt || observed.firstObservedAt,
    legacyAliases: [...new Set([...(preserved.legacyAliases || []), ...(observed.legacyAliases || [])])],
    subscriber: preserved.subscriber || null,
    registration: preserved.registration || undefined,
    processing: preserved.processing || undefined,
    transcript: preserved.transcript || null,
    ai: preserved.ai || null,
    writeback: preserved.writeback || undefined,
    timeline: Array.isArray(preserved.timeline) ? preserved.timeline : []
  };
  return CallRecord.from(next).toJSON();
}

export function upsertCanonicalCall(store = createCallStore(), raw = {}, observedAt = new Date().toISOString()) {
  const call = normalizeCanonicalCall(raw, observedAt);
  if (!call) return { stored: false, call: null, store };
  const previous = store.calls?.[call.callKey] || null;
  store.calls ||= {};
  store.calls[call.callKey] = mergeCanonical(previous, call);
  store.updatedAt = observedAt;
  return { stored: true, call: store.calls[call.callKey], store };
}

export function mutateCall(store = createCallStore(), rawKey = '', mutator = () => {}, at = new Date().toISOString()) {
  const call = getCall(store, rawKey);
  if (!call) return { updated: false, call: null, store };
  const record = CallRecord.from(call);
  mutator(record);
  const next = record.toJSON();
  next.updatedAt = clean(at, 40);
  store.calls[next.callKey] = next;
  store.updatedAt = next.updatedAt;
  return { updated: true, call: next, store };
}

export function cleanupCalls(store = createCallStore(), atMs = Date.now()) {
  const cutoff = Number(atMs) - CALL_RETENTION_MS;
  const entries = Object.entries(store.calls || {})
    .filter(([, call]) => Number(call?.startedAtMs || 0) >= cutoff)
    .sort((a, b) => Number(b[1]?.startedAtMs || 0) - Number(a[1]?.startedAtMs || 0))
    .slice(0, MAX_CALLS);
  store.calls = Object.fromEntries(entries);
  store.unresolvedLegacy = (Array.isArray(store.unresolvedLegacy) ? store.unresolvedLegacy : []).slice(-80);
  return store;
}

export function getCall(store = createCallStore(), rawKey = '') {
  const callKey = canonicalCallKey(rawKey);
  if (callKey) return store.calls?.[callKey] || null;
  const legacy = legacyPbxKey(rawKey);
  if (!legacy) return null;
  return Object.values(store.calls || {}).find(call => (call.legacyAliases || []).includes(legacy)) || null;
}

export function findByPbxRecordId(store = createCallStore(), recordId = '') {
  const legacy = legacyPbxKey(recordId);
  if (!legacy) return null;
  return Object.values(store.calls || {}).find(call => (
    call?.pbxRecordId && `pbx:${call.pbxRecordId}` === legacy
  ) || (call?.legacyAliases || []).includes(legacy)) || null;
}

export function listCalls(store = createCallStore()) {
  return Object.values(store.calls || {}).sort((a, b) => Number(b.startedAtMs || 0) - Number(a.startedAtMs || 0));
}

export function listAttentionCalls(store = createCallStore()) {
  return listCalls(store).filter(call => CallRecord.from(call).needsAttention());
}

export const CallRepository = Object.freeze({
  create: createCallStore,
  canonicalCallKey,
  legacyPbxKey,
  normalize: normalizeCanonicalCall,
  upsert: upsertCanonicalCall,
  mutate: mutateCall,
  cleanup: cleanupCalls,
  get: getCall,
  findByPbxRecordId,
  list: listCalls,
  listAttention: listAttentionCalls
});
