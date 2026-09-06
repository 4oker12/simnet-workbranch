'use strict';

import { withStateWriteLock } from '../../../infrastructure/state-repository.js';
import {
  createCallStore,
  getCall,
  listCalls,
  upsertPbxCall
} from './call-repository.js';
import { CallRecord } from '../domain/call-record.js';

export const WORKBENCH_STATE_KEY = 'simnet_workbench_state_v5';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function ensureStateShape(state = {}) {
  state.schemaVersion ||= 5;
  state.cases ||= {};
  state.tabs ||= {};
  state.handoffs ||= {};
  state.callModule ||= {};
  state.callModule.calls ||= createCallStore();
  state.meta ||= {};
  return state;
}

export async function readWorkbenchState() {
  const raw = (await chrome.storage.local.get(WORKBENCH_STATE_KEY))?.[WORKBENCH_STATE_KEY] || {};
  return ensureStateShape(clone(raw));
}

export async function readCallRecord(rawKey = '') {
  const state = await readWorkbenchState();
  const call = getCall(state.callModule.calls, rawKey);
  return call ? clone(call) : null;
}

export async function listCallRecords() {
  const state = await readWorkbenchState();
  return listCalls(state.callModule.calls).map(clone);
}

export async function mutateCallRecord(rawKey = '', mutator = () => {}) {
  return withStateWriteLock(WORKBENCH_STATE_KEY, async () => {
    const raw = (await chrome.storage.local.get(WORKBENCH_STATE_KEY))?.[WORKBENCH_STATE_KEY] || {};
    const state = ensureStateShape(raw);
    const store = state.callModule.calls;
    const current = getCall(store, rawKey);
    if (!current) return null;
    const record = CallRecord.from(current);
    await mutator(record, state);
    const next = record.toJSON();
    next.updatedAt = new Date().toISOString();

    const existingKey = Object.entries(store.calls || {}).find(([, value]) => value === current)?.[0]
      || Object.entries(store.calls || {}).find(([, value]) => value?.callKey === current.callKey)?.[0]
      || next.callKey;
    store.calls[existingKey] = next;
    store.updatedAt = next.updatedAt;
    state.callModule.updatedAt = next.updatedAt;
    state.meta.updatedAt = next.updatedAt;
    await chrome.storage.local.set({ [WORKBENCH_STATE_KEY]: state });
    return clone(next);
  });
}

export async function ensurePbxCallRecord(raw = {}) {
  return withStateWriteLock(WORKBENCH_STATE_KEY, async () => {
    const current = (await chrome.storage.local.get(WORKBENCH_STATE_KEY))?.[WORKBENCH_STATE_KEY] || {};
    const state = ensureStateShape(current);
    const at = new Date().toISOString();
    const result = upsertPbxCall(state.callModule.calls, raw, at);
    if (!result.stored || !result.call) return null;
    state.callModule.updatedAt = at;
    state.meta.updatedAt = at;
    await chrome.storage.local.set({ [WORKBENCH_STATE_KEY]: state });
    return clone(result.call);
  });
}

export async function mutateCalls(mutator = () => {}) {
  return withStateWriteLock(WORKBENCH_STATE_KEY, async () => {
    const current = (await chrome.storage.local.get(WORKBENCH_STATE_KEY))?.[WORKBENCH_STATE_KEY] || {};
    const state = ensureStateShape(current);
    const result = await mutator(state.callModule.calls, state);
    const at = new Date().toISOString();
    state.callModule.calls.updatedAt = at;
    state.callModule.updatedAt = at;
    state.meta.updatedAt = at;
    await chrome.storage.local.set({ [WORKBENCH_STATE_KEY]: state });
    return clone(result);
  });
}

export const CallStateStore = Object.freeze({
  key: WORKBENCH_STATE_KEY,
  readState: readWorkbenchState,
  read: readCallRecord,
  list: listCallRecords,
  mutate: mutateCallRecord,
  mutateAll: mutateCalls,
  ensurePbx: ensurePbxCallRecord
});
