'use strict';

import { createCallModule } from '../index.js';
import { withStateWriteLock } from '../../../infrastructure/state-repository.js';

const MESSAGE_TYPE = 'CALL_LIVE_ROW_OBSERVED';
const STATE_KEY = 'simnet_workbench_state_v5';
const USERSIDE_HOST = 'userside.simnet.kiev.ua';
const CALL_LIST_PATH = '/message/call_list';
const OPERATOR_EXTENSION = '6047';
const MAX_CALL_AGE_MS = 12 * 60 * 60 * 1000;

const callModule = createCallModule({
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString()
});

const clean = (value, max = 180) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);

function senderIsCallList(sender = {}) {
  for (const raw of [sender?.url, sender?.tab?.url]) {
    try {
      const url = new URL(String(raw || ''));
      if (url.protocol === 'https:' && url.hostname === USERSIDE_HOST && url.pathname === CALL_LIST_PATH) return true;
    } catch {}
  }
  return false;
}

function sanitizeCall(raw = {}) {
  const usersideCallId = digits(raw.usersideCallId || raw.callId, 24);
  const startedAtMs = Math.max(0, Number(raw.startedAtMs || 0));
  const age = Date.now() - startedAtMs;
  const agentExtension = digits(raw.agentExtension, 6);
  if (!startedAtMs || age < -120_000 || age > MAX_CALL_AGE_MS || agentExtension !== OPERATOR_EXTENSION) return null;

  const ongoing = raw.ongoing === true || String(raw.status || '').toLowerCase() === 'ongoing';
  const durationSeconds = Math.max(0, Math.min(86_400, Number(raw.durationSeconds || 0)));
  if (!ongoing && durationSeconds <= 0) return null;

  const customerId = digits(raw.customerId, 14);
  const login = clean(raw.login, 48);
  const fio = clean(raw.fio || raw.fullName, 140);
  const customerCandidates = customerId
    ? [{ customerId, login, fio }]
    : [];

  return {
    source: 'userside:call_list:live-dom',
    usersideCallId,
    callKey: usersideCallId ? `call:${usersideCallId}` : '',
    recordId: clean(raw.recordId || raw.pbxRecordId, 40),
    callerId: digits(raw.callerId, 15),
    callerMasked: clean(raw.callerMasked || raw.callerId, 24),
    date: clean(raw.date, 16),
    time: clean(raw.time, 16),
    startedAtMs,
    duration: clean(raw.duration, 20),
    durationSeconds,
    agentExtension: OPERATOR_EXTENSION,
    agent: clean(raw.agent || OPERATOR_EXTENSION, 120),
    direction: clean(raw.direction, 20),
    customerId,
    customerCandidates,
    login,
    contract: clean(raw.contract || login, 48),
    fio,
    status: ongoing ? 'ongoing' : 'completed',
    ongoing,
    bindable: Boolean(usersideCallId),
    observedAt: new Date().toISOString()
  };
}

async function ingest(raw = {}, sender = {}) {
  if (!senderIsCallList(sender)) throw new Error('Live CALL row accepted only from UserSide call_list');
  const call = sanitizeCall(raw?.call || raw);
  if (!call) return { accepted: false, stored: 0, reason: 'invalid-live-row' };

  return withStateWriteLock(STATE_KEY, async () => {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const state = stored?.[STATE_KEY];
    if (!state || typeof state !== 'object') return { accepted: false, stored: 0, reason: 'state-missing' };

    const result = call.ongoing
      ? callModule.ingestUsersideCalls(state, [], call)
      : callModule.ingestUsersideCalls(state, [call], null);

    state.meta ||= {};
    state.meta.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return {
      ...result,
      status: call.status,
      usersideCallId: call.usersideCallId,
      callKey: call.callKey,
      customerId: call.customerId
    };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPE) return false;
  Promise.resolve(ingest(message?.payload || {}, sender)).then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: error?.message || String(error) })
  );
  return true;
});

export const LiveRowIngestInternals = Object.freeze({ sanitizeCall, senderIsCallList });
