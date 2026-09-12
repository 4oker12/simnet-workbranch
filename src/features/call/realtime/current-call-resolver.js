(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.currentCallResolver) return;

  const NATIVE_STATE_KEY = 'simnet_call_active_6047_v1';
  const LIVE_STATE_KEY = 'simnet_call_live_call_list_6047_v1';
  const LOCK_KEY = 'simnet_call_live_resolver_lock_v1';
  const OPERATOR_EXTENSION = '6047';
  const QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';
  const ACTIVE_TTL_MS = 15_000;
  const LOCK_TTL_MS = 12_000;
  const START_TOLERANCE_MS = 90_000;
  const RETRIES_MS = [0, 1800, 4500];

  let stopped = false;
  let retryTimers = [];
  let resolvingKey = '';

  const now = () => Date.now();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');

  function activeNative(value = null) {
    if (!value || value.schema !== 'simnet-wb-native-pbx-state-v1') return null;
    if (String(value.agentExtension || '') !== OPERATOR_EXTENSION || value.active !== true) return null;
    const observedAtMs = Number(value.observedAtMs || 0);
    if (!observedAtMs || now() - observedAtMs > ACTIVE_TTL_MS) return null;
    return {
      talkStartMs: Math.max(0, Number(value.talkStartMs || 0)),
      observedAtMs
    };
  }

  function isOngoing(call = null) {
    if (!call || typeof call !== 'object') return false;
    return call.ongoing === true
      || String(call.status || '').toLowerCase() === 'ongoing'
      || String(call.snapshotStatus || '').toLowerCase() === 'live';
  }

  function matchesActive(call = null, active = null) {
    if (!isOngoing(call) || !active) return false;
    const agent = digits(call.agentExtension || call.agent || '');
    if (agent && agent !== OPERATOR_EXTENSION) return false;
    const startedAtMs = Number(call.startedAtMs || 0);
    if (!startedAtMs) return false;
    if (active.talkStartMs && Math.abs(startedAtMs - active.talkStartMs) > START_TOLERANCE_MS) return false;
    return true;
  }

  function callIdentity(call = {}) {
    return {
      ...call,
      status: 'ongoing',
      ongoing: true,
      snapshotStatus: 'live',
      snapshotKind: 'live',
      agentExtension: OPERATOR_EXTENSION,
      customerId: digits(call.customerId || ''),
      contract: digits(call.contract || call.login || ''),
      fullName: String(call.fullName || call.fio || '').trim()
    };
  }

  function publish(call, active) {
    const state = {
      schema: 'simnet-wb-call-list-live-v1',
      active: true,
      agentExtension: OPERATOR_EXTENSION,
      observedAtMs: now(),
      source: 'background-current-call-resolver',
      call: callIdentity(call)
    };
    return chrome.storage.local.set({ [LIVE_STATE_KEY]: state }).then(() => state);
  }

  function requestCurrent() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          type: QUERY_MESSAGE,
          payload: {
            fresh: true,
            forceRefresh: true,
            backgroundRefresh: true,
            backgroundRefreshReason: 'active-call-resolve'
          }
        }, response => {
          const error = chrome.runtime.lastError;
          if (error || !response?.success) return resolve(null);
          resolve(response.data || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function attempt(active, key) {
    if (stopped || resolvingKey !== key) return false;
    const data = await requestCurrent();
    if (stopped || resolvingKey !== key) return false;
    const call = data?.focusCall && matchesActive(data.focusCall, active)
      ? data.focusCall
      : (Array.isArray(data?.calls) ? data.calls.find(item => matchesActive(item, active)) : null);
    if (!call) return false;
    await publish(call, active);
    try {
      await chrome.storage.local.set({
        [LOCK_KEY]: { key, status: 'resolved', owner: location.href, expiresAtMs: now() + 60_000 }
      });
    } catch {}
    return true;
  }

  async function resolveActive(active) {
    const key = String(active.talkStartMs || Math.floor(active.observedAtMs / 10_000));
    if (!key || resolvingKey === key) return;

    let storage = {};
    try { storage = await chrome.storage.local.get([LIVE_STATE_KEY, LOCK_KEY]); } catch {}
    const existing = storage?.[LIVE_STATE_KEY];
    if (existing?.active === true && Number(existing?.call?.startedAtMs || 0)) {
      const start = Number(existing.call.startedAtMs || 0);
      if (!active.talkStartMs || Math.abs(start - active.talkStartMs) <= START_TOLERANCE_MS) return;
    }
    const lock = storage?.[LOCK_KEY];
    if (lock?.key === key && Number(lock.expiresAtMs || 0) > now()) return;

    resolvingKey = key;
    try {
      await chrome.storage.local.set({
        [LOCK_KEY]: { key, status: 'resolving', owner: location.href, expiresAtMs: now() + LOCK_TTL_MS }
      });
    } catch {}

    retryTimers.forEach(clearTimeout);
    retryTimers = [];
    for (const delay of RETRIES_MS) {
      retryTimers.push(setTimeout(async () => {
        if (stopped || resolvingKey !== key) return;
        const ok = await attempt(active, key);
        if (ok) {
          retryTimers.forEach(clearTimeout);
          retryTimers = [];
        }
      }, delay));
    }
  }

  async function inspect() {
    if (stopped) return;
    let result = {};
    try { result = await chrome.storage.local.get([NATIVE_STATE_KEY]); } catch {}
    const active = activeNative(result?.[NATIVE_STATE_KEY]);
    if (!active) return;
    void resolveActive(active);
  }

  function onChanged(changes, area) {
    if (stopped || area !== 'local' || !changes?.[NATIVE_STATE_KEY]) return;
    const active = activeNative(changes[NATIVE_STATE_KEY].newValue);
    if (!active) {
      resolvingKey = '';
      retryTimers.forEach(clearTimeout);
      retryTimers = [];
      return;
    }
    void resolveActive(active);
  }

  chrome.storage.onChanged.addListener(onChanged);
  void inspect();

  WB.currentCallResolver = Object.freeze({
    resolve: inspect,
    destroy() {
      stopped = true;
      retryTimers.forEach(clearTimeout);
      retryTimers = [];
      chrome.storage.onChanged.removeListener(onChanged);
    }
  });
})();
