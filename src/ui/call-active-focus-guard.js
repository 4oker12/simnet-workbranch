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

  function directFilteredLiveCall(registration) {
    const call = registration?.focusCall;
    if (!call || !nativeActive()) return null;
    const live = call.ongoing === true
      || String(call.status || '').toLowerCase() === 'ongoing'
      || String(call.snapshotStatus || '').toLowerCase() === 'live';
    if (!live || !callMatchesNative(call)) return null;
    return { ...call };
  }

  function isActive() {
    return nativeActive() || Boolean(currentLiveCall());
  }

  function liveCustomerSignature(call = {}) {
    const candidates = Array.isArray(call?.customerCandidates) ? call.customerCandidates : [];
    return candidates.map(item => [
      digits(item?.customerId),
      String(item?.login || '').trim().toLowerCase(),
      digits(item?.contract || item?.login),
      String(item?.fio || item?.fullName || '').trim().toLowerCase()
    ].join('/')).join(',');
  }

  function liveIdentitySignature(state = liveListState) {
    const call = state?.call || {};
    return [
      state?.active ? 1 : 0,
      call.startedAtMs || 0,
      call.usersideCallId || '',
      call.callerId || '',
      call.customerId || '',
      call.login || '',
      call.contract || '',
      call.fullName || call.fio || '',
      liveCustomerSignature(call),
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

  function identityFromRaw(raw = {}) {
    const customerId = digits(raw?.customerId);
    const contract = digits(raw?.contract || raw?.login);
    const login = String(raw?.login || '').trim();
    const fullName = String(raw?.fullName || raw?.fio || '').trim();
    if (!customerId && !contract && !login && !fullName) return null;
    return { customerId, contract, login, fullName };
  }

  function identityMatchesCase(identity = null, current = {}) {
    if (!identity) return false;
    return Boolean(
      (identity.customerId && current.customerId && identity.customerId === current.customerId)
      || (identity.contract && current.contract && identity.contract === current.contract)
      || (identity.login && current.login && identity.login.toLowerCase() === current.login)
    );
  }

  function candidateFromIdentity(registration, call, identity = null) {
    if (!identity) return null;
    const current = caseIdentity(registration);
    const isCurrentCase = identityMatchesCase(identity, current);
    const { customerId, contract, login, fullName } = identity;
    return {
      customerId,
      contract,
      login,
      fullName,
      label: String(fullName || login || (contract ? `abon${contract}` : (customerId ? `Customer ${customerId}` : 'Абонент из call_list'))),
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
        contract,
        login
      }]
    };
  }

  function resolveLiveIdentity(registration, call) {
    const rawCandidates = Array.isArray(call?.customerCandidates) ? call.customerCandidates : [];
    const identities = rawCandidates.map(identityFromRaw).filter(Boolean);

    if (identities.length > 1) {
      const current = caseIdentity(registration);
      const matching = identities.filter(identity => identityMatchesCase(identity, current));
      const labels = identities.map(identity => identity.login || (identity.contract ? `abon${identity.contract}` : identity.fullName || identity.customerId)).filter(Boolean);
      if (matching.length === 1) {
        return {
          candidate: candidateFromIdentity(registration, call, matching[0]),
          ambiguous: true,
          count: identities.length,
          labels,
          resolvedByCurrentCase: true
        };
      }
      return { candidate: null, ambiguous: true, count: identities.length, labels, resolvedByCurrentCase: false };
    }

    const direct = identities[0] || identityFromRaw(call);
    return {
      candidate: candidateFromIdentity(registration, call, direct),
      ambiguous: false,
      count: direct ? 1 : 0,
      labels: direct ? [direct.login || (direct.contract ? `abon${direct.contract}` : direct.fullName || direct.customerId)].filter(Boolean) : [],
      resolvedByCurrentCase: false
    };
  }

  function candidateIdentityKey(candidate = null) {
    if (!candidate) return '';
    return [digits(candidate.customerId), digits(candidate.contract || candidate.login), String(candidate.login || '').toLowerCase()].join(':');
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

  function liveFreshNote(resolution) {
    if (resolution?.ambiguous) {
      const suffix = resolution.labels?.length ? `: ${resolution.labels.join(' / ')}` : '';
      if (resolution.resolvedByCurrentCase) return `LIVE UserSide · номер связан с ${resolution.count} абонентами${suffix} · совпала текущая карточка`;
      return `LIVE UserSide · номер связан с ${resolution.count} абонентами${suffix} · нужен выбор абонента`;
    }
    if (resolution?.candidate) return 'LIVE UserSide · абонент определён по call_list';
    return 'LIVE UserSide · абонент в call_list не определён';
  }

  function hardEnforce(registration) {
    if (!registration || !isActive()) {
      if (registration) registration.__wbActiveCallPending = false;
      return false;
    }

    registration.historyFocusCallKey = '';
    // The authoritative filtered GET made by registration.open() is primary.
    // Use its current 6047 row directly; an optional live DOM state is only a
    // fallback. Never discard a fresh matching row merely because no separate
    // /message/call_list tab is open.
    const liveCall = directFilteredLiveCall(registration) || currentLiveCall();
    if (liveCall) {
      const previous = registration.focusCall;
      const same = sameLiveCall(previous, liveCall);
      const previousCandidateKey = candidateIdentityKey(Array.isArray(registration.focusCandidates) ? registration.focusCandidates[0] : null);
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

      const resolution = resolveLiveIdentity(registration, liveCall);
      const candidate = resolution.candidate;
      const nextCandidateKey = candidateIdentityKey(candidate);
      registration.focusCandidates = candidate ? [candidate] : [];
      registration.currentCaseCandidate = candidate?.isCurrentCase ? candidate : null;

      if (!same || previousCandidateKey !== nextCandidateKey) {
        registration.focusSnapshot = null;
        registration.pbxBinding = null;
        registration.model = null;
      }
      registration.pbxFreshNote = liveFreshNote(resolution);
      registration.__wbActiveCallPending = false;
      return true;
    }

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
        <div class="pbx-empty">Workbench запросил call_list, но UserSide ещё не вернул строку этого звонка. Предыдущего абонента не подставляю.</div>
      </section>
      <div class="actions"><button class="action primary" type="button" data-action="refresh-focus">Обновить call_list</button><button class="action" type="button" data-action="cancel">Закрыть</button></div>
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
