(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'userside.simnet.kiev.ua') return;

  const EVENT_NAME = 'simnet-wb-native-pbx-state';
  const PROBE_EVENT_NAME = 'simnet-wb-native-pbx-probe';
  const DATASET_KEY = 'simnetWbNativePbxState';
  const SESSION_PREFIX = 'opw.session.crm.';
  const BUS_PREFIX = 'opw.bus.crm.';
  const OPERATOR_EXTENSION = '6047';
  const MAX_DISCOVERY_ATTEMPTS = 24;
  const DISCOVERY_DELAY_MS = 250;

  let channel = null;
  let busName = '';
  let busStorageKey = '';
  let scope = '';
  let session = null;
  let lastState = null;
  let discoveryAttempts = 0;
  let discoveryTimer = 0;
  let destroyed = false;

  const nowMs = () => Date.now();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');
  const toMs = value => {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : 0;
  };

  function parseJson(value, fallback = null) {
    try { return JSON.parse(String(value || '')); } catch { return fallback; }
  }

  function ownSession(candidate = null) {
    if (!candidate || typeof candidate !== 'object') return false;
    return [candidate.agent_id, candidate.agent_id_1, candidate.agent_id_2, candidate.last_payload?.agent_id]
      .some(value => digits(value) === OPERATOR_EXTENSION);
  }

  function findSession() {
    const candidates = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || '');
        if (!key.startsWith(SESSION_PREFIX)) continue;
        const value = parseJson(localStorage.getItem(key));
        if (!value) continue;
        candidates.push({ key, value });
      }
    } catch {}
    return candidates.find(item => ownSession(item.value)) || candidates[0] || null;
  }

  function emit(state = {}) {
    if (destroyed) return;
    const safe = {
      schema: 'simnet-wb-native-pbx-state-v1',
      active: state.active === true,
      agentExtension: OPERATOR_EXTENSION,
      talkStartMs: Math.max(0, Number(state.talkStartMs || 0)),
      lastCallEndMs: Math.max(0, Number(state.lastCallEndMs || 0)),
      observedAtMs: nowMs(),
      source: 'userside-native-widget'
    };
    lastState = safe;
    try {
      document.documentElement.dataset[DATASET_KEY] = JSON.stringify(safe);
      document.documentElement.dispatchEvent(new Event(EVENT_NAME));
    } catch {}
  }

  function stateFromPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') return null;
    const operatorMatches = [
      payload.agent_id,
      payload.agent_id_1,
      payload.agent_id_2,
      session?.agent_id,
      session?.agent_id_1,
      session?.agent_id_2
    ].some(value => digits(value) === OPERATOR_EXTENSION);
    if (!operatorMatches) return null;
    const active = Number(payload.is_talking || 0) > 0 || Number(payload.calls?.talking || 0) > 0;
    return {
      active,
      talkStartMs: toMs(payload.talk_start),
      lastCallEndMs: toMs(payload.last_call_end)
    };
  }

  function handlePayload(payload = {}) {
    const next = stateFromPayload(payload);
    if (!next) return;
    emit(next);
  }

  function handleBusMessage(message = {}) {
    if (!message || typeof message !== 'object') return;
    if (scope && message.scope && String(message.scope) !== scope) return;
    if (message.type === 'stream-payload') {
      handlePayload(message.payload || {});
      return;
    }
    if (message.type === 'session-update') {
      if (message.session && typeof message.session === 'object') {
        session = message.session;
        if (session.last_payload) handlePayload(session.last_payload);
      }
      return;
    }
    // The native widget already emits a coordinator heartbeat. Reuse it only as
    // a lease refresh for an active call; no additional polling/timer is added.
    if (message.type === 'leader-heartbeat' && lastState?.active) emit(lastState);
  }

  function onStorage(event) {
    if (!busStorageKey || event.key !== busStorageKey || !event.newValue) return;
    handleBusMessage(parseJson(event.newValue, {}));
  }

  function postHello() {
    if (!channel || !scope) return;
    try {
      channel.postMessage({
        _msg_id: `simnet-wb-${Math.random().toString(36).slice(2)}-${nowMs().toString(36)}`,
        type: 'hello',
        scope,
        tab_id: `simnet-wb-${nowMs().toString(36)}`,
        ts: nowMs()
      });
    } catch {}
  }

  function connect() {
    if (destroyed) return false;
    if (channel && session) return true;
    const found = findSession();
    if (!found) return false;
    session = found.value;
    scope = found.key.slice(SESSION_PREFIX.length);
    if (!scope) return false;
    busName = `${BUS_PREFIX}${scope}`;
    busStorageKey = `${busName}.storage`;
    try {
      channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(busName) : null;
      if (channel) channel.onmessage = event => handleBusMessage(event.data || {});
    } catch { channel = null; }
    window.removeEventListener('storage', onStorage);
    window.addEventListener('storage', onStorage);
    if (session?.last_payload) handlePayload(session.last_payload);
    postHello();
    return true;
  }

  function refreshSessionSnapshot() {
    const found = findSession();
    if (found?.value) {
      session = found.value;
      if (!scope) scope = found.key.slice(SESSION_PREFIX.length);
      if (session.last_payload) {
        handlePayload(session.last_payload);
        return true;
      }
    }
    if (session?.last_payload) {
      handlePayload(session.last_payload);
      return true;
    }
    return false;
  }

  function onProbe() {
    if (destroyed) return;
    // Probe is synchronous and local-only. It exists specifically so opening
    // CALL can ask the native UserSide PBX widget for its latest 6047 lifecycle
    // state before any historical/cached call is allowed into focus.
    connect();
    refreshSessionSnapshot();
  }

  function discover() {
    if (destroyed || connect()) return;
    discoveryAttempts += 1;
    if (discoveryAttempts >= MAX_DISCOVERY_ATTEMPTS) return;
    discoveryTimer = window.setTimeout(discover, DISCOVERY_DELAY_MS);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(discoveryTimer);
    discoveryTimer = 0;
    document.documentElement?.removeEventListener(PROBE_EVENT_NAME, onProbe);
    window.removeEventListener('storage', onStorage);
    try { channel?.close?.(); } catch {}
    channel = null;
  }

  document.documentElement?.addEventListener(PROBE_EVENT_NAME, onProbe);
  window.addEventListener('pagehide', destroy, { once: true });
  discover();
})();
