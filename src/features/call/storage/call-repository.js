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
const recordIdOf = value => String(value || '').match(/(?:^pbx:)?(\d{9,12}\.\d{1,12})$/)?.[1] || '';

export function canonicalCallKey(raw = {}) {
  if (typeof raw === 'string') {
    const match = raw.match(/^call:(\d{1,24})$/);
    return match ? `call:${match[1]}` : '';
  }
  const usersideCallId = digits(raw.usersideCallId || raw.callId, 24);
  return usersideCallId ? `call:${usersideCallId}` : '';
}

export function legacyPbxKey(raw = {}) {
  const value = typeof raw === 'string' ? raw : raw.callKey || raw.recordId || raw.pbxRecordId;
  const id = recordIdOf(value);
  return id ? `pbx:${id}` : '';
}

export function normalizeCanonicalCall(raw = {}, observedAt = new Date().toISOString()) {
  const callKey = canonicalCallKey(raw);
  const usersideCallId = digits(raw.usersideCallId || raw.callId, 24);
  const startedAtMs = Math.max(0, Number(raw.startedAtMs || 0));
  const durationSeconds = Math.max(0, Math.min(86_400, Number(raw.durationSeconds || 0)));
  if (!callKey || !usersideCallId || !startedAtMs) return null;
  const completed = durationSeconds > 0 && raw.ongoing !== true;
  const recordId = recordIdOf(raw.recordId || raw.pbxRecordId);
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

export function normalizePbxCall(raw = {}, observedAt = new Date().toISOString()) {
  const recordId = recordIdOf(raw.recordId || raw.pbxRecordId || raw.callKey);
  if (!recordId) return null;
  const callKey = `pbx:${recordId}`;
  const startedAtMs = Math.max(0, Number(raw.startedAtMs || raw.createdAtMs || 0)) || Date.now();
  return {
    schema: 'simnet-call-record-v2',
    callKey,
    usersideCallId: '',
    pbxRecordId: recordId,
    legacyAliases: [callKey],
    source: clean(raw.source || 'pbx:history', 80),
    date: clean(raw.date, 24),
    time: clean(raw.time, 24),
    startedAtMs,
    endedAtMs: 0,
    duration: clean(raw.duration, 32),
    durationSeconds: Math.max(0, Number(raw.durationSeconds || 0)),
    direction: clean(raw.direction, 20),
    callerId: normalizedPhone(raw.callerId),
    callerMasked: clean(raw.callerMasked, 24) || maskedPhone(raw.callerId),
    agent: clean(raw.agent, 120),
    agentExtension: clean(raw.agentExtension, 12),
    customerId: digits(raw.customerId, 14),
    login: clean(raw.login, 48),
    contract: clean(raw.contract, 80),
    fio: clean(raw.fio, 180),
    address: clean(raw.address, 300),
    status: clean(raw.status || 'completed', 24),
    ongoing: false,
    bindable: false,
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
    ...Object.fromEntries(Object.entries(observed).filter(([, value]) => value !== '' && value != null)),
    schema: 'simnet-call-record-v2',
    callKey: observed.callKey || preserved.callKey,
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
  const record = CallRecord.from(next);
  if (next.pbxRecordId) record.attachPbx(next.pbxRecordId, observed.updatedAt || new Date().toISOString());
  return record.toJSON();
}

function findPbxEntry(store = createCallStore(), recordId = '') {
  const id = recordIdOf(recordId);
  if (!id) return null;
  const alias = `pbx:${id}`;
  for (const [key, call] of Object.entries(store.calls || {})) {
    if (call?.pbxRecordId === id || key === alias || (call?.legacyAliases || []).includes(alias)) {
      return { key, call };
    }
  }
  return null;
}

export function upsertCanonicalCall(store = createCallStore(), raw = {}, observedAt = new Date().toISOString()) {
  const call = normalizeCanonicalCall(raw, observedAt);
  if (!call) return { stored: false, call: null, store };
  store.calls ||= {};

  let previous = store.calls[call.callKey] || null;
  const provisional = call.pbxRecordId ? findPbxEntry(store, call.pbxRecordId) : null;
  if (provisional && provisional.key !== call.callKey) {
    previous = mergeCanonical(provisional.call, previous || {});
    delete store.calls[provisional.key];
  }

  store.calls[call.callKey] = mergeCanonical(previous, call);
  store.updatedAt = observedAt;
  return { stored: true, call: store.calls[call.callKey], store };
}

export function upsertPbxCall(store = createCallStore(), raw = {}, observedAt = new Date().toISOString()) {
  const pbx = normalizePbxCall(raw, observedAt);
  if (!pbx) return { stored: false, call: null, store };
  store.calls ||= {};
  const existing = findPbxEntry(store, pbx.pbxRecordId);
  const targetKey = existing?.call?.usersideCallId ? existing.key : (existing?.key || pbx.callKey);
  const observed = { ...pbx, callKey: targetKey };
  store.calls[targetKey] = mergeCanonical(existing?.call || null, observed);
  store.updatedAt = observedAt;
  return { stored: true, call: store.calls[targetKey], store };
}

export function mutateCall(store = createCallStore(), rawKey = '', mutator = () => {}, at = new Date().toISOString()) {
  const call = getCall(store, rawKey);
  if (!call) return { updated: false, call: null, store };
  const record = CallRecord.from(call);
  mutator(record);
  const next = record.toJSON();
  next.updatedAt = clean(at, 40);
  const currentKey = Object.keys(store.calls || {}).find(key => store.calls[key] === call) || next.callKey;
  store.calls[currentKey] = next;
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
  const direct = String(rawKey || '');
  if (direct && store.calls?.[direct]) return store.calls[direct];
  const callKey = canonicalCallKey(rawKey);
  if (callKey && store.calls?.[callKey]) return store.calls[callKey];
  const legacy = legacyPbxKey(rawKey);
  if (!legacy) return null;
  return Object.values(store.calls || {}).find(call => (
    call?.pbxRecordId && `pbx:${call.pbxRecordId}` === legacy
  ) || (call?.legacyAliases || []).includes(legacy)) || null;
}

export function findByPbxRecordId(store = createCallStore(), recordId = '') {
  return findPbxEntry(store, recordId)?.call || null;
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
  normalizePbx: normalizePbxCall,
  upsert: upsertCanonicalCall,
  upsertPbx: upsertPbxCall,
  mutate: mutateCall,
  cleanup: cleanupCalls,
  get: getCall,
  findByPbxRecordId,
  list: listCalls,
  listAttention: listAttentionCalls
});
