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
  const LOCK_TTL_MS = 25_000;
  const RETRY_AFTER_MISS_MS = 2_500;
  const START_TOLERANCE_MS = 90_000;

  let stopped = false;
  let inFlightKey = '';
  let lastAttemptAtMs = 0;
  let lastActiveKey = '';

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

  function activeKey(active = null) {
    if (!active) return '';
    return String(active.talkStartMs || Math.floor(active.observedAtMs / 10_000));
  }

  function isOngoing(call = null) {
    if (!call || typeof call !== 'object') return false;
    return call.ongoing === true
      || String(call.status || '').toLowerCase() === 'ongoing'
      || String(call.snapshotStatus || '').toLowerCase() === 'live';
  }

  function matchesActive(call = null, active = null) {
    if (!call || !active) return false;
    const agent = digits(call.agentExtension || call.agent || '');
    if (agent && agent !== OPERATOR_EXTENSION) return false;
    const startedAtMs = Number(call.startedAtMs || 0);
    if (!startedAtMs) return false;
    if (active.talkStartMs && Math.abs(startedAtMs - active.talkStartMs) > START_TOLERANCE_MS) return false;
    return isOngoing(call) || Boolean(active.talkStartMs);
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

  function publish(call) {
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

  function clearLiveState() {
    return chrome.storage.local.set({
      [LIVE_STATE_KEY]: {
        schema: 'simnet-wb-call-list-live-v1',
        active: false,
        agentExtension: OPERATOR_EXTENSION,
        observedAtMs: now(),
        source: 'background-current-call-resolver',
        call: null
      }
    });
  }

  function requestCurrent(reason = 'active-call-resolve') {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          type: QUERY_MESSAGE,
          payload: {
            fresh: true,
            forceRefresh: true,
            backgroundRefresh: true,
            backgroundRefreshReason: reason
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

  function candidateFromResponse(data, active) {
    const candidates = [
      data?.focusCall,
      data?.refresh?.focusPreview,
      ...(Array.isArray(data?.calls) ? data.calls : [])
    ].filter(Boolean);
    return candidates.find(item => matchesActive(item, active)) || null;
  }

  async function attempt(active, key) {
    if (stopped || inFlightKey) return false;
    inFlightKey = key;
    lastAttemptAtMs = now();
    try {
      const data = await requestCurrent('active-call-resolve');
      if (stopped) return false;
      const call = candidateFromResponse(data, active);
      if (!call) {
        try {
          await chrome.storage.local.set({
            [LOCK_KEY]: {
              key,
              status: 'miss',
              owner: location.href,
              expiresAtMs: now() + RETRY_AFTER_MISS_MS
            }
          });
        } catch {}
        WB.log?.warn?.('CALL', 'Активный звонок 6047 пока не найден в call_list', {
          talkStartMs: active.talkStartMs,
          retryAfterMs: RETRY_AFTER_MISS_MS
        });
        return false;
      }

      await publish(call);
      try {
        await chrome.storage.local.set({
          [LOCK_KEY]: { key, status: 'resolved', owner: location.href, expiresAtMs: now() + 60_000 }
        });
      } catch {}
      WB.log?.info?.('CALL', 'Активный звонок 6047 сопоставлен с UserSide', {
        callKey: String(call.callKey || ''),
        usersideCallId: String(call.usersideCallId || ''),
        customerId: String(call.customerId || ''),
        startedAtMs: Number(call.startedAtMs || 0)
      });
      return true;
    } finally {
      inFlightKey = '';
    }
  }

  async function resolveActive(active) {
    const key = activeKey(active);
    if (!key || inFlightKey) return;
    lastActiveKey = key;
    if (now() - lastAttemptAtMs < RETRY_AFTER_MISS_MS) return;

    let storage = {};
    try { storage = await chrome.storage.local.get([LIVE_STATE_KEY, LOCK_KEY]); } catch {}

    const existing = storage?.[LIVE_STATE_KEY];
    if (existing?.active === true && Number(existing?.call?.startedAtMs || 0)) {
      const start = Number(existing.call.startedAtMs || 0);
      if (!active.talkStartMs || Math.abs(start - active.talkStartMs) <= START_TOLERANCE_MS) return;
    }

    const lock = storage?.[LOCK_KEY];
    if (lock?.key === key && Number(lock.expiresAtMs || 0) > now()) return;

    try {
      await chrome.storage.local.set({
        [LOCK_KEY]: { key, status: 'resolving', owner: location.href, expiresAtMs: now() + LOCK_TTL_MS }
      });
    } catch {}
    await attempt(active, key);
  }

  async function refreshAfterHangup(key) {
    if (stopped || !key || inFlightKey) return;
    const endKey = `end:${key}`;
    let storage = {};
    try { storage = await chrome.storage.local.get([LOCK_KEY]); } catch {}
    const lock = storage?.[LOCK_KEY];
    if (lock?.key === endKey && Number(lock.expiresAtMs || 0) > now()) return;

    try {
      await chrome.storage.local.set({
        [LOCK_KEY]: { key: endKey, status: 'finalizing', owner: location.href, expiresAtMs: now() + LOCK_TTL_MS }
      });
    } catch {}

    inFlightKey = endKey;
    try {
      await clearLiveState();
      const data = await requestCurrent('active-call-ended');
      try {
        await chrome.storage.local.set({
          [LOCK_KEY]: {
            key: endKey,
            status: data ? 'finalized' : 'finalize-miss',
            owner: location.href,
            expiresAtMs: now() + 60_000
          }
        });
      } catch {}
      WB.log?.info?.('CALL', 'После завершения звонка обновлён канонический call_list', {
        activeKey: key,
        success: Boolean(data),
        focusCallKey: String(data?.focusCall?.callKey || '')
      });
    } finally {
      inFlightKey = '';
      lastAttemptAtMs = 0;
    }
  }

  async function inspect() {
    if (stopped) return;
    let result = {};
    try { result = await chrome.storage.local.get([NATIVE_STATE_KEY]); } catch {}
    const active = activeNative(result?.[NATIVE_STATE_KEY]);
    if (!active) return;
    lastActiveKey = activeKey(active);
    void resolveActive(active);
  }

  function onChanged(changes, area) {
    if (stopped || area !== 'local' || !changes?.[NATIVE_STATE_KEY]) return;
    const active = activeNative(changes[NATIVE_STATE_KEY].newValue);
    if (!active) {
      const endedKey = lastActiveKey;
      lastActiveKey = '';
      lastAttemptAtMs = 0;
      if (endedKey) void refreshAfterHangup(endedKey);
      else void clearLiveState().catch(() => {});
      return;
    }
    lastActiveKey = activeKey(active);
    // Native widget refreshes this state while the conversation is alive. Each
    // heartbeat can retry a miss without a permanent polling timer.
    void resolveActive(active);
  }

  chrome.storage.onChanged.addListener(onChanged);
  void inspect();

  WB.currentCallResolver = Object.freeze({
    resolve: inspect,
    destroy() {
      stopped = true;
      inFlightKey = '';
      chrome.storage.onChanged.removeListener(onChanged);
    }
  });
})();
