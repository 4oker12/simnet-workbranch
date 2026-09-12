(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callActiveFocusGuard) return;

  const STORAGE_KEY = 'simnet_call_active_6047_v1';
  const DATASET_KEY = 'simnetWbNativePbxState';
  const PROBE_EVENT_NAME = 'simnet-wb-native-pbx-probe';
  const OPERATOR_EXTENSION = '6047';
  const LEASE_TTL_MS = 12_000;
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';

  let activeState = null;
  let patchedRegistration = null;
  let stopped = false;
  const refreshByTalk = new Map();

  const nowMs = () => Date.now();

  function normalizeState(value = null) {
    if (!value || typeof value !== 'object') return null;
    if (value.schema !== 'simnet-wb-native-pbx-state-v1') return null;
    if (String(value.agentExtension || '') !== OPERATOR_EXTENSION) return null;
    return {
      schema: value.schema,
      active: value.active === true,
      agentExtension: OPERATOR_EXTENSION,
      talkStartMs: Math.max(0, Number(value.talkStartMs || 0)),
      lastCallEndMs: Math.max(0, Number(value.lastCallEndMs || 0)),
      observedAtMs: Math.max(0, Number(value.observedAtMs || 0)),
      source: String(value.source || '')
    };
  }

  function acceptNewestState(candidate = null) {
    const normalized = normalizeState(candidate);
    if (!normalized) return activeState;
    if (!activeState || Number(normalized.observedAtMs || 0) >= Number(activeState.observedAtMs || 0)) {
      activeState = normalized;
    }
    return activeState;
  }

  function isActive(state = activeState) {
    if (!state?.active || state.agentExtension !== OPERATOR_EXTENSION) return false;
    const age = nowMs() - Number(state.observedAtMs || 0);
    return age >= 0 && age <= LEASE_TTL_MS;
  }

  function isOngoing(call = null) {
    if (!call || typeof call !== 'object') return false;
    return call.ongoing === true
      || String(call.status || '').toLowerCase() === 'ongoing'
      || String(call.snapshotStatus || '').toLowerCase() === 'live';
  }

  function syncProbeNativeState() {
    if (stopped || location.hostname !== 'userside.simnet.kiev.ua') return activeState;
    try {
      document.documentElement?.dispatchEvent(new Event(PROBE_EVENT_NAME));
      const raw = document.documentElement?.dataset?.[DATASET_KEY] || '';
      if (raw) acceptNewestState(JSON.parse(raw));
    } catch {}
    return activeState;
  }

  function readState() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY], result => {
          if (chrome.runtime.lastError) return resolve(activeState);
          acceptNewestState(result?.[STORAGE_KEY]);
          resolve(activeState);
        });
      } catch { resolve(activeState); }
    });
  }

  function hardEnforce(registration) {
    if (!registration || !isActive()) {
      if (registration) registration.__wbActiveCallPending = false;
      return false;
    }

    registration.historyFocusCallKey = '';
    if (isOngoing(registration.focusCall)) {
      registration.__wbActiveCallPending = false;
      return true;
    }

    // Hard invariant: while 6047 is talking, a historical/completed call is
    // never allowed to remain in focus. Until UserSide exposes the canonical
    // call:<id>, show a pending active-call state rather than the previous call.
    registration.focusCall = null;
    registration.focusSnapshot = null;
    registration.focusCandidates = [];
    registration.currentCaseCandidate = null;
    registration.pbxBinding = null;
    registration.model = null;
    registration.__wbActiveCallPending = true;
    return true;
  }

  function sendCanonicalRefresh(reason = 'native-active-focus') {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          type: PBX_QUERY_MESSAGE,
          payload: {
            fresh: true,
            forceRefresh: true,
            backgroundRefresh: true,
            backgroundRefreshReason: reason
          }
        }, response => {
          const error = chrome.runtime.lastError;
          if (error) return resolve({ success: false, error: error.message || String(error) });
          resolve(response || { success: false });
        });
      } catch (error) {
        resolve({ success: false, error: String(error?.message || error) });
      }
    });
  }

  function refreshKey(state = activeState) {
    return String(Number(state?.talkStartMs || 0) || `active-${Math.floor(Number(state?.observedAtMs || nowMs()) / 10_000)}`);
  }

  function ensureCurrentCallRefresh(registration, state = activeState) {
    if (!registration || !isActive(state)) return Promise.resolve(null);
    const key = refreshKey(state);
    if (refreshByTalk.has(key)) return refreshByTalk.get(key);

    const promise = sendCanonicalRefresh('native-active-start')
      .then(async response => {
        syncProbeNativeState();
        if (stopped || !registration.host || !isActive() || refreshKey(activeState) !== key) return response;
        // The authoritative refresh has now merged the filtered 6047 call_list
        // into CALL state. Re-open from cache only; no second heavy lookup.
        const activeCase = WB.store?.activeCase?.() || null;
        try {
          await registration.__wbActiveFocusOriginalOpen?.(activeCase, { focusCallKey: '' });
        } catch {}
        return response;
      });
    refreshByTalk.set(key, promise);
    return promise;
  }

  function pendingMarkup() {
    const started = Number(activeState?.talkStartMs || 0);
    const time = started
      ? new Date(started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';
    const suffix = time ? ` · с ${time}` : '';
    return `<div class="decision">
      <div class="status warn">Текущий звонок 6047 активен${suffix}. Он имеет абсолютный приоритет.</div>
      <section class="pbx-card focus-card">
        <div class="pbx-head"><span>Звонок <span class="call-live-chip">LIVE</span></span></div>
        <div class="pbx-empty">Определяю его UserSide callId. Предыдущий звонок намеренно не подставляется.</div>
      </section>
      <div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div>
    </div>`;
  }

  function patchRegistration(registration) {
    if (!registration || registration.__wbActiveFocusPatched) return registration;
    if (typeof registration.applyPbxSnapshot !== 'function' || typeof registration.open !== 'function') return registration;

    const originalApply = registration.applyPbxSnapshot.bind(registration);
    const originalOpen = registration.open.bind(registration);
    const originalRenderDecision = registration.renderDecision?.bind(registration);
    registration.__wbActiveFocusOriginalOpen = originalOpen;

    registration.applyPbxSnapshot = function(...args) {
      syncProbeNativeState();
      const result = originalApply(...args);
      hardEnforce(this);
      return result;
    };

    registration.renderDecision = function(notice = null) {
      syncProbeNativeState();
      if (isActive() && this.__wbActiveCallPending) {
        this.surface?.(pendingMarkup());
        return;
      }
      return originalRenderDecision?.(notice);
    };

    registration.open = async function(caseData = WB.store?.activeCase?.() || null, options = {}) {
      // Ask native UserSide PBX synchronously before reading any cached CALL.
      // This is local-only: no network, timer or MutationObserver.
      syncProbeNativeState();
      await readState();
      syncProbeNativeState();
      const live = isActive();
      const safeOptions = live ? { ...(options || {}), focusCallKey: '' } : (options || {});
      if (live) void ensureCurrentCallRefresh(this, activeState);
      const result = await originalOpen(caseData, safeOptions);
      syncProbeNativeState();
      hardEnforce(this);
      if (live && this.__wbActiveCallPending && this.host) this.renderDecision();
      return result;
    };

    registration.__wbActiveFocusPatched = true;
    patchedRegistration = registration;
    syncProbeNativeState();
    hardEnforce(registration);
    if (isActive()) void ensureCurrentCallRefresh(registration, activeState);
    return registration;
  }

  function findAndPatch() {
    if (stopped) return;
    const registration = WB.callRegistration;
    if (registration && registration.__lazy !== true) patchRegistration(registration);
  }

  // CallRegistration.open emits this synchronously before it mounts or queries
  // CALL state. Probe native lifecycle first so historical focus cannot win a race.
  function onModuleOpen(event) {
    if (event?.detail?.module !== 'call') return;
    syncProbeNativeState();
    findAndPatch();
    hardEnforce(patchedRegistration);
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes?.[STORAGE_KEY]) return;
    const previous = activeState ? { ...activeState } : null;
    acceptNewestState(changes[STORAGE_KEY].newValue);
    syncProbeNativeState();
    const wasActive = isActive(previous);
    const live = isActive(activeState);
    findAndPatch();

    const registration = patchedRegistration;
    if (!registration?.host) return;

    if (live) {
      hardEnforce(registration);
      if (registration.__wbActiveCallPending) registration.renderDecision?.();
      void ensureCurrentCallRefresh(registration, activeState);
      return;
    }

    if (wasActive && !live) {
      // Hangup: refresh canonical duration/recording in background. UI is not
      // blocked; the next open reads the completed call from local CALL state.
      void sendCanonicalRefresh('native-active-ended');
    }
  }

  window.addEventListener('simnet-workbench-module-open', onModuleOpen);
  chrome.storage.onChanged.addListener(onStorageChanged);
  syncProbeNativeState();
  void readState().then(() => {
    syncProbeNativeState();
    findAndPatch();
  });

  WB.callActiveFocusGuard = Object.freeze({
    isActive: () => {
      syncProbeNativeState();
      return isActive();
    },
    state: () => {
      syncProbeNativeState();
      return activeState ? { ...activeState } : null;
    },
    enforce: () => {
      syncProbeNativeState();
      return hardEnforce(patchedRegistration);
    },
    destroy() {
      stopped = true;
      window.removeEventListener('simnet-workbench-module-open', onModuleOpen);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
  });
})();
