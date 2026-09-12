(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callActiveFocusGuard) return;

  const NATIVE_STORAGE_KEY = 'simnet_call_active_6047_v1';
  const LIVE_LIST_STORAGE_KEY = 'simnet_call_live_call_list_6047_v1';
  const DATASET_KEY = 'simnetWbNativePbxState';
  const PROBE_EVENT_NAME = 'simnet-wb-native-pbx-probe';
  const OPERATOR_EXTENSION = '6047';
  const NATIVE_TTL_MS = 12_000;
  const LIVE_FALLBACK_TTL_MS = 90_000;
  const START_MATCH_TOLERANCE_MS = 90_000;
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';

  let activeState = null;
  let liveListState = null;
  let patchedRegistration = null;
  let stopped = false;
  let endFallbackKey = '';

  const nowMs = () => Date.now();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');

  function normalizeNativeState(value = null) {
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

  function acceptNewestNative(candidate = null) {
    const normalized = normalizeNativeState(candidate);
    if (normalized && (!activeState || normalized.observedAtMs >= Number(activeState.observedAtMs || 0))) activeState = normalized;
    return activeState;
  }

  function acceptNewestLive(candidate = null) {
    const normalized = normalizeLiveListState(candidate);
    if (normalized && (!liveListState || normalized.observedAtMs >= Number(liveListState.observedAtMs || 0))) liveListState = normalized;
    return liveListState;
  }

  function nativeActive() {
    if (!activeState?.active || activeState.agentExtension !== OPERATOR_EXTENSION) return false;
    const age = nowMs() - Number(activeState.observedAtMs || 0);
    return age >= 0 && age <= NATIVE_TTL_MS;
  }

  function liveStateRecent() {
    const age = nowMs() - Number(liveListState?.observedAtMs || 0);
    return age >= 0 && age <= LIVE_FALLBACK_TTL_MS;
  }

  function callMatchesNative(call = null) {
    if (!call || !nativeActive()) return false;
    const start = Number(call.startedAtMs || 0);
    const talkStart = Number(activeState?.talkStartMs || 0);
    return Boolean(start && (!talkStart || Math.abs(start - talkStart) <= START_MATCH_TOLERANCE_MS));
  }

  function currentLiveCall() {
    const call = liveListState?.call;
    if (!liveListState?.active || !call) return null;
    if (callMatchesNative(call) || liveStateRecent()) return { ...call };
    return null;
  }

  function isActive() {
    return nativeActive() || Boolean(currentLiveCall());
  }

  function liveIdentitySignature(state = liveListState) {
    const call = state?.call || {};
    return [
      state?.active ? 1 : 0,
      call.startedAtMs || 0,
      call.usersideCallId || '',
      call.callerId || '',
      call.customerId || '',
      call.status || ''
    ].join(':');
  }

  function syncProbeNativeState() {
    if (stopped || location.hostname !== 'userside.simnet.kiev.ua') return;
    try {
      document.documentElement?.dispatchEvent(new Event(PROBE_EVENT_NAME));
      const raw = document.documentElement?.dataset?.[DATASET_KEY] || '';
      if (raw) acceptNewestNative(JSON.parse(raw));
    } catch {}
  }

  function syncProbeLiveList() {
    try {
      const state = WB.callListLiveBridge?.probe?.();
      if (state) acceptNewestLive(state);
    } catch {}
  }

  function syncProbes() {
    syncProbeNativeState();
    syncProbeLiveList();
  }

  function readState() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([NATIVE_STORAGE_KEY, LIVE_LIST_STORAGE_KEY], result => {
          if (!chrome.runtime.lastError) {
            acceptNewestNative(result?.[NATIVE_STORAGE_KEY]);
            acceptNewestLive(result?.[LIVE_LIST_STORAGE_KEY]);
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
      fullName: String(call?.fullName || call?.fio || '').trim(),
      label: String(call?.fullName || call?.fio || login || (contract ? `abon${contract}` : `Customer ${customerId}`)),
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

  function mergeLiveIntoCallList(registration, liveCall) {
    if (!registration || !liveCall?.callKey) return;
    const rows = Array.isArray(registration.pbxCalls) ? registration.pbxCalls : [];
    const index = rows.findIndex(call => String(call.callKey || '') === String(liveCall.callKey));
    if (index >= 0) {
      const next = rows.slice();
      next[index] = { ...next[index], ...liveCall, ongoing: true, status: 'ongoing', snapshotStatus: 'live' };
      registration.pbxCalls = next;
    } else {
      registration.pbxCalls = [{ ...liveCall, ongoing: true, status: 'ongoing', snapshotStatus: 'live' }, ...rows];
    }
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
      mergeLiveIntoCallList(registration, registration.focusCall);

      const candidate = liveCandidate(registration, liveCall);
      if (candidate) {
        registration.focusCandidates = [candidate];
        registration.currentCaseCandidate = candidate.isCurrentCase ? candidate : null;
      } else if (!same) {
        registration.focusCandidates = [];
        registration.currentCaseCandidate = null;
      }
      if (!same) {
        registration.focusSnapshot = null;
        registration.pbxBinding = null;
        registration.model = null;
      }
      registration.pbxFreshNote = 'LIVE из открытого UserSide call_list · без повторной загрузки всей таблицы';
      registration.__wbActiveCallPending = false;
      return true;
    }

    // PBX only tells us that 6047 is talking. It must never make an older call
    // the focus while the identity row from call_list has not arrived yet.
    registration.focusCall = null;
    registration.focusSnapshot = null;
    registration.focusCandidates = [];
    registration.currentCaseCandidate = null;
    registration.pbxBinding = null;
    registration.model = null;
    registration.__wbActiveCallPending = true;
    return true;
  }

  function sendCanonicalRefresh(reason = 'native-active-ended-fallback') {
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

  function pendingMarkup() {
    const started = Number(activeState?.talkStartMs || 0);
    const time = started ? new Date(started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    return `<div class="decision">
      <div class="status warn">LIVE 6047${time ? ` · с ${time}` : ''}</div>
      <section class="pbx-card focus-card">
        <div class="pbx-head"><span>Текущий звонок <span class="call-live-chip">LIVE</span></span></div>
        <div class="pbx-empty">Жду живую строку 6047 из call_list. Предыдущий звонок не используется и полный список повторно не запрашивается.</div>
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
    if (!changes?.[NATIVE_STORAGE_KEY] && !changes?.[LIVE_LIST_STORAGE_KEY]) return;

    const wasActive = isActive();
    const previousLive = liveListState ? { ...liveListState, call: liveListState.call ? { ...liveListState.call } : null } : null;
    const previousIdentity = liveIdentitySignature();

    if (changes?.[NATIVE_STORAGE_KEY]) acceptNewestNative(changes[NATIVE_STORAGE_KEY].newValue);
    if (changes?.[LIVE_LIST_STORAGE_KEY]) acceptNewestLive(changes[LIVE_LIST_STORAGE_KEY].newValue);
    syncProbes();

    const live = isActive();
    const identityChanged = previousIdentity !== liveIdentitySignature();
    const activityChanged = wasActive !== live;
    findAndPatch();

    const registration = patchedRegistration;
    if (registration?.host && live && (activityChanged || identityChanged)) {
      hardEnforce(registration);
      registration.renderDecision?.();
    }

    if (wasActive && !live) {
      const endedStart = Number(previousLive?.call?.startedAtMs || activeState?.talkStartMs || 0);
      const fallbackKey = String(endedStart || activeState?.lastCallEndMs || '');
      const hadDomIdentity = previousLive?.source === 'userside-call-list-dom' && Boolean(previousLive?.call?.startedAtMs);
      if (!hadDomIdentity && fallbackKey && fallbackKey !== endFallbackKey) {
        endFallbackKey = fallbackKey;
        void sendCanonicalRefresh('native-active-ended-fallback');
      }
    }
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
