(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callActiveFocusGuard) return;

  const STORAGE_KEY = 'simnet_call_active_6047_v1';
  const LIVE_LIST_STORAGE_KEY = 'simnet_call_live_call_list_6047_v1';
  const DATASET_KEY = 'simnetWbNativePbxState';
  const PROBE_EVENT_NAME = 'simnet-wb-native-pbx-probe';
  const OPERATOR_EXTENSION = '6047';
  const LEASE_TTL_MS = 12_000;
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';

  let activeState = null;
  let liveListState = null;
  let patchedRegistration = null;
  let stopped = false;
  const refreshByTalk = new Map();

  const nowMs = () => Date.now();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');

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

  function normalizeLiveListState(value = null) {
    if (!value || typeof value !== 'object') return null;
    if (value.schema !== 'simnet-wb-call-list-live-v1') return null;
    if (String(value.agentExtension || '') !== OPERATOR_EXTENSION) return null;
    return {
      schema: value.schema,
      active: value.active === true,
      agentExtension: OPERATOR_EXTENSION,
      observedAtMs: Math.max(0, Number(value.observedAtMs || 0)),
      source: String(value.source || ''),
      call: value.call && typeof value.call === 'object' ? { ...value.call } : null
    };
  }

  function acceptNewestState(candidate = null) {
    const normalized = normalizeState(candidate);
    if (normalized && (!activeState || normalized.observedAtMs >= Number(activeState.observedAtMs || 0))) activeState = normalized;
    return activeState;
  }

  function acceptNewestLiveListState(candidate = null) {
    const normalized = normalizeLiveListState(candidate);
    if (normalized && (!liveListState || normalized.observedAtMs >= Number(liveListState.observedAtMs || 0))) liveListState = normalized;
    return liveListState;
  }

  function freshActive(state) {
    if (!state?.active || state.agentExtension !== OPERATOR_EXTENSION) return false;
    const age = nowMs() - Number(state.observedAtMs || 0);
    return age >= 0 && age <= LEASE_TTL_MS;
  }

  function isActive() {
    return freshActive(liveListState) || freshActive(activeState);
  }

  function currentLiveCall() {
    return freshActive(liveListState) && liveListState?.call ? { ...liveListState.call } : null;
  }

  function syncProbeNativeState() {
    if (stopped || location.hostname !== 'userside.simnet.kiev.ua') return;
    try {
      document.documentElement?.dispatchEvent(new Event(PROBE_EVENT_NAME));
      const raw = document.documentElement?.dataset?.[DATASET_KEY] || '';
      if (raw) acceptNewestState(JSON.parse(raw));
    } catch {}
  }

  function syncProbeLiveList() {
    try {
      const state = WB.callListLiveBridge?.probe?.();
      if (state) acceptNewestLiveListState(state);
    } catch {}
  }

  function syncProbes() {
    syncProbeNativeState();
    syncProbeLiveList();
  }

  function readState() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY, LIVE_LIST_STORAGE_KEY], result => {
          if (!chrome.runtime.lastError) {
            acceptNewestState(result?.[STORAGE_KEY]);
            acceptNewestLiveListState(result?.[LIVE_LIST_STORAGE_KEY]);
          }
          resolve();
        });
      } catch { resolve(); }
    });
  }

  function caseIdentity(registration) {
    const snapshot = registration?.caseSnapshot || {};
    return {
      customerId: digits(snapshot.customerId),
      contract: digits(snapshot.contract),
      login: String(snapshot.login || '').trim().toLowerCase()
    };
  }

  function liveCandidate(registration, call) {
    const customerId = digits(call?.customerId);
    if (!customerId) return null;
    const contract = digits(call?.contract || call?.login);
    const login = String(call?.login || '').trim();
    const current = caseIdentity(registration);
    const isCurrentCase = Boolean(
      (customerId && current.customerId && customerId === current.customerId)
      || (contract && current.contract && contract === current.contract)
      || (login && current.login && login.toLowerCase() === current.login)
    );
    return {
      customerId,
      contract,
      login,
      fullName: String(call?.fullName || '').trim(),
      label: String(call?.fullName || login || (contract ? `abon${contract}` : `Customer ${customerId}`)),
      confidence: 100,
      rawScore: 250,
      score: 250,
      authoritative: true,
      isCurrentCase,
      reasons: ['customer-match'],
      evidence: [{
        type: 'CALL_LIST_LIVE_CUSTOMER',
        source: 'userside',
        ts: Number(call?.startedAtMs || nowMs()),
        customerId,
        contract
      }]
    };
  }

  function sameLiveCall(left = null, right = null) {
    if (!left || !right) return false;
    if (left.callKey && right.callKey && String(left.callKey) === String(right.callKey)) return true;
    const a = Number(left.startedAtMs || 0);
    const b = Number(right.startedAtMs || 0);
    return Boolean(a && b && Math.abs(a - b) <= 2000);
  }

  function hardEnforce(registration) {
    if (!registration || !isActive()) {
      if (registration) registration.__wbActiveCallPending = false;
      return false;
    }

    registration.historyFocusCallKey = '';
    const liveCall = currentLiveCall();
    if (liveCall) {
      const previous = registration.focusCall;
      const same = sameLiveCall(previous, liveCall);
      registration.focusCall = {
        ...(same ? previous : {}),
        ...liveCall,
        status: 'ongoing',
        ongoing: true,
        snapshotStatus: 'live',
        snapshotKind: 'live',
        registrationReady: Boolean(liveCall.callKey)
      };

      const candidate = liveCandidate(registration, liveCall);
      if (candidate) {
        registration.focusCandidates = [candidate];
        registration.currentCaseCandidate = candidate.isCurrentCase ? candidate : null;
      } else if (!same) {
        registration.focusCandidates = [];
        registration.currentCaseCandidate = null;
      }
      registration.focusSnapshot = same ? registration.focusSnapshot : null;
      registration.pbxBinding = same ? registration.pbxBinding : null;
      registration.model = same ? registration.model : null;
      registration.__wbActiveCallPending = !liveCall.callKey;
      return true;
    }

    // Native PBX confirms an active 6047 conversation, but call_list has not
    // exposed its row yet. Never substitute the previous completed call.
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

  function refreshKey() {
    const live = currentLiveCall();
    return String(Number(live?.startedAtMs || activeState?.talkStartMs || 0) || `active-${Math.floor(nowMs() / 10_000)}`);
  }

  function ensureCurrentCallRefresh(registration) {
    if (!registration || !isActive()) return Promise.resolve(null);
    const key = refreshKey();
    if (refreshByTalk.has(key)) return refreshByTalk.get(key);

    const promise = sendCanonicalRefresh('native-active-start').then(async response => {
      syncProbes();
      if (stopped || !registration.host || !isActive() || refreshKey() !== key) return response;
      const activeCase = WB.store?.activeCase?.() || null;
      try {
        await registration.__wbActiveFocusOriginalOpen?.(activeCase, { focusCallKey: '' });
      } catch {}
      syncProbes();
      hardEnforce(registration);
      if (registration.host) registration.renderDecision?.();
      return response;
    });
    refreshByTalk.set(key, promise);
    return promise;
  }

  function pendingMarkup() {
    const call = currentLiveCall();
    const started = Number(call?.startedAtMs || activeState?.talkStartMs || 0);
    const time = started ? new Date(started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const phone = String(call?.callerMasked || call?.callerId || '').trim();
    const person = String(call?.fullName || call?.login || '').trim();
    const meta = [phone, person].filter(Boolean).join(' · ');
    return `<div class="decision">
      <div class="status warn">LIVE 6047${time ? ` · с ${time}` : ''}${meta ? ` · ${meta}` : ''}</div>
      <section class="pbx-card focus-card">
        <div class="pbx-head"><span>Текущий звонок <span class="call-live-chip">LIVE</span></span></div>
        <div class="pbx-empty">Текущий разговор уже определён. Жду только канонический UserSide callId; предыдущий звонок не используется.</div>
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
      syncProbes();
      const result = originalApply(...args);
      hardEnforce(this);
      return result;
    };

    registration.renderDecision = function(notice = null) {
      syncProbes();
      hardEnforce(this);
      if (isActive() && this.__wbActiveCallPending) {
        this.surface?.(pendingMarkup());
        return;
      }
      return originalRenderDecision?.(notice);
    };

    registration.open = async function(caseData = WB.store?.activeCase?.() || null, options = {}) {
      syncProbes();
      await readState();
      syncProbes();
      const live = isActive();
      const safeOptions = live ? { ...(options || {}), focusCallKey: '' } : (options || {});
      if (live) void ensureCurrentCallRefresh(this);
      const result = await originalOpen(caseData, safeOptions);
      syncProbes();
      hardEnforce(this);
      if (live && this.host) this.renderDecision();
      return result;
    };

    registration.__wbActiveFocusPatched = true;
    patchedRegistration = registration;
    syncProbes();
    hardEnforce(registration);
    if (isActive()) void ensureCurrentCallRefresh(registration);
    return registration;
  }

  function findAndPatch() {
    if (stopped) return;
    const registration = WB.callRegistration;
    if (registration && registration.__lazy !== true) patchRegistration(registration);
  }

  function onModuleOpen(event) {
    if (event?.detail?.module !== 'call') return;
    syncProbes();
    findAndPatch();
    hardEnforce(patchedRegistration);
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local') return;
    const relevant = changes?.[STORAGE_KEY] || changes?.[LIVE_LIST_STORAGE_KEY];
    if (!relevant) return;
    const wasActive = isActive();
    if (changes?.[STORAGE_KEY]) acceptNewestState(changes[STORAGE_KEY].newValue);
    if (changes?.[LIVE_LIST_STORAGE_KEY]) acceptNewestLiveListState(changes[LIVE_LIST_STORAGE_KEY].newValue);
    syncProbes();
    const live = isActive();
    findAndPatch();

    const registration = patchedRegistration;
    if (registration?.host && live) {
      hardEnforce(registration);
      registration.renderDecision?.();
      void ensureCurrentCallRefresh(registration);
    }
    if (registration?.host && wasActive && !live) void sendCanonicalRefresh('native-active-ended');
  }

  window.addEventListener('simnet-workbench-module-open', onModuleOpen);
  chrome.storage.onChanged.addListener(onStorageChanged);
  syncProbes();
  void readState().then(() => {
    syncProbes();
    findAndPatch();
  });

  WB.callActiveFocusGuard = Object.freeze({
    isActive: () => { syncProbes(); return isActive(); },
    state: () => ({ active: isActive(), native: activeState ? { ...activeState } : null, liveList: liveListState ? { ...liveListState } : null }),
    enforce: () => { syncProbes(); return hardEnforce(patchedRegistration); },
    destroy() {
      stopped = true;
      window.removeEventListener('simnet-workbench-module-open', onModuleOpen);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
  });
})();
