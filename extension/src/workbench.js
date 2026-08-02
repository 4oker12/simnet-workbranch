/*
 * Generated from SIMNET Diagnostic Workbench 2.0.0-dev.5.8.
 * Source SHA-256: 416C44C307E7B8324AE94E1A76477556856593B051677E9585DAEDB322E8D9AF
 * Tampermonkey metadata was removed; business logic below remains source-compatible.
 */
(async () => {
  "use strict";

  const LOG_PREFIX = "[SIMNET-WB-EXT]";
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;

  try {
    if (!compat?.ready || !compat?.api) {
      throw new Error("MV3 compatibility layer is unavailable");
    }

    await compat.ready;

    const {
      GM_getValue,
      GM_setValue,
      GM_deleteValue,
      GM_addValueChangeListener,
      GM_removeValueChangeListener,
      GM_addStyle,
      GM_setClipboard,
      GM_xmlhttpRequest
    } = compat.api;

    console.log(`${LOG_PREFIX} Starting Workbench 2.0.0-dev.5.8`);
    // BEGIN ORIGINAL USERSCRIPT BODY
(function () {
  'use strict';

  if (window.top !== window.self) return;

  const billingProviderApi = globalThis.__SIMNET_BILLING_PROVIDER__;
  if (!billingProviderApi?.profiles || !billingProviderApi?.detectFromDocument) {
    throw new Error('Billing provider registry is unavailable');
  }

  function billingLoginFormPresent(doc = document) {
    if (!doc) return false;
    const passwords = typeof doc.querySelectorAll === 'function'
      ? [...doc.querySelectorAll('input[type="password"]')]
      : [doc.querySelector && doc.querySelector('input[type="password"]')].filter(Boolean);
    return passwords.some(password => {
      const form = password && password.closest && password.closest('form');
      if (!form) return true;
      const userField = form.querySelector && form.querySelector([
        'input[type="email"]',
        'input[name*="login" i]',
        'input[name*="user" i]',
        'input[name^="uu"]',
        'input[autocomplete="username"]',
      ].join(','));
      const formText = String(form.textContent || '').replace(/\s+/g, ' ').trim();
      return Boolean(userField || /(?:авторизац|login|логин|користувач|пользователь)/i.test(formText));
    });
  }

  // На странице Billing сам загруженный HTML является подтверждением состояния:
  // страница с формой входа даёт только кандидата, рабочая страница подтверждает новый rolling PP.
  // Никаких фоновых проверочных GET: в Billing pp может меняться после каждого запроса.
  function captureBillingPpBeforeUiGuard() {
    const provider = billingProviderApi.providerForHostname(location.hostname);
    if (!provider) return '';
    const profile = billingProviderApi.profileForProvider(provider);
    try {
      const hiddenPp = document.querySelector('input[type="hidden"][name="pp"]');
      const pp = String((hiddenPp && hiddenPp.value) || new URL(location.href).searchParams.get('pp') || '').trim();
      if (!pp || pp.length < 8) return '';
      const savedAt = Date.now();

      // Одноразовая миграция подтверждённого состояния dev.2.2.
      if (provider === 'simnet') {
        const currentMeta = GM_getValue(profile.ppMetaKey, null);
        const legacyMeta = GM_getValue('dp_billing_pp_meta_v4', null);
        const legacyPp = String(GM_getValue('dp_billing_pp_v4', '') || '').trim();
        if ((!currentMeta || !currentMeta.value) && legacyMeta && legacyMeta.confirmedAt && legacyPp === legacyMeta.value) {
          GM_setValue(profile.ppKey, legacyPp);
          GM_setValue(profile.ppMetaKey, {
            value: legacyPp,
            savedAt: Number(legacyMeta.savedAt || savedAt),
            confirmedAt: Number(legacyMeta.confirmedAt || 0),
            source: 'migrated:dev.2.2',
            href: String(legacyMeta.href || `${location.origin}${location.pathname}`),
          });
        }
      }

      if (billingLoginFormPresent(document)) {
        GM_setValue(profile.ppCandidateKey, {
          value: pp,
          savedAt,
          source: 'billing-login-page',
          href: `${location.origin}${location.pathname}`,
        });
        return pp;
      }

      GM_setValue(profile.ppMetaKey, {
        value: pp,
        savedAt,
        confirmedAt: savedAt,
        source: 'billing-page-authenticated',
        href: `${location.origin}${location.pathname}`,
      });
      GM_setValue(profile.ppKey, pp);
      try { GM_deleteValue(profile.ppCandidateKey); } catch (_) {}
      return pp;
    } catch (_) {
      return '';
    }
  }

  captureBillingPpBeforeUiGuard();

  const ACTIVE_WORKBENCH_VERSION = '2.0.0-dev.5.8';
  const stalePanel = document.getElementById('dp-panel');
  if (stalePanel) {
    if (stalePanel.dataset.workbenchVersion === ACTIVE_WORKBENCH_VERSION) return;
    const staleWrapper = stalePanel.parentElement;
    stalePanel.remove();
    if (staleWrapper && staleWrapper !== document.body && !staleWrapper.children.length && !String(staleWrapper.textContent || '').trim()) {
      staleWrapper.remove();
    }
  }

  // dev.4.5 мигрирует со старого плавающего/псевдодок-режима. Если предыдущая
  // версия успела изменить размеры страницы, снимаем только её собственные следы.
  if (document.documentElement.classList.contains('dp-workbench-dock-reserved')) {
    document.documentElement.classList.remove('dp-workbench-dock-reserved');
    document.documentElement.style.removeProperty('--dp-workbench-dock-space');
    document.documentElement.style.removeProperty('width');
    document.documentElement.style.removeProperty('max-width');
    document.documentElement.style.removeProperty('box-sizing');
    document.documentElement.style.removeProperty('overflow-x');
    if (document.body) {
      document.body.style.removeProperty('width');
      document.body.style.removeProperty('max-width');
      document.body.style.removeProperty('padding-right');
      document.body.style.removeProperty('box-sizing');
      document.body.style.removeProperty('overflow-x');
    }
  }

  const INSTANCE_KEY = '__SIMNET_DIAGNOSTIC_WORKBENCH_MAIN_V5__';
  const previousInstance = window[INSTANCE_KEY];
  if (previousInstance && previousInstance.status === 'ready' && previousInstance.version === ACTIVE_WORKBENCH_VERSION) return;
  if (previousInstance && previousInstance.status === 'starting' && Date.now() - Number(previousInstance.startedAt || 0) < 15000) return;
  window[INSTANCE_KEY] = { version: ACTIVE_WORKBENCH_VERSION, status: 'starting', startedAt: Date.now() };

  const BOOT_PREFIX = '[SIMNET Diagnostic Workbench][BOOT]';
  try { console.info(`${BOOT_PREFIX} запуск версии 2.0.0-dev.5.8`, { host: location.hostname, href: sanitizeJournalUrl(location.href) }); } catch (_) {}

  try {

  const BASE = 'https://userside.simnet.kiev.ua';
  const BILLING_PROVIDER_MODE_KEY = 'dp_billing_provider_mode_v1';
  const billingHostProvider = billingProviderApi.providerForHostname(location.hostname);
  let billingProviderMode = billingProviderApi.normalizeMode(GM_getValue(BILLING_PROVIDER_MODE_KEY, 'auto'));
  let detectedBillingProvider = '';
  let detectedBillingProviderSource = '';
  if (!billingHostProvider && billingProviderMode === 'auto') {
    const initialDetection = billingProviderApi.detectFromDocument(document);
    detectedBillingProvider = initialDetection.provider;
    detectedBillingProviderSource = initialDetection.source;
  }
  let activeBillingProvider = billingHostProvider
    || (billingProviderMode === 'auto' ? detectedBillingProvider : billingProviderMode)
    || 'simnet';
  let activeBillingProfile = billingProviderApi.profileForProvider(activeBillingProvider);
  let BILLING_BASE = activeBillingProfile.base;
  let BILLING_HOSTNAME = activeBillingProfile.hostname;
  let BILLING_PP_KEY = activeBillingProfile.ppKey;
  let BILLING_PP_META_KEY = activeBillingProfile.ppMetaKey;
  let BILLING_PP_CANDIDATE_KEY = activeBillingProfile.ppCandidateKey;
  const BILLING_PP_MAX_AGE_MS = 8 * 60 * 60 * 1000;
  const BILLING_BRIDGE_REQUEST_KEY = 'dp_billing_bridge_request_v1';
  const BILLING_BRIDGE_RESPONSE_KEY = 'dp_billing_bridge_response_v1';
  let BILLING_BRIDGE_PRESENCE_KEY = activeBillingProfile.bridgePresenceKey;
  let BILLING_COOKIE_TOP_LEVEL_SITE = activeBillingProfile.cookieTopLevelSite;
  const BILLING_BRIDGE_PRESENCE_MAX_AGE_MS = 3 * 60 * 1000;
  const BILLING_BRIDGE_HEARTBEAT_MS = 60 * 1000;
  const BILLING_BRIDGE_LEADER_LEASE_MS = 2 * 60 * 1000;
  const BILLING_BRIDGE_IDENTITY_REFRESH_MS = 2 * 60 * 1000;
  const BILLING_BRIDGE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  const billingPpRuntime = {
    lastKnown: '',
    lastTransportFailureAt: 0,
    lastTransportFailureReason: '',
    lastBridgeSuccessAt: 0,
    pageSyncInstalled: false,
  };
  const billingBridgeRuntime = {
    authenticated: false,
    ppFingerprint: '',
    path: '',
    lastIdentityRefreshAt: 0,
    leader: false,
    unloading: false,
  };
  const billingBridgePending = new Map();
  const billingBridgeServerControllers = new Map();
  const billingBridgeTabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let billingBridgeClientTail = Promise.resolve();
  let billingBridgePresenceTimer = 0;
  let billingBridgeElectionTimer = 0;
  const JOURNAL_MAX_ENTRIES = 900;
  const JOURNAL_PREFIX = '[SIMNET Diagnostic Workbench]';

  function isActiveBillingHost() {
    return location.hostname === BILLING_HOSTNAME;
  }

  function applyBillingProvider(provider, source = '') {
    const normalized = billingProviderApi.normalizeProvider(provider) || 'simnet';
    const profile = billingProviderApi.profileForProvider(normalized);
    activeBillingProvider = profile.id;
    activeBillingProfile = profile;
    BILLING_BASE = profile.base;
    BILLING_HOSTNAME = profile.hostname;
    BILLING_PP_KEY = profile.ppKey;
    BILLING_PP_META_KEY = profile.ppMetaKey;
    BILLING_PP_CANDIDATE_KEY = profile.ppCandidateKey;
    BILLING_BRIDGE_PRESENCE_KEY = profile.bridgePresenceKey;
    BILLING_COOKIE_TOP_LEVEL_SITE = profile.cookieTopLevelSite;
    billingPpRuntime.lastKnown = '';
    billingPpRuntime.lastTransportFailureAt = 0;
    billingPpRuntime.lastTransportFailureReason = '';
    updateBillingProviderControl(source);
    updateBillingSessionBadge();
    return profile;
  }

  function dpAddStyle(cssText) {
    const css = String(cssText || '');
    if (!css) return null;
    try {
      if (typeof GM_addStyle === 'function') return GM_addStyle(css);
    } catch (_) {}
    const style = document.createElement('style');
    style.setAttribute('data-simnet-workbench-style', ACTIVE_WORKBENCH_VERSION);
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }
  const JOURNAL_VIEW_KEY = 'dp_journal_view_v1';
  const JOURNAL_HEIGHT_KEY = 'dp_journal_height_v1';
  const PANEL_GEOMETRY_KEY = 'dp_panel_geometry_v1';
  const PANEL_COLLAPSED_KEY = 'dp_panel_collapsed_v1';
  const PANEL_HIDDEN_KEY = 'dp_panel_hidden_v1';
  const PANEL_SIDE_KEY = 'dp_panel_side_v1';
  const PANEL_DOCK_DEFAULT_WIDTH = 520;
  const PANEL_DOCK_MIN_WIDTH = 360;
  const PANEL_DOCK_MAX_WIDTH = 1100;
  const PANEL_DOCK_COLLAPSED_WIDTH = 44;
  const PANEL_DOCK_RESERVE_BREAKPOINT = 1320;
  const pageDockRuntime = {
    body: null,
    html: null,
    baseBodyInline: null,
    baseHtmlInline: null,
    basePaddingRight: 0,
  };
  const DIAGNOSTIC_LIMITS = Object.freeze({
    userSideRequests: 24,
    billingRequests: 18,
    onuPolls: 4,
    totalMs: 3 * 60 * 1000,
  });
  const diagnosticRuntime = {
    runId: 0,
    running: false,
    stopped: false,
    startedAt: 0,
    deadlineTimer: 0,
    abortables: new Set(),
    counters: { userSideRequests: 0, billingRequests: 0, onuPolls: 0 },
  };
  const portAnalysisRuntime = {
    context: null,
    result: null,
    billingRaw: '',
  };


  const RANDOM_PON_TEST_STATE_KEY = 'dp_random_pon_disabled_main_v1';
  const RANDOM_PON_TEST_LEGACY_STATE_KEYS = ['dp_random_pon_test_v4', 'dp_random_pon_test_v3', 'dp_random_pon_test_v2', 'dp_random_pon_test_v1'];
  const RANDOM_PON_TEST_ADD_MAX = 30;
  const RANDOM_PON_TEST_QUEUE_LIMIT = 150;
  const RANDOM_PON_TEST_HISTORY_LIMIT = 150;
  const RANDOM_PON_TEST_RAW_LIMIT = 120000;
  const RANDOM_PON_TEST_RECENT_FULL_LIMIT = 30;
  const RANDOM_PON_TEST_PANEL_TEXT_LIMIT = 180000;
  const randomPonTestRuntime = {
    running: false,
    stopRequested: false,
    currentIndex: -1,
    queue: [],
    results: [],
    startedAt: 0,
    batchNo: 0,
    activeBatchId: '',
    activeQueueItem: null,
    runInitialCount: 0,
    runProcessedCount: 0,
    activeSourceMode: 'page',
    activeSourceUrl: '',
    activeSourceTitle: '',
    activeSourcePage: '',
    candidateCount: 0,
    requestedCountSpec: '10',
    currentJournalStartIndex: 0,
    heartbeatTimer: 0,
  };

  // Раскрытие карточек результатов — локальное состояние конкретной вкладки.
  // Оно намеренно не синхронизируется через workspace: клик по RAW в зеркале
  // не должен раскрывать/закрывать блок во вкладке-исполнителе и запускать
  // каскадную перерисовку во всех вкладках.
  const randomPonDisclosureState = new Map();

  function randomPonDisclosureKey(item) {
    return String(item && item.resultId || randomPonResultFingerprint(item) || 'unknown');
  }

  function ensureRandomPonDisclosure(item, defaultCardOpen = false) {
    const key = randomPonDisclosureKey(item);
    let state = randomPonDisclosureState.get(key);
    if (!state) {
      state = {
        card: Boolean(defaultCardOpen),
        raw: false,
        workbench: false,
        journal: false,
      };
      randomPonDisclosureState.set(key, state);
    }
    return { key, state };
  }

  function rememberRandomPonDisclosureToggle(event) {
    const details = event && event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const card = details.matches('.dp-random-result')
      ? details
      : details.closest('.dp-random-result');
    if (!card) return;
    const key = String(card.dataset.resultKey || '');
    if (!key) return;
    const state = randomPonDisclosureState.get(key) || {
      card: false,
      raw: false,
      workbench: false,
      journal: false,
    };
    if (details === card) state.card = Boolean(details.open);
    else {
      const section = String(details.dataset.dpSection || '');
      if (section && Object.prototype.hasOwnProperty.call(state, section)) {
        state[section] = Boolean(details.open);
      }
    }
    randomPonDisclosureState.set(key, state);
  }

  function captureRandomPonDisclosureState(list) {
    if (!list) return { scrollTop: 0 };
    list.querySelectorAll('details.dp-random-result[data-result-key]').forEach(card => {
      const key = String(card.dataset.resultKey || '');
      if (!key) return;
      const state = randomPonDisclosureState.get(key) || {
        card: false,
        raw: false,
        workbench: false,
        journal: false,
      };
      state.card = Boolean(card.open);
      card.querySelectorAll('details[data-dp-section]').forEach(details => {
        const section = String(details.dataset.dpSection || '');
        if (section && Object.prototype.hasOwnProperty.call(state, section)) {
          state[section] = Boolean(details.open);
        }
      });
      randomPonDisclosureState.set(key, state);
    });
    return { scrollTop: Number(list.scrollTop || 0) };
  }



  // Универсальное локальное состояние всех раскрывающихся блоков панели.
  // Синхронизация прогресса и перерисовка HTML не должны закрывать то,
  // что оператор раскрыл вручную в этой вкладке.
  const dpDisclosureState = new Map();
  let dpDisclosureRestoreFrame = 0;

  function dpDisclosureSummaryText(details) {
    const summary = details && details.querySelector(':scope > summary');
    return String(summary && summary.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/\b\d+\s*\/\s*\d+\b/g, '#/#')
      .replace(/\b\d+\b/g, '#')
      .trim()
      .slice(0, 180);
  }

  function dpDisclosureKey(details) {
    if (!(details instanceof HTMLDetailsElement)) return '';
    const randomCard = details.closest('.dp-random-result[data-result-key]');
    if (randomCard) {
      const resultKey = String(randomCard.dataset.resultKey || '');
      const section = details === randomCard
        ? 'card'
        : String(details.dataset.dpSection || dpDisclosureSummaryText(details) || 'section');
      return `result:${resultKey}:${section}`;
    }
    if (details.id) return `id:${details.id}`;
    const root = details.closest('#dp-results, #dp-random-panel, #dp-journal-wrap, #dp-panel');
    const rootId = String(root && root.id || 'panel');
    const summaryText = dpDisclosureSummaryText(details) || 'details';
    const peers = root ? [...root.querySelectorAll('details')].filter(node => dpDisclosureSummaryText(node) === summaryText) : [details];
    const index = Math.max(0, peers.indexOf(details));
    return `${rootId}:${summaryText}:${index}`;
  }

  function rememberDpDisclosure(details, forcedOpen = null) {
    const key = dpDisclosureKey(details);
    if (!key) return;
    dpDisclosureState.set(key, forcedOpen === null ? Boolean(details.open) : Boolean(forcedOpen));
  }

  function restoreDpDisclosures(root = document.querySelector('#dp-panel')) {
    if (!root) return;
    root.querySelectorAll('details').forEach(details => {
      const key = dpDisclosureKey(details);
      if (!key || !dpDisclosureState.has(key)) return;
      const expected = Boolean(dpDisclosureState.get(key));
      if (details.open !== expected) details.open = expected;
    });
  }

  function scheduleDpDisclosureRestore() {
    if (dpDisclosureRestoreFrame) return;
    dpDisclosureRestoreFrame = window.requestAnimationFrame(() => {
      dpDisclosureRestoreFrame = 0;
      restoreDpDisclosures();
    });
  }

  function installStablePanelDisclosures() {
    const panel = document.querySelector('#dp-panel');
    if (!panel || panel.dataset.disclosurePersistenceInstalled === '1') return;
    panel.dataset.disclosurePersistenceInstalled = '1';

    // Запоминаем намерение до того, как синхронизация успеет заменить узел.
    panel.addEventListener('click', event => {
      const summary = event.target && event.target.closest ? event.target.closest('summary') : null;
      const details = summary && summary.parentElement;
      if (!(details instanceof HTMLDetailsElement) || !panel.contains(details)) return;
      rememberDpDisclosure(details, !details.open);
      scheduleDpDisclosureRestore();
    }, true);

    panel.addEventListener('toggle', event => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      rememberDpDisclosure(details);
    }, true);

    const observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) scheduleDpDisclosureRestore();
    });
    observer.observe(panel, { childList: true, subtree: true });
    restoreDpDisclosures(panel);
  }

  // Последнее состояние панели хранится в Tampermonkey и потому доступно
  // после reload, перехода UserSide ↔ Billing и в других вкладках.
  // Сетевой Promise после перезагрузки восстановить невозможно: сохраняются
  // уже полученные данные, контекст, отчёты и журнал.
  // ЕДИНОЕ состояние всей панели. Оно включает основной отчёт, очередь,
  // результаты рандом-теста, системный журнал, открытые секции и текущую
  // операцию. Любая вкладка UserSide/Billing отображает один и тот же снимок.
  const WORKSPACE_STATE_KEY = 'dp_workspace_main_state_v1';
  const LEGACY_WORKSPACE_STATE_KEYS = ['dp_workspace_state_v2', 'dp_workspace_state_v1'];
  const WORKSPACE_STATE_SCHEMA = 3;
  const WORKSPACE_RESULTS_HTML_LIMIT = 2 * 1024 * 1024;
  const WORKSPACE_PERSIST_DELAY_MS = 70;
  const WORKSPACE_TAB_SESSION_KEY = 'dp_workspace_tab_id_v1';
  const WORKSPACE_COMMAND_KEY = 'dp_workspace_main_command_v1';
  const WORKSPACE_VIEW_KEY = 'dp_workspace_main_view_v1';
  const WORKSPACE_VIEW_VALUES = new Set(['subscriber', 'journal']);
  let workspaceActiveView = String(safeGetValue(WORKSPACE_VIEW_KEY, 'subscriber') || 'subscriber');
  // Отдельная короткая lease-блокировка является источником истины о том,
  // какая вкладка имеет право выполнять сетевую операцию. Workspace-снимок
  // отвечает за отображение, lease — за эксклюзивное владение процессом.
  const WORKSPACE_LEASE_KEY = 'dp_workspace_main_lease_v1';
  const WORKSPACE_LEASE_SCHEMA = 1;
  const WORKSPACE_LEASE_MS = 3 * 60 * 1000;
  const WORKSPACE_LEASE_HEARTBEAT_MS = 5000;
  const WORKSPACE_LEASE_CLAIM_SETTLE_MS = 240;
  const WORKSPACE_OPERATION_STALE_MS = 120000;
  let workspacePersistTimer = 0;
  let workspaceApplyingState = false;
  let workspaceLastAppliedAt = 0;
  let workspaceLastRevision = 0;
  let workspacePendingRemoteState = null;
  let workspaceDirty = false;
  let workspaceRemoteOperation = null;
  let workspaceLastCommandId = '';
  let workspaceExplicitOperationKind = '';
  let workspaceLeaseToken = '';
  let workspaceLeaseMode = '';
  let workspaceLeaseActiveContract = '';
  let workspaceLeaseHeartbeatTimer = 0;
  let workspaceLeaseLostHandling = false;
  const workspaceTabId = (() => {
    try {
      let value = String(sessionStorage.getItem(WORKSPACE_TAB_SESSION_KEY) || '');
      if (!value) {
        value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(WORKSPACE_TAB_SESSION_KEY, value);
      }
      return value;
    } catch (_) {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  })();
  const workspaceBaseDocumentTitle = String(document.title || 'SIMNET')
    .replace(/^\[(?:ИСПОЛНИТЕЛЬ|ЗЕРКАЛО|СВОБОДНА)\]\s*/i, '')
    .trim() || 'SIMNET';

  function workspaceTabShortId(tabId = workspaceTabId) {
    const value = String(tabId || '').replace(/[^a-z0-9]/gi, '');
    return (value.slice(-5) || '-----').toUpperCase();
  }

  function workspaceTabArea(host = location.hostname) {
    return /admin\.(?:simnet|looknet)/i.test(String(host || '')) ? 'Billing' : 'UserSide';
  }

  function workspaceTabLabel(host = location.hostname, tabId = workspaceTabId) {
    return `${workspaceTabArea(host)} · ${workspaceTabShortId(tabId)}`;
  }

  const savedJournalView = String(safeGetValue(JOURNAL_VIEW_KEY, 'flow') || 'flow');
  const systemJournal = {
    entries: [],
    sequence: 0,
    runStartedAt: 0,
    collapsed: false,
    viewMode: ['flow', 'all'].includes(savedJournalView) ? savedJournalView : 'flow',
  };

  function clonePlainValue(value, fallback = null) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
  }

  function persistedPortResult(result) {
    if (!result || !result.context || !result.assessment || !Array.isArray(result.rows)) return null;
    return {
      context: clonePlainValue(result.context, {}),
      assessment: clonePlainValue(result.assessment, {}),
      rows: result.rows.map(row => {
        const copy = { ...row };
        delete copy.raw;
        delete copy.macRows;
        return clonePlainValue(copy, {});
      }),
      billingPoll: {
        ok: Boolean(result.billingPoll && result.billingPoll.ok),
        error: String(result.billingPoll && result.billingPoll.error || ''),
        evidence: Array.isArray(result.billingPoll && result.billingPoll.evidence)
          ? result.billingPoll.evidence.slice(0, 500).map(value => String(value || '').slice(0, 2000))
          : [],
        raw: String(result.billingPoll && result.billingPoll.raw || '').slice(0, 180000),
      },
    };
  }

  function serializedJournalEntries() {
    return systemJournal.entries.slice(-JOURNAL_MAX_ENTRIES).map(entry => ({
      ...entry,
      at: entry.at instanceof Date ? entry.at.toISOString() : String(entry.at || ''),
      details: clonePlainValue(entry.details, {}),
    }));
  }

  function localWorkspaceOperation() {
    const randomRunning = Boolean(randomPonTestRuntime.running);
    const diagnosticRunning = Boolean(diagnosticRuntime.running);
    const running = randomRunning || diagnosticRunning;
    const activeContract = randomRunning
      ? String(randomPonTestRuntime.activeQueueItem && randomPonTestRuntime.activeQueueItem.contract || document.querySelector('#dp-input')?.value || '')
      : String(document.querySelector('#dp-input')?.value || '');
    return {
      running,
      mode: randomRunning ? 'random-pon' : diagnosticRunning ? (workspaceExplicitOperationKind || 'diagnostic') : 'idle',
      ownerTabId: running ? workspaceTabId : '',
      ownerHost: running ? location.hostname : '',
      ownerHref: running ? sanitizeJournalUrl(location.href) : '',
      ownerLabel: running ? workspaceTabLabel(location.hostname, workspaceTabId) : '',
      heartbeatAt: Date.now(),
      startedAt: randomRunning ? Number(randomPonTestRuntime.startedAt || 0) : Number(diagnosticRuntime.startedAt || 0),
      activeContract,
      selected: randomRunning ? Number(randomPonTestRuntime.runInitialCount || 0) : 1,
      processed: randomRunning ? Number(randomPonTestRuntime.runProcessedCount || 0) : 0,
      queueRemaining: Number(randomPonTestRuntime.queue.length || 0),
      batchNo: Number(randomPonTestRuntime.batchNo || 0),
    };
  }

  function sharedRandomPonState() {
    return { queue: [], results: [], running: false, stopRequested: false, currentIndex: -1, activeQueueItem: null, runInitialCount: 0, runProcessedCount: 0, startedAt: 0, activeBatchId: '' };
    const state = randomPonTestState();
    return {
      ...state,
      running: Boolean(randomPonTestRuntime.running),
      stopRequested: Boolean(randomPonTestRuntime.stopRequested),
      currentIndex: Number(randomPonTestRuntime.currentIndex || -1),
      activeQueueItem: clonePlainValue(randomPonTestRuntime.activeQueueItem, null),
      runInitialCount: Number(randomPonTestRuntime.runInitialCount || 0),
      runProcessedCount: Number(randomPonTestRuntime.runProcessedCount || 0),
      startedAt: Number(randomPonTestRuntime.startedAt || 0),
      activeBatchId: String(randomPonTestRuntime.activeBatchId || ''),
    };
  }

  function operationIsFresh(operation) {
    if (!operation || !operation.running) return false;
    const expiresAt = Number(operation.expiresAt || 0);
    if (expiresAt > 0) return expiresAt > Date.now();
    const heartbeatAt = Number(operation.heartbeatAt || operation.updatedAt || 0);
    return heartbeatAt > 0 && Date.now() - heartbeatAt < WORKSPACE_OPERATION_STALE_MS;
  }

  function validWorkspaceLease(raw) {
    return Boolean(raw && typeof raw === 'object'
      && Number(raw.schema) === WORKSPACE_LEASE_SCHEMA
      && raw.running === true
      && String(raw.token || '')
      && String(raw.ownerTabId || '')
      && Number(raw.expiresAt || 0) > Date.now());
  }

  function readWorkspaceLease() {
    const lease = safeGetValue(WORKSPACE_LEASE_KEY, null);
    return validWorkspaceLease(lease) ? clonePlainValue(lease, null) : null;
  }

  function workspaceLeaseAsOperation(lease) {
    if (!validWorkspaceLease(lease)) return null;
    return {
      running: true,
      mode: String(lease.mode || 'diagnostic'),
      ownerTabId: String(lease.ownerTabId || ''),
      ownerHost: String(lease.ownerHost || ''),
      ownerHref: String(lease.ownerHref || ''),
      ownerLabel: String(lease.ownerLabel || workspaceTabLabel(lease.ownerHost, lease.ownerTabId)),
      heartbeatAt: Number(lease.heartbeatAt || 0),
      expiresAt: Number(lease.expiresAt || 0),
      startedAt: Number(lease.startedAt || 0),
      activeContract: String(lease.activeContract || ''),
      selected: Number(lease.selected || 0),
      processed: Number(lease.processed || 0),
      queueRemaining: Number(lease.queueRemaining || 0),
      batchNo: Number(lease.batchNo || 0),
      leaseToken: String(lease.token || ''),
    };
  }

  function currentWorkspaceLeasePayload(token = workspaceLeaseToken) {
    const local = localWorkspaceOperation();
    const now = Date.now();
    return {
      schema: WORKSPACE_LEASE_SCHEMA,
      appVersion: ACTIVE_WORKBENCH_VERSION,
      running: true,
      token: String(token || ''),
      ownerTabId: workspaceTabId,
      ownerHost: location.hostname,
      ownerHref: sanitizeJournalUrl(location.href),
      ownerLabel: workspaceTabLabel(location.hostname, workspaceTabId),
      mode: String(local.running ? local.mode : workspaceLeaseMode || 'diagnostic'),
      activeContract: String(local.activeContract || workspaceLeaseActiveContract || ''),
      selected: Number(local.selected || 0),
      processed: Number(local.processed || 0),
      queueRemaining: Number(local.queueRemaining || randomPonTestRuntime.queue.length || 0),
      batchNo: Number(local.batchNo || randomPonTestRuntime.batchNo || 0),
      startedAt: Number(local.startedAt || now),
      claimedAt: Number(readWorkspaceLease()?.claimedAt || now),
      heartbeatAt: now,
      expiresAt: now + WORKSPACE_LEASE_MS,
    };
  }

  function workspaceOwnsCurrentLease() {
    if (!workspaceLeaseToken) return false;
    const current = readWorkspaceLease();
    return Boolean(current
      && current.ownerTabId === workspaceTabId
      && current.token === workspaceLeaseToken);
  }

  function stopWorkspaceLeaseHeartbeat() {
    if (!workspaceLeaseHeartbeatTimer) return;
    window.clearInterval(workspaceLeaseHeartbeatTimer);
    workspaceLeaseHeartbeatTimer = 0;
  }

  function handleWorkspaceLeaseLost(reason = 'эксклюзивное владение перешло другой вкладке') {
    if (workspaceLeaseLostHandling) return;
    workspaceLeaseLostHandling = true;
    stopWorkspaceLeaseHeartbeat();
    const previousToken = workspaceLeaseToken;
    workspaceLeaseToken = '';
    workspaceLeaseMode = '';
    workspaceLeaseActiveContract = '';
    const foreign = readWorkspaceLease();
    workspaceRemoteOperation = workspaceLeaseAsOperation(foreign);
    try {
      if (randomPonTestRuntime.running) randomPonTestRuntime.stopRequested = true;
      if (diagnosticRuntime.running) stopDiagnostics(`локальный запуск отменён: ${reason}`);
      journalLog('error', 'Локальная вкладка потеряла право исполнителя', {
        reason,
        previousToken: previousToken ? `${previousToken.slice(0, 6)}…` : 'не было',
        newOwner: workspaceRemoteOperation && workspaceRemoteOperation.ownerLabel || 'не определён',
      });
      renderStatus(`запуск здесь остановлен: исполнитель находится в другой вкладке`, 'error');
      updateRunControls();
    } finally {
      workspaceLeaseLostHandling = false;
    }
  }

  function renewWorkspaceLease() {
    if (!workspaceLeaseToken) return false;
    const current = safeGetValue(WORKSPACE_LEASE_KEY, null);
    if (validWorkspaceLease(current)
      && (String(current.ownerTabId || '') !== workspaceTabId || String(current.token || '') !== workspaceLeaseToken)) {
      handleWorkspaceLeaseLost('обнаружена более новая lease другой вкладки');
      return false;
    }
    try {
      GM_setValue(WORKSPACE_LEASE_KEY, currentWorkspaceLeasePayload(workspaceLeaseToken));
      workspaceDirty = true;
      persistWorkspaceStateNow({ force: true });
      updateWorkspaceRoleUi();
      return true;
    } catch (_) {
      return false;
    }
  }

  function startWorkspaceLeaseHeartbeat() {
    stopWorkspaceLeaseHeartbeat();
    renewWorkspaceLease();
    workspaceLeaseHeartbeatTimer = window.setInterval(renewWorkspaceLease, WORKSPACE_LEASE_HEARTBEAT_MS);
  }

  async function acquireWorkspaceLease(mode, activeContract = '') {
    const existing = readWorkspaceLease();
    if (existing && existing.ownerTabId !== workspaceTabId) {
      workspaceRemoteOperation = workspaceLeaseAsOperation(existing);
      renderStatus(`запуск запрещён: исполнитель ${workspaceRemoteOperation.ownerLabel || 'в другой вкладке'}`, 'warning');
      updateRunControls();
      return false;
    }
    if (existing && existing.ownerTabId === workspaceTabId && workspaceLeaseToken === existing.token) {
      workspaceLeaseMode = String(mode || workspaceLeaseMode || 'diagnostic');
      workspaceLeaseActiveContract = String(activeContract || workspaceLeaseActiveContract || '');
      startWorkspaceLeaseHeartbeat();
      return true;
    }

    const token = `${Date.now().toString(36)}-${workspaceTabId}-${Math.random().toString(36).slice(2, 10)}`;
    workspaceLeaseMode = String(mode || 'diagnostic');
    workspaceLeaseActiveContract = String(activeContract || '');
    try {
      GM_setValue(WORKSPACE_LEASE_KEY, currentWorkspaceLeasePayload(token));
    } catch (_) {
      renderStatus('не удалось установить блокировку исполнителя', 'error');
      return false;
    }

    await new Promise(resolve => window.setTimeout(resolve,
      WORKSPACE_LEASE_CLAIM_SETTLE_MS + Math.floor(Math.random() * 80)));
    const confirmed = readWorkspaceLease();
    if (!confirmed || confirmed.ownerTabId !== workspaceTabId || confirmed.token !== token) {
      workspaceLeaseMode = '';
      workspaceLeaseActiveContract = '';
      workspaceRemoteOperation = workspaceLeaseAsOperation(confirmed);
      renderStatus(`запуск отменён: право исполнителя получила другая вкладка`, 'warning');
      updateRunControls();
      return false;
    }

    workspaceLeaseToken = token;
    workspaceRemoteOperation = null;
    startWorkspaceLeaseHeartbeat();
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });
    updateRunControls();
    return true;
  }

  function releaseWorkspaceLease(reason = 'операция завершена') {
    stopWorkspaceLeaseHeartbeat();
    const current = safeGetValue(WORKSPACE_LEASE_KEY, null);
    if (current && String(current.ownerTabId || '') === workspaceTabId
      && (!workspaceLeaseToken || String(current.token || '') === workspaceLeaseToken)) {
      try { GM_deleteValue(WORKSPACE_LEASE_KEY); } catch (_) {}
    }
    workspaceLeaseToken = '';
    workspaceLeaseMode = '';
    workspaceLeaseActiveContract = '';
    workspaceRemoteOperation = null;
    workspaceDirty = true;
    try { console.debug(`${JOURNAL_PREFIX} lease исполнителя освобождена: ${reason}`); } catch (_) {}
    updateRunControls();
  }

  function clearReloadedOwnWorkspaceLease() {
    const lease = readWorkspaceLease();
    if (!lease || lease.ownerTabId !== workspaceTabId) return false;
    try { GM_deleteValue(WORKSPACE_LEASE_KEY); } catch (_) {}
    workspaceLeaseToken = '';
    workspaceLeaseMode = '';
    workspaceLeaseActiveContract = '';
    return true;
  }

  function buildWorkspaceState(revision = 0) {
    const panel = document.querySelector('#dp-panel');
    if (!panel) return null;
    const status = document.querySelector('#dp-status');
    const input = document.querySelector('#dp-input');
    const results = document.querySelector('#dp-results');
    const randomPanel = document.querySelector('#dp-random-panel');
    const resultsHtml = String(results && results.innerHTML || '');
    const localOperation = localWorkspaceOperation();
    const sharedOperation = localOperation.running
      ? localOperation
      : operationIsFresh(workspaceRemoteOperation)
        ? clonePlainValue(workspaceRemoteOperation, localOperation)
        : localOperation;
    return {
      schema: WORKSPACE_STATE_SCHEMA,
      revision: Number(revision || 0),
      appVersion: '2.0.0-dev.5.8',
      updatedAt: Date.now(),
      sourceTabId: workspaceTabId,
      sourceHost: location.hostname,
      href: sanitizeJournalUrl(location.href),
      contractInput: String(input && input.value || ''),
      status: {
        text: String(status && status.textContent || ''),
        className: String(status && status.className || ''),
      },
      resultsHtml: resultsHtml.length <= WORKSPACE_RESULTS_HTML_LIMIT ? resultsHtml : '',
      resultsOmitted: resultsHtml.length > WORKSPACE_RESULTS_HTML_LIMIT,
      operation: sharedOperation,
      journal: {
        entries: serializedJournalEntries(),
        sequence: Number(systemJournal.sequence || 0),
        runStartedAt: Number(systemJournal.runStartedAt || 0),
        viewMode: systemJournal.viewMode,
      },
      portContext: clonePlainValue(portAnalysisRuntime.context, null),
      portResult: persistedPortResult(portAnalysisRuntime.result),
      randomPonMeta: { savedAt: 0, queueCount: 0, resultsCount: 0, batchNo: 0 },
      ui: {
        randomPanelOpen: ['process', 'results', 'queue'].includes(normalizeWorkspaceView(workspaceActiveView)),
        panelCollapsed: Boolean(panel.classList.contains('collapsed')),
        panelWidth: Number(currentPanelGeometry().width || PANEL_DOCK_DEFAULT_WIDTH),
        journalHeight: Number(document.querySelector('#dp-journal-list')?.getBoundingClientRect().height || safeGetValue(JOURNAL_HEIGHT_KEY, 150) || 150),
        journalView: systemJournal.viewMode,
        workspaceView: normalizeWorkspaceView(workspaceActiveView),
      },
    };
  }

  function persistWorkspaceStateNow(options = {}) {
    if (workspaceApplyingState) return;
    if (workspacePersistTimer) window.clearTimeout(workspacePersistTimer);
    workspacePersistTimer = 0;

    const localRunning = Boolean(diagnosticRuntime.running || randomPonTestRuntime.running);
    if (!options.force && !workspaceDirty && !localRunning) return;

    const latest = safeGetValue(WORKSPACE_STATE_KEY, null);
    const latestRevision = validWorkspaceState(latest) ? Number(latest.revision || 0) : 0;
    const latestAt = validWorkspaceState(latest) ? Number(latest.updatedAt || 0) : 0;

    // Старая вкладка не имеет права затереть более новый снимок только потому,
    // что её скрыли или закрыли. Запись допускается после реального локального
    // изменения либо пока эта вкладка владеет выполняющейся операцией.
    if (!options.force && !localRunning && latestAt > workspaceLastAppliedAt && !workspaceDirty) return;

    const nextRevision = Math.max(workspaceLastRevision, latestRevision) + 1;
    const state = buildWorkspaceState(nextRevision);
    if (!state) return;
    try {
      GM_setValue(WORKSPACE_STATE_KEY, state);
      workspaceLastAppliedAt = Math.max(workspaceLastAppliedAt, state.updatedAt);
      workspaceLastRevision = nextRevision;
      workspaceDirty = false;
    } catch (error) {
      try { console.warn(`${JOURNAL_PREFIX} Не удалось сохранить единое состояние панели`, error); } catch (_) {}
    }
  }

  function scheduleWorkspacePersist(delay = WORKSPACE_PERSIST_DELAY_MS) {
    if (workspaceApplyingState) return;
    workspaceDirty = true;
    if (workspacePersistTimer) window.clearTimeout(workspacePersistTimer);
    workspacePersistTimer = window.setTimeout(() => persistWorkspaceStateNow(), Math.max(0, Number(delay) || 0));
  }

  function validWorkspaceState(raw) {
    return Boolean(raw && typeof raw === 'object'
      && Number(raw.schema) === WORKSPACE_STATE_SCHEMA
      && Number(raw.updatedAt) > 0);
  }

  function restoreJournalFromWorkspace(rawJournal) {
    if (!rawJournal || typeof rawJournal !== 'object') return;
    const restored = Array.isArray(rawJournal.entries) ? rawJournal.entries : [];
    systemJournal.entries = restored.slice(-JOURNAL_MAX_ENTRIES).map((entry, index) => {
      const at = new Date(entry && entry.at || Date.now());
      return {
        id: Number(entry && entry.id || index + 1),
        at: Number.isNaN(at.getTime()) ? new Date() : at,
        elapsedMs: Number(entry && entry.elapsedMs || 0),
        level: String(entry && entry.level || 'info'),
        title: String(entry && entry.title || ''),
        details: entry && typeof entry.details === 'object' ? entry.details : {},
      };
    });
    systemJournal.sequence = Math.max(
      Number(rawJournal.sequence || 0),
      ...systemJournal.entries.map(entry => Number(entry.id || 0)),
      0,
    );
    systemJournal.runStartedAt = Number(rawJournal.runStartedAt || 0);
    systemJournal.viewMode = ['flow', 'all'].includes(rawJournal.viewMode)
      ? rawJournal.viewMode
      : systemJournal.viewMode;
  }

  function restoreRandomPonFromWorkspace(rawRandom) {
    return;
    if (!rawRandom || typeof rawRandom !== 'object') return;
    randomPonTestRuntime.queue = normalizeRandomPonQueue(rawRandom.queue);
    randomPonTestRuntime.results = dedupeRandomPonHistory(rawRandom.results);
    randomPonTestRuntime.batchNo = Math.max(0, Number(rawRandom.batchNo || 0));
    randomPonTestRuntime.currentIndex = Number(rawRandom.currentIndex ?? -1);
    randomPonTestRuntime.activeQueueItem = clonePlainValue(rawRandom.activeQueueItem, null);
    randomPonTestRuntime.runInitialCount = Math.max(0, Number(rawRandom.runInitialCount || 0));
    randomPonTestRuntime.runProcessedCount = Math.max(0, Number(rawRandom.runProcessedCount || 0));
    randomPonTestRuntime.startedAt = Number(rawRandom.startedAt || 0);
    randomPonTestRuntime.activeBatchId = String(rawRandom.activeBatchId || '');

    const textarea = document.querySelector('#dp-random-contracts');
    const count = document.querySelector('#dp-random-count');
    const delay = document.querySelector('#dp-random-delay');
    const source = document.querySelector('#dp-random-source');
    const repeat = document.querySelector('#dp-random-repeat');
    if (textarea) textarea.value = String(rawRandom.manualContracts || '');
    if (count) count.value = String(rawRandom.countSpec || rawRandom.count || '10');
    if (delay) delay.value = String(Math.max(2, Math.min(30, Number(rawRandom.delaySeconds || 3))));
    if (source) source.value = rawRandom.sourceMode === 'manual' ? 'manual' : 'page';
    if (repeat) repeat.checked = Boolean(rawRandom.allowRepeat);
  }

  function applyWorkspaceState(rawState, options = {}) {
    if (!validWorkspaceState(rawState)) return false;
    const incomingRevision = Number(rawState.revision || 0);
    const incomingAt = Number(rawState.updatedAt || 0);
    if (!options.force && incomingRevision && incomingRevision <= workspaceLastRevision) return false;
    if (!options.force && !incomingRevision && incomingAt <= workspaceLastAppliedAt) return false;

    const localRunning = Boolean(diagnosticRuntime.running || randomPonTestRuntime.running);
    if (options.remote && localRunning && rawState.sourceTabId !== workspaceTabId) {
      workspacePendingRemoteState = clonePlainValue(rawState, null);
      return false;
    }

    workspaceApplyingState = true;
    let interruptedByReload = false;
    try {
      const input = document.querySelector('#dp-input');
      const status = document.querySelector('#dp-status');
      const results = document.querySelector('#dp-results');
      const panel = document.querySelector('#dp-panel');
      const randomPanel = document.querySelector('#dp-random-panel');

      if (input) input.value = String(rawState.contractInput || '');
      if (status) {
        status.textContent = String(rawState.status && rawState.status.text || 'Готов к работе');
        status.className = String(rawState.status && rawState.status.className || '');
      }
      if (results && rawState.resultsHtml) {
        const incomingHtml = String(rawState.resultsHtml);
        if (results.innerHTML !== incomingHtml) results.innerHTML = incomingHtml;
      }

      restoreJournalFromWorkspace(rawState.journal);
      // Тяжёлая история RAW хранится один раз в RANDOM_PON_TEST_STATE_KEY.
      // Единый workspace синхронизирует только интерфейс и ход операции.
      if (rawState.randomPon && typeof rawState.randomPon === 'object') {
        restoreRandomPonFromWorkspace(rawState.randomPon); // миграция раннего v3-снимка
      }
      portAnalysisRuntime.context = clonePlainValue(rawState.portContext, null);
      portAnalysisRuntime.result = clonePlainValue(rawState.portResult, null);
      portAnalysisRuntime.billingRaw = String(rawState.portResult && rawState.portResult.billingPoll && rawState.portResult.billingPoll.raw || '');

      const operation = clonePlainValue(rawState.operation, null);
      const operationFresh = operationIsFresh(operation);
      const leaseOperation = workspaceLeaseAsOperation(readWorkspaceLease());
      const remoteOwner = leaseOperation && leaseOperation.ownerTabId !== workspaceTabId;
      workspaceRemoteOperation = remoteOwner ? leaseOperation : null;

      interruptedByReload = Boolean(
        operationFresh && operation.ownerTabId === workspaceTabId
        && !localRunning
      );
      if (interruptedByReload && status) {
        clearReloadedOwnWorkspaceLease();
        status.className = 'warning';
        status.textContent = 'Предыдущая операция прервана перезагрузкой; собранные данные восстановлены';
      }

      if (randomPanel && rawState.ui && typeof rawState.ui.randomPanelOpen === 'boolean') {
        randomPanel.hidden = !rawState.ui.randomPanelOpen;
      }
      if (panel && rawState.ui && Number(rawState.ui.panelWidth) > 0) {
        const sharedWidth = Math.round(Number(rawState.ui.panelWidth));
        panel.dataset.expandedWidth = String(sharedWidth);
        try { GM_setValue(PANEL_GEOMETRY_KEY, { width: sharedWidth, height: window.innerHeight }); } catch (_) {}
      }
      if (panel && rawState.ui && typeof rawState.ui.panelCollapsed === 'boolean') {
        const sharedCollapsed = Boolean(rawState.ui.panelCollapsed);
        try { GM_setValue(PANEL_COLLAPSED_KEY, sharedCollapsed); } catch (_) {}
        setPanelCollapsed(sharedCollapsed, false);
      } else if (panel && rawState.ui && Number(rawState.ui.panelWidth) > 0) {
        applyPanelGeometry({ width: Number(rawState.ui.panelWidth), height: window.innerHeight }, false);
      }
      if (rawState.ui && rawState.ui.workspaceView) {
        workspaceActiveView = normalizeWorkspaceView(rawState.ui.workspaceView);
        try { GM_setValue(WORKSPACE_VIEW_KEY, workspaceActiveView); } catch (_) {}
        setWorkspaceView(workspaceActiveView, { persist: false });
      }
      if (rawState.ui && Number(rawState.ui.journalHeight) > 0) {
        const sharedJournalHeight = Math.round(Number(rawState.ui.journalHeight));
        try { GM_setValue(JOURNAL_HEIGHT_KEY, sharedJournalHeight); } catch (_) {}
        applyJournalHeight(sharedJournalHeight, false);
      }

      if (portAnalysisRuntime.result && document.querySelector('#dp-port-container')) {
        renderPortReport(portAnalysisRuntime.result);
      } else if (portAnalysisRuntime.context && document.querySelector('#dp-port-container')) {
        renderPortReadyState();
      }

      workspaceLastAppliedAt = incomingAt || Date.now();
      workspaceLastRevision = Math.max(workspaceLastRevision, incomingRevision);
      workspaceDirty = false;
      renderRandomPonTestResults();
      renderSystemJournal();
      updateRunControls();
    } finally {
      workspaceApplyingState = false;
    }

    if (interruptedByReload) {
      journalLog('warn', 'Операция была прервана перезагрузкой страницы', {
        action: 'собранные данные и отчёты восстановлены; сетевой процесс нужно запустить повторно',
      });
      scheduleWorkspacePersist(0);
    }
    return true;
  }

  function migrateLegacyWorkspaceState() {
    const current = safeGetValue(WORKSPACE_STATE_KEY, null);
    if (validWorkspaceState(current)) return current;

    let legacy = null;
    let legacyKey = '';
    for (const key of LEGACY_WORKSPACE_STATE_KEYS) {
      const candidate = safeGetValue(key, null);
      if (candidate && typeof candidate === 'object' && Number(candidate.updatedAt) > 0) {
        legacy = candidate;
        legacyKey = key;
        break;
      }
    }
    if (!legacy) return null;

    const randomLegacy = safeGetValue(RANDOM_PON_TEST_STATE_KEY, null);
    return {
      ...clonePlainValue(legacy, {}),
      schema: WORKSPACE_STATE_SCHEMA,
      revision: 1,
      appVersion: ACTIVE_WORKBENCH_VERSION,
      updatedAt: Date.now(),
      sourceTabId: workspaceTabId,
      operation: { running: false, mode: 'idle', ownerTabId: '', heartbeatAt: Date.now() },
      randomPonMeta: randomLegacy && typeof randomLegacy === 'object' ? {
        savedAt: Number(randomLegacy.savedAt || 0),
        queueCount: Array.isArray(randomLegacy.queue) ? randomLegacy.queue.length : 0,
        resultsCount: Array.isArray(randomLegacy.results) ? randomLegacy.results.length : 0,
        batchNo: Number(randomLegacy.batchNo || 0),
      } : null,
      ui: {
        randomPanelOpen: false,
        panelCollapsed: Boolean(safeGetValue(PANEL_COLLAPSED_KEY, false)),
        journalView: String(legacy.journal && legacy.journal.viewMode || systemJournal.viewMode),
        workspaceView: 'process',
      },
      migratedFrom: legacyKey,
    };
  }

  function restoreWorkspaceState() {
    const state = migrateLegacyWorkspaceState();
    const restored = applyWorkspaceState(state, { force: true, remote: false });
    if (restored && state && state.migratedFrom) {
      workspaceDirty = true;
      persistWorkspaceStateNow({ force: true });
    }
    return restored;
  }

  function applyPendingRemoteWorkspace(reason = 'focus') {
    const pending = workspacePendingRemoteState;
    if (!pending || diagnosticRuntime.running || randomPonTestRuntime.running || workspaceApplyingState) return false;
    workspacePendingRemoteState = null;
    const applied = applyWorkspaceState(pending, { remote: true });
    if (applied) {
      try { console.debug(`${JOURNAL_PREFIX} Единое состояние другой вкладки применено: ${reason}`); } catch (_) {}
    }
    return applied;
  }


  function requestRemoteWorkspaceStop() {
    const operation = workspaceRemoteOperation;
    if (!operationIsFresh(operation) || !operation.ownerTabId) return false;
    const command = {
      commandId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      type: 'stop',
      targetOwnerTabId: String(operation.ownerTabId),
      requestedByTabId: workspaceTabId,
      requestedAt: Date.now(),
      reason: 'остановлено оператором из синхронизированной панели',
    };
    try {
      GM_setValue(WORKSPACE_COMMAND_KEY, command);
      renderStatus(`команда STOP отправлена во вкладку, где выполняется ${operation.mode || 'операция'}`, 'warning');
      return true;
    } catch (_) {
      return false;
    }
  }

  function handleWorkspaceCommand(command, remote) {
    if (!remote || !command || typeof command !== 'object') return;
    const commandId = String(command.commandId || '');
    if (!commandId || commandId === workspaceLastCommandId) return;
    if (String(command.targetOwnerTabId || '') !== workspaceTabId) return;
    workspaceLastCommandId = commandId;
    if (command.type !== 'stop') return;

    journalLog('warn', 'Получена удалённая команда STOP из другой вкладки', {
      requestedByTabId: command.requestedByTabId || 'неизвестно',
      reason: command.reason || 'не указана',
    });
    if (randomPonTestRuntime.running) stopRandomPonTests();
    else if (diagnosticRuntime.running) stopDiagnostics(command.reason || 'остановлено оператором');
  }

  function installWorkspacePersistence() {
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(WORKSPACE_STATE_KEY, (_name, _oldValue, newValue, remote) => {
          if (!remote || workspaceApplyingState || !validWorkspaceState(newValue)) return;
          const revision = Number(newValue.revision || 0);
          if (revision && revision <= workspaceLastRevision) return;
          if (!revision && Number(newValue.updatedAt || 0) <= workspaceLastAppliedAt) return;

          if (diagnosticRuntime.running || randomPonTestRuntime.running) {
            workspacePendingRemoteState = clonePlainValue(newValue, null);
            return;
          }
          applyWorkspaceState(newValue, { remote: true });
        });
        GM_addValueChangeListener(WORKSPACE_COMMAND_KEY, (_name, _oldValue, command, remote) => {
          handleWorkspaceCommand(command, remote);
        });
        GM_addValueChangeListener(WORKSPACE_LEASE_KEY, (_name, _oldValue, newValue, remote) => {
          if (!remote) return;
          const lease = validWorkspaceLease(newValue) ? clonePlainValue(newValue, null) : null;
          if (workspaceLeaseToken && lease
            && (lease.ownerTabId !== workspaceTabId || lease.token !== workspaceLeaseToken)) {
            handleWorkspaceLeaseLost('lease была перехвачена другой вкладкой');
            return;
          }
          workspaceRemoteOperation = lease && lease.ownerTabId !== workspaceTabId
            ? workspaceLeaseAsOperation(lease)
            : null;
          updateRunControls();
        });
        GM_addValueChangeListener(RANDOM_PON_TEST_STATE_KEY, (_name, _oldValue, newValue, remote) => {
          if (!remote || !newValue || typeof newValue !== 'object') return;
          // Вкладка-владелец не принимает собственный отражённый снимок поверх
          // живого runtime. Остальные вкладки сразу получают ту же очередь,
          // результаты, настройки и RAW-историю.
          if (randomPonTestRuntime.running) return;
          workspaceApplyingState = true;
          try {
            restoreRandomPonFromWorkspace(newValue);
            renderRandomPonTestResults();
            updateRunControls();
          } finally {
            workspaceApplyingState = false;
          }
        });
      }
    } catch (_) {}

    const persistBeforeLeaving = () => {
      if (workspaceDirty || diagnosticRuntime.running || randomPonTestRuntime.running) {
        persistWorkspaceStateNow({ force: true });
      }
    };
    window.addEventListener('pagehide', persistBeforeLeaving);
    window.addEventListener('beforeunload', persistBeforeLeaving);
    window.addEventListener('focus', () => applyPendingRemoteWorkspace('focus'));
    window.addEventListener('pageshow', () => applyPendingRemoteWorkspace('pageshow'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) applyPendingRemoteWorkspace('visibilitychange');
      else if (workspaceDirty || diagnosticRuntime.running || randomPonTestRuntime.running) persistWorkspaceStateNow({ force: true });
    });
    document.querySelector('#dp-input')?.addEventListener('input', () => scheduleWorkspacePersist());
    document.querySelector('#dp-results')?.addEventListener('toggle', () => scheduleWorkspacePersist(), true);
    // Аккордеоны истории PON не являются общим состоянием процесса.
    // Запоминаем их только локально и не публикуем клик в другие вкладки.
    document.querySelector('#dp-random-results')?.addEventListener('toggle', rememberRandomPonDisclosureToggle, true);
  }

  function registerAbortable(abortable) {
    if (!abortable || typeof abortable.abort !== 'function') return () => {};
    diagnosticRuntime.abortables.add(abortable);
    return () => diagnosticRuntime.abortables.delete(abortable);
  }

  function abortActiveRequests() {
    const active = [...diagnosticRuntime.abortables];
    diagnosticRuntime.abortables.clear();
    for (const abortable of active) {
      try { abortable.abort(); } catch (_) {}
    }
  }

  function foreignWorkspaceOperation() {
    const lease = readWorkspaceLease();
    if (!lease || lease.ownerTabId === workspaceTabId) return null;
    return workspaceLeaseAsOperation(lease);
  }

  function workspaceMutationBlocked() {
    const operation = foreignWorkspaceOperation();
    if (!operation) return false;
    workspaceRemoteOperation = operation;
    renderStatus(`изменение запрещено: процесс выполняет ${operation.ownerLabel || 'другая вкладка'}`, 'warning');
    updateRunControls();
    return true;
  }

  function blockStartWhenAnotherTabRuns() {
    const operation = foreignWorkspaceOperation();
    if (!operation) return false;
    workspaceRemoteOperation = operation;
    renderStatus(`уже выполняется ${operation.mode || 'операция'} в другой вкладке${operation.activeContract ? ` · ${operation.activeContract}` : ''}`, 'warning');
    updateRunControls();
    return true;
  }

  function normalizeWorkspaceView(view) {
    const value = String(view || '').trim().toLowerCase();
    return WORKSPACE_VIEW_VALUES.has(value) ? value : 'subscriber';
  }

  function updateWorkspaceViewBadges() {
    const badges = {
      process: document.querySelector('[data-dp-workspace-badge="process"]'),
      results: document.querySelector('[data-dp-workspace-badge="results"]'),
      queue: document.querySelector('[data-dp-workspace-badge="queue"]'),
      subscriber: document.querySelector('[data-dp-workspace-badge="subscriber"]'),
      journal: document.querySelector('[data-dp-workspace-badge="journal"]'),
    };
    const localRandom = Boolean(randomPonTestRuntime.running);
    const remoteRandom = operationIsFresh(workspaceRemoteOperation) && workspaceRemoteOperation.mode === 'random-pon';
    const operation = localRandom ? localWorkspaceOperation() : remoteRandom ? workspaceRemoteOperation : null;
    const processed = operation ? Number(operation.processed || 0) : 0;
    const selected = operation ? Number(operation.selected || 0) : 0;
    if (badges.process) badges.process.textContent = operation ? `${processed}/${selected || '?'}` : '—';
    if (badges.results) badges.results.textContent = String(randomPonTestRuntime.results.length || 0);
    if (badges.queue) badges.queue.textContent = String(randomPonTestRuntime.queue.length || 0);
    if (badges.subscriber) badges.subscriber.textContent = document.querySelector('#dp-onu-container .dp-onu-state') ? '1' : '—';
    if (badges.journal) badges.journal.textContent = String(systemJournal.entries.length || 0);
  }

  function setWorkspaceView(view, options = {}) {
    const next = normalizeWorkspaceView(view);
    workspaceActiveView = next;
    const panel = document.querySelector('#dp-panel');
    if (panel) panel.dataset.workspaceView = next;
    document.querySelectorAll('[data-dp-workspace-view]').forEach(button => {
      const active = button.getAttribute('data-dp-workspace-view') === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const randomPanel = document.querySelector('#dp-random-panel');
    const randomVisible = ['process', 'results', 'queue'].includes(next);
    if (randomPanel) {
      randomPanel.hidden = !randomVisible;
      if (randomVisible) renderRandomPonTestResults();
    }
    const config = document.querySelector('#dp-random-config');
    if (config) {
      if (next === 'queue' && !(diagnosticRuntime.running || randomPonTestRuntime.running || operationIsFresh(workspaceRemoteOperation))) config.open = true;
      if (next === 'process' && (randomPonTestRuntime.running || (operationIsFresh(workspaceRemoteOperation) && workspaceRemoteOperation.mode === 'random-pon'))) config.open = false;
    }
    updateWorkspaceViewBadges();
    if (options.persist !== false) {
      try { GM_setValue(WORKSPACE_VIEW_KEY, next); } catch (_) {}
      scheduleWorkspacePersist();
    }
  }

  function updateWorkspaceSyncBadge() {
    const badge = document.querySelector('#dp-sync-badge');
    if (!badge) return;
    const localOperation = localWorkspaceOperation();
    const ownLease = readWorkspaceLease();
    const localOwner = ownLease && ownLease.ownerTabId === workspaceTabId && workspaceOwnsCurrentLease();
    if (localOperation.running || localOwner) {
      badge.className = 'local';
      badge.textContent = `ИСПОЛНИТЕЛЬ · ЭТА ВКЛАДКА · ${workspaceTabShortId()}`;
      return;
    }
    if (operationIsFresh(workspaceRemoteOperation)) {
      badge.className = 'remote';
      badge.textContent = `ЗЕРКАЛО · ТОЛЬКО ПРОСМОТР · ${workspaceRemoteOperation.ownerLabel || workspaceTabShortId(workspaceRemoteOperation.ownerTabId)}`;
      return;
    }
    badge.className = '';
    badge.textContent = `СВОБОДНА · запуск разрешён · ${workspaceTabShortId()}`;
  }

  function updateWorkspaceRoleUi() {
    const panel = document.querySelector('#dp-panel');
    const banner = document.querySelector('#dp-role-banner');
    const title = document.querySelector('#dp-role-title');
    const detail = document.querySelector('#dp-role-detail');
    const localOperation = localWorkspaceOperation();
    const ownLease = readWorkspaceLease();
    const localOwner = Boolean(ownLease && ownLease.ownerTabId === workspaceTabId && workspaceOwnsCurrentLease());
    const foreign = foreignWorkspaceOperation();
    if (foreign) workspaceRemoteOperation = foreign;
    else if (!localOwner) workspaceRemoteOperation = null;

    let role = 'idle';
    let heading = 'СВОБОДНАЯ ВКЛАДКА';
    let description = `Процесс не запущен. Старт можно выполнить здесь · вкладка ${workspaceTabShortId()}.`;
    let documentPrefix = '';

    if (localOperation.running || localOwner) {
      role = 'owner';
      const operation = localOperation.running ? localOperation : workspaceLeaseAsOperation(ownLease) || {};
      const progress = operation.mode === 'random-pon'
        ? ` · ${Number(operation.processed || 0) + 1}/${operation.selected || '?'}`
        : operation.activeContract ? ` · ${operation.activeContract}` : '';
      heading = 'ИСПОЛНИТЕЛЬ — ЭТА ВКЛАДКА';
      description = `${operation.mode === 'random-pon' ? `PON-цикл №${operation.batchNo || '?'}` : operation.mode || 'диагностика'}${progress}. Переключаться на другие вкладки можно. Закрытие, обновление или переход по ссылке в этой вкладке прервёт активный запрос; готовые результаты и очередь сохранятся.`;
      documentPrefix = operation.mode === 'random-pon'
        ? `[ИСПОЛНИТЕЛЬ ${Number(operation.processed || 0)}/${operation.selected || '?'}] `
        : '[ИСПОЛНИТЕЛЬ] ';
    } else if (foreign) {
      role = 'mirror';
      const progress = foreign.mode === 'random-pon'
        ? ` · ${Number(foreign.processed || 0) + 1}/${foreign.selected || '?'}`
        : foreign.activeContract ? ` · ${foreign.activeContract}` : '';
      heading = 'ЗЕРКАЛО — СЕТЕВОЙ ЗАПУСК ЗАБЛОКИРОВАН';
      description = `Исполнитель: ${foreign.ownerLabel || workspaceTabLabel(foreign.ownerHost, foreign.ownerTabId)} · ${foreign.mode === 'random-pon' ? `PON-цикл №${foreign.batchNo || '?'}` : foreign.mode || 'диагностика'}${progress}. Прогресс, журнал, новые результаты и RAW подгружаются сюда автоматически. Доступны просмотр, копирование и STOP.`;
      documentPrefix = foreign.mode === 'random-pon'
        ? `[ЗЕРКАЛО ${Number(foreign.processed || 0)}/${foreign.selected || '?'}] `
        : '[ЗЕРКАЛО] ';
    }

    if (panel) panel.dataset.tabRole = role;
    if (banner) banner.className = role;
    if (title) title.textContent = heading;
    if (detail) detail.textContent = description;
    if (document.title !== `${documentPrefix}${workspaceBaseDocumentTitle}`) {
      document.title = `${documentPrefix}${workspaceBaseDocumentTitle}`;
    }
    updateWorkspaceSyncBadge();
  }

  function updateRunControls() {
    const leaseForeign = foreignWorkspaceOperation();
    if (leaseForeign) workspaceRemoteOperation = leaseForeign;
    else if (!workspaceOwnsCurrentLease()) workspaceRemoteOperation = null;

    const runButton = document.querySelector('#dp-run');
    const portButton = document.querySelector('#dp-port-run');
    const randomButton = document.querySelector('#dp-random-toggle');
    const stopButton = document.querySelector('#dp-stop');
    const batchBusy = Boolean(randomPonTestRuntime.running);
    const localBusy = Boolean(diagnosticRuntime.running || batchBusy || workspaceOwnsCurrentLease());
    const remoteBusy = operationIsFresh(workspaceRemoteOperation);
    const anyBusy = localBusy || remoteBusy;

    if (runButton) {
      runButton.disabled = anyBusy;
      runButton.title = remoteBusy
        ? `Запуск запрещён: исполнитель ${workspaceRemoteOperation.ownerLabel || 'в другой вкладке'}`
        : localBusy ? 'В этой вкладке уже выполняется операция' : 'Запустить диагностику в этой вкладке';
    }
    if (portButton) {
      const ready = Boolean(portAnalysisRuntime.context && portAnalysisRuntime.context.oltIp && portAnalysisRuntime.context.ponPort);
      portButton.disabled = anyBusy || !ready;
      portButton.title = remoteBusy
        ? `Операция выполняется в другой вкладке: ${workspaceRemoteOperation.ownerLabel || workspaceRemoteOperation.mode || 'диагностика'}`
        : ready
          ? `Собрать и сопоставить абонентов ${portAnalysisRuntime.context.ponPort} на OLT ${portAnalysisRuntime.context.oltIp}`
          : 'Сначала запусти обычную диагностику и получи подтверждённую ONU с PON-позицией';
    }
    // Накопительная панель и экспорт доступны в зеркале; запуск и изменение
    // очереди блокируются на весь срок чужой или локальной операции.
    if (randomButton) randomButton.disabled = false;
    if (stopButton) {
      stopButton.disabled = !anyBusy;
      stopButton.title = remoteBusy
        ? `Отправить STOP исполнителю ${workspaceRemoteOperation.ownerLabel || workspaceRemoteOperation.ownerHost || ''}`
        : 'Остановить текущую операцию в этой вкладке';
    }

    const input = document.querySelector('#dp-input');
    if (input) {
      input.readOnly = remoteBusy;
      input.title = remoteBusy ? 'Зеркало: поле управляется вкладкой-исполнителем' : '';
    }
    const billingProviderSelect = document.querySelector('#dp-billing-provider-mode');
    if (billingProviderSelect) {
      billingProviderSelect.disabled = anyBusy || Boolean(billingHostProvider);
      billingProviderSelect.title = billingHostProvider
        ? `Эта вкладка всегда использует ${activeBillingProfile.label}: база определяется доменом.`
        : anyBusy
          ? 'Нельзя менять базу во время активной операции.'
          : 'Авто определяет базу по карточке абонента UserSide; Simnet и Looknet задают её вручную.';
    }
    const randomContracts = document.querySelector('#dp-random-contracts');
    if (randomContracts) randomContracts.readOnly = anyBusy;
    ['#dp-random-count', '#dp-random-delay', '#dp-random-source', '#dp-random-repeat'].forEach(selector => {
      const control = document.querySelector(selector);
      if (control) control.disabled = anyBusy;
    });

    const randomCollect = document.querySelector('#dp-random-collect');
    const randomStart = document.querySelector('#dp-random-start');
    const randomStop = document.querySelector('#dp-random-stop');
    const randomClearQueue = document.querySelector('#dp-random-clear-queue');
    const randomClearResults = document.querySelector('#dp-random-clear');
    if (randomCollect) randomCollect.disabled = anyBusy || randomPonTestRuntime.queue.length >= RANDOM_PON_TEST_QUEUE_LIMIT;
    if (randomStart) randomStart.disabled = anyBusy || !randomPonTestRuntime.queue.length;
    if (randomStop) randomStop.disabled = !(batchBusy || (remoteBusy && workspaceRemoteOperation.mode === 'random-pon'));
    if (randomClearQueue) randomClearQueue.disabled = anyBusy || !randomPonTestRuntime.queue.length;
    if (randomClearResults) randomClearResults.disabled = anyBusy || !randomPonTestRuntime.results.length;
    updateWorkspaceRoleUi();
    updateWorkspaceViewBadges();
  }

  function isDiagnosticRunActive(runId) {
    return diagnosticRuntime.running
      && !diagnosticRuntime.stopped
      && runId === diagnosticsRunId
      && runId === diagnosticRuntime.runId;
  }

  function stopDiagnostics(reason = 'остановлено оператором', options = {}) {
    if (!diagnosticRuntime.running && !randomPonTestRuntime.running && operationIsFresh(workspaceRemoteOperation)) {
      requestRemoteWorkspaceStop();
      return;
    }
    if (randomPonTestRuntime.running && !options.keepRandomBatch) {
      randomPonTestRuntime.stopRequested = true;
    }
    const wasRunning = diagnosticRuntime.running;
    diagnosticRuntime.running = false;
    diagnosticRuntime.stopped = true;
    diagnosticRuntime.runId = ++diagnosticsRunId;
    if (diagnosticRuntime.deadlineTimer) window.clearTimeout(diagnosticRuntime.deadlineTimer);
    diagnosticRuntime.deadlineTimer = 0;
    abortActiveRequests();
    updateRunControls();
    if (!options.silentStatus) renderStatus(reason, 'stopped');
    if (wasRunning) journalLog('warn', 'Диагностика остановлена', { reason });
    scheduleWorkspacePersist();
  }

  function beginDiagnosticsRun() {
    if (diagnosticRuntime.running) {
      stopDiagnostics('предыдущий запуск заменён новым', { silentStatus: true });
    }
    const runId = ++diagnosticsRunId;
    diagnosticRuntime.runId = runId;
    diagnosticRuntime.running = true;
    diagnosticRuntime.stopped = false;
    diagnosticRuntime.startedAt = Date.now();
    diagnosticRuntime.counters = { userSideRequests: 0, billingRequests: 0, onuPolls: 0 };
    diagnosticRuntime.deadlineTimer = window.setTimeout(() => {
      if (isDiagnosticRunActive(runId)) stopDiagnostics('остановлено: общий лимит 3 минуты');
    }, DIAGNOSTIC_LIMITS.totalMs);
    updateRunControls();
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });
    return runId;
  }

  function finishDiagnosticsRun(runId) {
    if (runId !== diagnosticsRunId || runId !== diagnosticRuntime.runId) return;
    diagnosticRuntime.running = false;
    if (diagnosticRuntime.deadlineTimer) window.clearTimeout(diagnosticRuntime.deadlineTimer);
    diagnosticRuntime.deadlineTimer = 0;
    diagnosticRuntime.abortables.clear();
    if (!randomPonTestRuntime.running) workspaceExplicitOperationKind = '';
    updateRunControls();
    workspacePendingRemoteState = null;
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });
  }

  function consumeDiagnosticBudget(kind, label) {
    if (!diagnosticRuntime.running || diagnosticRuntime.stopped) {
      throw new Error('диагностика остановлена');
    }
    const limit = DIAGNOSTIC_LIMITS[kind];
    const next = (diagnosticRuntime.counters[kind] || 0) + 1;
    diagnosticRuntime.counters[kind] = next;
    if (next <= limit) return;
    const reason = `остановлено: превышён лимит ${label} (${limit})`;
    stopDiagnostics(reason);
    throw new Error(reason);
  }

  function sanitizeJournalUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/^(pp|token|salt|password|passwd|session|sid|employee_hash)$/i.test(key)) {
          url.searchParams.set(key, '{protected}');
        } else if (/^(?:_|ts|timestamp|rand|cache|t)$/i.test(key)) {
          url.searchParams.set(key, '{dynamic}');
        }
      }
      return `${url.origin}${url.pathname}${url.search}`;
    } catch (_) {
      return String(rawUrl || '').slice(0, 1000);
    }
  }

  function journalCompact(value, max = 1000) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function normalizeJournalDetails(details = {}) {
    const normalized = {};
    for (const [key, rawValue] of Object.entries(details || {})) {
      if (rawValue === null || rawValue === undefined || rawValue === '') continue;
      let value = rawValue;
      if (/url|endpoint|href/i.test(key)) value = sanitizeJournalUrl(rawValue);
      else if (Array.isArray(value)) value = value.join(' | ');
      else if (typeof value === 'object') {
        try { value = JSON.stringify(value); } catch (_) { value = String(value); }
      }
      normalized[key] = journalCompact(value, 1400);
    }
    return normalized;
  }

  function journalElapsedMs() {
    return systemJournal.runStartedAt ? Date.now() - systemJournal.runStartedAt : 0;
  }

  function journalLog(level, title, details = {}) {
    const entry = {
      id: ++systemJournal.sequence,
      at: new Date(),
      elapsedMs: journalElapsedMs(),
      level: ['debug', 'decision', 'info', 'network', 'ok', 'warn', 'error'].includes(level) ? level : 'info',
      title: journalCompact(title, 500),
      details: normalizeJournalDetails(details),
    };
    systemJournal.entries.push(entry);
    systemJournal.entries = systemJournal.entries.slice(-JOURNAL_MAX_ENTRIES);

    const consoleDetails = Object.keys(entry.details).length ? entry.details : '';
    const method = entry.level === 'error' ? 'error'
      : entry.level === 'warn' ? 'warn'
      : entry.level === 'debug' ? 'debug'
      : 'log';
    try { console[method](`${JOURNAL_PREFIX} ${entry.title}`, consoleDetails); } catch (_) {}
    renderSystemJournal();
    scheduleWorkspacePersist();
    return entry;
  }

  function resetSystemJournal(contract) {
    // Во время накопленного PON-цикла журнал не очищается между договорами.
    // Иначе запись «СТАРТ цикла» и прогресс предыдущих опросов исчезали
    // при каждом вызове runDiagnostics().
    if (randomPonTestRuntime.running && randomPonTestRuntime.activeBatchId) {
      randomPonTestRuntime.currentJournalStartIndex = systemJournal.entries.length;
      journalLog('info', `PON-цикл №${randomPonTestRuntime.batchNo} · старт договора ${contract}`, {
        position: `${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}`,
        queueRemaining: randomPonTestRuntime.queue.length,
        sourcePage: randomPonTestRuntime.activeSourcePage || 'не указана',
        host: location.hostname,
        version: ACTIVE_WORKBENCH_VERSION,
        billingSessionPp: safeGetValue(BILLING_PP_KEY, '') ? 'есть' : 'не найден',
      });
      return;
    }

    systemJournal.entries = [];
    systemJournal.sequence = 0;
    systemJournal.runStartedAt = Date.now();
    randomPonTestRuntime.currentJournalStartIndex = 0;
    journalLog('info', `Новый запуск диагностики договора ${contract}`, {
      host: location.hostname,
      version: ACTIVE_WORKBENCH_VERSION,
      billingSessionPp: safeGetValue(BILLING_PP_KEY, '') ? 'есть' : 'не найден',
    });
  }

  function resetSystemJournalForRandomPonBatch() {
    systemJournal.entries = [];
    systemJournal.sequence = 0;
    systemJournal.runStartedAt = Date.now();
    randomPonTestRuntime.currentJournalStartIndex = 0;
    renderSystemJournal();
    scheduleWorkspacePersist();
  }

  function journalDetailsText(details) {
    return Object.entries(details || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');
  }

  function journalVisibleEntries() {
    if (systemJournal.viewMode === 'all') return systemJournal.entries;
    return systemJournal.entries.filter(entry => !['network', 'debug'].includes(entry.level));
  }

  function journalDisplayDetails(entry) {
    const details = entry && entry.details || {};
    if (systemJournal.viewMode === 'all') return details;
    return Object.fromEntries(
      Object.entries(details).filter(([key]) => !/(?:^|_)(?:url|finalUrl|endpoint|href)$/i.test(key))
    );
  }

  function setJournalView(mode) {
    const next = mode === 'all' ? 'all' : 'flow';
    systemJournal.viewMode = next;
    try { GM_setValue(JOURNAL_VIEW_KEY, next); } catch (_) {}
    renderSystemJournal();
  }

  function journalEntriesAsText(entries, mode = 'all') {
    return (Array.isArray(entries) ? entries : []).map(entry => {
      const at = entry.at instanceof Date ? entry.at : new Date(entry.at || Date.now());
      const time = at.toLocaleTimeString('ru-RU', { hour12: false });
      const elapsed = `+${(Number(entry.elapsedMs || 0) / 1000).toFixed(1)}с`;
      const detailsObject = mode === 'all' ? entry.details : journalDisplayDetails(entry);
      const details = journalDetailsText(detailsObject);
      return `[${time}] [${elapsed}] [${String(entry.level || 'info').toUpperCase()}] ${entry.title}${details ? `\n  ${details}` : ''}`;
    }).join('\n');
  }

  function systemJournalAsText(mode = systemJournal.viewMode) {
    const entries = mode === 'all' ? systemJournal.entries : journalVisibleEntries();
    return journalEntriesAsText(entries, mode);
  }

  function currentRandomPonContractJournalAsText() {
    const start = Math.max(0, Math.min(
      systemJournal.entries.length,
      Number(randomPonTestRuntime.currentJournalStartIndex || 0),
    ));
    return journalEntriesAsText(systemJournal.entries.slice(start), 'all');
  }

  async function copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) throw new Error('журнал пуст');
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(value, 'text');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('браузер не разрешил копирование');
  }

  async function copyCurrentJournal() {
    const button = document.querySelector('#dp-copy-journal');
    const mode = systemJournal.viewMode;
    const entries = mode === 'all' ? systemJournal.entries : journalVisibleEntries();
    try {
      await copyTextToClipboard(systemJournalAsText(mode));
      if (button) {
        const original = button.dataset.originalText || button.textContent || 'Копировать';
        button.dataset.originalText = original;
        button.textContent = `Скопировано ${entries.length}`;
        window.setTimeout(() => { if (button) button.textContent = original; }, 1500);
      }
    } catch (error) {
      if (button) {
        const original = button.dataset.originalText || 'Копировать';
        button.textContent = 'Ошибка';
        window.setTimeout(() => { if (button) button.textContent = original; }, 1500);
      }
      journalLog('warn', 'Не удалось скопировать системный журнал', {
        reason: error && error.message || String(error),
      });
    }
  }

  function renderSystemJournal() {
    const list = document.querySelector('#dp-journal-list');
    const count = document.querySelector('#dp-journal-count');
    if (!list || !count || typeof escapeHtml !== 'function') return;
    const entries = journalVisibleEntries();
    count.textContent = systemJournal.viewMode === 'all'
      ? String(systemJournal.entries.length)
      : `${entries.length}/${systemJournal.entries.length}`;
    document.querySelectorAll('[data-dp-journal-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.dpJournalView === systemJournal.viewMode);
    });
    list.innerHTML = entries.map(entry => {
      const time = entry.at.toLocaleTimeString('ru-RU', { hour12: false });
      const elapsed = `+${(entry.elapsedMs / 1000).toFixed(1)}с`;
      const details = journalDetailsText(journalDisplayDetails(entry));
      const levelLabel = ({ decision: 'решение', network: 'сеть', info: 'шаг', ok: 'готово', warn: 'внимание', error: 'ошибка', debug: 'детали' })[entry.level] || entry.level;
      return `
        <div class="dp-journal-entry ${escapeHtml(entry.level)}">
          <div class="dp-journal-line">
            <span class="dp-journal-time">${escapeHtml(time)} · ${escapeHtml(elapsed)}</span>
            <span class="dp-journal-level">${escapeHtml(levelLabel)}</span>
          </div>
          <div class="dp-journal-title">${escapeHtml(entry.title)}</div>
          ${details ? `<div class="dp-journal-details">${escapeHtml(details)}</div>` : ''}
        </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
    updateWorkspaceViewBadges();
  }


  if (isActiveBillingHost()) {
    const refreshBillingPp = () => {
      const pp = storedBillingPp();
      if (pp) synchronizeBillingPagePp(pp);
      updateBillingSessionBadge();
    };

    window.addEventListener('pageshow', refreshBillingPp);
    window.addEventListener('popstate', refreshBillingPp);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateBillingSessionBadge();
    });
  }

  const ENDPOINTS = {
    resolveContract: {
      buildUrl: (contract) => `${BASE}/customer_list/ajax_search?token=${Date.now()}&search=${encodeURIComponent(contract)}`,
      extractCustomerId: (raw) => {
        try {
          const json = JSON.parse(raw);
          const frag = parseHtml(json.data || '');
          const link = frag.querySelector('a[href^="/customer/"]');
          const m = link && link.getAttribute('href').match(/\/customer\/(\d+)/);
          return m ? m[1] : null;
        } catch (e) { return null; }
      },
    },
    main: (c) => `${BASE}/customer/tab?tab=main&id=${c.customerId}`,
    tab29: (c) => `${BASE}/customer/tab?tab=tab29&id=${c.customerId}`,
    support: (c) => `${BASE}/customer/tab?tab=support&id=${c.customerId}`,
    macHistory: (c) => `${BASE}/customer_list/search_page?search=${encodeURIComponent(c.mac)}&find_typer=machistory`,
    macHistoryUplinkDownlink: (c) => `${BASE}/customer_list/search_page?search=${encodeURIComponent(c.mac)}&uplinkport=1`,
    deviceCard: (c) => `${BASE}/device/${encodeURIComponent(c.deviceId)}`,
  };

  function isMeaningful(v) {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    if (s === '') return false;
    return !['-', '—', 'нет данных', 'n/a', 'null'].includes(s.toLowerCase());
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function extractByLabel(root, label) {
    const nodes = root.querySelectorAll('*');
    for (const node of nodes) {
      if (node.children.length > 0) continue;
      const text = (node.textContent || '').trim();
      if (!text.startsWith(label)) continue;
      const rest = text.slice(label.length).trim();
      if (rest) return rest;
      const sib = node.nextElementSibling;
      if (sib && sib.textContent.trim()) return sib.textContent.trim();
    }
    return null;
  }

  function extractByLeftData(doc, label) {
    const divs = doc.querySelectorAll('.left_data');
    for (const div of divs) {
      if (div.textContent.trim().replace(/:\s*$/, '') === label.replace(/:\s*$/, '')) {
        const sib = div.nextElementSibling;
        return sib ? sib.textContent.trim() : null;
      }
    }
    return null;
  }

  function extractSessionMac(doc) {
    const anchor = doc.querySelector('#ref_ip_mac');
    const heading = anchor && anchor.closest('.label_h3_hr');
    const block = heading && heading.nextElementSibling;
    const item = block && block.querySelector('.item');
    if (!item) return null;
    const divs = item.querySelectorAll(':scope > div');
    return divs[1] ? extractByRegex(divs[1].textContent, MAC_REGEX) : null;
  }

  function extractActiveDeviceMac(doc) {
    const rows = doc.querySelectorAll('#tableListData tr.table_item');
    for (const row of rows) {
      const text = row.textContent;
      if (/замена/i.test(text)) continue;
      const mac = extractByRegex(text, MAC_REGEX);
      if (mac) return mac;
    }
    return null;
  }

  function extractDeviceIdFromHref(rawHref) {
    const match = String(rawHref || '').match(/\/device\/(\d+)/);
    return match ? match[1] : '';
  }

  function oltEvidenceContainer(anchor) {
    let node = anchor;
    let fallback = anchor.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 3000) break;
      if (/Найдено\s+на\s+OLT|\bOLT\b|IP\s*:\s*(?:\d{1,3}\.){3}\d{1,3}|Interface\s*:/i.test(text)) {
        fallback = node;
        if (/IP\s*:\s*(?:\d{1,3}\.){3}\d{1,3}/i.test(text)
          && /(?:Interface\s*:|(?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3})/i.test(text)) {
          return node;
        }
      }
    }
    return fallback;
  }

  function extractOltEvidence(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const candidates = [];
    const anchors = [...doc.querySelectorAll('a[href*="/device/"]')];
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const deviceId = extractDeviceIdFromHref(href);
      if (!deviceId) continue;
      const container = oltEvidenceContainer(anchor);
      const rowText = String(container && container.textContent || anchor.parentElement && anchor.parentElement.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const anchorText = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
      const ipMatch = rowText.match(/IP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i);
      const ifaceMatch = rowText.match(/Interface\s*:\s*((?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3}(?::\d+)?)/i)
        || rowText.match(/\b((?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3}(?::\d+)?)\b/i);
      const ip = ipMatch ? ipMatch[1] : '';
      const onuInterface = ifaceMatch ? ifaceMatch[1] : '';
      if (!ip && !onuInterface && !/Найдено\s+на\s+OLT|\bOLT\b/i.test(rowText)) continue;

      let score = 0;
      if (/Найдено\s+на\s+OLT/i.test(rowText)) score += 220;
      if (ip) score += 100;
      if (onuInterface) score += 100;
      if (/\bOLT\b|MA\d{3,5}|BDCOM|GCOM|Huawei|ZTE|C-?DATA|V-?SOL|FiberHome/i.test(anchorText)) score += 160;
      if (/Huawei|MA\d{3,5}|BDCOM|GCOM|ZTE|C-?DATA|V-?SOL|FiberHome/i.test(rowText)) score += 70;
      if (/\bONU\b|\bONT\b|FoxGate|xPON-?ONU/i.test(anchorText)
        && !/\bOLT\b|MA\d{3,5}|BDCOM|GCOM|Huawei|ZTE/i.test(anchorText)) score -= 140;

      const parsedInterface = parsePonInterfaceIdentity(onuInterface);
      candidates.push({
        deviceId,
        deviceName: anchorText,
        ip,
        onuInterface,
        ponPort: parsedInterface.port,
        onuId: parsedInterface.onuId,
        text: [anchorText, ip, onuInterface].filter(Boolean).join(' · '),
        rowText,
        score,
      });
    }

    candidates.sort((a, b) => b.score - a.score || Number(Boolean(b.ip)) - Number(Boolean(a.ip)));
    const best = candidates[0] || null;
    return best && (best.ip || best.onuInterface || best.score >= 200) ? best : null;
  }

  function extractOltInfo(doc) {
    const evidence = extractOltEvidence(doc);
    return evidence ? evidence.text : null;
  }

  function normalizeMacAddress(raw) {
    const source = String(raw || '').trim();
    const compact = source.replace(/[^0-9a-f]/ig, '').toUpperCase();
    if (compact.length !== 12) return '';
    return compact.match(/.{2}/g).join(':');
  }

  function validIpv4(raw) {
    const value = String(raw || '').trim();
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }

  function privateIpv4(raw) {
    if (!validIpv4(raw)) return false;
    const [a, b] = raw.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  function textFromRowCell(row, suffix) {
    const cells = [...row.querySelectorAll(`[id$="${suffix}"]`)];
    for (const cell of cells) {
      const value = String(cell.textContent || '').replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    return '';
  }

  function scoreMacHistoryCandidate(candidate, index) {
    const device = candidate.deviceName.toLowerCase();
    const iface = candidate.iface.toLowerCase();
    const rowText = `${device} ${iface}`;
    const ponPort = /(?:^|[^a-z0-9])(?:xgs?pon|gpon|epon|pon)\d*[\/:._-]/i.test(iface)
      || /^(?:xgs?pon|gpon|epon|pon)/i.test(iface);
    const oltName = /\bolt\b/i.test(device);
    const knownOlt = /huawei|bdcom|gcom|zte|c-?data|v-?sol|eltex|raisecom|fiberhome/i.test(device);
    const oltModel = /ma\d{3,5}|gp\d{3,5}|p33\d+|epon|gpon|xgpon|xgspon/i.test(device);
    const transit = /port-?channel|eth-?trunk|vlanif|arista|dcs-|core|aggregation|агрегац|серверн/i.test(rowText);
    const ordinaryEthernet = /^(?:ethernet|eth\d|ge\d|gi\d|xe\d)/i.test(iface);

    let score = 0;
    const reasons = [];
    if (ponPort) { score += 120; reasons.push(`PON-порт ${candidate.iface}`); }
    if (oltName) { score += 90; reasons.push('в названии есть OLT'); }
    if (knownOlt) { score += 45; reasons.push('известный производитель OLT'); }
    if (oltModel) { score += 25; reasons.push('модель похожа на PON OLT'); }
    if (index === 0) { score += 10; reasons.push('самая свежая строка выдачи'); }
    if (candidate.lastSeen) { score += 5; reasons.push(`последнее наблюдение ${candidate.lastSeen}`); }
    if (transit && !ponPort) { score -= 170; reasons.push('транзитное оборудование/порт'); }
    if (ordinaryEthernet && !ponPort) { score -= 70; reasons.push('обычный Ethernet-порт'); }

    return {
      ...candidate,
      score,
      reasons,
      ponPort,
      oltName,
      accepted: Boolean(candidate.deviceId && ponPort && (oltName || knownOlt || oltModel) && score >= 150),
    };
  }

  function extractMacHistoryCandidates(doc) {
    const rows = [...doc.querySelectorAll('#tableListData tr.table_item')];
    return rows.map((row, index) => {
      const deviceCell = row.querySelector('[id$="_device_info_Id"]');
      const deviceLink = deviceCell && deviceCell.querySelector('a[href*="/device/"]');
      const href = deviceLink && deviceLink.getAttribute('href') || '';
      const deviceIdMatch = href.match(/\/device\/(\d+)/);
      const ifaceCell = row.querySelector('[id$="_iface_Id"]');
      const ifaceLink = ifaceCell && ifaceCell.querySelector('a[href]');
      const candidate = {
        index,
        lastSeen: textFromRowCell(row, '_date_last_Id'),
        firstSeen: textFromRowCell(row, '_date_first_Id'),
        deviceId: deviceIdMatch ? deviceIdMatch[1] : '',
        deviceName: deviceLink ? String(deviceLink.textContent || '').replace(/\s+/g, ' ').trim() : '',
        deviceUrl: href ? new URL(href, BASE).toString() : '',
        iface: ifaceLink
          ? String(ifaceLink.textContent || '').replace(/\s+/g, ' ').trim()
          : String(ifaceCell && ifaceCell.textContent || '').replace(/\s+/g, ' ').trim(),
        ifaceUrl: ifaceLink ? new URL(ifaceLink.getAttribute('href'), BASE).toString() : '',
        vlan: textFromRowCell(row, '_vlan_Id'),
      };
      return scoreMacHistoryCandidate(candidate, index);
    }).filter(candidate => candidate.deviceName || candidate.iface);
  }

  function chooseMacHistoryOlt(candidates) {
    const accepted = candidates.filter(candidate => candidate.accepted)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return accepted[0] || null;
  }

  function extractDeviceManagementIp(doc) {
    for (const label of ['IP:', 'IP-адрес:', 'IP адрес:', 'Адрес управления:']) {
      const value = extractByLeftData(doc, label) || extractByLabel(doc, label);
      const match = String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (match && validIpv4(match[0])) return match[0];
    }

    const bodyText = String(doc.body && doc.body.textContent || '').replace(/\s+/g, ' ');
    const labelled = bodyText.match(/(?:\bIP(?:-адрес|\s+адрес)?|адрес\s+управления)\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i);
    if (labelled && validIpv4(labelled[1])) return labelled[1];

    const all = bodyText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    return all.find(ip => privateIpv4(ip)) || all.find(ip => validIpv4(ip)) || '';
  }

  function extractExtendedMacSubscriberMatches(doc) {
    const rows = [...doc.querySelectorAll('tr.table_item')];
    return rows.map(row => {
      const agreementCell = row.querySelector('[id$="_agreement_full_Id"]');
      const identityCell = row.querySelector('[id$="_ip_username_Id"]');
      const nameCell = row.querySelector('[id$="_name_full_Id"]');
      if (!agreementCell || !identityCell || !nameCell) return null;

      const customerLink = row.querySelector('a[href^="/customer/"]');
      const customerIdMatch = customerLink && customerLink.getAttribute('href').match(/\/customer\/(\d+)/);
      const identityLines = String(identityCell.textContent || '')
        .split(/\s+/)
        .map(value => value.trim())
        .filter(Boolean);
      const agreementMatch = String(agreementCell.textContent || '').match(/\b\d{4,14}\b/);
      const mac = identityLines.map(normalizeMacAddress).find(Boolean) || '';
      const ip = identityLines.find(validIpv4) || '';
      const login = identityLines.find(value => /^abon\d+$/i.test(value)) || '';

      return {
        customerId: customerIdMatch ? customerIdMatch[1] : '',
        agreement: agreementMatch ? agreementMatch[0] : '',
        login,
        ip,
        mac,
        name: String(nameCell.textContent || '').replace(/\s+/g, ' ').trim(),
        address: textFromRowCell(row, '_adr_full_Id'),
        status: textFromRowCell(row, '_state_name_Id'),
        activity: textFromRowCell(row, '_date_activity_Id'),
      };
    }).filter(Boolean);
  }

  function subscriberMatchRelation(match, ctx) {
    const expectedAgreement = normalizeAgreement(ctx && ctx.contract);
    const expectedLogin = normalizeSubscriberLogin(ctx && ctx.contract);
    const sameCustomer = Boolean(match.customerId && ctx && String(match.customerId) === String(ctx.customerId));
    const sameAgreement = Boolean(match.agreement && expectedAgreement && match.agreement === expectedAgreement);
    const sameLogin = Boolean(match.login && expectedLogin && match.login.toLowerCase() === expectedLogin.toLowerCase());
    return {
      same: sameCustomer || sameAgreement || sameLogin,
      reasons: [
        sameCustomer ? 'совпадает UserSide customerId' : '',
        sameAgreement ? 'совпадает договор' : '',
        sameLogin ? 'совпадает логин' : '',
      ].filter(Boolean),
    };
  }

  function transportObservationText(candidates, max = 4) {
    return candidates.slice(0, max).map(item => {
      const parts = [
        item.lastSeen || '',
        item.deviceName || '',
        item.iface || '',
        item.vlan ? `VLAN ${item.vlan}` : '',
      ].filter(Boolean);
      return parts.join(' · ');
    });
  }

  function alternativeEvidenceFromCandidate(candidate, oltIp, sessionMac, routeMode = 'direct-port-history') {
    const deviceName = candidate.deviceName || `Устройство ${candidate.deviceId}`;
    const detailParts = [
      deviceName,
      oltIp,
      candidate.iface,
      candidate.vlan ? `VLAN ${candidate.vlan}` : '',
    ].filter(Boolean);
    const oltInfo = detailParts.join(' · ');
    const forcedBillingAction = /huawei/i.test(deviceName) ? '313' : '';
    const extended = routeMode === 'uplink-downlink';
    return {
      oltInfo,
      oltIp,
      deviceId: candidate.deviceId || '',
      deviceName,
      onuInterface: candidate.iface || '',
      ponPort: parsePonInterfaceIdentity(candidate.iface).port,
      deviceMac: sessionMac,
      sessionMac,
      forcedBillingAction,
      technologyRule: forcedBillingAction
        ? 'Huawei в названии OLT → обязательный раздел Huawei OLT (a=313)'
        : '',
      text: [deviceName, candidate.iface, candidate.vlan, sessionMac].filter(Boolean).join(' | '),
      source: extended
        ? 'история MAC на UPLINK/DOWNLINK-портах (резерв 2)'
        : 'история MAC на оборудовании (резерв)',
      alternative: {
        ...candidate,
        oltIp,
        sessionMac,
        routeMode,
        interpretation: extended
          ? `Обычный поиск активности MAC не дал PON-результата. При расширенном поиске на UPLINK/DOWNLINK-портах MAC ${sessionMac} найден на PON-порту ${candidate.iface} устройства ${deviceName}.`
          : `MAC ${sessionMac} фактически наблюдался на PON-порту ${candidate.iface} устройства ${deviceName}.`,
      },
    };
  }

  async function loadCandidateDeviceIp(ctx, candidate, sessionMac, active, routeMode) {
    journalLog('ok', routeMode === 'uplink-downlink'
      ? 'Выбран OLT-кандидат из UPLINK/DOWNLINK-поиска'
      : 'Выбран резервный OLT-кандидат по MAC', {
      mac: sessionMac,
      routeMode,
      deviceId: candidate.deviceId,
      device: candidate.deviceName,
      port: candidate.iface,
      vlan: candidate.vlan || 'не указан',
      score: candidate.score,
      reasons: candidate.reasons,
      url: candidate.deviceUrl,
    });

    renderMacRoutePending(`нашёл PON-кандидат ${candidate.iface}; получаю IP устройства`, sessionMac, candidate,
      routeMode === 'uplink-downlink' ? 'uplink/downlink' : 'обычная история');
    const deviceUrl = ENDPOINTS.deviceCard({ deviceId: candidate.deviceId });
    const deviceRaw = await ctx.getSource(`device:${candidate.deviceId}`, () => deviceUrl, ctx);
    if (active && !active()) return null;
    const oltIp = extractDeviceManagementIp(parseHtml(deviceRaw));
    if (!oltIp) {
      renderMacRouteFailure('OLT-кандидат найден, но на карточке устройства не удалось извлечь management IP', {
        mac: sessionMac,
        режим: routeMode === 'uplink-downlink' ? 'UPLINK/DOWNLINK' : 'обычная история MAC',
        устройство: candidate.deviceName,
        порт: candidate.iface,
        vlan: candidate.vlan,
      });
      journalLog('warn', 'На карточке OLT-кандидата не найден IP', {
        routeMode,
        deviceId: candidate.deviceId,
        device: candidate.deviceName,
        url: deviceUrl,
      });
      return null;
    }

    const evidence = alternativeEvidenceFromCandidate(candidate, oltIp, sessionMac, routeMode);
    renderMacRouteSuccess(evidence.alternative);
    journalLog('ok', 'Резервный маршрут OLT подтверждён карточкой устройства', {
      mac: sessionMac,
      routeMode,
      oltIp,
      device: candidate.deviceName,
      port: candidate.iface,
    });
    return evidence;
  }

  async function resolveOltByMacHistory(ctx, mainDoc, juniper, active, fallbackReason = 'основная и Billing-гипотезы не подтвердили OLT') {
    const sessionMac = normalizeMacAddress(extractSessionMac(mainDoc) || (juniper && juniper.mac));
    if (!sessionMac) {
      renderMacRouteFailure('резервный поиск невозможен: в карточке нет сессионного MAC');
      journalLog('warn', 'Резервный поиск OLT не запущен: MAC не найден');
      return null;
    }

    renderMacRoutePending(`${fallbackReason} — ищу, где сессионный MAC виден на абонентских портах`, sessionMac);
    const historyUrl = ENDPOINTS.macHistory({ mac: sessionMac });
    journalLog('info', 'Запущен резервный поиск OLT по обычной истории MAC', {
      reason: fallbackReason,
      mac: sessionMac,
      url: historyUrl,
    });

    const historyRaw = await ctx.getSource(`macHistory:${sessionMac}`, () => historyUrl, ctx);
    if (active && !active()) return null;
    const historyDoc = parseHtml(historyRaw);
    const directCandidates = extractMacHistoryCandidates(historyDoc);
    journalLog(directCandidates.length ? 'info' : 'warn', 'Получены строки обычной истории MAC', {
      mac: sessionMac,
      rows: directCandidates.length,
    });

    const directCandidate = chooseMacHistoryOlt(directCandidates);
    if (directCandidate) {
      return loadCandidateDeviceIp(ctx, directCandidate, sessionMac, active, 'direct-port-history');
    }

    const extendedUrl = ENDPOINTS.macHistoryUplinkDownlink({ mac: sessionMac });
    renderMacRoutePending(
      directCandidates.length
        ? 'Обычная история не дала PON/OLT-кандидата — ищу MAC также на UPLINK/DOWNLINK-портах'
        : 'Обычная история MAC пуста — ищу также на UPLINK/DOWNLINK-портах',
      sessionMac,
      null,
      'uplink/downlink',
    );
    journalLog('info', 'Запущен расширенный поиск MAC на UPLINK/DOWNLINK-портах', {
      mac: sessionMac,
      url: extendedUrl,
    });

    const extendedRaw = await ctx.getSource(`macHistoryUplinkDownlink:${sessionMac}`, () => extendedUrl, ctx);
    if (active && !active()) return null;
    const extendedDoc = parseHtml(extendedRaw);
    const extendedCandidates = extractMacHistoryCandidates(extendedDoc);
    const subscriberMatches = extractExtendedMacSubscriberMatches(extendedDoc);
    const relatedMatches = subscriberMatches.map(match => ({
      ...match,
      relation: subscriberMatchRelation(match, ctx),
    }));

    journalLog(extendedCandidates.length || subscriberMatches.length ? 'info' : 'warn', 'Получен расширенный ответ UPLINK/DOWNLINK', {
      mac: sessionMac,
      equipmentRows: extendedCandidates.length,
    });

    const extendedCandidate = chooseMacHistoryOlt(extendedCandidates);
    if (extendedCandidate) {
      return loadCandidateDeviceIp(ctx, extendedCandidate, sessionMac, active, 'uplink-downlink');
    }

    renderMacUplinkDownlinkContext({
      sessionMac,
      subscriberMatches: relatedMatches,
      candidates: extendedCandidates,
      directRows: directCandidates.length,
    });

    journalLog('warn', 'UPLINK/DOWNLINK-поиск не дал OLT для опроса ONU', { mac: sessionMac });
    return null;
  }

  function normalizeAgreement(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/(?:abon)?(\d{4,14})/i);
    return match ? match[1] : '';
  }

  function normalizeSubscriberLogin(raw, agreementFallback = '') {
    const text = String(raw || '').trim().toLowerCase();
    if (/^abon\d{4,14}$/.test(text)) return text;
    const agreement = normalizeAgreement(text) || normalizeAgreement(agreementFallback);
    return agreement ? `abon${agreement}` : text;
  }

  function extractJuniperParams(doc) {
    const iframe = doc.querySelector('iframe[src*="juniper.php"]');
    if (!iframe) return null;
    const src = iframe.getAttribute('src') || '';
    const qs = new URLSearchParams(src.split('?')[1] || '');
    const billingSystemId = qs.get('billing_id');
    const billingUid = qs.get('billing_uid');
    return {
      mac: qs.get('mac'),
      ip: qs.get('ip'),
      login: normalizeSubscriberLogin(qs.get('login'), qs.get('agreement_number')),
      billingSystemId,
      billingUid,
      billingId: billingUid || (billingSystemId && billingSystemId !== '1' ? billingSystemId : null),
      agreementNumber: normalizeAgreement(qs.get('agreement_number')),
      iframeSrc: src,
    };
  }

  async function selectBillingProviderForContext(ctx) {
    if (billingHostProvider) {
      applyBillingProvider(billingHostProvider, 'billing-host');
      return activeBillingProvider;
    }
    if (billingProviderMode !== 'auto') {
      applyBillingProvider(billingProviderMode, 'manual');
      return activeBillingProvider;
    }

    const sources = [
      ['main', ENDPOINTS.main],
      ['tab29', ENDPOINTS.tab29],
    ];
    for (const [name, endpoint] of sources) {
      try {
        const raw = await ctx.getSource(name, endpoint, ctx);
        const detection = billingProviderApi.detectFromDocument(parseHtml(raw));
        if (!detection.provider) continue;
        detectedBillingProvider = detection.provider;
        detectedBillingProviderSource = detection.source;
        applyBillingProvider(detection.provider, detection.source);
        journalLog('ok', `Биллинг определён автоматически: ${activeBillingProfile.label}`, {
          provider: activeBillingProvider,
          source: detection.source,
        });
        return activeBillingProvider;
      } catch (error) {
        journalLog('debug', `Не удалось проверить провайдера по источнику ${name}`, {
          reason: error && error.message || String(error),
        });
      }
    }

    detectedBillingProvider = '';
    detectedBillingProviderSource = '';
    updateBillingProviderControl('auto-unresolved');
    journalLog('warn', 'Биллинг абонента не определён автоматически; Billing-запросы остановлены до ручного выбора');
    return '';
  }

  function resolveBillingIdentity(juniper, contract) {
    const agreementNumber = normalizeAgreement(juniper && juniper.agreementNumber)
      || normalizeAgreement(contract);
    const login = normalizeSubscriberLogin(juniper && juniper.login, agreementNumber);
    const billingUid = String(juniper && juniper.billingUid || '').trim();
    const billingSystemId = String(juniper && juniper.billingSystemId || '').trim();

    if (/^\d+$/.test(billingUid) && billingUid !== '0') {
      return { billingId: billingUid, source: 'tab29.billing_uid', login, agreementNumber, billingUid, billingSystemId };
    }
    if (/^\d+$/.test(billingSystemId) && !['0', '1'].includes(billingSystemId)) {
      return { billingId: billingSystemId, source: 'tab29.billing_id', login, agreementNumber, billingUid, billingSystemId };
    }
    if (/^\d{6,14}$/.test(agreementNumber)) {
      return { billingId: agreementNumber.slice(0, -1), source: 'договор без последней цифры (резерв)', login, agreementNumber, billingUid, billingSystemId };
    }
    return { billingId: '', source: 'не найден', login, agreementNumber, billingUid, billingSystemId };
  }

  function extractByRegex(text, regex) {
    const m = String(text || '').match(regex);
    return m ? m[0] : null;
  }

  const MAC_REGEX = /([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/;

  function gmRequest(url, method = 'GET', timeout = 15000) {
    consumeDiagnosticBudget('userSideRequests', 'запросов UserSide');
    const startedAt = performance.now();
    journalLog('network', `${method} UserSide`, { url, timeoutMs: timeout });
    return new Promise((resolve, reject) => {
      let requestHandle = null;
      let untrack = () => {};
      const cleanup = () => untrack();
      requestHandle = GM_xmlhttpRequest({
        method, url,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        onload: (res) => {
          cleanup();
          const durationMs = Math.round(performance.now() - startedAt);
          if (res.status >= 200 && res.status < 400) {
            journalLog('ok', `${method} UserSide завершён`, { url, http: res.status, durationMs, bytes: String(res.responseText || '').length });
            resolve(res.responseText);
          } else {
            journalLog('error', `${method} UserSide вернул HTTP ${res.status}`, { url, durationMs });
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: () => {
          cleanup();
          journalLog('error', `${method} UserSide: network error`, { url, durationMs: Math.round(performance.now() - startedAt) });
          reject(new Error('network error'));
        },
        ontimeout: () => {
          cleanup();
          journalLog('error', `${method} UserSide: timeout`, { url, durationMs: Math.round(performance.now() - startedAt) });
          reject(new Error('timeout'));
        },
        onabort: () => {
          cleanup();
          reject(new Error('диагностика остановлена'));
        },
        timeout,
      });
      untrack = registerAbortable(requestHandle);
    });
  }

  function billingRequestModes() {
    const partitioned = {
      name: 'billing-cookie-partition',
      options: { cookiePartition: { topLevelSite: BILLING_COOKIE_TOP_LEVEL_SITE } },
    };
    const regular = { name: 'default-cookie-context', options: {} };
    return isActiveBillingHost()
      ? [regular, partitioned]
      : [partitioned, regular];
  }

  function billingBridgeRequestUrl(rawUrl) {
    const url = new URL(rawUrl, BILLING_BASE);
    if (url.hostname !== BILLING_HOSTNAME) throw new Error('мост отклонил чужой домен');
    if (!/^\/cgi-bin\/adm\/(?:adm|stat)\.pl$/i.test(url.pathname)) {
      throw new Error(`мост отклонил неподдерживаемый путь ${url.pathname}`);
    }
    url.searchParams.delete('pp');
    return url.toString();
  }

  function readBillingBridgePresence() {
    const raw = safeGetValue(BILLING_BRIDGE_PRESENCE_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    const presence = {
      tabId: String(raw.tabId || ''),
      seenAt: Number(raw.seenAt || 0),
      authenticated: Boolean(raw.authenticated),
      provider: billingProviderApi.normalizeProvider(raw.provider) || activeBillingProvider,
      ppFingerprint: String(raw.ppFingerprint || ''),
      path: String(raw.path || ''),
    };
    if (!presence.tabId || !presence.seenAt) return null;
    return presence;
  }

  function billingBridgeIsReady() {
    const presence = readBillingBridgePresence();
    return Boolean(
      presence
      && presence.authenticated
      && Date.now() - presence.seenAt <= BILLING_BRIDGE_PRESENCE_MAX_AGE_MS
    );
  }

  function publishBillingBridgeResponse(payload) {
    try {
      const message = { ...payload, provider: activeBillingProvider, sentAt: Date.now() };
      GM_setValue(BILLING_BRIDGE_RESPONSE_KEY, message);
      window.setTimeout(() => {
        const current = safeGetValue(BILLING_BRIDGE_RESPONSE_KEY, null);
        if (current && current.id === message.id) {
          try { GM_deleteValue(BILLING_BRIDGE_RESPONSE_KEY); } catch (_) {}
        }
      }, 60000);
    } catch (_) {}
  }

  function refreshBillingBridgeIdentity(reason = 'bridge-refresh') {
    if (!isActiveBillingHost()) return false;
    const auth = billingAuthState(document, location.href);
    const pp = auth.detected ? '' : rememberBillingPp(location.href, document, reason, true);
    const confirmedPp = pp || storedBillingPp();
    billingBridgeRuntime.authenticated = !auth.detected && Boolean(confirmedPp);
    billingBridgeRuntime.ppFingerprint = ppFingerprint(confirmedPp);
    billingBridgeRuntime.path = location.pathname;
    billingBridgeRuntime.lastIdentityRefreshAt = Date.now();
    return billingBridgeRuntime.authenticated;
  }

  function announceBillingBridgePresence(options = {}) {
    if (!isActiveBillingHost() || billingBridgeRuntime.unloading) return false;
    const refreshIdentity = Boolean(options.refreshIdentity);
    const force = Boolean(options.force);
    if (refreshIdentity || !billingBridgeRuntime.lastIdentityRefreshAt) {
      refreshBillingBridgeIdentity(String(options.reason || 'bridge-presence'));
    }

    const now = Date.now();
    const existing = readBillingBridgePresence();
    const existingAge = existing ? now - existing.seenAt : Infinity;
    const otherTab = Boolean(existing && existing.tabId !== billingBridgeTabId);
    const otherAuthenticatedLeader = Boolean(
      otherTab
      && existing.authenticated
      && existingAge <= BILLING_BRIDGE_PRESENCE_MAX_AGE_MS
    );
    const otherRecentPeer = Boolean(
      otherTab
      && existingAge <= BILLING_BRIDGE_LEADER_LEASE_MS
      && (existing.authenticated || !billingBridgeRuntime.authenticated)
    );
    if (!force && (otherAuthenticatedLeader || otherRecentPeer)) {
      billingBridgeRuntime.leader = false;
      updateBillingSessionBadge();
      return false;
    }

    try {
      GM_setValue(BILLING_BRIDGE_PRESENCE_KEY, {
        tabId: billingBridgeTabId,
        seenAt: now,
        authenticated: billingBridgeRuntime.authenticated,
        provider: activeBillingProvider,
        ppFingerprint: billingBridgeRuntime.ppFingerprint,
        path: billingBridgeRuntime.path || location.pathname,
      });
      billingBridgeRuntime.leader = true;
    } catch (_) {
      billingBridgeRuntime.leader = false;
    }
    updateBillingSessionBadge();
    return billingBridgeRuntime.leader;
  }

  function maintainBillingBridgePresence() {
    if (!isActiveBillingHost() || billingBridgeRuntime.unloading) return;
    const presence = readBillingBridgePresence();
    if (presence && presence.tabId === billingBridgeTabId) {
      billingBridgeRuntime.leader = true;
      announceBillingBridgePresence({ force: true });
      return;
    }

    const now = Date.now();
    const age = presence ? now - presence.seenAt : Infinity;
    if (
      presence
      && age <= BILLING_BRIDGE_LEADER_LEASE_MS
      && (presence.authenticated || !billingBridgeRuntime.authenticated)
    ) {
      billingBridgeRuntime.leader = false;
      return;
    }
    if (now - billingBridgeRuntime.lastIdentityRefreshAt > BILLING_BRIDGE_IDENTITY_REFRESH_MS) {
      refreshBillingBridgeIdentity('bridge-leader-takeover');
    }
    announceBillingBridgePresence();
  }

  function scheduleBillingBridgeElection() {
    if (billingBridgeRuntime.unloading || billingBridgeElectionTimer) return;
    const delay = 120 + Math.floor(Math.random() * 380);
    billingBridgeElectionTimer = window.setTimeout(() => {
      billingBridgeElectionTimer = 0;
      maintainBillingBridgePresence();
    }, delay);
  }

  function relinquishBillingBridgeLeadership() {
    if (!isActiveBillingHost()) return;
    billingBridgeRuntime.unloading = true;
    if (billingBridgePresenceTimer) window.clearInterval(billingBridgePresenceTimer);
    if (billingBridgeElectionTimer) window.clearTimeout(billingBridgeElectionTimer);
    const presence = readBillingBridgePresence();
    if (presence && presence.tabId === billingBridgeTabId) {
      try { GM_deleteValue(BILLING_BRIDGE_PRESENCE_KEY); } catch (_) {}
    }
  }

  async function handleBillingBridgeRequest(message) {
    if (billingProviderApi.normalizeProvider(message && message.provider) !== activeBillingProvider) return;
    if (!message || message.targetTabId !== billingBridgeTabId) return;
    const id = String(message.id || '');
    if (!id) return;

    if (message.type === 'cancel') {
      const controller = billingBridgeServerControllers.get(id);
      if (controller) controller.abort();
      return;
    }
    if (message.type !== 'request') return;

    const auth = billingAuthState(document, location.href);
    if (auth.detected) {
      billingBridgeRuntime.authenticated = false;
      billingBridgeRuntime.ppFingerprint = '';
      billingBridgeRuntime.path = location.pathname;
      billingBridgeRuntime.lastIdentityRefreshAt = Date.now();
      publishBillingBridgeResponse({
        id,
        serverTabId: billingBridgeTabId,
        ok: false,
        error: `вкладка Billing требует вход: ${auth.reason}`,
      });
      announceBillingBridgePresence();
      return;
    }

    let controller = null;
    const startedAt = performance.now();
    try {
      const cleanUrl = billingBridgeRequestUrl(message.url);
      const requestUrl = rebindBillingPp(cleanUrl, true);
      const timeout = Math.max(3000, Math.min(Number(message.timeout || 30000), 60000));
      controller = new AbortController();
      billingBridgeServerControllers.set(id, controller);
      const timer = window.setTimeout(() => controller.abort(), timeout);
      let response;
      try {
        response = await window.fetch(requestUrl, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });
      } finally {
        window.clearTimeout(timer);
      }
      const text = await response.text();
      if (!response.ok && response.status >= 400) throw new Error(`HTTP ${response.status}`);
      if (text.length > BILLING_BRIDGE_MAX_RESPONSE_BYTES) throw new Error('ответ Billing слишком большой для межвкладочного моста');

      const doc = parseHtml(text);
      const responseAuth = billingAuthState(doc, response.url || requestUrl);
      if (responseAuth.detected) throw new Error(`Billing вернул форму входа: ${responseAuth.reason}`);
      rememberBillingPp(response.url || requestUrl, doc, 'accepted:billing-tab-bridge-server', true);
      const confirmedPp = storedBillingPp();
      billingBridgeRuntime.authenticated = Boolean(confirmedPp);
      billingBridgeRuntime.ppFingerprint = ppFingerprint(confirmedPp);
      billingBridgeRuntime.path = location.pathname;
      billingBridgeRuntime.lastIdentityRefreshAt = Date.now();

      publishBillingBridgeResponse({
        id,
        serverTabId: billingBridgeTabId,
        ok: true,
        text,
        status: response.status,
        finalUrl: sanitizeJournalUrl(response.url || requestUrl),
        transport: 'billing-tab-bridge',
        durationMs: Math.round(performance.now() - startedAt),
      });
      announceBillingBridgePresence({ force: true });
    } catch (error) {
      const reason = error && error.name === 'AbortError'
        ? 'запрос через вкладку Billing остановлен или превысил время'
        : (error && error.message || String(error));
      publishBillingBridgeResponse({
        id,
        serverTabId: billingBridgeTabId,
        ok: false,
        error: reason,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      billingBridgeServerControllers.delete(id);
      const currentRequest = safeGetValue(BILLING_BRIDGE_REQUEST_KEY, null);
      if (currentRequest && currentRequest.id === id) {
        try { GM_deleteValue(BILLING_BRIDGE_REQUEST_KEY); } catch (_) {}
      }
    }
  }

  function billingBridgePageRequestOnce(rawUrl, timeout = 30000) {
    const presence = readBillingBridgePresence();
    if (!presence || !presence.authenticated || Date.now() - presence.seenAt > BILLING_BRIDGE_PRESENCE_MAX_AGE_MS) {
      return Promise.reject(new Error('авторизованная вкладка Billing не объявила готовность моста'));
    }
    const url = billingBridgeRequestUrl(rawUrl);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let untrack = () => {};
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        billingBridgePending.delete(id);
        untrack();
        callback(value);
      };
      const abortable = {
        abort() {
          try {
            GM_setValue(BILLING_BRIDGE_REQUEST_KEY, {
              type: 'cancel',
              id,
              provider: activeBillingProvider,
              targetTabId: presence.tabId,
              sentAt: Date.now(),
            });
          } catch (_) {}
          finish(reject, new Error('диагностика остановлена'));
        },
      };
      untrack = registerAbortable(abortable);
      const timer = window.setTimeout(() => {
        abortable.abort();
        if (!settled) finish(reject, new Error('таймаут ответа вкладки Billing'));
      }, Math.max(5000, timeout + 3000));

      billingBridgePending.set(id, {
        provider: activeBillingProvider,
        targetTabId: presence.tabId,
        resolve: value => finish(resolve, value),
        reject: error => finish(reject, error),
      });
      try {
        GM_setValue(BILLING_BRIDGE_REQUEST_KEY, {
          type: 'request',
          id,
          provider: activeBillingProvider,
          targetTabId: presence.tabId,
          url,
          timeout,
          sentAt: Date.now(),
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function billingBridgePageRequest(rawUrl, timeout = 30000) {
    const run = () => {
      if (diagnosticRuntime.stopped) throw new Error('диагностика остановлена');
      return billingBridgePageRequestOnce(rawUrl, timeout);
    };
    const result = billingBridgeClientTail.then(run, run);
    billingBridgeClientTail = result.catch(() => {});
    return result;
  }

  function installBillingTabBridge() {
    try {
      if (typeof GM_addValueChangeListener !== 'function') return;
      GM_addValueChangeListener(BILLING_BRIDGE_RESPONSE_KEY, (_name, _oldValue, message) => {
        if (!message || typeof message !== 'object') return;
        const pending = billingBridgePending.get(String(message.id || ''));
        if (!pending || message.serverTabId !== pending.targetTabId || message.provider !== pending.provider) return;
        if (message.ok) {
          billingPpRuntime.lastBridgeSuccessAt = Date.now();
          billingPpRuntime.lastTransportFailureAt = 0;
          billingPpRuntime.lastTransportFailureReason = '';
          pending.resolve({
            text: String(message.text || ''),
            status: Number(message.status || 200),
            finalUrl: String(message.finalUrl || ''),
            transport: 'billing-tab-bridge',
            durationMs: Number(message.durationMs || 0),
          });
        } else {
          pending.reject(new Error(String(message.error || 'неизвестная ошибка моста Billing')));
        }
        updateBillingSessionBadge();
        try { GM_deleteValue(BILLING_BRIDGE_RESPONSE_KEY); } catch (_) {}
      });

      if (isActiveBillingHost()) {
        GM_addValueChangeListener(BILLING_BRIDGE_REQUEST_KEY, (_name, _oldValue, message) => {
          handleBillingBridgeRequest(message);
        });
        GM_addValueChangeListener(BILLING_BRIDGE_PRESENCE_KEY, (_name, _oldValue, message) => {
          if (billingBridgeRuntime.unloading) return;
          const seenAt = Number(message && message.seenAt || 0);
          if (!message || !message.tabId || Date.now() - seenAt > BILLING_BRIDGE_LEADER_LEASE_MS) {
            scheduleBillingBridgeElection();
          }
        });
        refreshBillingBridgeIdentity('bridge-initial');
        announceBillingBridgePresence();
        billingBridgePresenceTimer = window.setInterval(maintainBillingBridgePresence, BILLING_BRIDGE_HEARTBEAT_MS);
        window.addEventListener('pageshow', () => {
          refreshBillingBridgeIdentity('bridge-pageshow');
          announceBillingBridgePresence();
        });
        window.addEventListener('popstate', () => {
          refreshBillingBridgeIdentity('bridge-popstate');
          announceBillingBridgePresence();
        });
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) return;
          if (Date.now() - billingBridgeRuntime.lastIdentityRefreshAt > BILLING_BRIDGE_IDENTITY_REFRESH_MS) {
            refreshBillingBridgeIdentity('bridge-visibility');
          }
          announceBillingBridgePresence();
        });
        window.addEventListener('pagehide', relinquishBillingBridgeLeadership);
      }
    } catch (error) {
      journalLog('warn', 'Не удалось запустить межвкладочный мост Billing', {
        reason: error && error.message || String(error),
      });
    }
  }

  async function nativeBillingPageRequest(rawUrl, timeout = 30000) {
    if (!isActiveBillingHost()) {
      throw new Error('native same-origin fetch доступен только во вкладке Billing');
    }
    const url = rebindBillingPp(rawUrl, true);
    const startedAt = performance.now();
    const controller = new AbortController();
    const untrack = registerAbortable(controller);
    const timer = window.setTimeout(() => controller.abort(), timeout);

    journalLog('network', 'GET Billing', { url, timeoutMs: timeout, transport: 'native-same-origin-fetch' });

    try {
      const response = await window.fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      });
      const body = await response.text();
      const result = {
        text: body,
        status: response.status,
        finalUrl: response.url || url,
        transport: 'native-same-origin-fetch',
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (!response.ok && response.status >= 400) throw new Error(`HTTP ${response.status}`);
      journalLog('ok', 'GET Billing завершён', { url, finalUrl: result.finalUrl, http: result.status, durationMs: result.durationMs, transport: result.transport });
      return result;
    } catch (error) {
      const reason = error && error.name === 'AbortError' ? 'timeout' : (error && error.message || String(error));
      journalLog('error', 'GET Billing: native fetch error', { url, reason, durationMs: Math.round(performance.now() - startedAt) });
      throw new Error(reason);
    } finally {
      window.clearTimeout(timer);
      untrack();
    }
  }

  function gmPageRequestOnce(rawUrl, timeout, mode) {
    const url = rebindBillingPp(rawUrl, true);
    const startedAt = performance.now();

    journalLog('network', 'GET Billing', { url, timeoutMs: timeout, transport: mode.name });

    return new Promise((resolve, reject) => {
      let requestHandle = null;
      let untrack = () => {};
      const cleanup = () => untrack();
      const requestDetails = {
        method: 'GET',
        url,
        timeout,
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        onload: (res) => {
          cleanup();
          const durationMs = Math.round(performance.now() - startedAt);
          if (res.status >= 200 && res.status < 400) {
            const response = {
              text: String(res.responseText || ''),
              status: res.status,
              finalUrl: String(res.finalUrl || url),
              transport: mode.name,
              durationMs,
            };
            journalLog('ok', 'GET Billing завершён', { url, finalUrl: response.finalUrl, http: res.status, durationMs, transport: mode.name });
            resolve(response);
          } else {
            journalLog('error', `GET Billing вернул HTTP ${res.status}`, { url, durationMs, transport: mode.name });
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: () => {
          cleanup();
          journalLog('error', 'GET Billing: network error', { url, durationMs: Math.round(performance.now() - startedAt), transport: mode.name });
          reject(new Error('network error'));
        },
        ontimeout: () => {
          cleanup();
          journalLog('error', 'GET Billing: timeout', { url, durationMs: Math.round(performance.now() - startedAt), transport: mode.name });
          reject(new Error('timeout'));
        },
        onabort: () => {
          cleanup();
          reject(new Error('диагностика остановлена'));
        },
      };

      Object.assign(requestDetails, mode.options || {});
      try {
        requestHandle = GM_xmlhttpRequest(requestDetails);
        untrack = registerAbortable(requestHandle);
      } catch (error) {
        cleanup();
        journalLog('warn', 'Транспорт Billing не поддержан', { transport: mode.name, reason: error.message || String(error) });
        reject(error);
      }
    });
  }

  async function gmPageRequest(rawUrl, timeout = 30000, allowSessionRetry = true) {
    consumeDiagnosticBudget('billingRequests', 'запросов Billing');
    const failures = [];
    const requestUrl = rebindBillingPp(rawUrl, true);
    const requestPp = lastUrlParam(requestUrl, 'pp');

    const inspectResponse = (response) => {
      const doc = parseHtml(response.text);
      const auth = billingAuthState(doc, response.finalUrl);
      if (auth.detected) {
        failures.push(`${response.transport}: ${auth.reason}`);
        journalLog('warn', 'Billing вернул страницу авторизации', { transport: response.transport, reason: auth.reason });
        return null;
      }
      rememberBillingPp(response.finalUrl, doc, `accepted:${response.transport}`, true);
      return response;
    };

    if (!isActiveBillingHost()) {
      try {
        journalLog('network', 'GET Billing через авторизованную вкладку', { url: requestUrl, timeoutMs: timeout, transport: 'billing-tab-bridge' });
        const accepted = inspectResponse(await billingBridgePageRequest(requestUrl, timeout));
        if (accepted) {
          journalLog('ok', 'GET Billing через вкладку завершён', {
            url: requestUrl,
            finalUrl: accepted.finalUrl,
            http: accepted.status,
            durationMs: accepted.durationMs,
            transport: accepted.transport,
          });
          return accepted;
        }
      } catch (error) {
        failures.push(`billing-tab-bridge: ${error.message || error}`);
        journalLog('warn', 'Мост через вкладку Billing не выполнил запрос', {
          reason: error && error.message || String(error),
        });
      }
    }

    if (isActiveBillingHost()) {
      try {
        const accepted = inspectResponse(await nativeBillingPageRequest(requestUrl, timeout));
        if (accepted) return accepted;
      } catch (error) {
        failures.push(`native-same-origin-fetch: ${error.message || error}`);
      }
    }

    for (const mode of billingRequestModes()) {
      try {
        const accepted = inspectResponse(await gmPageRequestOnce(requestUrl, timeout, mode));
        if (accepted) return accepted;
      } catch (error) {
        failures.push(`${mode.name}: ${error.message || error}`);
      }
    }

    rejectBillingPp(requestPp, failures.join(' | '));

    if (allowSessionRetry) {
      const refreshedPp = currentBillingPp();
      if (refreshedPp && refreshedPp !== requestPp) {
        journalLog('info', 'Повторяю Billing-запрос с новым pp');
        return gmPageRequest(rawUrl, timeout, false);
      }
    }

    if (isActiveBillingHost()) {
      throw new Error(`Billing не подтвердил запрос (${failures.join(' | ')}). Проверь, что эта вкладка Billing действительно авторизована.`);
    }
    throw new Error(
      `Запрос Billing не выполнен (${failures.join(' | ')}). `
      + 'Подтверждённая сессия не сброшена. Оставь открытой хотя бы одну авторизованную вкладку Billing — UserSide подключится к ней автоматически.'
    );
  }

  function lastUrlParam(rawUrl, name) {
    try {
      const values = new URL(rawUrl, BILLING_BASE).searchParams.getAll(name);
      return values.length ? values[values.length - 1] : '';
    } catch (_) {
      return '';
    }
  }

  function safeGetValue(key, fallback = '') {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined || value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function ppLooksUsable(raw) {
    const value = String(raw || '').trim();
    if (!value || value.length < 8) return false;
    if (/^\{?protected\}?$/i.test(value)) return false;
    if (/^(?:undefined|null|false)$/i.test(value)) return false;
    return true;
  }

  function migrateLegacyBillingPpState() {
    if (activeBillingProvider !== 'simnet') return;
    const current = safeGetValue(BILLING_PP_META_KEY, null);
    if (current && current.value && current.confirmedAt) return;
    const legacyMeta = safeGetValue('dp_billing_pp_meta_v4', null);
    const legacyPp = String(safeGetValue('dp_billing_pp_v4', '') || '').trim();
    if (!legacyMeta || !legacyMeta.confirmedAt || legacyMeta.value !== legacyPp || !ppLooksUsable(legacyPp)) return;
    try {
      GM_setValue(BILLING_PP_KEY, legacyPp);
      GM_setValue(BILLING_PP_META_KEY, {
        value: legacyPp,
        savedAt: Number(legacyMeta.savedAt || Date.now()),
        confirmedAt: Number(legacyMeta.confirmedAt || 0),
        source: 'migrated:dev.2.2',
        href: String(legacyMeta.href || ''),
      });
    } catch (_) {}
  }

  migrateLegacyBillingPpState();

  function readBillingPpMeta() {
    const raw = safeGetValue(BILLING_PP_META_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    return {
      value: String(raw.value || '').trim(),
      savedAt: Number(raw.savedAt || 0),
      confirmedAt: Number(raw.confirmedAt || 0),
      source: String(raw.source || ''),
      href: String(raw.href || ''),
    };
  }

  function readBillingPpCandidate() {
    const raw = safeGetValue(BILLING_PP_CANDIDATE_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    const candidate = {
      value: String(raw.value || '').trim(),
      savedAt: Number(raw.savedAt || 0),
      source: String(raw.source || ''),
      href: String(raw.href || ''),
    };
    return ppLooksUsable(candidate.value) ? candidate : null;
  }

  function clearStoredBillingPp(reason = '') {
    billingPpRuntime.lastKnown = '';
    try { GM_setValue(BILLING_PP_KEY, ''); } catch (_) {}
    try {
      GM_setValue(BILLING_PP_META_KEY, { value: '', savedAt: Date.now(), confirmedAt: 0, source: `cleared:${reason}`, href: sanitizeJournalUrl(location.href) });
    } catch (_) {}
    try { GM_deleteValue(BILLING_PP_CANDIDATE_KEY); } catch (_) {}
  }

  function saveBillingPp(rawPp, source = '', href = '', confirmed = false) {
    const pp = String(rawPp || '').trim();
    if (!ppLooksUsable(pp)) return '';
    const previous = readBillingPpMeta();

    // Неподтверждённый PP никогда не вытесняет последний подтверждённый.
    if (!confirmed && (!previous || previous.value !== pp || !previous.confirmedAt)) {
      try {
        GM_setValue(BILLING_PP_CANDIDATE_KEY, {
          value: pp,
          savedAt: Date.now(),
          source: source || 'unconfirmed-candidate',
          href: sanitizeJournalUrl(href),
        });
      } catch (_) {}
      updateBillingSessionBadge();
      return '';
    }

    billingPpRuntime.lastKnown = pp;
    if (confirmed) {
      billingPpRuntime.lastTransportFailureAt = 0;
      billingPpRuntime.lastTransportFailureReason = '';
    }
    const savedAt = Date.now();
    const confirmedAt = confirmed
      ? savedAt
      : (previous && previous.value === pp ? previous.confirmedAt : 0);
    try {
      GM_setValue(BILLING_PP_META_KEY, {
        value: pp,
        savedAt,
        confirmedAt,
        source: confirmed ? source : (confirmedAt ? previous.source : source),
        href: sanitizeJournalUrl(href),
      });
    } catch (_) {}
    try { GM_setValue(BILLING_PP_KEY, pp); } catch (_) {}
    if (confirmed) {
      try { GM_deleteValue(BILLING_PP_CANDIDATE_KEY); } catch (_) {}
    }
    synchronizeBillingPagePp(pp);
    updateBillingSessionBadge();
    return pp;
  }

  function extractBillingPp(rawUrl = '', doc = null) {
    const scored = new Map();
    const add = (value, score, source) => {
      const pp = String(value || '').trim();
      if (!ppLooksUsable(pp)) return;
      const current = scored.get(pp) || { value: pp, score: 0, sources: [] };
      current.score += score;
      current.sources.push(source);
      scored.set(pp, current);
    };

    if (doc) {
      for (const input of doc.querySelectorAll('input[type="hidden"][name="pp"]')) {
        add(input.value, 100, 'hidden-input');
      }
      for (const node of doc.querySelectorAll('a[href], form[action]')) {
        const target = node.getAttribute('href') || node.getAttribute('action') || '';
        add(lastUrlParam(target, 'pp'), 10, 'dom-link-or-form');
      }
    }
    add(lastUrlParam(rawUrl, 'pp'), 5, 'url-fallback');
    return [...scored.values()].sort((a, b) => b.score - a.score)[0]?.value || '';
  }

  function billingDocumentIsAuthenticated(doc, finalUrl = '') {
    if (!doc) return false;
    return !billingAuthState(doc, finalUrl || location.href).detected;
  }

  function rememberBillingPp(rawUrl = '', doc = null, source = '', confirmedResponse = false) {
    const sourceDoc = doc || (isActiveBillingHost() ? document : null);
    if (sourceDoc && !billingDocumentIsAuthenticated(sourceDoc, rawUrl || location.href)) return '';
    const pp = extractBillingPp(rawUrl, sourceDoc);
    if (!pp) return '';
    return saveBillingPp(
      pp,
      source || (doc ? 'billing-response' : 'current-billing-page'),
      rawUrl || location.href,
      confirmedResponse,
    );
  }

  function storedBillingPp() {
    const value = String(safeGetValue(BILLING_PP_KEY, '') || '').trim();
    if (!ppLooksUsable(value)) return '';
    const meta = readBillingPpMeta();
    if (!meta || meta.value !== value || !meta.confirmedAt) return '';
    if (meta && meta.value === value && meta.savedAt && (Date.now() - meta.savedAt > BILLING_PP_MAX_AGE_MS)) {
      clearStoredBillingPp('expired');
      return '';
    }
    return value;
  }

  function currentBillingPp() {
    const stored = storedBillingPp();
    if (stored) return stored;
    if (isActiveBillingHost()) {
      const current = rememberBillingPp(location.href, document, 'current-page-load', false);
      if (current) return current;
    }
    return '';
  }

  function ppFingerprint(rawPp) {
    const value = String(rawPp || '');
    if (!value) return '—';
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function pageBillingPp() {
    if (!isActiveBillingHost()) return '';
    const urlPp = lastUrlParam(location.href, 'pp');
    if (ppLooksUsable(urlPp)) return urlPp;
    const hidden = document.querySelector('input[type="hidden"][name="pp"]');
    return ppLooksUsable(hidden && hidden.value) ? String(hidden.value).trim() : '';
  }

  function rewriteBillingUrlWithPp(rawUrl, pp) {
    try {
      const url = new URL(rawUrl, location.href);
      if (url.hostname !== BILLING_HOSTNAME) return rawUrl;
      if (!url.searchParams.has('pp') && !/\/cgi-bin\/adm\/adm\.pl$/i.test(url.pathname)) return rawUrl;
      url.searchParams.set('pp', pp);
      return url.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function synchronizeBillingPagePp(rawPp) {
    const pp = String(rawPp || '').trim();
    if (!isActiveBillingHost() || !ppLooksUsable(pp)) return 0;
    if (billingLoginFormPresent(document)) return 0;
    let changed = 0;

    try {
      const current = new URL(location.href);
      if (current.searchParams.has('pp') && current.searchParams.get('pp') !== pp) {
        current.searchParams.set('pp', pp);
        history.replaceState(history.state, '', current.toString());
        changed += 1;
      }
    } catch (_) {}

    for (const input of document.querySelectorAll('input[type="hidden"][name="pp"]')) {
      if (String(input.value || '') !== pp) {
        input.value = pp;
        changed += 1;
      }
    }
    for (const anchor of document.querySelectorAll('a[href]')) {
      const original = anchor.getAttribute('href') || '';
      const rewritten = rewriteBillingUrlWithPp(original, pp);
      if (rewritten !== original) {
        anchor.setAttribute('href', rewritten);
        changed += 1;
      }
    }
    for (const form of document.querySelectorAll('form[action]')) {
      const original = form.getAttribute('action') || '';
      const rewritten = rewriteBillingUrlWithPp(original, pp);
      if (rewritten !== original) {
        form.setAttribute('action', rewritten);
        changed += 1;
      }
    }
    return changed;
  }

  function updateBillingProviderControl(source = '') {
    const select = document.querySelector('#dp-billing-provider-mode');
    const state = document.querySelector('#dp-billing-provider-state');
    const panel = document.querySelector('#dp-panel');
    if (select) select.value = billingHostProvider || billingProviderMode;
    if (panel) {
      panel.dataset.billingProvider = activeBillingProvider;
      panel.dataset.billingProviderMode = billingHostProvider || billingProviderMode;
    }
    if (!state) return;

    if (billingHostProvider) {
      state.textContent = `Текущая вкладка: ${activeBillingProfile.label}`;
      state.title = `База этой Billing-вкладки определяется доменом ${activeBillingProfile.hostname}.`;
      return;
    }
    if (billingProviderMode !== 'auto') {
      state.textContent = `Вручную → ${activeBillingProfile.label}`;
      state.title = 'Ручной выбор действует до возврата переключателя в режим «Авто».';
      return;
    }
    if (detectedBillingProvider) {
      state.textContent = `Авто → ${activeBillingProfile.label}`;
      state.title = detectedBillingProviderSource === 'userside.billing-label'
        ? 'Определено по строке «Биллинг» в карточке абонента UserSide.'
        : 'Определено по техническому billing_id во вкладке JUNIPER NEW.';
      return;
    }
    state.textContent = 'Авто → ещё не определено';
    state.title = source === 'auto-unresolved'
      ? 'UserSide не сообщил базу абонента. Выбери Simnet или Looknet вручную.'
      : 'База будет определена по карточке выбранного абонента.';
  }

  function setBillingProviderMode(value, source = 'ui') {
    const mode = billingProviderApi.normalizeMode(value);
    billingProviderMode = mode;
    try { GM_setValue(BILLING_PROVIDER_MODE_KEY, mode); } catch (_) {}
    if (billingHostProvider) {
      applyBillingProvider(billingHostProvider, 'billing-host');
      return;
    }
    if (mode === 'auto') {
      const detection = billingProviderApi.detectFromDocument(document);
      detectedBillingProvider = detection.provider;
      detectedBillingProviderSource = detection.source;
      if (detection.provider) applyBillingProvider(detection.provider, detection.source);
      else updateBillingProviderControl(source);
      return;
    }
    applyBillingProvider(mode, source);
    journalLog('info', `Биллинг выбран вручную: ${activeBillingProfile.label}`, {
      provider: activeBillingProvider,
    });
  }

  function installBillingProviderAutoDetection() {
    if (billingHostProvider || location.hostname !== 'userside.simnet.kiev.ua') return;
    let refreshTimer = 0;
    const refresh = () => {
      refreshTimer = 0;
      if (billingProviderMode !== 'auto') return;
      const detection = billingProviderApi.detectFromDocument(document);
      if (!detection.provider) return;
      if (
        detection.provider === detectedBillingProvider
        && detection.source === detectedBillingProviderSource
      ) return;
      detectedBillingProvider = detection.provider;
      detectedBillingProviderSource = detection.source;
      applyBillingProvider(detection.provider, detection.source);
    };
    const schedule = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refresh, 180);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', schedule);
    window.addEventListener('popstate', schedule);
    schedule();
  }

  function updateBillingSessionBadge() {
    const badge = document.querySelector('#dp-session-badge');
    if (!badge) return;
    const providerLabel = activeBillingProfile.label;
    const pp = storedBillingPp();
    const meta = readBillingPpMeta();
    const candidate = readBillingPpCandidate();
    const pagePp = pageBillingPp();
    const confirmed = Boolean(pp && meta && meta.value === pp && meta.confirmedAt);
    const bridgeReady = billingBridgeIsReady();
    const loginPage = isActiveBillingHost() && billingLoginFormPresent(document);
    const transportWarning = billingPpRuntime.lastTransportFailureAt > billingPpRuntime.lastBridgeSuccessAt;
    badge.className = !pp ? 'missing' : (confirmed && (!transportWarning || bridgeReady) ? 'ok' : 'pending');
    if (loginPage && candidate) {
      const activeState = pp ? ` · активная #${ppFingerprint(pp)}` : '';
      badge.textContent = `Billing ${providerLabel}: вход · кандидат #${ppFingerprint(candidate.value)}${activeState}`;
    } else if (!pp) {
      badge.textContent = `Billing ${providerLabel}: сессия не найдена`;
    } else {
      const pageState = pagePp
        ? ` · страница #${ppFingerprint(pagePp)} ${pagePp === pp ? '✓' : '≠'}`
        : '';
      const bridgeState = location.hostname === 'userside.simnet.kiev.ua'
        ? (bridgeReady
          ? ' · мост готов'
          : (billingPpRuntime.lastTransportFailureAt ? ' · прямой запрос заблокирован' : ' · ожидаю вкладку Billing'))
        : '';
      const stateLabel = confirmed ? 'подтверждена' : 'кандидат';
      badge.textContent = `Billing ${providerLabel}: ${stateLabel}${bridgeState} · PP #${ppFingerprint(pp)}${pageState}`;
    }
    badge.title = pp
      ? 'Подтверждение Billing и доступность межвкладочного моста учитываются отдельно. Ошибка прямого запроса UserSide не отменяет живую сессию Billing.'
      : `Открой авторизованную страницу ${BILLING_HOSTNAME}, затем вернись к диагностике.`;
  }

  function installBillingPpSyncListener() {
    try {
      if (typeof GM_addValueChangeListener !== 'function') return;
      for (const profile of Object.values(billingProviderApi.profiles)) {
        GM_addValueChangeListener(profile.ppKey, (_name, _oldValue, newValue) => {
          if (profile.id !== activeBillingProvider) return;
          billingPpRuntime.lastKnown = ppLooksUsable(newValue) ? String(newValue).trim() : '';
          if (billingPpRuntime.lastKnown) synchronizeBillingPagePp(billingPpRuntime.lastKnown);
          updateBillingSessionBadge();
        });
        GM_addValueChangeListener(profile.ppMetaKey, () => {
          if (profile.id === activeBillingProvider) updateBillingSessionBadge();
        });
        GM_addValueChangeListener(profile.bridgePresenceKey, () => {
          if (profile.id === activeBillingProvider) updateBillingSessionBadge();
        });
      }
      GM_addValueChangeListener(BILLING_PROVIDER_MODE_KEY, (_name, _oldValue, newValue) => {
        if (billingHostProvider) return;
        const nextMode = billingProviderApi.normalizeMode(newValue);
        if (nextMode === billingProviderMode) return;
        billingProviderMode = nextMode;
        if (nextMode === 'auto') {
          const detection = billingProviderApi.detectFromDocument(document);
          detectedBillingProvider = detection.provider;
          detectedBillingProviderSource = detection.source;
          if (detection.provider) applyBillingProvider(detection.provider, detection.source);
          else updateBillingProviderControl('storage');
        } else {
          applyBillingProvider(nextMode, 'storage');
        }
      });
    } catch (error) {
      journalLog('debug', 'Не удалось включить межвкладочное обновление статуса Billing', {
        reason: error && error.message || String(error),
      });
    }
    if (!billingPpRuntime.pageSyncInstalled && isActiveBillingHost()) {
      billingPpRuntime.pageSyncInstalled = true;
      document.addEventListener('click', event => {
        if (billingLoginFormPresent(document)) return;
        const anchor = event.target && event.target.closest && event.target.closest('a[href]');
        const pp = storedBillingPp();
        if (!anchor || !pp) return;
        const original = anchor.getAttribute('href') || '';
        const rewritten = rewriteBillingUrlWithPp(original, pp);
        if (rewritten !== original) anchor.setAttribute('href', rewritten);
      }, true);
      document.addEventListener('submit', event => {
        if (billingLoginFormPresent(document)) return;
        const form = event.target;
        const pp = storedBillingPp();
        if (!form || !pp || !form.matches || !form.matches('form')) return;
        const original = form.getAttribute('action') || '';
        const rewritten = rewriteBillingUrlWithPp(original, pp);
        if (rewritten !== original) form.setAttribute('action', rewritten);
        for (const input of form.querySelectorAll('input[type="hidden"][name="pp"]')) input.value = pp;
      }, true);
    }
  }

  function rejectBillingPp(rawPp, reason = '') {
    const pp = String(rawPp || '').trim();
    if (!pp) return;
    // Не удаляем и не блокируем pp: ошибка могла быть вызвана cookie-контекстом,
    // CORS/GM-транспортом или временным ответом Billing, а не самим токеном.
    billingPpRuntime.lastTransportFailureAt = Date.now();
    billingPpRuntime.lastTransportFailureReason = String(reason || '').slice(0, 1000);
    journalLog('warn', 'Транспорт UserSide не получил авторизованный ответ Billing; подтверждённая сессия сохранена', {
      reason: billingPpRuntime.lastTransportFailureReason,
    });
    updateBillingSessionBadge();
  }

  function rebindBillingPp(rawUrl, required = true) {
    const url = new URL(rawUrl, BILLING_BASE);
    if (url.hostname !== BILLING_HOSTNAME) return url.toString();
    url.searchParams.delete('pp');
    const pp = currentBillingPp();
    if (!pp) {
      if (required) throw new Error('Не найден pp Billing. Открой авторизованную страницу Billing.');
      return url.toString();
    }
    url.searchParams.set('pp', pp);
    return url.toString();
  }

  function billingUrl(path, params = {}, includeStoredPp = true) {
    const url = new URL(path, BILLING_BASE);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value) !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return includeStoredPp ? rebindBillingPp(url.toString(), true) : url.toString();
  }

  function absoluteBillingUrl(href, baseUrl) {
    const url = new URL(href, baseUrl || BILLING_BASE);
    if (url.hostname !== BILLING_HOSTNAME) return url.toString();
    const pp = currentBillingPp();
    if (pp) {
      url.searchParams.delete('pp');
      url.searchParams.set('pp', pp);
    }
    return url.toString();
  }

  function billingAuthState(doc, finalUrl = '') {
    if (!doc) return { detected: true, reason: 'пустой HTML Billing', title: '' };
    let parsedUrl = null;
    try { parsedUrl = new URL(finalUrl || BILLING_BASE, BILLING_BASE); } catch (_) {}
    const title = String(doc.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (parsedUrl && /(?:login|auth|signin)/i.test(`${parsedUrl.pathname} ${parsedUrl.search}`)) {
      return { detected: true, reason: 'редирект на login/auth URL', title };
    }

    if (billingLoginFormPresent(doc)) {
      return { detected: true, reason: 'найдена форма входа Billing', title };
    }
    return { detected: false, reason: '', title };
  }

  function billingLoginDetected(doc, finalUrl = '') {
    return billingAuthState(doc, finalUrl).detected;
  }

  function billingPageHasExpectedSubscriber(doc, loginOrContract) {
    const body = String(doc.body && doc.body.textContent || '');
    const expected = normalizeSubscriberLogin(loginOrContract);
    const logins = (body.match(/\babon\d{3,14}\b/ig) || []).map(v => v.toLowerCase());
    if (!logins.length) return true;
    return Boolean(expected && logins.includes(expected));
  }

  function billingTechnologyActionFromEvidence(evidence) {
    const text = String(evidence && evidence.text || '').toLowerCase();
    if (evidence && evidence.forcedBillingAction) return evidence.forcedBillingAction;
    if (/huawei|smartax|\bma\d{3,5}\b/.test(text)) return '313';
    const inferred = inferBillingActionFromText(text);
    if (inferred) return inferred;
    if (/epon/.test(text)) return '310';
    if (/gpon/.test(text) && /gcom/.test(text)) return '312';
    if (/gpon/.test(text) && /bdcom/.test(text)) return '311';
    if (/gcom/.test(text)) return '312';
    if (/bdcom/.test(text)) return '311';
    return '';
  }

  function buildPollEvidence(mainDoc) {
    const evidence = extractOltEvidence(mainDoc) || {};
    const oltInfo = evidence.text || '';
    const oltContext = [oltInfo, evidence.rowText].filter(Boolean).join(' | ');
    const oltIp = evidence.ip || extractByRegex(oltInfo, /\b(?:\d{1,3}\.){3}\d{1,3}\b/) || '';
    const deviceMac = extractActiveDeviceMac(mainDoc) || '';
    const forcedBillingAction = /huawei|smartax|\bma\d{3,5}\b/i.test(oltContext) ? '313' : '';
    return {
      oltInfo,
      oltIp,
      deviceId: evidence.deviceId || '',
      deviceName: evidence.deviceName || '',
      onuInterface: evidence.onuInterface || '',
      ponPort: evidence.ponPort || '',
      onuId: evidence.onuId || '',
      deviceMac,
      source: 'ТМЦ UserSide (источник №2 после Billing)',
      forcedBillingAction,
      text: [oltContext, deviceMac].filter(Boolean).join(' | '),
    };
  }

  function analyzeUserSideTmcHtml(html) {
    const evidence = buildPollEvidence(parseHtml(String(html || '')));
    return Object.freeze({
      ...evidence,
      action: billingTechnologyActionFromEvidence(evidence),
    });
  }

  function billingTechnologyCandidates(doc, baseUrl, evidence, includeAll = false) {
    const expectedAction = billingTechnologyActionFromEvidence(evidence);
    const forcedAction = String(evidence && evidence.forcedBillingAction || '');
    const evidenceText = String(evidence && evidence.text || '').toLowerCase();
    const byAction = new Map();

    for (const link of doc.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), baseUrl); } catch (_) { continue; }
      if (!/\/stat\.pl$/i.test(url.pathname)) continue;
      const action = lastUrlParam(url.toString(), 'a');
      if (!['310', '311', '312', '313'].includes(action)) continue;
      if (forcedAction && !includeAll && action !== forcedAction) continue;

      const label = String(link.textContent || '').replace(/\s+/g, ' ').trim();
      const labelText = label.toLowerCase();
      let score = 0;
      const reasons = [];

      if (forcedAction && action === forcedAction) {
        score += 1000;
      } else if (expectedAction && action === expectedAction) {
        score += 150;
      }
      for (const token of ['huawei', 'gcom', 'bdcom', 'epon', 'gpon']) {
        if (evidenceText.includes(token) && labelText.includes(token)) {
          score += token === 'huawei' || token === 'gcom' || token === 'bdcom' ? 60 : 35;
        }
      }

      const candidate = { action, label: label || `a=${action}`, url: url.toString(), score, reasons };
      const previous = byAction.get(action);
      if (!previous || candidate.score > previous.score) byAction.set(action, candidate);
    }
    return [...byAction.values()].sort((a, b) => b.score - a.score);
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractIpv4List(raw) {
    return uniqueBy((String(raw || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []).filter(validIpv4), value => value);
  }

  function emptyBillingSelection(raw) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    return !value || /^(?:0|-|—|нет|не выбрано|не выбран|пусто|none|null)$/i.test(value)
      || /(?:не\s+выбран|выберите|без\s+olt|нет\s+привязки)/i.test(value);
  }

  function controlContextText(control) {
    const row = control.closest('tr');
    const container = row || control.closest('td,div,fieldset,label') || control.parentElement;
    return [control.getAttribute('name'), control.id, container && container.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
  }

  function inferBillingActionFromText(raw) {
    const value = String(raw || '').toLowerCase();
    // Huawei имеет абсолютный приоритет независимо от подписи EPON/GPON.
    if (/huawei/.test(value)) return '313';
    // В Billing встречаются варианты GCOM, G-COM и G COM.
    if (/g[\s_-]*com/.test(value)) return '312';
    const bdcom = /bd[\s_-]*com/.test(value);
    if (bdcom && /gpon/.test(value)) return '311';
    if (bdcom && /epon/.test(value)) return '310';
    if (/epon/.test(value)) return '310';
    if (/gpon/.test(value) && bdcom) return '311';
    return '';
  }

  function selectedControlText(control) {
    if (!control) return '';
    if (control.tagName === 'SELECT') {
      const option = control.selectedOptions && control.selectedOptions[0]
        || control.options && control.options[control.selectedIndex] || null;
      const values = [option && option.textContent, option && option.value, control.value]
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return [...new Set(values)].join(' ');
    }
    return String(control.value || control.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function billingTechnicalFields(doc) {
    const byName = name => doc.querySelector(`[name="${name}"]`);
    return {
      subscriberMac: selectedControlText(byName('dopfield_4')),
      eponOnuMac: selectedControlText(byName('dopfield_19')),
      gponSerial: selectedControlText(byName('dopfield_38')),
      olt: selectedControlText(byName('dopfield_29')),
      technology: selectedControlText(byName('dopfield_39')),
      technologyAction: inferBillingActionFromText(selectedControlText(byName('dopfield_39'))),
    };
  }

  function billingSelectedOltControl(doc) {
    if (!doc) return null;
    return doc.querySelector('select[name="dopfield_29"], input[name="dopfield_29"]');
  }

  function billingSelectedOltRaw(doc) {
    const control = billingSelectedOltControl(doc);
    return control ? selectedControlText(control) : '';
  }

  function normalizeOltMatchText(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' ')
      .replace(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/ig, ' ')
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function oltMatchTokens(raw) {
    const stop = new Set([
      'olt', 'onu', 'ont', 'pon', 'epon', 'gpon', 'xpon', 'xgpon', 'xgspon',
      'huawei', 'gcom', 'status', 'autofind', 'reboot', 'port', 'опрос', 'запрос',
      'источник', 'группа', 'мак', 'mac', 'адрес', 'абонента', 'полный', 'порт'
    ]);
    return [...new Set(
      normalizeOltMatchText(raw).split(' ')
        .filter(token => token.length >= 2 && !stop.has(token))
    )];
  }

  function extractBillingSelectedOlts(doc) {
    const found = [];
    const technicalFields = billingTechnicalFields(doc);
    const control = billingSelectedOltControl(doc);
    if (!control) return found;

    const selectedText = selectedControlText(control);
    if (emptyBillingSelection(selectedText)) return found;
    for (const ip of extractIpv4List(selectedText)) {
      found.push({
        ip,
        selectedText,
        context: controlContextText(control),
        control: control.matches('select') ? 'select[name=dopfield_29]' : 'input[name=dopfield_29]',
        suggestedAction: inferBillingActionFromText(selectedText) || technicalFields.technologyAction,
        source: 'Техданные Billing: поле OLT (dopfield_29)',
        confidence: 100,
        resolvedBy: 'ip-in-selected-field',
      });
    }
    return uniqueBy(found, item => item.ip).sort((a, b) => b.confidence - a.confidence);
  }


  async function fetchBillingTechnicalData(billingId, expectedLogin) {
    const normalizedLogin = normalizeSubscriberLogin(expectedLogin);
    const url = billingUrl('/cgi-bin/adm/adm.pl', { a: 'dopdata', parent_type: '0', id: billingId, tmpl: '1' }, true);
    try {
      const response = await gmPageRequest(url, 25000);
      const doc = parseHtml(response.text);
      rememberBillingPp(response.finalUrl, doc, 'accepted:subscriber-probe', true);
      if (billingLoginDetected(doc, response.finalUrl) || !billingPageHasExpectedSubscriber(doc, normalizedLogin)) return null;
      return { doc, url: response.finalUrl };
    } catch (_) {
      return null;
    }
  }

  function listAskOltLinks(doc, baseUrl, billingId, action = '') {
    const links = [];
    for (const link of doc.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), baseUrl); } catch (_) { continue; }
      if (!/\/stat\.pl$/i.test(url.pathname)) continue;
      if (lastUrlParam(url.toString(), 'act') !== 'askolt') continue;
      if (action && lastUrlParam(url.toString(), 'a') !== action) continue;
      if (billingId && lastUrlParam(url.toString(), 'id') !== String(billingId)) continue;
      const oltIp = lastUrlParam(url.toString(), 'olt_ip');
      if (!validIpv4(oltIp)) continue;
      const row = link.closest('tr');
      const contextText = String((row && row.textContent) || link.parentElement && link.parentElement.textContent || link.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
      links.push({
        url: url.toString(),
        label: String(link.textContent || '').trim() || 'Запрос OLT',
        oltIp,
        action: lastUrlParam(url.toString(), 'a') || action,
        contextText,
        inferredAction: inferBillingActionFromText(contextText),
      });
    }
    return uniqueBy(links, item => item.url);
  }

  async function loadBillingTechnologySnapshots(card, billingId, expectedLogin, evidence, active) {
    const technologies = billingTechnologyCandidates(card.doc, card.url, evidence, true);
    if (!technologies.length) throw new Error('в карточке Billing не найдены технологические вкладки ONU');

    const snapshots = [];
    for (let index = 0; index < technologies.length; index += 1) {
      const technology = technologies[index];
      if (active && !active()) break;
      renderOnuPending(
        'подготавливаю карту OLT-кандидатов…',
        `это ещё не опрос ONU · раздел ${index + 1}/${technologies.length}: ${technology.label} [a=${technology.action}]`,
      );
      try {
        const response = await gmPageRequest(technology.url, 30000);
        if (active && !active()) break;
        const doc = parseHtml(response.text);
        rememberBillingPp(response.finalUrl, doc, 'accepted:technology-snapshot', true);
        if (billingLoginDetected(doc, response.finalUrl) || !billingPageHasExpectedSubscriber(doc, expectedLogin)) {
          throw new Error('ошибка сессии или абонента');
        }
        const askLinks = listAskOltLinks(doc, response.finalUrl, billingId, technology.action);
        snapshots.push({ technology, doc, url: response.finalUrl, askLinks });
        journalLog('debug', 'Разобран раздел выбора OLT Billing', {
          section: `${technology.label} [a=${technology.action}]`,
          candidates: askLinks.length
            ? askLinks.map(link => `${link.oltIp}${link.inferredAction ? ` тип→a=${link.inferredAction}` : ''}`)
            : 'OLT-ссылок для этого абонента нет',
        });
      } catch (error) {
        snapshots.push({ technology, error: error.message, askLinks: [] });
        journalLog('debug', 'Раздел выбора OLT Billing не разобран', {
          section: `${technology.label} [a=${technology.action}]`,
          reason: error && error.message || String(error),
        });
      }
    }

    const candidateIps = [...new Set(snapshots.flatMap(snapshot => (snapshot.askLinks || []).map(link => link.oltIp)))];
    journalLog('info', 'Подготовка карты OLT завершена', {
      sections: `${snapshots.filter(item => !item.error).length}/${technologies.length}`,
      oltCandidates: candidateIps.length ? candidateIps : 'не найдено',
      next: 'теперь формируется порядок гипотез; фактический ONU-опрос начнётся отдельной записью',
    });
    return snapshots.filter(Boolean);
  }


  function inferRepeatedBillingOlt(snapshots) {
    const byIp = new Map();
    for (const snapshot of snapshots) {
      for (const link of snapshot.askLinks || []) {
        if (!byIp.has(link.oltIp)) {
          byIp.set(link.oltIp, {
            ip: link.oltIp,
            actions: new Set(),
            inferredActions: new Set(),
            contexts: new Set(),
            links: [],
          });
        }
        const item = byIp.get(link.oltIp);
        item.actions.add(link.action);
        if (link.inferredAction) item.inferredActions.add(link.inferredAction);
        if (link.contextText) item.contexts.add(link.contextText);
        item.links.push({ ...link, technology: snapshot.technology });
      }
    }
    return [...byIp.values()].filter(item => item.actions.size >= 2).map(item => {
      const inferredActions = [...item.inferredActions];
      const suggestedAction = inferredActions.length === 1 ? inferredActions[0] : '';
      return {
        ip: item.ip,
        selectedText: [...item.contexts][0] || item.ip,
        control: 'повторяющаяся штатная ссылка askolt',
        suggestedAction,
        source: `Billing: IP в ${item.actions.size} разделах${suggestedAction ? `; тип из строки → a=${suggestedAction}` : ''}`,
        confidence: 55 + item.actions.size + (suggestedAction ? 10 : 0),
        availableActions: [...item.actions],
      };
    });
  }

  function linksForOltIp(snapshots, olt, strictAction = false) {
    const actionHint = String(olt && olt.suggestedAction || '');
    const all = [];
    for (const snapshot of snapshots) {
      for (const link of snapshot.askLinks || []) {
        if (link.oltIp !== olt.ip) continue;
        if (strictAction && actionHint && link.action !== actionHint) continue;
        let score = Number(snapshot.technology.score || 0);
        if (actionHint && link.action === actionHint) score += 1000;
        all.push({ ...link, technology: snapshot.technology, score });
      }
    }
    return uniqueBy(all, item => item.url).sort((a, b) => b.score - a.score);
  }


  function billingTechnologyDescriptor(action, snapshots = []) {
    const normalizedAction = String(action || '');
    const snapshot = snapshots.find(item => item && item.technology && String(item.technology.action) === normalizedAction);
    if (snapshot && snapshot.technology) return snapshot.technology;
    const labels = {
      '310': 'BDCOM EPON (1G)',
      '311': 'BDCOM GPON (2.5G)',
      '312': 'GCOM (2.5G)',
      '313': 'HUAWEI OLT',
    };
    return {
      action: normalizedAction,
      label: labels[normalizedAction] || `OLT-раздел a=${normalizedAction}`,
      score: 0,
      synthetic: true,
    };
  }

  // Если IP OLT и технология уже известны из доверенного источника,
  // отсутствие готовой HTML-ссылки askolt не является основанием пропускать опрос.
  // Команда строится напрямую по тому же endpoint Billing.
  function buildDirectAskOltLink(olt, billingId, snapshots = []) {
    if (!olt || !validIpv4(olt.ip) || !/^\d+$/.test(String(billingId || ''))) return null;
    const action = String(
      olt.suggestedAction
      || inferBillingActionFromText([olt.selectedText, olt.context, olt.source].filter(Boolean).join(' '))
      || ''
    );
    if (!['310', '311', '312', '313'].includes(action)) return null;
    const technology = billingTechnologyDescriptor(action, snapshots);
    return {
      url: billingUrl('/cgi-bin/adm/stat.pl', {
        a: action,
        id: billingId,
        act: 'askolt',
        olt_ip: olt.ip,
      }, true),
      label: 'Сформированный запрос OLT',
      oltIp: olt.ip,
      action,
      contextText: String(olt.selectedText || olt.context || olt.source || ''),
      inferredAction: action,
      technology,
      score: 2000,
      synthetic: true,
    };
  }

  // Только значение конкретного поля OLT в техданных Billing считается
  // гипотезой приоритета №1. Если поле хранит только имя, оно сопоставляется
  // со строками штатных страниц выбора OLT. Повторяющиеся askolt-ссылки сами
  // по себе выбранной OLT не считаются.
  function resolveBillingSelectedOlts(technicalData, snapshots) {
    if (!technicalData || !technicalData.doc) return [];
    const direct = extractBillingSelectedOlts(technicalData.doc);
    if (direct.length) return direct;

    const selectedText = billingSelectedOltRaw(technicalData.doc);
    if (emptyBillingSelection(selectedText)) return [];
    const normalizedSelected = normalizeOltMatchText(selectedText);
    const selectedTokens = oltMatchTokens(selectedText);
    const matches = [];

    for (const snapshot of snapshots || []) {
      for (const link of snapshot.askLinks || []) {
        const normalizedContext = normalizeOltMatchText(link.contextText);
        const contextTokens = new Set(oltMatchTokens(link.contextText));
        const exactNameMatch = Boolean(
          normalizedSelected.length >= 5
          && normalizedContext.includes(normalizedSelected)
        );
        const tokenHits = selectedTokens.filter(token => contextTokens.has(token));
        const tokenRatio = selectedTokens.length ? tokenHits.length / selectedTokens.length : 0;
        const score = exactNameMatch ? 300 : Math.round(tokenRatio * 100) + tokenHits.length * 8;
        if (!exactNameMatch && (selectedTokens.length < 2 || tokenRatio < 0.75)) continue;
        matches.push({
          ip: link.oltIp,
          selectedText,
          context: link.contextText,
          control: 'select[name=dopfield_29] → сопоставление по имени',
          suggestedAction: link.inferredAction || link.action || inferBillingActionFromText(selectedText),
          source: 'Техданные Billing: выбранное имя OLT сопоставлено со штатной строкой Billing',
          confidence: score,
          resolvedBy: exactNameMatch ? 'exact-name-match' : 'token-name-match',
          matchedTokens: tokenHits,
        });
      }
    }

    const bestByIp = new Map();
    for (const match of matches) {
      const previous = bestByIp.get(match.ip);
      if (!previous || match.confidence > previous.confidence) bestByIp.set(match.ip, match);
    }
    const ranked = [...bestByIp.values()].sort((a, b) => b.confidence - a.confidence);
    if (!ranked.length) return [];
    const best = ranked[0];
    const tied = ranked.filter(item => item.confidence === best.confidence);
    if (best.confidence < 90 || tied.length > 1) return [];
    return [best];
  }


  function readableText(root) {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,img').forEach(node => node.remove());
    clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    clone.querySelectorAll('p,div,tr,li,pre,table,h1,h2,h3,h4').forEach(node => {
      node.appendChild(node.ownerDocument.createTextNode('\n'));
    });
    return String(clone.textContent || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  }

  function normalizeEquipmentIdentifier(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* ==========================================================
     НОРМАЛИЗАЦИЯ И ИНТЕРПРЕТАЦИЯ РЕЗУЛЬТАТА ONU-ОПРОСА

     Четыре штатных формата Billing:
       a=310 — BDCOM EPON
       a=311 — BDCOM GPON
       a=312 — GCOM
       a=313 — HUAWEI

     Парсеры отличаются, но возвращают одну модель фактов. Общий
     интерпретатор оценивает текущее состояние, а историю использует
     только как контекст. Сырой ответ остаётся доступен оператору.
     ========================================================== */

  const ONU_POLL_ADAPTERS_BY_ACTION = Object.freeze({
    '310': 'bdcom-epon',
    '311': 'bdcom-gpon',
    '312': 'gcom',
    '313': 'huawei',
  });

  const ONU_ANALYSIS_THRESHOLDS = Object.freeze({
    stableUptimeSeconds: 2 * 60 * 60,
    recentWindowMs: 48 * 60 * 60 * 1000,
    trendWindowMs: 7 * 24 * 60 * 60 * 1000,
    opticalWarnDbm: -30,
    opticalErrorDbm: -32,
  });

  function pollAdapterFromAction(action) {
    return ONU_POLL_ADAPTERS_BY_ACTION[String(action || '')] || 'unknown';
  }

  function normalizePollMac(raw) {
    const compact = String(raw || '').replace(/[^0-9a-f]/ig, '').toUpperCase();
    if (compact.length !== 12) return '';
    return compact.match(/.{2}/g).join(':');
  }

  function normalizePollIdentifier(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function placeholderEquipmentValue(raw) {
    const normalized = normalizePollIdentifier(raw);
    return !normalized || /^0+$/.test(normalized) || /^(?:NONE|NULL|NA|UNKNOWN)$/.test(normalized);
  }

  function pollNumber(raw) {
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!text) return null;
    const value = Number(text.replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  function firstPollMatch(text, patterns, group = 1) {
    for (const pattern of patterns) {
      const match = String(text || '').match(pattern);
      if (match && match[group] !== undefined) return String(match[group]).trim();
    }
    return '';
  }

  function pollLines(raw) {
    return String(raw || '').replace(/\r/g, '').split('\n');
  }

  function splitPollCommandBlocks(raw) {
    const blocks = [];
    let current = { command: '', lines: [] };
    for (const sourceLine of pollLines(raw)) {
      const line = String(sourceLine || '');
      if (/^\s*(?:show|display)\s+\S+/i.test(line)) {
        if (current.command || current.lines.length) blocks.push(current);
        current = { command: line.trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    if (current.command || current.lines.length) blocks.push(current);
    return blocks.map(block => ({
      ...block,
      text: block.lines.join('\n'),
    }));
  }

  function firstNumericLine(raw, includePattern, excludePattern = null) {
    for (const line of pollLines(raw)) {
      includePattern.lastIndex = 0;
      if (!includePattern.test(line)) continue;
      if (excludePattern) {
        excludePattern.lastIndex = 0;
        if (excludePattern.test(line)) continue;
      }
      const values = [...line.matchAll(/-?\d+(?:[.,]\d+)?/g)];
      if (!values.length) continue;
      // В строках таблиц интерфейс (например, epon0/1:1) содержит цифры.
      // Нужное измерение обычно является последним числом строки.
      return pollNumber(values[values.length - 1][0]);
    }
    return null;
  }

  function parsePollDate(raw) {
    const text = String(raw || '');
    const patterns = [
      /\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\b/,
      /\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\b/,
      /\b(\d{1,2}):(\d{2}):(\d{2})\s+(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/,
    ];
    let match = text.match(patterns[0]);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
    match = text.match(patterns[1]);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
    match = text.match(patterns[2]);
    if (match) return new Date(Number(match[4]), Number(match[5]) - 1, Number(match[6]), Number(match[1]), Number(match[2]), Number(match[3]));
    return null;
  }

  function parsePollDurationSeconds(raw) {
    const text = String(raw || '').toLowerCase();
    if (!text) return null;
    const bdcomClock = text.match(/\b(\d+)d\s*[:.]\s*(\d{1,2}):(\d{2}):(\d{2})\b/i);
    if (bdcomClock) {
      return Number(bdcomClock[1]) * 86400
        + Number(bdcomClock[2]) * 3600
        + Number(bdcomClock[3]) * 60
        + Number(bdcomClock[4]);
    }
    const read = patterns => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return Number(match[1]);
      }
      return 0;
    };
    const days = read([/(\d+)\s*day/, /(\d+)\s*д(?:н|ень|ня|ней)/]);
    const hours = read([/(\d+)\s*hour/, /(\d+)\s*h(?:\b|\s)/, /(\d+)\s*час/]);
    const minutes = read([/(\d+)\s*minute/, /(\d+)\s*m(?:\b|\s)/, /(\d+)\s*мин/]);
    const seconds = read([/(\d+)\s*second/, /(\d+)\s*s(?:\b|\s)/, /(\d+)\s*сек/]);
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }

  function formatPollDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 3600) return `${Math.max(1, Math.round(value / 60))} мин`;
    if (value < 86400) return `${Math.floor(value / 3600)} ч ${Math.floor((value % 3600) / 60)} мин`;
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    return hours ? `${days} д ${hours} ч` : `${days} д`;
  }

  function normalizeCurrentOnuState(rawState) {
    const value = String(rawState || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (/^(?:online|active|operational|registered|working|up)$/.test(value)) return 'online';
    if (/^(?:offline|inactive|unregistered|down|disabled|power off|wire down)$/.test(value)) return 'offline';
    return 'unknown';
  }

  function normalizePollDownReason(rawReason) {
    const raw = String(rawReason || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { code: '', raw: '' };
    if (/dying[\s_-]*gasp|power[_ -]?off|powerdown|power\s+failure/i.test(raw)) return { code: 'power', raw };
    if (/\bLOS\b|LOSi|LOBi|signal\s+loss|wire\s+down|linkfault/i.test(raw)) return { code: 'los', raw };
    if (/admin|deactivat|manual|shutdown/i.test(raw)) return { code: 'administrative', raw };
    return { code: 'other', raw };
  }

  function pollReasonLabel(code, raw = '') {
    if (code === 'power') return 'пропадание питания ONU';
    if (code === 'los') return 'потеря оптического сигнала';
    if (code === 'administrative') return 'административное отключение';
    return raw || 'причина не расшифрована';
  }

  function parseBdcomGponLifecycle(raw) {
    const blocks = splitPollCommandBlocks(raw);
    const activeBlock = blocks.find(block => /show\s+gpon\s+active-onu/i.test(block.command));
    const inactiveBlock = blocks.find(block => /show\s+gpon\s+inactive-onu/i.test(block.command));
    const interfacePattern = /\bGPON\d*\/\d+(?::\d+)?\b/i;
    const activeRow = activeBlock
      ? pollLines(activeBlock.text).find(line => interfacePattern.test(line)) || ''
      : '';
    const inactiveRow = inactiveBlock
      ? pollLines(inactiveBlock.text).find(line => interfacePattern.test(line)) || ''
      : '';

    const closedEvents = [];
    for (const line of pollLines(raw)) {
      const match = line.match(/^\s*(\d+)\s+(20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(.+?)\s*$/);
      if (!match) continue;
      const deactiveAt = parsePollDate(match[3]);
      const reason = normalizePollDownReason(match[4]);
      closedEvents.push({
        seq: Number(match[1]),
        activeAt: parsePollDate(match[2]),
        deactiveAt,
        reasonCode: reason.code,
        reasonRaw: reason.raw,
        evidence: line.trim(),
      });
    }
    closedEvents.sort((a, b) => b.seq - a.seq);

    let status = 'unknown';
    if (activeRow) status = 'online';
    else if (inactiveRow) status = 'offline';
    else if (closedEvents.length) status = 'offline';

    return {
      status,
      activeRow,
      inactiveRow,
      lastClosed: closedEvents[0] || null,
      closedEvents,
    };
  }

  function extractBdcomGponRegistration(raw) {
    const lifecycle = parseBdcomGponLifecycle(raw);
    const evidence = lifecycle.activeRow || lifecycle.inactiveRow || '';
    const activeAt = lifecycle.activeRow ? parsePollDate(lifecycle.activeRow) : null;
    const durationRaw = firstPollMatch(lifecycle.activeRow, [
      /\b(\d+d\s*[:.]\s*\d{1,2}:\d{2}:\d{2})\b/i,
    ]);
    const distanceMatch = lifecycle.activeRow.match(/\s(\d+(?:[.,]\d+)?)\s*$/);
    return {
      activeAt: activeAt && !Number.isNaN(activeAt.getTime()) ? activeAt : null,
      durationSeconds: parsePollDurationSeconds(durationRaw),
      durationText: durationRaw,
      distanceMeters: distanceMatch ? pollNumber(distanceMatch[1]) : null,
      evidence: evidence.trim(),
    };
  }

  function extractBdcomEponRegistration(raw) {
    const blocks = splitPollCommandBlocks(raw);
    const activeBlock = blocks.find(block => /show\s+epon\s+active-onu/i.test(block.command));
    const evidence = activeBlock
      ? pollLines(activeBlock.text).find(line => /\bEPON\d*\/\d+(?::\d+)?\b/i.test(line)) || ''
      : '';
    const dates = [...evidence.matchAll(/20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g)].map(match => parsePollDate(match[0]));
    const reason = normalizePollDownReason(firstPollMatch(evidence, [
      /(POWER[_ -]?OFF|Dying\s*Gasp|LOSi(?:\/LOBi)?|LOBi|\bLOS\b|wire[-\s]+down|linkfault)/i,
    ]));
    const alive = evidence.match(/\b(\d+)\s*[.]\s*(\d{1,2}):(\d{2}):(\d{2})\s*$/);
    const durationSeconds = alive
      ? Number(alive[1]) * 86400 + Number(alive[2]) * 3600 + Number(alive[3]) * 60 + Number(alive[4])
      : null;
    return {
      activeAt: dates[0] && !Number.isNaN(dates[0].getTime()) ? dates[0] : null,
      lastDownAt: dates[1] && !Number.isNaN(dates[1].getTime()) ? dates[1] : null,
      lastDownReasonCode: reason.code,
      lastDownReasonRaw: reason.raw,
      durationSeconds,
      durationText: durationSeconds ? formatPollDuration(durationSeconds) : '',
      distanceMeters: null,
      evidence: evidence.trim(),
    };
  }

  function extractPollHistory(raw) {
    const events = [];
    const sourceLines = pollLines(raw);
    for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
      const line = sourceLines[lineIndex];
      const gponSequence = line.match(/^\s*(\d+)\s+(20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(.+?)\s*$/);
      if (gponSequence) {
        const normalized = normalizePollDownReason(gponSequence[4]);
        const at = parsePollDate(gponSequence[3]);
        if (normalized.code && normalized.code !== 'other') {
          events.push({
            at: at && !Number.isNaN(at.getTime()) ? at : null,
            reasonCode: normalized.code,
            reasonRaw: normalized.raw,
            evidence: line.trim(),
          });
        }
        continue;
      }

      const huaweiCause = line.match(/^\s*DownCause\s*:\s*(.+?)\s*$/i);
      if (huaweiCause) {
        const normalized = normalizePollDownReason(huaweiCause[1]);
        const historyStart = Math.max(0, lineIndex - 10);
        const downLine = sourceLines.slice(historyStart, lineIndex)
          .reverse()
          .find(candidate => /^\s*DownTime\s*:/i.test(candidate)) || '';
        const at = parsePollDate(downLine);
        if (normalized.code && normalized.code !== 'other') {
          events.push({
            at: at && !Number.isNaN(at.getTime()) ? at : null,
            reasonCode: normalized.code,
            reasonRaw: normalized.raw,
            evidence: [downLine.trim(), line.trim()].filter(Boolean).join(' · '),
          });
        }
        continue;
      }

      if (!/(?:POWER[_ -]?OFF|Dying\s*Gasp|\bLOS\b|LOSi|LOBi|wire\s+down|linkfault|offline|dereg|deactivat)/i.test(line)) continue;
      const reasonText = firstPollMatch(line, [
        /reason\s*:\s*([^,;]+)/i,
        /(?:LastDeregReason|Last\s+down\s+cause)\s*[:=]\s*(.+)$/i,
        /(POWER[_ -]?OFF|Dying\s*Gasp|LOSi(?:\/LOBi)?|LOBi|\bLOS\b|wire\s+down|linkfault)/i,
      ]);
      const normalized = normalizePollDownReason(reasonText || line);
      if (!normalized.code || normalized.code === 'other' && !reasonText) continue;
      const at = parsePollDate(line);
      // Значения 2000 года в BDCOM EPON часто являются заглушкой LastReg/LastDereg,
      // а не реальной историей абонента.
      if (at && at.getFullYear() < 2015) continue;
      events.push({
        at: at && !Number.isNaN(at.getTime()) ? at : null,
        reasonCode: normalized.code,
        reasonRaw: normalized.raw,
        evidence: line.trim(),
      });
    }

    const separateCause = firstPollMatch(raw, [
      /^\s*Last\s+down\s+cause\s*:\s*(.+)$/im,
      /^\s*LastDeregReason\s*[:=]\s*(.+)$/im,
    ]);
    const separateTime = firstPollMatch(raw, [
      /^\s*Last\s+down\s+time\s*:\s*(.+)$/im,
      /^\s*LastDereg(?:Time)?\s*[:=]\s*(.+)$/im,
    ]);
    if (separateCause) {
      const normalized = normalizePollDownReason(separateCause);
      const at = parsePollDate(separateTime);
      if (!at || at.getFullYear() >= 2015) {
        events.push({
          at: at && !Number.isNaN(at.getTime()) ? at : null,
          reasonCode: normalized.code,
          reasonRaw: normalized.raw,
          evidence: [separateTime, separateCause].filter(Boolean).join(' · '),
        });
      }
    }

    const deduped = [];
    const seen = new Set();
    for (const event of events) {
      const key = `${event.at ? event.at.getTime() : 'unknown'}|${event.reasonCode}|${event.reasonRaw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(event);
    }
    deduped.sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0));

    const now = Date.now();
    const withTime = deduped.filter(event => event.at && event.at.getTime() <= now + 5 * 60 * 1000);
    const recent48h = withTime.filter(event => now - event.at.getTime() <= ONU_ANALYSIS_THRESHOLDS.recentWindowMs);
    const recent7d = withTime.filter(event => now - event.at.getTime() <= ONU_ANALYSIS_THRESHOLDS.trendWindowMs);
    const sortedAsc = [...recent7d].sort((a, b) => a.at - b.at);
    let clustered = false;
    for (let left = 0; left < sortedAsc.length; left += 1) {
      let right = left;
      while (right < sortedAsc.length && sortedAsc[right].at - sortedAsc[left].at <= 2 * 60 * 60 * 1000) right += 1;
      if (right - left >= 3) { clustered = true; break; }
    }

    return {
      events: deduped,
      last: withTime[0] || deduped[0] || null,
      recent48h,
      recent7d,
      recentPower48h: recent48h.filter(event => event.reasonCode === 'power').length,
      recentLos48h: recent48h.filter(event => event.reasonCode === 'los').length,
      frequentRecent: recent48h.length >= 3 || recent7d.length >= 5 || clustered,
    };
  }

  function extractPollMacTable(raw, expectedOnuMac = '') {
    const rows = [];
    const expectedOnu = normalizePollMac(expectedOnuMac);
    const macPattern = /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}[.:-][0-9a-f]{4}[.:-][0-9a-f]{4}/ig;
    const blocks = splitPollCommandBlocks(raw);

    // MAC учитываем только из фактических таблиц MAC. Адрес, который встречается
    // в самой команде фильтра (например, "| inc a85e...."), не доказывает,
    // что OLT его изучила.
    const macBlocks = blocks.filter(block => {
      const command = String(block.command || '');
      if (/dhcp(?:-relay)?\s+snooping\s+binding/i.test(command)) return false;
      return /(?:mac\s+address-table|mac-address-table|ont-learned-mac|mac-address\s+port|mac\s+address\s+port)/i.test(command);
    });
    const sources = macBlocks.map(block => block.text);
    const sourceText = sources.join('\n');

    for (const line of pollLines(sourceText)) {
      const matches = [...line.matchAll(macPattern)];
      if (!matches.length) continue;
      for (const match of matches) {
        const mac = normalizePollMac(match[0]);
        if (!mac) continue;
        const prefix = line.slice(0, match.index).trim();
        const suffix = line.slice((match.index || 0) + match[0].length).trim();
        let vlan = null;
        const prefixVlan = prefix.match(/(?:^|\s)(\d{1,4})\s*$/);
        const suffixVlan = suffix.match(/^\s*(\d{1,4})(?:\s|$)/);
        if (prefixVlan && Number(prefixVlan[1]) >= 1 && Number(prefixVlan[1]) <= 4094) vlan = Number(prefixVlan[1]);
        else if (suffixVlan && Number(suffixVlan[1]) >= 1 && Number(suffixVlan[1]) <= 4094) vlan = Number(suffixVlan[1]);
        const port = firstPollMatch(line, [
          /\b((?:gpon|epon)\d*\/\d+(?::\d+)?(?:-\d+)?)\b/i,
          /\b(\d+\/\d+\/\d+(?::\d+)?)\b/,
        ]);
        rows.push({ mac, vlan, port, evidence: line.trim() });
      }
    }

    const unique = [];
    const seenRows = new Set();
    for (const row of rows) {
      const key = `${row.mac}|${row.vlan || ''}`;
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      unique.push(row);
    }
    const subscriberRows = unique.filter(row => !expectedOnu || row.mac !== expectedOnu);
    const totalMatch = sourceText.match(/Total\s+(?:entries|entry)\s*:\s*(\d+)/i)
      || sourceText.match(/Mac\s+Address\s+Table\s*\(Total\s+(\d+)\)/i)
      || sourceText.match(/Total\s*:\s*(\d+)/i);
    return {
      seen: macBlocks.length > 0,
      total: totalMatch ? Number(totalMatch[1]) : unique.length,
      allRows: unique,
      subscriberRows,
      subscriberMacs: [...new Set(subscriberRows.map(row => row.mac))],
    };
  }

  function extractPollErrorCounters(raw) {
    const counters = [];
    const labelPattern = /(?:FCS|CRC|alignment|collision|jabber|fragment|undersize|oversize|discard|overflow|MAC\s+sub-layer.*error|carrier\s+sense\s+error)/i;
    for (const line of pollLines(raw)) {
      if (!labelPattern.test(line)) continue;
      const match = line.match(/:\s*(\d+)\s*$/);
      if (!match) continue;
      counters.push({ label: line.split(':')[0].trim(), value: Number(match[1]), evidence: line.trim() });
    }
    return {
      available: counters.length > 0,
      counters,
      total: counters.reduce((sum, item) => sum + item.value, 0),
      nonZero: counters.filter(item => item.value > 0),
    };
  }

  function extractCurrentOnuStatus(raw, adapter) {
    const exact = firstPollMatch(raw, [
      /^\s*Run\s+state\s*:\s*(online|offline|active|inactive|registered|unregistered)\b/im,
      /^\s*Status\s*:\s*(online|offline|active|inactive|registered|unregistered)\b/im,
      /^\s*(?:ONU|ONT)\s+status\s*:\s*(online|offline|active|inactive|registered|unregistered)\b/im,
      /\bONU\s+\S+\s+is\s*-\s*(online|offline)\b/i,
    ]);
    if (exact) return normalizeCurrentOnuState(exact);

    const blocks = splitPollCommandBlocks(raw);
    if (adapter === 'bdcom-epon') {
      const activeBlock = blocks.find(block => /show\s+epon\s+active-onu/i.test(block.command));
      const inactiveBlock = blocks.find(block => /show\s+epon\s+inactive-onu/i.test(block.command));
      if (activeBlock && /\bEPON\d*\/\d+(?::\d+)?\b/i.test(activeBlock.text)
        && /(?:ctc-oam-oper|auto-configured|active|operational)/i.test(activeBlock.text)) return 'online';
      if (inactiveBlock && /\bEPON\d*\/\d+(?::\d+)?\b/i.test(inactiveBlock.text)) return 'offline';
      if (/OAM\s+operational\s+status\s*:\s*operational|ctc-oam-oper/i.test(raw)) return 'online';
    }

    if (adapter === 'bdcom-gpon') {
      return parseBdcomGponLifecycle(raw).status;
    }
    return 'unknown';
  }

  function extractEthernetFacts(raw) {
    // BDCOM GPON выводит Ethernet-link как `uni-port 1 up/down`,
    // без слов `link state`. Это полноценное состояние UNI-порта ONU.
    const blocks = splitPollCommandBlocks(raw);
    const portBlocks = blocks.filter(block => /(?:onu|ont).{0,30}port|port-status|eth-port|port\s+state/i.test(block.command));
    const source = portBlocks.length
      ? portBlocks.map(block => `${block.command}\n${block.text}`).join('\n')
      : String(raw || '');
    const lines = pollLines(source);
    let link = 'unknown';
    let speedMbps = null;
    let duplex = 'unknown';
    let evidence = '';

    for (const line of lines) {
      if (/hardware\s+state\s+is\s+link[-\s]?down|port\s+status\s+is\s+(?:disable|down)|\blink\s*state\s*[:=]?\s*down\b|\buni[-\s]?port\s+\d+\s+(?:is\s+)?down\b|\b(?:eth|ethernet)[-\s]?port\s+\d+\s+(?:is\s+)?down\b/i.test(line)) {
        link = 'down'; evidence = line.trim(); break;
      }
    }
    if (link === 'unknown') {
      for (const line of lines) {
        if (/hardware\s+state\s+is\s+link[-\s]?up|port\s+status\s+is\s+enable|\blink\s*state\s*[:=]?\s*up\b|\buni[-\s]?port\s+\d+\s+(?:is\s+)?up\b|\b(?:eth|ethernet)[-\s]?port\s+\d+\s+(?:is\s+)?up\b/i.test(line)) {
          link = 'up'; evidence = line.trim(); break;
        }
      }
    }

    for (const line of lines) {
      if (speedMbps === null) {
        let match = line.match(/\b(10000|2500|1000|100|10)\s*(?:BASE[- ]?T|BaseT|Mbps|Mbit\/s|M)\b/i);
        if (!match) match = line.match(/\b(?:speed|rate)(?:\s*\([^)]*\))?\s*(?:is|[:=])?\s*(10000|2500|1000|100|10)\b/i);
        if (match) speedMbps = Number(match[1]);
      }
      if (/half[-\s]?duplex|\bhalf\b/i.test(line) && /duplex|BaseT|BASE-T|speed/i.test(line)) duplex = 'half';
      else if (/full[-\s]?duplex/i.test(line) || (/\bfull\b/i.test(line) && /duplex|BaseT|BASE-T|speed/i.test(line))) duplex = 'full';

      // Huawei часто выводит значения отдельной строкой таблицы под заголовком
      // Speed(Mbps) / Duplex / LinkState.
      const tableRow = line.match(/\b(10000|2500|1000|100|10)\b[^\n]{0,80}\b(full|half)(?:[-\s]?duplex)?\b[^\n]{0,80}\b(up|down)\b/i);
      if (tableRow) {
        speedMbps = Number(tableRow[1]);
        duplex = tableRow[2].toLowerCase();
        link = tableRow[3].toLowerCase();
        evidence = line.trim();
      }
    }
    return { link, speedMbps, duplex, evidence };
  }

  function extractServiceFacts(raw) {
    const blocks = splitPollCommandBlocks(raw)
      .filter(block => /service[- ]?port/i.test(block.command));
    const source = blocks.length ? blocks.map(block => block.text).join('\n') : '';
    let state = 'unknown';
    let evidence = '';

    for (const line of pollLines(source)) {
      if (/\bdown\b|disable/i.test(line) && !/Up\/Down\s*:\s*\d+\/0/i.test(line)) {
        state = 'down'; evidence = line.trim(); break;
      }
      if (/\bup\b/i.test(line) || /Up\/Down\s*:\s*[1-9]\d*\/0/i.test(line)) {
        state = 'up'; evidence = line.trim();
      }
    }
    return { state, evidence };
  }

  function extractUptimeFacts(raw) {
    const lines = pollLines(raw);
    const line = lines.find(value => /(?:online\s+duration|up\/down\s+time|alive\s*time|alivetime|uptime)/i.test(value)) || '';
    let seconds = parsePollDurationSeconds(line);
    let since = null;

    if (!seconds) {
      for (const row of lines) {
        const eponAlive = row.match(/\bEPON\d*\/\d+(?::\d+)?\b.*?\s(\d+)\s*\.\s*(\d{1,2}):(\d{2}):(\d{2})\s*$/i);
        if (eponAlive) {
          seconds = Number(eponAlive[1]) * 86400 + Number(eponAlive[2]) * 3600 + Number(eponAlive[3]) * 60 + Number(eponAlive[4]);
          break;
        }
      }
    }

    if (!seconds) {
      const sinceText = firstPollMatch(raw, [
        /^\s*Online\/Offline\s+time\s*:\s*(.+)$/im,
        /^\s*(?:Online\s+since|Last\s+up\s+time)\s*:\s*(.+)$/im,
      ]);
      since = parsePollDate(sinceText);
      if (since && !Number.isNaN(since.getTime()) && since.getTime() <= Date.now()) {
        seconds = Math.floor((Date.now() - since.getTime()) / 1000);
      }
    }

    if (!seconds) {
      const lifecycle = parseBdcomGponLifecycle(raw);
      if (lifecycle.status === 'online' && lifecycle.activeRow) {
        since = parsePollDate(lifecycle.activeRow);
        if (since && !Number.isNaN(since.getTime()) && since.getTime() <= Date.now()) {
          seconds = Math.floor((Date.now() - since.getTime()) / 1000);
        }
      }
    }

    return {
      seconds,
      text: seconds ? formatPollDuration(seconds) : String(line || '').replace(/^.*?:\s*/, '').trim(),
      since,
    };
  }

  function baseOnuFacts(raw, context, adapter) {
    const serial = firstPollMatch(raw, [
      // Huawei часто печатает машинный hex-SN и удобную форму производителя
      // в скобках: 4647585015A2BAEB (FGXP-15A2BAEB). Для сравнения с
      // Billing используем форму в скобках.
      /^\s*SN\s*:\s*[^\s]+\s+\(([^)]+)\)\s*$/im,
      /^\s*SN\s*:\s*([^\s]+)\s*$/im,
      /^\s*(?:Serial(?:\s+Number)?|ONT\s+SN|ONU\s+SN)\s*:\s*([^\s]+)(?:\s+\([^)]+\))?\s*$/im,
      /^\s*Serial\s+number\s+([^\s]+)(?:\s+\([^)]+\))?\s*$/im,
    ]);
    const parsedOnuMac = normalizePollMac(firstPollMatch(raw, [
      /^\s*(?:ONU|ONT)\s+MAC(?:\s+address)?\s*[:=]\s*([^\s]+)\s*$/im,
      /^\s*MAC\s+Address\s*[:=]\s*([^\s]+)\s*$/im,
      /^\s*MAC\s*[:=]\s*([^\s]+)\s*$/im,
      /^\s*ONU\s+ID\s*:\s*([^\s]+)\s*$/im,
    ]));
    const onuMac = parsedOnuMac || (adapter === 'bdcom-epon' ? normalizePollMac(context.expectedOnuMac) : '');
    const macTable = extractPollMacTable(raw, onuMac);
    const ethernet = extractEthernetFacts(raw);
    const service = extractServiceFacts(raw);
    const uptime = extractUptimeFacts(raw);
    const history = extractPollHistory(raw);
    const errors = extractPollErrorCounters(raw);
    const onuInterface = firstPollMatch(raw, [
      /^\s*ONT\s*:\s*([^\s]+)\s*$/im,
      /\b((?:xgs?pon|gpon|epon|pon)\d*\/\d+(?:\/\d+)?(?::\d+)?)\b/i,
      /^\s*(\d+\/\d+\/\d+)\s*$/im,
    ]);

    return {
      adapter,
      action: String(context.action || ''),
      technologyLabel: String(context.technologyLabel || ''),
      status: extractCurrentOnuStatus(raw, adapter),
      configState: firstPollMatch(raw, [/^\s*Config(?:uration)?\s+state\s*:\s*(.+)$/im, /^\s*ONU\s+Config\s*:\s*(.+)$/im]),
      matchState: firstPollMatch(raw, [/^\s*Match\s+state\s*:\s*(.+)$/im]),
      workingState: firstPollMatch(raw, [/^\s*W\/S\s*:\s*(.+)$/im, /^\s*Operational\s*:\s*(.+)$/im]),
      onuInterface,
      serial,
      onuMac,
      distanceMeters: pollNumber(firstPollMatch(raw, [
        /^\s*(?:ONT\s+)?(?:last\s+)?distance\s*\(m\)\s*:\s*([\d.]+)/im,
        /^\s*Distance\s*\(m\)\s*:\s*([\d.]+)/im,
        /^\s*Distance\s*:\s*([\d.]+)\s*m/im,
      ])),
      optics: { onuRxDbm: null, onuTxDbm: null, oltRxDbm: null },
      ethernet,
      service,
      macTable,
      uptime,
      registration: null,
      history,
      errors,
      sourceWarnings: {
        onuMacMismatch: /неверно\s+указан\s+mac\s+onu|incorrect(?:ly)?\s+(?:specified\s+)?onu\s+mac|onu\s+mac\s+mismatch/i.test(String(raw || '')),
      },
      expected: {
        onuMac: normalizePollMac(context.expectedOnuMac),
        onuSerial: String(context.expectedOnuSerial || '').trim(),
        routerMac: normalizePollMac(context.expectedRouterMac),
        sessionRouterMac: normalizePollMac(context.sessionRouterMac),
      },
      evidence: [],
    };
  }

  function parseHuaweiOnuPoll(raw, context) {
    const facts = baseOnuFacts(raw, context, 'huawei');
    facts.optics.oltRxDbm = pollNumber(firstPollMatch(raw, [
      /^\s*OLT\s+Rx\s+(?:ONT|ONU)\s+optical\s+power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    facts.optics.onuRxDbm = pollNumber(firstPollMatch(raw, [
      /^\s*(?:ONT\s+)?Rx\s+optical\s+power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    facts.optics.onuTxDbm = pollNumber(firstPollMatch(raw, [
      /^\s*(?:ONT\s+)?Tx\s+optical\s+power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    const ontId = firstPollMatch(raw, [/^\s*ontid_by_onu\s*=\s*(\d+)\s*$/im]);
    if (ontId && facts.optics.onuRxDbm === null) {
      const opticalBlock = splitPollCommandBlocks(raw)
        .find(block => /display\s+ont\s+optical-info/i.test(block.command));
      const row = opticalBlock
        ? pollLines(opticalBlock.text).find(line => new RegExp(`^\\s*${ontId}\\s+-?\\d`).test(line)) || ''
        : '';
      const values = row.match(/^\s*\d+\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)/);
      if (values) {
        facts.optics.onuRxDbm = pollNumber(values[1]);
        facts.optics.onuTxDbm = pollNumber(values[2]);
        facts.optics.oltRxDbm = pollNumber(values[3]);
      }
    }
    return facts;
  }

  function parseGcomOnuPoll(raw, context) {
    const facts = baseOnuFacts(raw, context, 'gcom');
    facts.optics.onuRxDbm = pollNumber(firstPollMatch(raw, [
      /^\s*RX\s+Optical\s+Power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    facts.optics.onuTxDbm = pollNumber(firstPollMatch(raw, [
      /^\s*TX\s+Optical\s+Power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    const oltRx = pollNumber(firstPollMatch(raw, [/\(OLT\s+RX\s*:\s*(-?[\d.]+)\)/i]));
    facts.optics.oltRxDbm = oltRx === 0 ? null : oltRx;
    return facts;
  }

  function parseBdcomGponOnuPoll(raw, context) {
    const facts = baseOnuFacts(raw, context, 'bdcom-gpon');
    facts.registration = extractBdcomGponRegistration(raw);
    if (facts.distanceMeters === null && facts.registration.distanceMeters !== null) {
      facts.distanceMeters = facts.registration.distanceMeters;
    }
    facts.optics.onuRxDbm = firstNumericLine(raw, /(?:ONU\s+)?(?:Rx\s+optical\s+power|Rx\s*Power|RxPower|received\s+(?:optical\s+)?power)/i, /OLT|CATV/i);
    facts.optics.onuTxDbm = firstNumericLine(raw, /(?:ONU\s+)?(?:Tx\s+optical\s+power|Tx\s*Power|TxPower|transmit(?:ted)?\s+(?:optical\s+)?power)/i, /OLT|CATV/i);
    if (!facts.serial) {
      facts.serial = firstPollMatch(raw, [
        /\bGPON\d*\/\d+(?::\d+)?\b\s+([^\s]+)\s+(?:active|inactive|online|offline)\b/i,
        /^\s*Serial\s+number\s+([^\s]+)(?:\s+\([^)]+\))?/im,
      ]);
    }
    return facts;
  }

  function parseBdcomEponOnuPoll(raw, context) {
    const facts = baseOnuFacts(raw, context, 'bdcom-epon');
    facts.registration = extractBdcomEponRegistration(raw);
    const blocks = splitPollCommandBlocks(raw);
    const oltBlock = blocks.find(block => /optical-transceiver-diagnosis/i.test(block.command));
    if (oltBlock) {
      facts.optics.oltRxDbm = firstNumericLine(oltBlock.text, /Rx\s*Power|RxPower/i, /CATV/i);
      if (facts.optics.oltRxDbm === null) {
        const tableRow = pollLines(oltBlock.text).find(line => /\bEPON\d*\/\d+(?::\d+)?\b/i.test(line) && /-?\d+(?:[.,]\d+)?/.test(line));
        if (tableRow) {
          const values = [...tableRow.matchAll(/-?\d+(?:[.,]\d+)?/g)];
          if (values.length) facts.optics.oltRxDbm = pollNumber(values[values.length - 1][0]);
        }
      }
    }

    const ctcOptBlock = blocks.find(block => /onu\s+ctc\s+opt/i.test(block.command));
    const onuText = ctcOptBlock ? ctcOptBlock.text : String(raw || '');
    facts.optics.onuRxDbm = pollNumber(firstPollMatch(onuText, [
      /^\s*received\s+(?:optical\s+)?power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
      /^\s*Rx\s+(?:optical\s+)?power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));
    facts.optics.onuTxDbm = pollNumber(firstPollMatch(onuText, [
      /^\s*transmit(?:ted)?\s+(?:optical\s+)?power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
      /^\s*Tx\s+(?:optical\s+)?power\s*\(dBm\)\s*:\s*(-?[\d.]+)/im,
    ]));

    const activeBlock = blocks.find(block => /show\s+epon\s+active-onu/i.test(block.command));
    if (activeBlock && facts.distanceMeters === null) {
      const activeRow = pollLines(activeBlock.text).find(line => /\bEPON\d*\/\d+(?::\d+)?\b/i.test(line)) || '';
      const match = activeRow.match(/\bEPON\d*\/\d+(?::\d+)?\b\s+\S+\s+\S+\s+\S+\s+(\d{1,6})\b/i);
      if (match) facts.distanceMeters = Number(match[1]);
    }
    return facts;
  }

  function parseUnknownOnuPoll(raw, context) {
    const facts = baseOnuFacts(raw, context, 'unknown');
    facts.optics.onuRxDbm = firstNumericLine(raw, /(?:RX\s+Optical\s+Power|Rx\s*Power|RxPower|received\s+optical\s+power)/i, /OLT/i);
    facts.optics.onuTxDbm = firstNumericLine(raw, /(?:TX\s+Optical\s+Power|Tx\s*Power|TxPower|transmit(?:ted)?\s+optical\s+power)/i, /OLT/i);
    return facts;
  }

  function evaluateOnuPollFacts(facts) {
    const deviations = [];
    const current = [];
    const historyItems = [];
    const causes = [];
    let severity = 'ok';
    const raise = next => {
      const rank = { ok: 0, unknown: 1, warn: 2, conflict: 3, error: 4 };
      if (rank[next] > rank[severity]) severity = next;
    };

    const routerMacs = facts.macTable.subscriberMacs;
    const expectedRouterMac = facts.expected.routerMac;
    const sessionRouterMac = facts.expected.sessionRouterMac;
    const referenceRouterMac = expectedRouterMac || sessionRouterMac;
    const routerMacPresent = routerMacs.length > 0;
    const routerMacMatched = Boolean(referenceRouterMac && routerMacs.includes(referenceRouterMac));
    const routerMacMismatch = Boolean(referenceRouterMac && routerMacPresent && !routerMacMatched);
    const macTableEmpty = facts.macTable.seen && !routerMacPresent;

    if (facts.sourceWarnings?.onuMacMismatch) {
      deviations.push('OLT прямо сообщает: в Billing неверно указан MAC ONU для абонента.');
      raise('conflict');
    }

    if (facts.status === 'online') current.push('ONU находится в сети.');
    else if (facts.status === 'offline') {
      const reason = facts.history.last ? pollReasonLabel(facts.history.last.reasonCode, facts.history.last.reasonRaw) : '';
      current.push(`ONU находится offline${reason ? `; последняя известная причина — ${reason}` : ''}.`);
      deviations.push('ONU сейчас не находится в сети.');
      raise('error');
    } else {
      current.push('Текущее состояние ONU однозначно не распознано.');
      raise('unknown');
    }

    if (facts.optics.onuRxDbm !== null) {
      current.push(`Приём ONU: ${facts.optics.onuRxDbm.toFixed(2)} dBm.`);
      if (facts.optics.onuRxDbm <= ONU_ANALYSIS_THRESHOLDS.opticalErrorDbm) {
        deviations.push(`Критически слабый уровень приёма ONU: ${facts.optics.onuRxDbm.toFixed(2)} dBm.`);
        raise('error');
      } else if (facts.optics.onuRxDbm <= ONU_ANALYSIS_THRESHOLDS.opticalWarnDbm) {
        deviations.push(`Слабый уровень приёма ONU: ${facts.optics.onuRxDbm.toFixed(2)} dBm.`);
        raise('warn');
      }
    }
    if (facts.optics.oltRxDbm !== null) {
      current.push(`Приём сигнала ONU на OLT: ${facts.optics.oltRxDbm.toFixed(2)} dBm.`);
      if (facts.optics.oltRxDbm <= ONU_ANALYSIS_THRESHOLDS.opticalErrorDbm) {
        deviations.push(`Критически слабый приём сигнала ONU на OLT: ${facts.optics.oltRxDbm.toFixed(2)} dBm.`);
        raise('error');
      } else if (facts.optics.oltRxDbm <= ONU_ANALYSIS_THRESHOLDS.opticalWarnDbm) {
        deviations.push(`Слабый приём сигнала ONU на OLT: ${facts.optics.oltRxDbm.toFixed(2)} dBm.`);
        raise('warn');
      }
    }

    if (facts.ethernet.link === 'up') {
      const details = [
        facts.ethernet.speedMbps ? `${facts.ethernet.speedMbps} Мбит/с` : '',
        facts.ethernet.duplex !== 'unknown' ? `${facts.ethernet.duplex}-duplex` : '',
      ].filter(Boolean).join(', ');
      current.push(`Ethernet-линк с роутером поднят${details ? `: ${details}` : ''}.`);
    } else if (facts.ethernet.link === 'down') {
      deviations.push('Ethernet-линк между ONU и роутером отсутствует.');
      raise(facts.status === 'online' ? 'warn' : 'error');
    } else if (facts.status !== 'offline') {
      current.push('Состояние Ethernet-порта не получено.');
      if (facts.status === 'online') raise('unknown');
    }

    if (facts.ethernet.duplex === 'half') {
      deviations.push('Ethernet-порт работает в half-duplex.');
      raise('warn');
    }

    if (routerMacMatched) {
      current.push(`MAC роутера изучен и соответствует зарегистрированному: ${referenceRouterMac}.`);
    } else if (routerMacPresent && !referenceRouterMac) {
      current.push(`За ONU изучен MAC: ${routerMacs.join(', ')}; сравнить с Billing невозможно — зарегистрированный MAC не получен.`);
      deviations.push('В Billing не получен зарегистрированный MAC роутера для сверки.');
      raise('warn');
    } else if (routerMacMismatch) {
      deviations.push(`Изученный MAC (${routerMacs.join(', ')}) не соответствует ожидаемому ${referenceRouterMac}.`);
      raise('conflict');
    } else if (macTableEmpty && facts.status !== 'offline') {
      deviations.push('MAC роутера за ONU не изучен.');
      raise('warn');
    } else if (facts.status !== 'offline') {
      current.push('Таблица MAC в результате опроса не получена.');
      if (facts.status === 'online') raise('unknown');
    }

    const actualSerial = normalizePollIdentifier(facts.serial);
    const expectedSerial = normalizePollIdentifier(facts.expected.onuSerial);
    if (facts.serial && facts.expected.onuSerial) {
      if (placeholderEquipmentValue(facts.expected.onuSerial)) {
        deviations.push(`В Billing указан некорректный SN ONU; фактический SN: ${facts.serial}.`);
        raise('conflict');
      } else if (actualSerial && expectedSerial && actualSerial !== expectedSerial) {
        deviations.push(`SN ONU не совпадает: Billing ${facts.expected.onuSerial}, фактически ${facts.serial}.`);
        raise('conflict');
      }
    }

    if (facts.configState && !/normal|success|active|enable/i.test(facts.configState)) {
      deviations.push(`Состояние конфигурации ONU: ${facts.configState}.`);
      raise('warn');
    }
    if (facts.matchState && !/match|normal|success/i.test(facts.matchState)) {
      deviations.push(`ONU не соответствует профилю: ${facts.matchState}.`);
      raise('conflict');
    }
    if (facts.service.state === 'down') {
      deviations.push('Service-port находится в состоянии down.');
      raise('error');
    } else if (facts.service.state === 'up') {
      current.push('Service-port активен.');
    }

    if (facts.errors.available) {
      if (facts.errors.total > 0) {
        deviations.push(`На Ethernet-порту есть ненулевые ошибки: ${facts.errors.nonZero.map(item => `${item.label}=${item.value}`).join(', ')}.`);
        raise('warn');
      } else {
        current.push('Ошибки Ethernet-порта не обнаружены.');
      }
    }

    if (facts.uptime.seconds) {
      current.push(`Текущий uptime ONU: ${formatPollDuration(facts.uptime.seconds)}.`);
      if (facts.uptime.seconds < ONU_ANALYSIS_THRESHOLDS.stableUptimeSeconds && facts.history.last) {
        deviations.push('ONU поднялась недавно; короткий uptime следует сопоставить с последним отключением.');
        raise('warn');
      }
    }

    if (facts.history.last) {
      const last = facts.history.last;
      const when = last.at ? last.at.toLocaleString('ru-RU', { hour12: false }) : 'время не получено';
      historyItems.push(`Последнее отключение: ${pollReasonLabel(last.reasonCode, last.reasonRaw)} · ${when}.`);
    }
    if (facts.status === 'online' && facts.history.events.length && !facts.history.recent48h.length) {
      historyItems.push('В полученной истории за последние 48 часов новых отключений не видно.');
    }
    if (facts.history.frequentRecent) {
      const details = [];
      if (facts.history.recentPower48h) details.push(`по питанию: ${facts.history.recentPower48h}`);
      if (facts.history.recentLos48h) details.push(`по оптике: ${facts.history.recentLos48h}`);
      historyItems.push(`За последние 48 часов зафиксированы повторные отключения${details.length ? ` (${details.join(', ')})` : ''}.`);
      deviations.push('Наблюдается недавняя повторяющаяся нестабильность ONU.');
      raise('warn');
    } else if (facts.history.last && facts.uptime.seconds && facts.uptime.seconds >= ONU_ANALYSIS_THRESHOLDS.recentWindowMs / 1000) {
      historyItems.push(`Событие не текущее: после него ONU работает ${formatPollDuration(facts.uptime.seconds)}.`);
    }

    const causeCode = facts.history.frequentRecent
      ? (facts.history.recentLos48h > facts.history.recentPower48h ? 'los' : facts.history.recentPower48h ? 'power' : facts.history.last && facts.history.last.reasonCode)
      : (facts.status === 'offline' && facts.history.last ? facts.history.last.reasonCode : '');
    if (causeCode === 'power') {
      causes.push(
        'питание ONU, блок питания, кабель или контакт в розетке;',
        'абонент отключает или перезагружает оборудование;',
        'перебои электросети в квартире или доме;',
        'реже — неисправность самой ONU.'
      );
    } else if (causeCode === 'los') {
      causes.push(
        'оптический патч-корд, коннектор или загрязнение соединения;',
        'перегиб либо повреждение волокна;',
        'делитель, муфта или участок линии до абонента;',
        'локальные работы или авария на оптической сети.'
      );
    }

    let summary = '';
    let conclusion = '';
    if (facts.status === 'offline') {
      const reason = facts.history.last ? pollReasonLabel(facts.history.last.reasonCode, facts.history.last.reasonRaw) : '';
      summary = `ONU offline${reason ? `: ${reason}` : ''}.`;
      conclusion = reason === 'потеря оптического сигнала'
        ? 'Неисправность относится к оптическому участку OLT → ONU.'
        : reason === 'пропадание питания ONU'
          ? 'Проверить питание ONU и наличие электроснабжения у абонента.'
          : 'Требуется определить причину отсутствия регистрации ONU.';
    } else if (facts.status === 'online' && facts.ethernet.link === 'up' && routerMacMatched && !deviations.some(item => /Ethernet|MAC роутера|Service-port|критически|слабый уровень/i.test(item))) {
      summary = 'ONU online, линк с роутером поднят, зарегистрированный MAC изучен.';
      conclusion = 'Участок OLT → ONU → роутер подтверждён. При жалобе дальнейшую проверку направлять на роутер, локальную сеть и Wi‑Fi.';
    } else if (facts.status === 'online' && facts.ethernet.link === 'up' && routerMacPresent) {
      summary = 'ONU online, Ethernet-линк поднят и MAC за ONU присутствует; обнаружены отдельные отклонения.';
      conclusion = 'Физическое подключение до роутера подтверждено. Найденные отклонения следует проверить отдельно.';
    } else if (facts.status === 'online' && facts.ethernet.link === 'down') {
      summary = 'ONU online, но линк между ONU и роутером отсутствует.';
      conclusion = 'Оптическая линия до ONU работает; проверять кабель ONU–роутер, питание роутера и WAN-порт.';
    } else if (facts.status === 'online') {
      summary = 'ONU online, но цепочка до роутера подтверждена не полностью.';
      conclusion = 'Линия до ONU работает; для полного вывода нужны Ethernet-link и MAC роутера.';
    } else {
      summary = 'Результат опроса получен, но текущее состояние распознано не полностью.';
      conclusion = 'Нужна ручная проверка полного ответа OLT.';
    }

    if (facts.history.frequentRecent && facts.status === 'online') {
      summary += ' За последние дни есть повторные отключения.';
    }

    return {
      severity,
      badge: ({ ok: 'OK', warn: 'WARN', error: 'ERROR', unknown: 'UNKNOWN', conflict: 'CONFLICT' })[severity] || 'UNKNOWN',
      summary,
      current,
      deviations,
      history: historyItems,
      causes: causes.length ? {
        title: causeCode === 'los' ? 'Возможные причины потерь оптического сигнала' : 'Возможные причины отключений по питанию',
        items: causes,
      } : null,
      conclusion,
      strongCurrentChain: facts.status === 'online' && facts.ethernet.link === 'up' && routerMacMatched,
      routerMacPresent,
      routerMacMatched,
      routerMacMismatch,
    };
  }

  function analyzeOnuPollResult(raw, context = {}) {
    const adapter = pollAdapterFromAction(context.action);
    const parser = ({
      huawei: parseHuaweiOnuPoll,
      gcom: parseGcomOnuPoll,
      'bdcom-gpon': parseBdcomGponOnuPoll,
      'bdcom-epon': parseBdcomEponOnuPoll,
    })[adapter] || parseUnknownOnuPoll;
    const facts = parser(String(raw || ''), context);
    const report = evaluateOnuPollFacts(facts);
    return { adapter, facts, report };
  }

  globalThis.__SIMNET_ONU_ANALYSIS__ = Object.freeze({
    analyzeOnuPollResult,
    isolateOnuPollTranscript,
    pollAdapterFromAction,
    thresholds: ONU_ANALYSIS_THRESHOLDS,
  });

  globalThis.__SIMNET_TMC_ANALYSIS__ = Object.freeze({
    analyzeUserSideTmcHtml,
    billingTechnologyActionFromEvidence,
  });

  function isolateOnuPollTranscript(raw) {
    const text = String(raw || '').replace(/\r/g, '').trim();
    const marker = text.match(/^\s*\[\d{2}:\d{2}:\d{2}\s+\d{2}-\d{2}-\d{4}\]\s*=+\s*OLT\b.*$/im);
    if (marker && marker.index !== undefined) return text.slice(marker.index).trim();

    const commandMatches = [...text.matchAll(/^\s*(?:show|display)\s+\S+.*$/gim)];
    if (commandMatches.length >= 2 && commandMatches[0].index !== undefined) {
      return text.slice(commandMatches[0].index).trim();
    }
    return text;
  }

  function extractOnuPollRawOutput(doc) {
    const strongMarker = /(?:\[\d{2}:\d{2}:\d{2}\s+\d{2}-\d{2}-\d{4}\]|={3,}\s*OLT|hardware\s+state\s+is\s+link[-\s]?(?:up|down)|ctc-oam-oper|\bwire\s*down\b|\bpower\s*off\b|\bdying\s*gasp\b|\b(?:online|offline|operational|registered|unregistered)\b)/i;
    const roots = [...doc.querySelectorAll('pre,textarea,code,[id*="result" i],[id*="output" i],td,div')];
    const candidates = [];
    const seen = new Set();
    for (const root of roots.slice(0, 3500)) {
      const value = isolateOnuPollTranscript(readableText(root));
      if (value.length < 12 || value.length > 250000 || !strongMarker.test(value)) continue;
      const key = `${value.length}:${value.slice(0, 800)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tag = String(root.tagName || '').toUpperCase();
      const idClass = `${root.id || ''} ${root.className || ''}`;
      const commandCount = (value.match(/^\s*(?:show|display)\s+/gim) || []).length;
      const markerCount = (value.match(/\b(?:online|offline|POWER[_ -]?OFF|Dying\s*Gasp|LOSi|LOBi|Link-Up|Link-Down|ctc-oam-oper)\b/ig) || []).length;
      let score = Math.min(value.length / 100, 400) + commandCount * 60 + markerCount * 8;
      if (['PRE', 'TEXTAREA', 'CODE'].includes(tag)) score += 800;
      if (/result|output|response|answer/i.test(idClass)) score += 450;
      if (/^\s*\[\d{2}:\d{2}:\d{2}\s+\d{2}-\d{2}-\d{4}\]/m.test(value)) score += 1200;
      if (value.length > 100000) score -= 150;
      candidates.push({ value, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.value.length - b.value.length);
    return candidates[0]?.value || isolateOnuPollTranscript(readableText(doc.body));
  }

  function extractBillingOnuResult(doc, expected = {}) {
    const rawOutput = extractOnuPollRawOutput(doc);
    const flat = rawOutput.replace(/\s+/g, ' ').trim();
    const analysis = analyzeOnuPollResult(rawOutput, expected);
    const compactOutput = normalizeEquipmentIdentifier(flat);
    const expectedIdentifiers = [
      { type: 'ONU MAC', value: expected.onuMac },
      { type: 'ONU SN', value: expected.onuSerial },
    ].map(item => ({ ...item, normalized: normalizeEquipmentIdentifier(item.value) }))
      .filter(item => item.normalized.length >= 8 && !placeholderEquipmentValue(item.value));
    const matchedIdentifiers = expectedIdentifiers.filter(item => compactOutput.includes(item.normalized));
    const identifierMatched = matchedIdentifiers.length > 0;

    const pending = /(?:данные\s+посланы|wait\.{0,3}|ждите|ожидани|выполняется\s+опрос)/i.test(flat)
      && analysis.facts.status === 'unknown';
    const notFound = /(?:onu|ont).{0,80}(?:не\s+найден|not\s+found)|нет\s+(?:записей|ответа)/i.test(flat);
    const fatalTechnicalError = !notFound
      && analysis.facts.status === 'unknown'
      && /(?:\bfailed\b|\btimeout\b|internal\s+server\s+error|ошиб(?:ка|ки|ок)?)/i.test(flat);
    const meaningfulFacts = Boolean(
      analysis.facts.status !== 'unknown'
      || analysis.facts.optics.onuRxDbm !== null
      || analysis.facts.ethernet.link !== 'unknown'
      || analysis.facts.macTable.seen
      || analysis.facts.serial
      || identifierMatched
    );
    const confirmed = !notFound && meaningfulFacts;

    let classification = 'unknown';
    if (pending) classification = 'pending';
    else if (notFound) classification = 'not-found';
    else if (confirmed && analysis.facts.status === 'offline') classification = 'found-negative';
    else if (confirmed && ['warn', 'conflict'].includes(analysis.report.severity)) classification = 'found-warning';
    else if (confirmed && analysis.report.severity === 'error') classification = 'found-negative';
    else if (confirmed) classification = 'positive';
    else if (fatalTechnicalError) classification = 'error';

    return {
      ready: classification !== 'unknown' && classification !== 'pending',
      confirmed,
      positive: classification === 'positive',
      pending,
      negative: classification === 'found-negative' || classification === 'not-found' || classification === 'error',
      unhealthy: analysis.facts.status === 'offline' || analysis.report.severity === 'error',
      warning: classification === 'found-warning',
      notFound: classification === 'not-found',
      technicalError: classification === 'error',
      identifierMatched,
      matchedIdentifiers: matchedIdentifiers.map(item => `${item.type}: ${item.value}`),
      classification,
      status: analysis.facts.status,
      output: rawOutput,
      rawOutput,
      analysis,
    };
  }
  async function fetchBillingCard(billingId, expectedLogin) {
    const normalizedLogin = normalizeSubscriberLogin(expectedLogin);
    const url = billingUrl('/cgi-bin/adm/adm.pl', { a: 'user', id: billingId }, true);
    const response = await gmPageRequest(url, 25000);
    const doc = parseHtml(response.text);
    rememberBillingPp(response.finalUrl, doc, 'accepted:billing-card', true);
    if (billingLoginDetected(doc, response.finalUrl) || !billingPageHasExpectedSubscriber(doc, normalizedLogin)) {
      throw new Error('Карточка Billing не авторизована или открыт не тот абонент');
    }
    return { doc, url: response.finalUrl };
  }

  async function runBillingOnuPoll(ctx, runId) {
    const active = () => isDiagnosticRunActive(runId);
    const attempts = [];
    const attemptedUrls = new Set();
    const hypothesisRuntime = {
      current: 0,
      total: 0,
      pollCommand: 0,
    };

    function hypothesisLabel(meta) {
      return hypothesisRuntime.total
        ? `${meta.hypothesisIndex || hypothesisRuntime.current}/${hypothesisRuntime.total}`
        : String(meta.hypothesisIndex || hypothesisRuntime.current || '?');
    }

    async function pollLink(link, meta) {
      if (!link || !link.url) return null;
      if (attemptedUrls.has(link.url)) {
        journalLog('info', 'Команда OLT уже выполнялась; повторный запрос пропущен', {
          hypothesis: hypothesisLabel(meta),
          oltIp: link.oltIp,
          technology: `${link.technology.label} [a=${link.action}]`,
          reason: 'тот же IP, раздел и endpoint уже были проверены ранее в этой диагностике',
        });
        return null;
      }
      attemptedUrls.add(link.url);
      if (!active()) return null;

      consumeDiagnosticBudget('onuPolls', 'ONU-опросов');
      const commandNumber = ++hypothesisRuntime.pollCommand;
      const commandIndex = Number(meta.commandIndex || 1);
      const commandTotal = Number(meta.commandTotal || 1);
      const hypothesis = hypothesisLabel(meta);
      const timeoutMs = 60000;

      journalLog('info', 'Запускаю команду проверки гипотезы OLT', {
        hypothesis,
        hypothesisType: meta.candidateType,
        hypothesisReason: meta.hypothesisReason,
        source: meta.candidateSource,
        oltIp: link.oltIp,
        technology: `${link.technology.label} [a=${link.action}]`,
        command: `${commandIndex}/${commandTotal}`,
        pollCommandNumber: commandNumber,
        timeoutMs,
        commandSource: link.synthetic ? 'сформирована напрямую по IP и технологии' : 'штатная ссылка Billing',
        url: link.url,
      });
      renderOnuPending(
        `гипотеза ${hypothesis}: ${meta.candidateLabel}`,
        `команда ${commandIndex}/${commandTotal} · ${link.technology.label} [a=${link.action}] · OLT ${link.oltIp} · лимит ожидания ${Math.round(timeoutMs / 1000)}с`,
      );

      const startedAt = performance.now();
      let response;
      try {
        response = await gmPageRequest(link.url, timeoutMs);
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        const result = {
          ready: true,
          confirmed: false,
          positive: false,
          pending: false,
          negative: true,
          unhealthy: false,
          warning: true,
          notFound: false,
          technicalError: true,
          identifierMatched: false,
          matchedIdentifiers: [],
          classification: 'request-error',
          status: '',
          output: error && error.message || String(error),
        };
        attempts.push({ link, meta, result });
        journalLog('warn', 'Команда гипотезы OLT завершилась ошибкой', {
          hypothesis,
          oltIp: link.oltIp,
          technology: `${link.technology.label} [a=${link.action}]`,
          command: `${commandIndex}/${commandTotal}`,
          durationMs,
          reason: result.output,
          next: commandIndex < commandTotal ? 'следующая команда этой гипотезы' : 'следующая гипотеза',
        });
        return { link, meta, result };
      }
      if (!active()) return null;
      const doc = parseHtml(response.text);
      rememberBillingPp(response.finalUrl, doc, 'accepted:onu-poll', true);
      if (billingLoginDetected(doc, response.finalUrl)) throw new Error('сессия Billing завершена во время опроса');

      const result = extractBillingOnuResult(doc, {
        action: link.action,
        technologyLabel: link.technology.label,
        onuMac: meta.expectedOnuMac,
        onuSerial: meta.expectedOnuSerial,
        expectedOnuMac: meta.expectedOnuMac,
        expectedOnuSerial: meta.expectedOnuSerial,
        expectedRouterMac: meta.expectedRouterMac,
        sessionRouterMac: meta.sessionRouterMac,
      });
      attempts.push({ link, meta, result });
      const durationMs = Math.round(performance.now() - startedAt);
      journalLog(result.confirmed ? 'ok' : result.pending ? 'warn' : 'info', 'Получен результат команды гипотезы OLT', {
        hypothesis,
        oltIp: link.oltIp,
        technology: `${link.technology.label} [a=${link.action}]`,
        command: `${commandIndex}/${commandTotal}`,
        durationMs,
        classification: result.classification,
        confirmed: result.confirmed ? 'да' : 'нет',
        pending: result.pending ? 'да' : 'нет',
        notFound: result.notFound ? 'да' : 'нет',
        identifierMatched: result.identifierMatched ? 'да' : 'нет',
        status: result.status || 'не распознан',
        next: result.confirmed
          ? 'гипотеза подтверждена, цепочка остановлена'
          : commandIndex < commandTotal
            ? 'следующая команда этой гипотезы'
            : 'следующая гипотеза',
      });
      if (result.analysis) {
        const facts = result.analysis.facts;
        const report = result.analysis.report;
        journalLog(report.severity === 'error' ? 'error' : ['warn', 'conflict'].includes(report.severity) ? 'warn' : report.severity === 'ok' ? 'ok' : 'info', 'ONU-опрос интерпретирован', {
          adapter: result.analysis.adapter,
          severity: report.badge,
          onu: facts.status,
          ethernet: `${facts.ethernet.link}${facts.ethernet.speedMbps ? `/${facts.ethernet.speedMbps}M` : ''}${facts.ethernet.duplex !== 'unknown' ? `/${facts.ethernet.duplex}` : ''}`,
          macs: facts.macTable.subscriberMacs.length ? facts.macTable.subscriberMacs : 'не получены',
          uptime: facts.uptime.text || 'не получен',
          recentEvents48h: facts.history.recent48h.length,
          deviations: report.deviations.length ? report.deviations : 'нет',
          summary: report.summary,
        });
      }
      return { link, meta, result };
    }

    function renderConfirmed(attempt, assessment) {
      const { link, meta, result } = attempt;
      renderOnuSuccess(result, {
        technology: `раздел ${link.technology.label} [a=${link.action}]`,
        oltIp: link.oltIp,
        billingId: meta.billingId,
        source: meta.candidateSource,
        assessment,
      });
      const report = result.analysis && result.analysis.report;
      journalLog(report && report.severity === 'error' ? 'error' : report && ['warn', 'conflict'].includes(report.severity) ? 'warn' : 'ok', 'Фактическая OLT подтверждена опросом', {
        oltIp: link.oltIp,
        assessment,
        result: report ? `${report.badge} · ${report.summary}` : 'ответ получен',
      });
    }

    async function tryOltCandidate(olt, snapshots, meta) {
      let links = linksForOltIp(snapshots, olt, Boolean(meta.strictAction));
      if (!links.length) {
        const directLink = buildDirectAskOltLink(olt, meta.billingId, snapshots);
        if (directLink) {
          links = [directLink];
          journalLog('decision', 'Для гипотезы построена прямая команда опроса OLT', {
            candidate: meta.candidateLabel,
            oltIp: directLink.oltIp,
            technology: `${directLink.technology.label} [a=${directLink.action}]`,
            reason: 'готовой askolt-ссылки в загруженной HTML-странице нет, но IP и технология известны',
            action: 'опрос не пропускается; используется тот же stat.pl?act=askolt',
          });
        }
      }
      const hypothesisIndex = Number(meta.hypothesisIndex || ++hypothesisRuntime.current);
      hypothesisRuntime.current = Math.max(hypothesisRuntime.current, hypothesisIndex);
      const hypothesis = hypothesisLabel({ ...meta, hypothesisIndex });
      const actions = links.map(link => `${link.technology.label} [a=${link.action}]${link.synthetic ? ' · команда сформирована' : ''}`);

      journalLog(links.length ? 'decision' : 'warn', 'Запускаю гипотезу выбора OLT', {
        hypothesis,
        candidate: meta.candidateLabel,
        candidateType: meta.candidateType,
        oltIp: olt && olt.ip,
        source: meta.candidateSource,
        reason: meta.hypothesisReason,
        strictTechnology: meta.strictAction ? 'да' : 'нет',
        suggestedAction: olt && olt.suggestedAction ? `a=${olt.suggestedAction}` : 'нет',
        commands: actions.length ? actions : 'штатные ссылки askolt не найдены',
        nextOnFailure: meta.nextOnFailure || 'следующая гипотеза',
      });

      if (!links.length) {
        journalLog('warn', 'Гипотеза OLT не может быть опрошена', {
          hypothesis,
          candidate: meta.candidateLabel,
          oltIp: olt && olt.ip,
          reason: 'не определена технология a=310/311/312/313; одной IP недостаточно для безопасного выбора раздела',
          next: meta.nextOnFailure || 'следующая гипотеза',
        });
        return null;
      }
      for (let index = 0; index < links.length; index += 1) {
        const link = links[index];
        const attempt = await pollLink(link, {
          ...meta,
          candidateDeviceId: meta.candidateDeviceId || (olt && olt.deviceId) || '',
          candidateDeviceName: meta.candidateDeviceName || (olt && (olt.deviceName || olt.selectedText)) || '',
          candidateInterface: meta.candidateInterface || (olt && (olt.onuInterface || olt.iface)) || '',
          hypothesisIndex,
          commandIndex: index + 1,
          commandTotal: links.length,
        });
        if (!active()) return null;
        if (attempt && attempt.result.confirmed) return attempt;
      }

      const candidateAttempts = attempts.filter(item => item.meta && item.meta.hypothesisIndex === hypothesisIndex);
      journalLog('warn', 'Гипотеза OLT не подтверждена', {
        hypothesis,
        candidate: meta.candidateLabel,
        oltIp: olt && olt.ip,
        results: candidateAttempts.map(item => `${item.link.technology.label}[a=${item.link.action}]:${item.result.classification}`),
        next: meta.nextOnFailure || 'следующая гипотеза',
      });
      return null;
    }

    try {
      journalLog('info', 'Запущена подготовка опроса ONU', { customerId: ctx.customerId, contract: ctx.contract });
      if (active()) renderOnuPending('получаю Billing ID, ТМЦ и выбранную OLT Billing…');

      const [tab29Raw, mainRaw] = await Promise.all([
        ctx.getSource('tab29', ENDPOINTS.tab29, ctx),
        ctx.getSource('main', ENDPOINTS.main, ctx),
      ]);
      if (!active()) return;

      const juniper = extractJuniperParams(parseHtml(tab29Raw));
      const billingIdentity = resolveBillingIdentity(juniper, ctx.contract);
      const billingId = billingIdentity.billingId;
      if (!isMeaningful(billingId)) throw new Error('в tab29 не найден billing_uid и не удалось восстановить ID Billing');

      const mainDoc = parseHtml(mainRaw);
      const tmcEvidence = buildPollEvidence(mainDoc);

      renderOnuPending('открываю подтверждённую карточку и «Техданные» Billing…', `Billing ID ${billingId}`);
      const card = await fetchBillingCard(billingId, billingIdentity.login || ctx.contract);
      if (!active()) return;
      const technicalData = await fetchBillingTechnicalData(billingId, billingIdentity.login || ctx.contract);
      if (!active()) return;
      const billingFields = technicalData ? billingTechnicalFields(technicalData.doc) : { eponOnuMac: '', gponSerial: '' };
      const expectedOnuMac = billingFields.eponOnuMac || tmcEvidence.deviceMac || '';
      const expectedOnuSerial = billingFields.gponSerial || '';
      const expectedRouterMac = billingFields.subscriberMac || '';
      const sessionRouterMac = normalizeMacAddress(extractSessionMac(mainDoc) || (juniper && juniper.mac)) || '';

      const snapshots = await loadBillingTechnologySnapshots(card, billingId, billingIdentity.login || ctx.contract, tmcEvidence, active);
      if (!active()) return;

      const billingSelectedOlts = resolveBillingSelectedOlts(technicalData, snapshots);
      const repeatedBillingFallbackOlts = inferRepeatedBillingOlt(snapshots)
        .filter(item => !billingSelectedOlts.some(explicit => explicit.ip === item.ip));
      const tmcAction = billingTechnologyActionFromEvidence(tmcEvidence);
      const sameBillingOlt = tmcEvidence.oltIp
        ? billingSelectedOlts.find(item => item.ip === tmcEvidence.oltIp)
        : null;
      const tmcNeedsSeparateHypothesis = Boolean(
        tmcEvidence.oltIp
        && (
          !sameBillingOlt
          || (tmcAction && sameBillingOlt.suggestedAction && tmcAction !== sameBillingOlt.suggestedAction)
        )
      );

      hypothesisRuntime.total = billingSelectedOlts.length
        + (tmcNeedsSeparateHypothesis ? 1 : 0)
        + repeatedBillingFallbackOlts.filter(item => item.ip !== tmcEvidence.oltIp).length
        + 1; // Последний этап — динамическая гипотеза по истории MAC.

      const knownChain = [
        ...billingSelectedOlts.map(item => `№1 Billing: ${item.ip} (${item.resolvedBy === 'ip-in-selected-field' ? 'IP из поля OLT' : 'имя OLT сопоставлено со строкой'})`),
        ...(tmcNeedsSeparateHypothesis ? [`№2 ТМЦ: ${tmcEvidence.oltIp}`] : []),
        ...repeatedBillingFallbackOlts
          .filter(item => item.ip !== tmcEvidence.oltIp)
          .map(item => `резерв: ${item.ip}${item.suggestedAction ? ` [a=${item.suggestedAction}]` : ''}`),
        'последний резерв: история MAC → найденная OLT',
      ];

      journalLog('debug', 'Как распознано поле OLT в техданных Billing', {
        rawValue: billingFields.olt || 'пусто',
        technology: billingFields.technology || 'пусто',
        recognized: billingSelectedOlts.length ? 'да' : 'нет',
        result: billingSelectedOlts.map(item => `${item.ip} · ${item.resolvedBy} · a=${item.suggestedAction || '?'}`),
        tmc: tmcEvidence.oltIp || 'не найдена',
        tmcAction: tmcAction || 'не определён',
      });

      journalLog('decision', 'Порядок проверки OLT определён', {
        rule: '1) OLT из поля техданных Billing; 2) OLT из ТМЦ; 3) слабые кандидаты; 4) история MAC',
        why: 'Billing — рабочая привязка и первая гипотеза; ТМЦ — следующий по доверию источник, который обычно поддерживается тщательнее',
        billingHypothesis: billingSelectedOlts.length
          ? billingSelectedOlts.map(item => `${item.ip}${item.suggestedAction ? ` [a=${item.suggestedAction}]` : ''}`)
          : (billingFields.olt ? `поле заполнено «${billingFields.olt}», но однозначно сопоставить IP не удалось` : 'поле OLT пустое'),
        tmcHypothesis: tmcEvidence.oltIp
          ? `${tmcEvidence.oltIp}${tmcNeedsSeparateHypothesis ? ' — отдельная гипотеза №2' : ' — совпадает с Billing, отдельный повтор не нужен'}`
          : 'OLT в ТМЦ не найдена',
        hypotheses: hypothesisRuntime.total,
        chain: knownChain.map((item, index) => `${index + 1}. ${item}`),
        exceptionRule: 'если Billing-гипотеза не подтверждается или не имеет штатной команды — без задержки переход к ТМЦ',
      });


      for (const selectedOlt of billingSelectedOlts) {
        const confirmed = await tryOltCandidate(selectedOlt, snapshots, {
          candidateType: 'billing-selected',
          candidateLabel: 'выбранная OLT Billing',
          candidateSource: selectedOlt.source,
          billingId,
          strictAction: Boolean(selectedOlt.suggestedAction),
          expectedOnuMac,
          expectedOnuSerial,
          expectedRouterMac,
          sessionRouterMac,
          hypothesisReason: 'OLT явно выбрана в поле техданных Billing; по правилу проверяется первой',
          nextOnFailure: tmcEvidence.oltIp ? `OLT из ТМЦ ${tmcEvidence.oltIp}` : 'резервные кандидаты Billing',
        });
        if (!active()) return;
        if (confirmed) {
          renderConfirmed(confirmed, 'ONU подтверждена на выбранной OLT Billing.');
          return { confirmed: true, attempt: confirmed, attempts, portContext: buildPortAnalysisContext(ctx, confirmed, tmcEvidence) };
        }
      }

      if (tmcNeedsSeparateHypothesis) {
        const expectedAction = tmcAction;
        const tmcOlt = { ip: tmcEvidence.oltIp, deviceId: tmcEvidence.deviceId, deviceName: tmcEvidence.deviceName, onuInterface: tmcEvidence.onuInterface, selectedText: tmcEvidence.oltInfo, suggestedAction: expectedAction, source: tmcEvidence.source };
        const confirmed = await tryOltCandidate(tmcOlt, snapshots, {
          candidateType: 'tmc',
          candidateLabel: 'OLT из ТМЦ',
          candidateSource: tmcEvidence.source,
          billingId,
          strictAction: true,
          expectedOnuMac,
          expectedOnuSerial,
          expectedRouterMac,
          sessionRouterMac,
          hypothesisReason: billingSelectedOlts.length
            ? 'явная Billing-OLT не подтвердилась; проверяю фактическую OLT из ТМЦ'
            : (billingFields.olt
              ? 'поле OLT Billing заполнено, но его IP не удалось однозначно сопоставить; проверяю следующий по доверию источник — ТМЦ'
              : 'поле OLT Billing пустое; проверяю следующий по доверию источник — ТМЦ'),
          nextOnFailure: repeatedBillingFallbackOlts.length ? 'слабые кандидаты из повторяющихся ссылок Billing' : 'история MAC',
        });
        if (!active()) return;
        if (confirmed) {
          renderConfirmed(confirmed, 'ONU подтверждена на OLT из ТМЦ.');
          return { confirmed: true, attempt: confirmed, attempts, portContext: buildPortAnalysisContext(ctx, confirmed, tmcEvidence) };
        }
      }

      // Резерв из повторяющихся askolt-ссылок проверяется только после ТМЦ.
      // Он больше не маскируется под «выбранную OLT Billing».
      for (const fallbackOlt of repeatedBillingFallbackOlts) {
        if (fallbackOlt.ip === tmcEvidence.oltIp) continue;
        const confirmed = await tryOltCandidate(fallbackOlt, snapshots, {
          candidateType: 'billing-repeated-fallback',
          candidateLabel: 'резервная OLT из ссылок Billing',
          candidateSource: fallbackOlt.source,
          billingId,
          strictAction: Boolean(fallbackOlt.suggestedAction),
          expectedOnuMac,
          expectedOnuSerial,
          expectedRouterMac,
          sessionRouterMac,
          hypothesisReason: 'явная Billing-OLT и ТМЦ не подтвердились; IP найден в нескольких штатных askolt-ссылках Billing',
          nextOnFailure: 'следующий слабый Billing-кандидат или история MAC',
        });
        if (!active()) return;
        if (confirmed) {
          renderConfirmed(confirmed, 'ONU подтверждена на резервной OLT из повторяющихся ссылок Billing после неуспеха явной Billing-OLT и ТМЦ.');
          return { confirmed: true, attempt: confirmed, attempts, portContext: buildPortAnalysisContext(ctx, confirmed, tmcEvidence) };
        }
      }

      const macHistoryHypothesisIndex = ++hypothesisRuntime.current;
      journalLog('decision', 'Перехожу к последней гипотезе: поиск OLT по истории MAC', {
        hypothesis: `${macHistoryHypothesisIndex}/${hypothesisRuntime.total}`,
        reason: 'предыдущие известные OLT не подтвердили ONU',
        mac: normalizeMacAddress(extractSessionMac(mainDoc) || (juniper && juniper.mac)) || 'не найден',
        route: 'обычная история MAC → при необходимости UPLINK/DOWNLINK → карточка устройства → штатный askolt',
      });
      renderOnuPending('запускаю резервный поиск OLT по MAC…', `гипотеза ${macHistoryHypothesisIndex}/${hypothesisRuntime.total} · Billing ID ${billingId}`);
      const fallbackEvidence = await resolveOltByMacHistory(ctx, mainDoc, juniper, active, 'Billing и ТМЦ не подтвердили OLT');
      if (!active()) return;

      if (fallbackEvidence && fallbackEvidence.oltIp) {
        renderFieldResult('connectionPoint', 'Точка подключения (OLT)', { ok: true, value: fallbackEvidence.oltInfo, source: 'история MAC (резерв)' });
        const fallbackOlt = { ip: fallbackEvidence.oltIp, deviceId: fallbackEvidence.deviceId, deviceName: fallbackEvidence.deviceName, onuInterface: fallbackEvidence.onuInterface, selectedText: fallbackEvidence.oltInfo, suggestedAction: billingTechnologyActionFromEvidence(fallbackEvidence), source: fallbackEvidence.source };
        const confirmed = await tryOltCandidate(fallbackOlt, snapshots, {
          candidateType: 'mac-history',
          candidateLabel: 'OLT из истории MAC',
          candidateSource: fallbackEvidence.source,
          billingId,
          strictAction: true,
          expectedOnuMac,
          expectedOnuSerial,
          expectedRouterMac,
          sessionRouterMac,
          hypothesisIndex: macHistoryHypothesisIndex,
          hypothesisReason: 'OLT найдена по фактическому прохождению сессионного MAC через PON-порт',
          nextOnFailure: 'завершение без подтверждённой OLT',
        });
        if (!active()) return;
        if (confirmed) {
          renderConfirmed(confirmed, 'OLT определена резервным поиском истории MAC и подтверждена опросом.');
          return { confirmed: true, attempt: confirmed, attempts, portContext: buildPortAnalysisContext(ctx, confirmed, tmcEvidence) };
        }
      }

      const best = attempts.find(item => item.result.pending) || attempts[0] || null;
      if (best) {
        renderOnuFailure('Ни одна гипотеза OLT не подтверждена положительным ответом ONU.', best.result.output, { warning: true });
      } else {
        renderOnuFailure('Не удалось сформировать или выполнить ни одной команды опроса OLT.', '', { warning: true });
      }
      return { confirmed: false, attempts };
    } catch (error) {
      if (!active()) return { confirmed: false, stopped: true, attempts };
      journalLog('error', 'Опрос ONU завершился ошибкой', { reason: error.message });
      renderOnuFailure(error.message, '', {});
      return { confirmed: false, error: error.message, attempts };
    }
  }

  function makeSourceCache() {
    const cache = new Map();
    const cacheHitLogged = new Set();
    return (name, urlBuilder, ctx) => {
      if (!cache.has(name)) {
        const url = urlBuilder(ctx);
        cache.set(name, gmRequest(url));
      } else if (!cacheHitLogged.has(name)) {
        cacheHitLogged.add(name);
      }
      return cache.get(name);
    };
  }

  async function resolveField(chain, ctx, fieldLabel = 'поле') {
    for (const step of chain) {
      try {
        const value = await step.get(ctx);
        if (isMeaningful(value)) return { value, source: step.source, ok: true };
      } catch (_) {}
    }
    return { value: null, source: null, ok: false };
  }

  async function resolveCustomerId(contract) {
    const raw = await gmRequest(ENDPOINTS.resolveContract.buildUrl(contract));
    return ENDPOINTS.resolveContract.extractCustomerId(raw);
  }

  const FIELD_DEFINITIONS = [
    {
      key: 'contract', label: 'Договор',
      chain: [{ source: 'основная карточка', get: async (ctx) => {
        const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
        return extractByLeftData(parseHtml(raw), 'Договор:');
      }}],
    },
    {
      key: 'fio', label: 'ФИО',
      chain: [{ source: 'основная карточка', get: async (ctx) => {
        const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
        return extractByLeftData(parseHtml(raw), 'ФИО:');
      }}],
    },
    {
      key: 'address', label: 'Адрес',
      chain: [{ source: 'основная карточка', get: async (ctx) => {
        const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
        return extractByLeftData(parseHtml(raw), 'Адрес:');
      }}],
    },
    {
      key: 'deviceMac', label: 'MAC (tab29/сессия)',
      chain: [
        { source: 'tab29/juniper.php', get: async (ctx) => {
          const raw = await ctx.getSource('tab29', ENDPOINTS.tab29, ctx);
          const p = extractJuniperParams(parseHtml(raw));
          return p && p.mac;
        }},
        { source: 'ТМЦ, активное устройство', get: async (ctx) => {
          const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
          return extractActiveDeviceMac(parseHtml(raw));
        }},
      ],
    },
    {
      key: 'sessionMac', label: 'MAC (сессия)',
      chain: [{ source: 'IP/MAC-адреса', get: async (ctx) => {
        const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
        return extractSessionMac(parseHtml(raw));
      }}],
    },
    {
      key: 'login', label: 'Логин',
      chain: [{ source: 'tab29/juniper.php', get: async (ctx) => {
        const raw = await ctx.getSource('tab29', ENDPOINTS.tab29, ctx);
        const p = extractJuniperParams(parseHtml(raw));
        return p && p.login;
      }}],
    },
    {
      key: 'billingId', label: 'ID в биллинге',
      chain: [{ source: 'tab29/juniper.php → billing_uid', get: async (ctx) => {
        const raw = await ctx.getSource('tab29', ENDPOINTS.tab29, ctx);
        const p = extractJuniperParams(parseHtml(raw));
        const identity = resolveBillingIdentity(p, ctx.contract);
        return identity.billingId;
      }}],
    },
    {
      key: 'connectionPoint', label: 'Точка подключения (OLT)',
      chain: [{ source: 'ТМЦ (PON-кейс)', get: async (ctx) => {
        const raw = await ctx.getSource('main', ENDPOINTS.main, ctx);
        return extractOltInfo(parseHtml(raw));
      }}],
    },
  ];


  /* ==========================================================
     АБОНЕНТЫ ПОДТВЕРЖДЁННОГО PON-ПОРТА

     Источники объединяются по точной позиции ONU:
       1) Billing act=askport — штатный live-опрос порта;
       2) UserSide ONU-list — ONU/SN/status/оптика/причина offline;
       3) UserSide interface_mac_list — MAC/VLAN/владелец/договор.

     Массового открытия карточек абонентов нет. STOP и лимиты запросов
     общие с основной диагностикой.
     ========================================================== */

  function compactVisibleText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizePonInterface(raw) {
    const source = compactVisibleText(raw)
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/\s+/g, '');
    // Поддерживаются как интерфейсы OLT, так и позиции ONU:
    // gpon0/1/5, gpon0/1/5:21 и Billing-форма GPON 0/1/5/21.
    const match = source.match(/(?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,4}(?::\d+)?/i);
    return match ? match[0].toLowerCase() : '';
  }

  function parsePonInterfaceIdentity(raw) {
    const iface = normalizePonInterface(raw);
    if (!iface) return { interface: '', port: '', onuId: '', portType: '', portPath: '' };
    const match = iface.match(/^((?:xgs?pon|xgpon|xpon|gpon|epon|pon))(\d*(?:\/\d+){1,4})(?::(\d+))?$/i);
    if (!match) {
      const split = iface.match(/^(.*?):(\d+)$/);
      return {
        interface: iface,
        port: split ? split[1] : iface,
        onuId: split ? split[2] : '',
        portType: '',
        portPath: '',
      };
    }

    const portType = match[1].toLowerCase();
    const parts = String(match[2] || '').split('/').filter(value => value !== '');
    let onuId = match[3] || '';

    // Huawei Billing может передавать позицию как GPON 0/1/5/21:
    // первые три числа — PON-порт, последнее — ONT ID.
    // Без этого старая логика принимала всю строку за порт.
    if (!onuId && parts.length >= 4) onuId = parts.pop() || '';

    const portPath = parts.join('/');
    const port = portPath ? `${portType}${portPath}` : '';
    const interfaceName = port ? `${port}${onuId ? `:${onuId}` : ''}` : iface;
    return {
      interface: interfaceName,
      port,
      onuId,
      portType,
      portPath,
    };
  }

  function portVendorFromContext(context = {}) {
    const action = String(context.action || '');
    const text = `${context.oltName || ''} ${context.technology || ''} ${context.source || ''}`.toLowerCase();
    if (action === '313' || /huawei/.test(text)) return 'huawei';
    if (/gcom|g[\s_-]*com/.test(text) || action === '312') return 'gcom';
    if (/bdcom|bd[\s_-]*com/.test(text) || ['310', '311'].includes(action)) return 'bdcom';
    return '';
  }

  function normalizedPortContext(context = {}) {
    const parsed = parsePonInterfaceIdentity(context.onuInterface || context.ponPort || '');
    const vendor = portVendorFromContext(context);
    const action = vendor === 'huawei' ? '313' : String(context.action || '');
    return {
      ...context,
      vendor,
      action,
      onuInterface: parsed.interface || context.onuInterface || '',
      ponPort: parsed.port || context.ponPort || '',
      onuId: parsed.onuId || context.onuId || '',
      portType: parsed.portType || context.portType || '',
      portPath: parsed.portPath || context.portPath || '',
    };
  }

  function samePonPort(left, right) {
    const a = parsePonInterfaceIdentity(left).port;
    const b = parsePonInterfaceIdentity(right).port;
    return Boolean(a && b && a === b);
  }

  function setPortAnalysisContext(context) {
    const normalized = normalizedPortContext(context || {});
    portAnalysisRuntime.context = normalized.oltIp && normalized.ponPort ? normalized : null;
    portAnalysisRuntime.result = null;
    portAnalysisRuntime.billingRaw = '';
    updateRunControls();
    renderPortReadyState();
    scheduleWorkspacePersist();
  }

  function buildPortAnalysisContext(ctx, attempt, tmcEvidence) {
    if (!attempt || !attempt.link || !attempt.result) return null;
    const facts = attempt.result.analysis && attempt.result.analysis.facts || {};
    const tmcMatches = Boolean(tmcEvidence && tmcEvidence.oltIp && tmcEvidence.oltIp === attempt.link.oltIp);

    // Позиция из конкретной гипотезы/TMC надёжнее первого PON-подобного
    // фрагмента в сыром выводе Billing. Раньше случайная строка gpon0/1/0
    // могла вытеснить фактическую позицию GPON 0/1/5/21.
    const trustedRawInterface = attempt.meta.candidateInterface
      || (tmcMatches ? tmcEvidence.onuInterface : '')
      || '';
    const trustedParsed = parsePonInterfaceIdentity(trustedRawInterface);
    const factsParsed = parsePonInterfaceIdentity(facts.onuInterface || '');
    const parsed = trustedParsed.interface
      ? {
          ...trustedParsed,
          onuId: trustedParsed.onuId || (trustedParsed.port === factsParsed.port ? factsParsed.onuId : ''),
          interface: trustedParsed.port
            ? `${trustedParsed.port}${trustedParsed.onuId || (trustedParsed.port === factsParsed.port ? factsParsed.onuId : '') ? `:${trustedParsed.onuId || factsParsed.onuId}` : ''}`
            : trustedParsed.interface,
        }
      : factsParsed;
    return {
      contract: ctx.contract,
      customerId: String(ctx.customerId || ''),
      billingId: String(attempt.meta.billingId || ''),
      oltIp: String(attempt.link.oltIp || ''),
      oltId: String(attempt.meta.candidateDeviceId || (tmcMatches ? tmcEvidence.deviceId : '') || ''),
      oltName: compactVisibleText(attempt.meta.candidateDeviceName || (tmcMatches ? tmcEvidence.deviceName : '') || attempt.meta.candidateLabel || ''),
      action: String(attempt.link.action || ''),
      technology: attempt.link.technology && attempt.link.technology.label || '',
      successfulPollUrl: String(attempt.link.url || ''),
      onuInterface: parsed.interface,
      ponPort: parsed.port,
      onuId: parsed.onuId,
      portType: parsed.portType,
      portPath: parsed.portPath,
      expectedOnuMac: String(attempt.meta.expectedOnuMac || ''),
      expectedOnuSerial: String(attempt.meta.expectedOnuSerial || ''),
      expectedRouterMac: normalizeMacAddress(attempt.meta.expectedRouterMac || ''),
      sessionRouterMac: normalizeMacAddress(attempt.meta.sessionRouterMac || ''),
      source: String(attempt.meta.candidateSource || ''),
    };
  }

  function renderPortReadyState() {
    const container = document.querySelector('#dp-port-container');
    if (!container) return;
    const context = portAnalysisRuntime.context;
    if (!context) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="dp-port-block ready">
        <div class="dp-port-head">
          <span class="dp-port-title">Абоненты PON-порта</span>
          <span class="dp-port-state">готово</span>
        </div>
        <div class="dp-port-message">Подтверждена позиция <b>${escapeHtml(context.onuInterface || context.ponPort)}</b> на OLT <b>${escapeHtml(context.oltIp)}</b>. ${context.vendor || context.portType ? `<span class="dp-port-identity">${escapeHtml([context.vendor === 'huawei' ? 'Huawei' : context.vendor ? context.vendor.toUpperCase() : '', context.portType ? context.portType.toUpperCase() : '', context.portPath || ''].filter(Boolean).join(' · '))}</span>. ` : ''}Нажми «Абоненты порта» для live-опроса и сопоставления всех позиций.</div>
      </div>`;
    scheduleWorkspacePersist();
  }

  function renderPortPending(message, detail = '') {
    const container = document.querySelector('#dp-port-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-port-block loading">
        <div class="dp-port-head">
          <span class="dp-port-title">Абоненты PON-порта</span>
          <span class="dp-port-state">сбор…</span>
        </div>
        <div class="dp-port-message">${escapeHtml(message)}${detail ? ` · <i>${escapeHtml(detail)}</i>` : ''}</div>
      </div>`;
    scheduleWorkspacePersist();
  }

  function renderPortFailure(message, details = '') {
    const container = document.querySelector('#dp-port-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-port-block error">
        <div class="dp-port-head">
          <span class="dp-port-title">Абоненты PON-порта</span>
          <span class="dp-port-state">ошибка</span>
        </div>
        <div class="dp-port-message">${escapeHtml(message)}</div>
        ${details ? `<pre class="dp-port-raw-output">${escapeHtml(details)}</pre>` : ''}
      </div>`;
    scheduleWorkspacePersist();
  }

  function parseOnuLinkSummary(rawHtml) {
    const doc = parseHtml(`<div id="dp-onu-link-root">${String(rawHtml || '')}</div>`);
    const root = doc.querySelector('#dp-onu-link-root');
    if (!root) return { customerId: '', onuDeviceId: '', login: '', contract: '', name: '', address: '', ip: '' };
    root.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    root.querySelectorAll('script,style').forEach(node => node.remove());
    const deviceLink = root.querySelector('a[href^="/device/"]');
    const customerLink = root.querySelector('a[href^="/customer/"]');
    const deviceIdMatch = deviceLink && deviceLink.getAttribute('href').match(/\/device\/(\d+)/);
    const customerIdMatch = customerLink && customerLink.getAttribute('href').match(/\/customer\/(\d+)/);
    const rawText = String(root.textContent || '').replace(/\r/g, '');
    const lines = rawText.split(/\n+/).map(compactVisibleText).filter(Boolean);
    const loginIndex = lines.findIndex(line => /\babon\d{3,14}\b/i.test(line));
    const loginMatch = rawText.match(/\babon\d{3,14}\b/i);
    const login = loginMatch ? loginMatch[0].toLowerCase() : '';
    const contract = normalizeAgreement(login);
    const ipMatch = rawText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    let name = '';
    let address = '';
    if (loginIndex >= 0) {
      name = lines[loginIndex].replace(/\s*-?\s*abon\d{3,14}.*$/i, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
      address = lines.slice(loginIndex + 1).find(line => !/^(?:IP|Баланс|тел\.?|Телефон|MAC|Логин)\s*:/i.test(line)) || '';
    }
    return {
      customerId: customerIdMatch ? customerIdMatch[1] : '',
      onuDeviceId: deviceIdMatch ? deviceIdMatch[1] : '',
      login,
      contract,
      name,
      address,
      ip: ipMatch ? ipMatch[0] : '',
      rawText: compactVisibleText(rawText),
    };
  }

  function portStatusFromOnu(raw) {
    if (Number(raw && raw.ifaceState) === 1) return 'online';
    if (Number(raw && raw.ifaceState) === 0) return 'offline';
    if (raw && (raw.reason_offline || raw.reason_offline_type)) return 'offline';
    return 'unknown';
  }

  function parseOnuListPayload(rawText, targetPort = '') {
    const source = String(rawText || '').replace(/^\uFEFF/, '').trim();
    if (!source) throw new Error('ONU endpoint вернул пустой ответ');
    if (/^<!doctype\s+html|^<html\b/i.test(source)) {
      throw new Error('получена HTML-страница вместо JSON endpoint /device/reload_device_onu_data');
    }

    let payload;
    try { payload = JSON.parse(source); }
    catch (error) { throw new Error(`ONU endpoint вернул некорректный JSON: ${error.message}`); }
    if (!payload || payload.result !== 'OK' || !Array.isArray(payload.data)) {
      throw new Error(`ONU endpoint: result=${payload && payload.result || 'unknown'}, data[] отсутствует`);
    }

    const allRows = payload.data.map(raw => {
      const iface = parsePonInterfaceIdentity(raw && raw.ifaceName);
      const owner = parseOnuLinkSummary(raw && raw.onuLink);
      const rx = Number.parseFloat(raw && raw.level);
      const tx = Number.parseFloat(raw && raw.level_onu_tx);
      const oltRx = Number.parseFloat(raw && raw.level_olt_rx);
      return {
        iface: iface.interface,
        port: iface.port,
        onuId: iface.onuId || String(raw && raw.nr || ''),
        status: portStatusFromOnu(raw),
        reasonOffline: compactVisibleText(raw && (raw.reason_offline || raw.reason_offline_type)),
        serial: compactVisibleText(raw && (raw.idFirst || raw.idSecond)),
        serial2: compactVisibleText(raw && raw.idSecond),
        vendor: compactVisibleText(raw && raw.vendor),
        model: compactVisibleText(raw && raw.model),
        firmware: compactVisibleText(raw && raw.firmware),
        distance: Number.isFinite(Number(raw && raw.distance)) ? Number(raw.distance) : null,
        rxDbm: Number.isFinite(rx) ? rx : null,
        txDbm: Number.isFinite(tx) ? tx : null,
        oltRxDbm: Number.isFinite(oltRx) ? oltRx : null,
        badLevel: Boolean(raw && raw.isBadLevel),
        levelMin: Number.isFinite(Number(raw && raw.levelNeedMin)) ? Number(raw.levelNeedMin) : null,
        levelMax: Number.isFinite(Number(raw && raw.levelNeedMax)) ? Number(raw.levelNeedMax) : null,
        onuDeviceId: String(raw && raw.onuDeviceId || owner.onuDeviceId || ''),
        customerId: owner.customerId,
        login: owner.login,
        contract: owner.contract,
        name: owner.name,
        address: owner.address,
        ip: owner.ip,
        raw,
      };
    });
    const port = parsePonInterfaceIdentity(targetPort).port;
    return {
      rows: port ? allRows.filter(row => row.port === port) : allRows,
      allRows,
      rawCount: allRows.length,
      taskId: String(payload.task_id || ''),
      finished: payload.isFinishLoadData === true,
      result: String(payload.result || ''),
    };
  }

  function buildOnuReloadUrl(oltId, options = {}) {
    const query = new URLSearchParams({
      if_indexes: String(options.ifIndexes || ''),
      idx: 'onu_list',
      page: String(options.page || 1),
      sort: String(options.sort === undefined ? 'pon_port_hash' : options.sort),
      sort_typer: String(options.sortTyper || ''),
      desc: String(options.desc === undefined ? '0' : options.desc),
      pon_iface: String(options.ponIface === undefined ? '0' : options.ponIface),
      iface_olt_number: String(options.ifaceOltNumber === undefined ? '' : options.ifaceOltNumber),
      id: String(oltId || ''),
      task_id: String(options.taskId || ''),
      additional_option: String(options.additionalOption || ''),
    });
    return `${BASE}/device/reload_device_onu_data?${query.toString()}`;
  }

  function ponPortFromInterfaceRow(row) {
    if (!row) return '';
    const preferred = [...row.querySelectorAll('[id^="ifDescr"], [id*="ifDescr"]')];
    const sources = [...preferred, row];
    for (const node of sources) {
      const text = String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
      const named = text.match(/\bName\s*:\s*((?:xgs?pon|xgpon|xpon|gpon|epon|pon)\s*\d*(?:\s*\/\s*\d+){1,3})/i);
      const parsed = parsePonInterfaceIdentity(named ? named[1] : text);
      if (parsed.port) return parsed.port;
    }
    return '';
  }

  function parsePonPortRoutes(doc) {
    const routes = new Map();
    const add = (rawPort, candidate = {}) => {
      const port = parsePonInterfaceIdentity(rawPort).port;
      if (!port) return;
      const previous = routes.get(port) || {
        port,
        ifIndex: '',
        ponIface: '',
        ifaceOltNumber: '',
        directOnuUrl: '',
        source: '',
      };
      const merged = { ...previous };
      for (const key of ['ifIndex', 'ponIface', 'ifaceOltNumber', 'directOnuUrl', 'source']) {
        if (!merged[key] && candidate[key]) merged[key] = String(candidate[key]);
      }
      if (!merged.ifIndex) merged.ifIndex = merged.ponIface || merged.ifaceOltNumber || '';
      routes.set(port, merged);
    };

    // Обычные страницы MAC-интерфейсов.
    for (const link of doc.querySelectorAll('a[href*="interface_mac_list"][href*="if_index="]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), BASE); } catch (_) { continue; }
      const row = link.closest('.item[class*="ifaceRow-"], tr, .item');
      const port = parsePonInterfaceIdentity(link.textContent).port || ponPortFromInterfaceRow(row);
      add(port, {
        ifIndex: url.searchParams.get('if_index') || '',
        source: 'interface_mac_list',
      });
    }

    // Huawei и часть других OLT публикуют готовый маршрут ONU прямо в строке
    // PON-порта карточки устройства. Это основной источник при отсутствии
    // if_index в общем MAC-списке.
    for (const link of doc.querySelectorAll('a[href*="/device/device_onu_list"][href*="pon_iface="]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), BASE); } catch (_) { continue; }
      const row = link.closest('.item[class*="ifaceRow-"], .item');
      const port = ponPortFromInterfaceRow(row);
      add(port, {
        ponIface: url.searchParams.get('pon_iface') || '',
        ifaceOltNumber: url.searchParams.get('iface_olt_number') || '',
        directOnuUrl: url.toString(),
        source: 'device_onu_list',
      });
    }

    // Последний UserSide-резерв: тот же индекс находится во встроенной
    // команде включения/выключения конкретного PON-порта.
    for (const link of doc.querySelectorAll('a[href*="change_port_status("]')) {
      const href = String(link.getAttribute('href') || '');
      const match = href.match(/change_port_status\s*\(\s*\d+\s*,\s*(\d+)/i);
      if (!match) continue;
      const row = link.closest('.item[class*="ifaceRow-"], .item');
      add(ponPortFromInterfaceRow(row), {
        ifIndex: match[1],
        source: 'change_port_status',
      });
    }

    return routes;
  }

  function parseInterfaceMap(doc) {
    return new Map([...parsePonPortRoutes(doc)].map(([port, route]) => [port, route.ifIndex || route.ponIface || route.ifaceOltNumber || '']));
  }

  async function resolveUserSidePonPortRoute(context, initialDoc, active) {
    const target = parsePonInterfaceIdentity(context && context.ponPort).port;
    let routes = parsePonPortRoutes(initialDoc);
    if (routes.has(target)) return { route: routes.get(target), discoveredPorts: [...routes.keys()], source: 'interface_mac_list' };

    if (!context || !context.oltId || !active()) {
      return { route: null, discoveredPorts: [...routes.keys()], source: '' };
    }

    const cardUrl = `${BASE}/device/${encodeURIComponent(context.oltId)}`;
    const cardRaw = await gmRequest(cardUrl, 'GET', 30000);
    if (!active()) return { route: null, discoveredPorts: [...routes.keys()], source: '' };
    const cardRoutes = parsePonPortRoutes(parseHtml(cardRaw));
    for (const [port, route] of cardRoutes) routes.set(port, route);
    const resolved = routes.get(target) || null;
    journalLog(resolved ? 'ok' : 'warn', 'Карта PON-портов карточки OLT обработана', {
      targetPort: target,
      found: resolved ? `${resolved.source} · ${resolved.ifIndex || resolved.ponIface || resolved.ifaceOltNumber}` : 'нет',
      discovered: [...routes.keys()].slice(0, 80),
      cardUrl,
    });
    return { route: resolved, discoveredPorts: [...routes.keys()], source: resolved && resolved.source || '' };
  }

  function parseOwnerInfoCell(cell) {
    if (!cell) return { customerId: '', login: '', contract: '', name: '', address: '', ip: '' };
    const link = cell.querySelector('a[href^="/customer/"]');
    const customerIdMatch = link && link.getAttribute('href').match(/\/customer\/(\d+)/);
    const html = link ? link.innerHTML : cell.innerHTML;
    const summary = parseOnuLinkSummary(`${html || ''}${link ? `<a href="${link.getAttribute('href')}"></a>` : ''}`);
    return { ...summary, customerId: customerIdMatch ? customerIdMatch[1] : summary.customerId };
  }

  function parseInterfaceMacRows(doc, targetPort = '') {
    const target = parsePonInterfaceIdentity(targetPort).port;
    const rows = [];
    for (const row of doc.querySelectorAll('#tableListData tr.table_item')) {
      const iface = parsePonInterfaceIdentity(textFromRowCell(row, '_if_name_Id'));
      if (!iface.interface || (target && iface.port !== target)) continue;
      const mac = normalizeMacAddress(textFromRowCell(row, '_mac_Id'));
      if (!mac) continue;
      const ownerCell = row.querySelector('[id$="_owner_info_Id"]');
      const owner = parseOwnerInfoCell(ownerCell);
      rows.push({
        iface: iface.interface,
        port: iface.port,
        onuId: iface.onuId,
        vlan: compactVisibleText(textFromRowCell(row, '_vid_Id')),
        mac,
        firstSeen: compactVisibleText(textFromRowCell(row, '_datefirst_Id')),
        lastSeen: compactVisibleText(textFromRowCell(row, '_datelast_Id')),
        ...owner,
      });
    }
    return rows;
  }

  function buildPortAskUrl(context) {
    if (!context || !context.successfulPollUrl) return '';
    try {
      const normalized = normalizedPortContext(context);
      const url = new URL(normalized.successfulPollUrl, BILLING_BASE);
      url.searchParams.set('act', 'askport');
      // Производитель и тип порта — разные оси. Huawei EPON остаётся в a=313,
      // а EPON используется только как тип интерфейса epon0/2/15.
      if (normalized.vendor === 'huawei' || normalized.action === '313') {
        url.searchParams.set('a', '313');
      } else if (['310', '311', '312'].includes(normalized.action)) {
        url.searchParams.set('a', normalized.action);
      }
      return url.toString();
    } catch (_) { return ''; }
  }

  function parseBillingPortEvidence(rawText, targetPort) {
    const target = parsePonInterfaceIdentity(targetPort).port;
    const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const relevant = [];
    const seen = new Set();
    for (const line of lines) {
      const matches = line.match(/(?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3}(?::\d+)?/ig) || [];
      if (!matches.some(value => !target || parsePonInterfaceIdentity(value).port === target)) continue;
      const compact = compactVisibleText(line);
      if (!compact || seen.has(compact)) continue;
      seen.add(compact);
      relevant.push(compact);
    }
    return relevant.slice(0, 250);
  }

  function billingPortNumber(raw) {
    const value = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!value || value === '-') return null;
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) ? number : null;
  }

  function parseBillingPortStructuredRows(rawText, targetPort = '') {
    const rows = new Map();
    const ensure = rawId => {
      const onuId = String(rawId || '').trim();
      if (!onuId) return null;
      if (!rows.has(onuId)) {
        rows.set(onuId, {
          onuId,
          status: '',
          lastUpTime: '',
          lastDownTime: '',
          downCause: '',
          serial: '',
          onuType: '',
          distance: null,
          rxDbm: null,
          txDbm: null,
          oltRxDbm: null,
          description: '',
          serviceState: '',
          serviceVlan: '',
          userVlan: '',
          serviceIndex: '',
        });
      }
      return rows.get(onuId);
    };

    let section = '';
    const lines = String(rawText || '').replace(/\r/g, '').split('\n');
    for (const sourceLine of lines) {
      const line = String(sourceLine || '');
      const compact = line.replace(/\s+$/g, '');
      if (/^\s*ONT\s+Run\s+Last\s+Last\s+Last/i.test(compact)) { section = 'state'; continue; }
      if (/^\s*ONT\s+SN\s+Type\s+Distance\s+Rx\/Tx\s+power/i.test(compact)) { section = 'identity'; continue; }
      if (/^\s*Switch-Oriented\s+Flow\s+List/i.test(compact)) { section = 'service'; continue; }
      if (/^\s*ONT\s+Rx\s+power\s+Tx\s+power\s+OLT\s+Rx/i.test(compact)) { section = 'optics'; continue; }
      if (/^\s*Port Information\b/i.test(compact) || /^\s*Optical Module State\b/i.test(compact)) section = '';
      if (!section || /^\s*-{5,}\s*$/.test(compact) || /^\s*(?:Total|In port)\b/i.test(compact)) continue;

      if (section === 'state') {
        const match = compact.match(/^\s*(\d+)\s+(online|offline)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|-)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|-)\s*(.*?)\s*$/i);
        if (!match) continue;
        const row = ensure(match[1]);
        row.status = match[2].toLowerCase();
        row.lastUpTime = match[3] === '-' ? '' : match[3];
        row.lastDownTime = match[4] === '-' ? '' : match[4];
        row.downCause = match[5] && match[5] !== '-' ? match[5].trim() : '';
        continue;
      }

      if (section === 'identity') {
        const match = compact.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\d+|-)\s+(-?\d+(?:[.,]\d+)?|-)\s*\/\s*(-?\d+(?:[.,]\d+)?|-)\s*(.*?)\s*$/i);
        if (!match) continue;
        const row = ensure(match[1]);
        row.serial = match[2] === '-' ? '' : match[2];
        row.onuType = match[3] === '-' ? '' : match[3];
        row.distance = billingPortNumber(match[4]);
        row.rxDbm = billingPortNumber(match[5]);
        row.txDbm = billingPortNumber(match[6]);
        row.description = String(match[7] || '').trim();
        continue;
      }

      if (section === 'optics') {
        const match = compact.match(/^\s*(\d+)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(\d+)\s*$/);
        if (!match) continue;
        const row = ensure(match[1]);
        row.rxDbm = billingPortNumber(match[2]);
        row.txDbm = billingPortNumber(match[3]);
        row.oltRxDbm = billingPortNumber(match[4]);
        row.distance = billingPortNumber(match[8]);
        continue;
      }

      if (section === 'service') {
        const match = compact.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+((?:xgs?pon|xgpon|xpon|gpon|epon|pon))\s+(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+.*?\s+(up|down)\s*$/i);
        if (!match) continue;
        const row = ensure(match[8]);
        row.serviceIndex = match[1];
        row.serviceVlan = match[2];
        row.userVlan = match[11];
        row.serviceState = match[12].toLowerCase();
      }
    }

    const port = parsePonInterfaceIdentity(targetPort).port;
    return [...rows.values()].map(row => ({
      ...row,
      iface: port ? `${port}:${row.onuId}` : '',
    })).sort((a, b) => Number(a.onuId) - Number(b.onuId));
  }

  function emptyMergedPortRow(context, billingRow) {
    const iface = billingRow.iface || `${context.ponPort}:${billingRow.onuId}`;
    return {
      iface,
      ...parsePonInterfaceIdentity(iface),
      status: 'unknown',
      reasonOffline: '', serial: '', serial2: '', vendor: '', model: '', firmware: '', distance: null,
      rxDbm: null, txDbm: null, oltRxDbm: null, badLevel: false, levelMin: null, levelMax: null,
      onuDeviceId: '', customerId: '', login: '', contract: '', name: '', address: '', ip: '',
      routerMacs: [], vlans: [], firstSeen: '', lastSeen: '', lastSeenAt: 0, macAgeMs: null,
      macFresh: false, macRows: [], conflict: false,
      current: Boolean(context.onuId && String(context.onuId) === String(billingRow.onuId)),
    };
  }

  function mergeBillingPortStructuredRows(rows, billingRows, context) {
    const byId = new Map((rows || []).map(row => [String(row.onuId || ''), row]));
    for (const billingRow of billingRows || []) {
      const onuId = String(billingRow.onuId || '');
      if (!onuId) continue;
      const base = byId.get(onuId) || emptyMergedPortRow(context, billingRow);
      byId.set(onuId, {
        ...base,
        iface: base.iface || billingRow.iface || `${context.ponPort}:${onuId}`,
        onuId,
        status: billingRow.status || base.status || 'unknown',
        reasonOffline: billingRow.downCause || base.reasonOffline || '',
        serial: billingRow.serial || base.serial || '',
        distance: billingRow.distance !== null ? billingRow.distance : base.distance,
        rxDbm: billingRow.rxDbm !== null ? billingRow.rxDbm : base.rxDbm,
        txDbm: billingRow.txDbm !== null ? billingRow.txDbm : base.txDbm,
        oltRxDbm: billingRow.oltRxDbm !== null ? billingRow.oltRxDbm : base.oltRxDbm,
        lastUpTime: billingRow.lastUpTime || base.lastUpTime || '',
        lastDownTime: billingRow.lastDownTime || base.lastDownTime || '',
        downCause: billingRow.downCause || base.downCause || base.reasonOffline || '',
        onuType: billingRow.onuType || base.onuType || base.model || '',
        description: billingRow.description || base.description || '',
        serviceState: billingRow.serviceState || base.serviceState || '',
        serviceVlan: billingRow.serviceVlan || base.serviceVlan || '',
        userVlan: billingRow.userVlan || base.userVlan || '',
        serviceIndex: billingRow.serviceIndex || base.serviceIndex || '',
        billingPortRow: billingRow,
      });
    }
    return [...byId.values()].sort((a, b) => Number(a.onuId || 99999) - Number(b.onuId || 99999));
  }

  function compactPortStreet(rawAddress) {
    const text = String(rawAddress || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const parts = text.split(/\s*,\s*/).filter(Boolean);
    const streetIndex = parts.findIndex(part => /\b(?:вул\.?|ул\.?|просп\.?|проспект|пр-т|пров\.?|пер\.?|переулок|бульв\.?|бул\.?|шосе|шоссе|наб\.?|набережн)/i.test(part));
    if (streetIndex >= 0) {
      const selected = [parts[streetIndex]];
      if (parts[streetIndex + 1] && /\d/.test(parts[streetIndex + 1]) && !/(?:кв\.?|квартира|офис|офіс)/i.test(parts[streetIndex + 1])) selected.push(parts[streetIndex + 1]);
      return selected.join(', ');
    }
    return parts.slice(0, 2).join(', ') || text;
  }

  function portStreetKey(rawAddress) {
    return compactPortStreet(rawAddress)
      .toLowerCase()
      .replace(/\b(?:буд\.?|дом|д\.?|№)\s*\d+[а-яa-z\/-]*/gi, ' ')
      .replace(/\b\d+[а-яa-z\/-]*\b/gi, ' ')
      .replace(/[^a-zа-яёіїєґ0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildApproximatePortRoute(rows) {
    const points = (rows || []).filter(row => Number.isFinite(Number(row.distance)))
      .map(row => ({
        onuId: String(row.onuId || ''),
        distance: Number(row.distance),
        contract: row.login || (row.contract ? `abon${row.contract}` : ''),
        street: compactPortStreet(row.address),
        streetKey: portStreetKey(row.address),
        status: row.status,
      }))
      .sort((a, b) => a.distance - b.distance || Number(a.onuId) - Number(b.onuId));
    if (!points.length) return { points: [], groups: [], confidence: 'нет дистанций' };

    const groups = [];
    for (const point of points) {
      const current = groups[groups.length - 1];
      const previous = current && current.points[current.points.length - 1];
      const gap = previous ? point.distance - previous.distance : Infinity;
      const sameStreet = Boolean(point.streetKey && current && current.streetKeys.has(point.streetKey));
      const compatible = current && (gap <= 70 || (sameStreet && gap <= 220));
      if (!compatible) {
        groups.push({ id: groups.length + 1, points: [point], streetKeys: new Set(point.streetKey ? [point.streetKey] : []) });
      } else {
        current.points.push(point);
        if (point.streetKey) current.streetKeys.add(point.streetKey);
      }
    }

    return {
      points,
      groups: groups.map(group => {
        const distances = group.points.map(point => point.distance);
        const streets = [...new Set(group.points.map(point => point.street).filter(Boolean))];
        return {
          id: group.id,
          minDistance: Math.min(...distances),
          maxDistance: Math.max(...distances),
          streets,
          points: group.points,
        };
      }),
      confidence: points.filter(point => point.street).length >= Math.max(3, Math.ceil(points.length * 0.6))
        ? 'средняя для группировки, низкая для физической топологии'
        : 'низкая: мало адресов',
    };
  }

  function portRouteHypothesisHtml(rows) {
    const route = buildApproximatePortRoute(rows);
    if (!route.points.length) return '';
    return `
      <details class="dp-port-route">
        <summary>Предполагаемые группы трассы по дистанции и улицам</summary>
        <div class="dp-port-route-warning">Это гипотеза для навигации, а не подтверждённая схема. PON является разветвлённой пассивной сетью: близкая дистанция помогает сгруппировать ONU, но не доказывает, что одна ONU находится «после» другой.</div>
        <div class="dp-port-route-groups">
          ${route.groups.map(group => `
            <div class="dp-port-route-group">
              <div><b>Группа ${escapeHtml(group.id)}</b> · ${escapeHtml(group.minDistance === group.maxDistance ? `${group.minDistance} м` : `${group.minDistance}–${group.maxDistance} м`)}</div>
              <div class="dp-port-route-streets">${escapeHtml(group.streets.length ? group.streets.join(' · ') : 'улица не определена')}</div>
              <div class="dp-port-route-members">${group.points.map(point => `${point.contract || `ONT ${point.onuId}`} (${point.distance} м)`).map(escapeHtml).join(' · ')}</div>
            </div>`).join('')}
        </div>
        <div class="dp-port-route-confidence">Достоверность: ${escapeHtml(route.confidence)}. Для реальной схемы нужны данные о муфтах, делителях, опорах и фактических трассах.</div>
      </details>`;
  }

  async function requestBillingPortPoll(context, active) {
    const url = buildPortAskUrl(context);
    if (!url) return { ok: false, raw: '', evidence: [], error: 'не удалось построить штатную ссылку act=askport' };
    if (!active()) return { ok: false, stopped: true, raw: '', evidence: [] };
    consumeDiagnosticBudget('onuPolls', 'ONU/port-опросов');
    journalLog('decision', 'Запускаю штатный опрос PON-порта в Billing', {
      oltIp: context.oltIp,
      ponPort: context.ponPort,
      technology: `${context.technology || '?'} [a=${context.action || '?'}]`,
      url,
    });
    try {
      const response = await gmPageRequest(url, 60000);
      if (!active()) return { ok: false, stopped: true, raw: '', evidence: [] };
      const doc = parseHtml(response.text);
      const raw = extractOnuPollRawOutput(doc) || readableText(doc.body);
      const evidence = parseBillingPortEvidence(raw, context.ponPort);
      const structuredRows = parseBillingPortStructuredRows(raw, context.ponPort);
      return { ok: true, raw: String(raw || ''), evidence, structuredRows, url: response.finalUrl };
    } catch (error) {
      journalLog('warn', 'Штатный опрос PON-порта Billing не получен', { reason: error.message || String(error) });
      return { ok: false, raw: '', evidence: [], error: error.message || String(error), url };
    }
  }

  function extractLinkedPonDeviceCandidates(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    const seen = new Set();
    const candidates = [];
    for (const anchor of doc.querySelectorAll('a[href*="/device/"]')) {
      const deviceId = extractDeviceIdFromHref(anchor.getAttribute('href') || '');
      if (!deviceId || seen.has(deviceId)) continue;
      const contextNode = anchor.closest('tr.table_item, tr, .item, td, div') || anchor.parentElement;
      const contextText = String(contextNode && contextNode.textContent || anchor.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1600);
      const anchorText = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
      let score = 0;
      if (/PON|GPON|EPON|XPON|ONU|ONT|оптичес|серийн|Найдено\s+на\s+OLT/i.test(contextText)) score += 100;
      if (/ONU|ONT|FoxGate|XPON/i.test(anchorText)) score += 60;
      if (/OLT|Huawei|MA\d{3,5}|BDCOM|GCOM|ZTE/i.test(anchorText)) score += 90;
      if (!score) continue;
      seen.add(deviceId);
      candidates.push({ deviceId, name: anchorText, contextText, score });
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function currentPageOltDeviceId(context) {
    if (location.hostname !== 'userside.simnet.kiev.ua') return '';
    const pathMatch = location.pathname.match(/^\/device\/(\d+)/);
    if (!pathMatch) return '';
    const currentId = pathMatch[1];
    const hasMacInterfaceRoute = Boolean(document.querySelector(`a[href*="interface_mac_list?id=${currentId}"], a[href*="interface_mac_list"][href*="id=${currentId}"]`));
    if (!hasMacInterfaceRoute) return '';
    const pageIp = extractDeviceManagementIp(document);
    return !context.oltIp || pageIp === context.oltIp ? currentId : '';
  }

  async function resolvePortOltIdentity(context, active) {
    if (context.oltId) return context;
    renderPortPending('восстанавливаю UserSide deviceId подтверждённой OLT…', context.oltIp);

    const currentOltId = currentPageOltDeviceId(context);
    if (currentOltId) {
      journalLog('ok', 'deviceId OLT взят из открытой карточки UserSide', {
        oltIp: context.oltIp,
        deviceId: currentOltId,
      });
      return { ...context, oltId: currentOltId };
    }

    const pageEvidence = location.hostname === 'userside.simnet.kiev.ua'
      ? extractOltEvidence(document)
      : null;
    if (pageEvidence && pageEvidence.deviceId && (!context.oltIp || pageEvidence.ip === context.oltIp)) {
      journalLog('ok', 'deviceId OLT извлечён из текущей страницы UserSide', {
        oltIp: pageEvidence.ip,
        deviceId: pageEvidence.deviceId,
        device: pageEvidence.deviceName,
      });
      return {
        ...context,
        oltId: pageEvidence.deviceId,
        oltName: pageEvidence.deviceName || context.oltName,
        onuInterface: context.onuInterface || pageEvidence.onuInterface,
        ponPort: context.ponPort || pageEvidence.ponPort,
        onuId: context.onuId || pageEvidence.onuId,
      };
    }

    const ctx = { contract: context.contract, customerId: context.customerId, getSource: makeSourceCache() };
    const mainRaw = await gmRequest(ENDPOINTS.main(ctx));
    if (!active()) return context;
    const mainDoc = parseHtml(mainRaw);
    const direct = extractOltEvidence(mainDoc);
    if (direct && direct.deviceId && (!context.oltIp || direct.ip === context.oltIp)) {
      journalLog('ok', 'deviceId OLT извлечён из ТМЦ основной карточки', {
        oltIp: direct.ip,
        deviceId: direct.deviceId,
        device: direct.deviceName,
      });
      return {
        ...context,
        oltId: direct.deviceId,
        oltName: direct.deviceName || context.oltName,
        onuInterface: context.onuInterface || direct.onuInterface,
        ponPort: context.ponPort || direct.ponPort,
        onuId: context.onuId || direct.onuId,
      };
    }

    // Иногда основная карточка содержит только ссылку на ONU, а строка
    // «Найдено на OLT» находится уже в карточке этой ONU. Открываем только
    // несколько наиболее вероятных PON-устройств, без массового обхода.
    const linkedDevices = extractLinkedPonDeviceCandidates(mainDoc);
    journalLog('info', 'Проверяю связанные PON-устройства для поиска OLT deviceId', {
      oltIp: context.oltIp,
      candidates: linkedDevices.map(item => `${item.deviceId}:${item.name || 'устройство'}`),
      limit: Math.min(linkedDevices.length, 6),
    });
    for (const linked of linkedDevices.slice(0, 6)) {
      if (!active()) return context;
      try {
        const deviceRaw = await gmRequest(`${BASE}/device/${encodeURIComponent(linked.deviceId)}`);
        const evidence = extractOltEvidence(parseHtml(deviceRaw));
        if (!evidence || !evidence.deviceId) continue;
        if (context.oltIp && evidence.ip !== context.oltIp) continue;
        journalLog('ok', 'OLT deviceId найден через карточку связанной ONU', {
          onuDeviceId: linked.deviceId,
          oltIp: evidence.ip,
          oltDeviceId: evidence.deviceId,
          olt: evidence.deviceName,
        });
        return {
          ...context,
          oltId: evidence.deviceId,
          oltName: evidence.deviceName || context.oltName,
          onuInterface: context.onuInterface || evidence.onuInterface,
          ponPort: context.ponPort || evidence.ponPort,
          onuId: context.onuId || evidence.onuId,
        };
      } catch (error) {
        journalLog('debug', 'Карточка связанного PON-устройства не дала OLT', {
          deviceId: linked.deviceId,
          reason: error && error.message || String(error),
        });
      }
    }

    const sessionMac = normalizeMacAddress(context.sessionRouterMac || extractSessionMac(mainDoc));
    if (!sessionMac) {
      journalLog('warn', 'Не удалось перейти к истории MAC для поиска OLT deviceId', {
        reason: 'сессионный MAC не найден',
        oltIp: context.oltIp,
      });
      return context;
    }
    const historyRaw = await gmRequest(ENDPOINTS.macHistory({ mac: sessionMac }));
    if (!active()) return context;
    const candidates = extractMacHistoryCandidates(parseHtml(historyRaw))
      .filter(candidate => candidate.deviceId && candidate.ponPort)
      .sort((a, b) => {
        const aPort = samePonPort(a.iface, context.ponPort) ? 1 : 0;
        const bPort = samePonPort(b.iface, context.ponPort) ? 1 : 0;
        return bPort - aPort || b.score - a.score;
      });

    for (const candidate of candidates.slice(0, 6)) {
      if (!active()) return context;
      try {
        const deviceRaw = await gmRequest(`${BASE}/device/${encodeURIComponent(candidate.deviceId)}`);
        const ip = extractDeviceManagementIp(parseHtml(deviceRaw));
        if (context.oltIp && ip !== context.oltIp) continue;
        const parsed = parsePonInterfaceIdentity(context.onuInterface || candidate.iface);
        journalLog('ok', 'OLT deviceId подтверждён через историю MAC', {
          oltIp: ip,
          deviceId: candidate.deviceId,
          device: candidate.deviceName,
          port: candidate.iface,
        });
        return {
          ...context,
          oltId: candidate.deviceId,
          oltName: candidate.deviceName || context.oltName,
          onuInterface: parsed.interface,
          ponPort: parsed.port,
          onuId: parsed.onuId || context.onuId,
        };
      } catch (_) {}
    }
    return context;
  }

  async function fetchPortOnuRows(oltId, routeOrIfIndex, targetPort, active) {
    const target = parsePonInterfaceIdentity(targetPort).port;
    const route = routeOrIfIndex && typeof routeOrIfIndex === 'object'
      ? routeOrIfIndex
      : { ifIndex: String(routeOrIfIndex || ''), ponIface: '', ifaceOltNumber: '' };
    const filterIndex = String(route.ifIndex || route.ponIface || route.ifaceOltNumber || '');

    // Страница /device/{id}/device_poller_data является HTML-оболочкой.
    // Сами строки ONU UserSide получает отдельным AJAX-запросом в JSON endpoint.
    if (filterIndex) {
      const filteredUrl = buildOnuReloadUrl(oltId, {
        page: 1,
        ifIndexes: filterIndex,
        sort: 'pon_port_hash',
        desc: '0',
        ponIface: route.ponIface || filterIndex,
        ifaceOltNumber: route.ifaceOltNumber || route.ponIface || filterIndex,
      });
      try {
        const raw = await gmRequest(filteredUrl, 'GET', 30000);
        const parsed = parseOnuListPayload(raw, target);
        journalLog(parsed.rows.length ? 'ok' : 'info', 'Фильтрованный JSON ONU-list обработан', {
          targetPort: target,
          ifIndex: filterIndex,
          routeSource: route.source || 'не указан',
          directOnuUrl: route.directOnuUrl || '',
          endpointRows: parsed.rawCount,
          matchedRows: parsed.rows.length,
          endpoint: filteredUrl,
        });
        if (parsed.rows.length) return parsed.rows;
      } catch (error) {
        journalLog('warn', 'Фильтрованный JSON ONU-list не дал результата', {
          targetPort: target,
          ifIndex: filterIndex,
          routeSource: route.source || 'не указан',
          reason: error.message || String(error),
          next: 'постраничный JSON-обход OLT',
        });
      }
    }

    const collected = new Map();
    let targetSeen = false;
    let emptyAfterTarget = 0;
    const seenPageFingerprints = new Set();

    for (let page = 1; page <= 8; page += 1) {
      if (!active()) break;
      const url = buildOnuReloadUrl(oltId, {
        page,
        ifIndexes: '',
        sort: 'pon_port_hash',
        desc: '0',
        ponIface: '0',
        ifaceOltNumber: '0',
      });
      const raw = await gmRequest(url, 'GET', 30000);
      const parsed = parseOnuListPayload(raw, target);
      const fingerprint = `${parsed.rawCount}|${parsed.allRows[0] && parsed.allRows[0].iface || ''}|${parsed.allRows.at(-1) && parsed.allRows.at(-1).iface || ''}`;
      if (seenPageFingerprints.has(fingerprint)) {
        journalLog('warn', 'Постраничный ONU endpoint повторил предыдущую страницу', { page, fingerprint });
        break;
      }
      seenPageFingerprints.add(fingerprint);

      journalLog('info', 'Страница JSON ONU-list обработана', {
        page,
        endpointRows: parsed.rawCount,
        matchedRows: parsed.rows.length,
        targetPort: target,
      });

      if (parsed.rows.length) {
        targetSeen = true;
        emptyAfterTarget = 0;
        for (const row of parsed.rows) collected.set(row.iface || `${row.port}:${row.onuId}`, row);
      } else if (targetSeen) {
        emptyAfterTarget += 1;
        if (emptyAfterTarget >= 1) break;
      }

      // Пустая страница означает конец пагинации. До нахождения нужного порта
      // продолжаем, потому что он может находиться на следующих страницах.
      if (!parsed.rawCount) break;
    }
    return [...collected.values()];
  }

  function parseUserSideTimestamp(raw) {
    const match = String(raw || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return 0;
    const value = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6] || 0)).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function latestMacTimestamp(rows) {
    return Math.max(0, ...rows.map(row => parseUserSideTimestamp(row.lastSeen)).filter(Boolean));
  }

  function identitiesConflict(onu, macRows) {
    const ownerRows = macRows.filter(row => row.customerId || row.login);
    if (!ownerRows.length || (!onu.customerId && !onu.login)) return false;
    return ownerRows.some(row => {
      if (onu.customerId && row.customerId) return String(onu.customerId) !== String(row.customerId);
      if (onu.login && row.login) return onu.login.toLowerCase() !== row.login.toLowerCase();
      return false;
    });
  }

  function mergePortSubscribers(onuRows, macRows, context) {
    const onuByIface = new Map(onuRows.map(row => [row.iface, row]));
    const macByIface = new Map();
    for (const row of macRows) {
      if (!macByIface.has(row.iface)) macByIface.set(row.iface, []);
      macByIface.get(row.iface).push(row);
    }
    const keys = new Set([...onuByIface.keys(), ...macByIface.keys()]);
    const currentLogin = normalizeSubscriberLogin(context.contract);
    const merged = [...keys].map(iface => {
      const onu = onuByIface.get(iface) || {
        iface,
        ...parsePonInterfaceIdentity(iface),
        status: 'unknown',
        reasonOffline: '', serial: '', serial2: '', vendor: '', model: '', firmware: '', distance: null,
        rxDbm: null, txDbm: null, oltRxDbm: null, badLevel: false, levelMin: null, levelMax: null,
        onuDeviceId: '', customerId: '', login: '', contract: '', name: '', address: '', ip: '',
      };
      const learned = macByIface.get(iface) || [];
      const preferred = learned.find(row => row.customerId && onu.customerId && row.customerId === onu.customerId)
        || learned.find(row => row.login && onu.login && row.login.toLowerCase() === onu.login.toLowerCase())
        || learned[0]
        || {};
      const conflict = identitiesConflict(onu, learned);
      const customerId = onu.customerId || preferred.customerId || '';
      const login = onu.login || preferred.login || '';
      const contract = onu.contract || preferred.contract || normalizeAgreement(login);
      const expectedOnuMac = normalizeMacAddress(context.expectedOnuMac || '');
      const routerMacs = [...new Set(learned.map(row => row.mac).filter(mac => mac && (!expectedOnuMac || mac !== expectedOnuMac)))];
      const lastSeenAt = latestMacTimestamp(learned);
      const macAgeMs = lastSeenAt ? Math.max(0, Date.now() - lastSeenAt) : null;
      const macFresh = Boolean(routerMacs.length && lastSeenAt && macAgeMs <= 2 * 60 * 60 * 1000);
      const current = Boolean(
        (customerId && String(customerId) === String(context.customerId))
        || (login && currentLogin && login.toLowerCase() === currentLogin.toLowerCase())
        || (contract && normalizeAgreement(context.contract) === contract)
        || (context.onuInterface && iface === context.onuInterface)
      );
      return {
        ...onu,
        customerId,
        login,
        contract,
        name: onu.name || preferred.name || '',
        address: onu.address || preferred.address || '',
        ip: onu.ip || preferred.ip || '',
        routerMacs,
        vlans: [...new Set(learned.map(row => row.vlan).filter(Boolean))],
        firstSeen: learned.map(row => row.firstSeen).filter(Boolean).sort()[0] || '',
        lastSeen: learned.map(row => row.lastSeen).filter(Boolean).sort().slice(-1)[0] || '',
        lastSeenAt,
        macAgeMs,
        macFresh,
        macRows: learned,
        conflict,
        current,
      };
    });
    return merged.sort((a, b) => Number(a.onuId || 99999) - Number(b.onuId || 99999) || a.iface.localeCompare(b.iface));
  }

  function buildPortAssessment(rows, context, billingPoll) {
    const online = rows.filter(row => row.status === 'online').length;
    const offline = rows.filter(row => row.status === 'offline').length;
    const unknown = rows.length - online - offline;
    const withOwner = rows.filter(row => row.customerId || row.login).length;
    const withMac = rows.filter(row => row.routerMacs.length).length;
    const withFreshMac = rows.filter(row => row.macFresh).length;
    const conflicts = rows.filter(row => row.conflict).length;
    const weak = rows.filter(row => row.badLevel || (row.rxDbm !== null && row.rxDbm <= -28)).length;
    const current = rows.find(row => row.current) || null;
    const known = online + offline;
    const offlineShare = known ? offline / known : 0;
    const massIncident = offline >= 3 && offlineShare >= 0.25;
    const conclusions = [];
    if (massIncident) conclusions.push(`На порту ${offline} offline из ${known} определённых состояний (${Math.round(offlineShare * 100)}%): вероятна общая проблема ветки, питания узла или оптического сегмента.`);
    else if (offline) conclusions.push(`Offline ONU: ${offline}. Массового порогового признака нет; проверяй распределение по времени и причины deregistration.`);
    else if (online) conclusions.push(`Все ${online} ONU с определённым состоянием online: общего обрыва PON-порта по текущему срезу не видно.`);
    else conclusions.push('UserSide не вернул достоверные online/offline-состояния по этому порту.');

    if (current) {
      if (current.status === 'offline' && online >= 2 && !massIncident) conclusions.push('Текущий абонент offline, при этом другие ONU порта online: проблема вероятнее локальная — питание ONU, дроп, коннектор или конкретная ветка сплиттера.');
      if (current.status === 'online' && !current.routerMacs.length && online >= 2) conclusions.push('Текущая ONU online, но MAC за ней не изучен: проверяй Ethernet ONU↔роутер, WAN-порт, питание роутера, кабель и VLAN/режим подключения.');
      if (current.status === 'online' && current.routerMacs.length && current.macFresh) conclusions.push(`Текущая ONU online и MAC ${current.routerMacs.join(', ')} обновлялся недавно: PON и L2-участок до роутера подтверждены свежим срезом UserSide.`);
      if (current.status === 'online' && current.routerMacs.length && !current.macFresh) conclusions.push(`Текущая ONU online, но запись MAC ${current.routerMacs.join(', ')} не является свежей (${current.lastSeen || 'дата неизвестна'}): она подтверждает историю, а не текущий Ethernet-линк.`);
      if (current.badLevel || (current.rxDbm !== null && current.rxDbm <= -28)) conclusions.push(`У текущей ONU слабый уровень Rx ${current.rxDbm !== null ? `${current.rxDbm} dBm` : ''}: возможен оптический запас у границы.`);
      if (current.conflict) conclusions.push('Для позиции текущей ONU найден конфликт владельцев между ONU-list и MAC-таблицей; автоматическому сопоставлению доверять нельзя до ручной проверки.');
    } else {
      conclusions.push('Текущий договор не удалось однозначно найти среди строк порта; позиция могла измениться либо источники UserSide рассинхронизированы.');
    }
    if (billingPoll && billingPoll.userSideFallbackReason) {
      conclusions.unshift(`UserSide-маршрут порта не сработал (${billingPoll.userSideFallbackReason}); применён резервный опрос Billing. Поля владельца и MAC могут отсутствовать.`);
    }
    if (!billingPoll.ok) conclusions.push(`Штатный askport Billing не получен (${billingPoll.error || 'нет ответа'}); сводка построена по UserSide.`);
    else if (!(billingPoll.structuredRows || []).length && !billingPoll.evidence.length) conclusions.push('Ответ askport Billing получен, но универсальный парсер не выделил строки порта; полный вывод сохранён ниже для ручной проверки.');

    return {
      total: rows.length,
      online, offline, unknown, withOwner, withMac, withFreshMac, conflicts, weak,
      current,
      offlineShare,
      massIncident,
      conclusions,
    };
  }

  function portSubscriberText(row) {
    const owner = row.login || (row.contract ? `abon${row.contract}` : 'владелец не определён');
    const street = compactPortStreet(row.address) || 'улица не определена';
    const status = String(row.status || 'unknown').toUpperCase();
    const rx = row.rxDbm !== null ? `${row.rxDbm} dBm` : '—';
    const tx = row.txDbm !== null ? `${row.txDbm} dBm` : '—';
    const distance = row.distance !== null ? `${row.distance} м` : '—';
    return `${row.current ? '→ ' : ''}ONT ${row.onuId || '?'} | ${owner} | ${street} | ${status} | SN ${row.serial || row.serial2 || '—'} | ${distance} | Rx/Tx ${rx}/${tx} | ${row.downCause || row.reasonOffline || '—'}`;
  }

  function portResultAsText(result) {
    const a = result.assessment;
    return [
      `SIMNET · Абоненты PON-порта`,
      `OLT: ${result.context.oltName || 'не указана'} ${result.context.oltIp} · deviceId ${result.context.oltId}`,
      `Порт: ${result.context.ponPort} · текущая ONU ${result.context.onuInterface || 'не определена'}`,
      `Итого: ${a.total}; online ${a.online}; offline ${a.offline}; unknown ${a.unknown}; владельцы ${a.withOwner}; MAC ${a.withMac}; свежих MAC ${a.withFreshMac}; конфликты ${a.conflicts}; слабая оптика ${a.weak}`,
      '',
      ...a.conclusions.map(item => `- ${item}`),
      '',
      ...result.rows.map(portSubscriberText),
    ].join('\n');
  }

  function portMetric(label, value, className = '') {
    return `<div class="dp-port-metric ${escapeHtml(className)}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
  }

  function portStatusCell(row) {
    const status = String(row.status || 'unknown').toLowerCase();
    return `<span class="dp-port-table-status ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }

  function portTableRowHtml(row) {
    const ownerLabel = row.login || (row.contract ? `abon${row.contract}` : '—');
    const ownerUrl = row.customerId ? `${BASE}/customer/${encodeURIComponent(row.customerId)}` : '';
    const street = compactPortStreet(row.address) || '—';
    const reason = row.downCause || row.reasonOffline || '—';
    const vlans = [...new Set([row.serviceVlan, row.userVlan, ...(row.vlans || [])].filter(Boolean))].join(' / ') || '—';
    const macs = row.routerMacs && row.routerMacs.length ? row.routerMacs.join(', ') : '—';
    const classes = [row.current ? 'current' : '', row.conflict ? 'conflict' : '', row.status || 'unknown'].filter(Boolean).join(' ');
    const value = (raw, suffix = '') => raw === null || raw === undefined || raw === '' ? '—' : `${raw}${suffix}`;
    return `
      <tr class="${escapeHtml(classes)}">
        <td class="dp-port-col-id">${row.current ? '<span class="dp-port-current-mark">→</span>' : ''}${escapeHtml(row.onuId || '—')}</td>
        <td class="dp-port-col-contract">${ownerUrl ? `<a href="${escapeHtml(ownerUrl)}" target="_blank" rel="noopener">${escapeHtml(ownerLabel)}</a>` : escapeHtml(ownerLabel)}</td>
        <td class="dp-port-col-street" title="${escapeHtml(row.address || '')}">${escapeHtml(street)}</td>
        <td>${portStatusCell(row)}</td>
        <td class="dp-port-nowrap">${escapeHtml(row.lastUpTime || '—')}</td>
        <td class="dp-port-nowrap">${escapeHtml(row.lastDownTime || '—')}</td>
        <td>${escapeHtml(reason)}</td>
        <td class="dp-port-nowrap">${escapeHtml(row.serial || row.serial2 || '—')}</td>
        <td>${escapeHtml(row.onuType || row.model || row.vendor || '—')}</td>
        <td class="dp-port-num">${escapeHtml(value(row.distance, ' м'))}</td>
        <td class="dp-port-num">${escapeHtml(value(row.rxDbm, ' dBm'))}</td>
        <td class="dp-port-num">${escapeHtml(value(row.txDbm, ' dBm'))}</td>
        <td class="dp-port-num">${escapeHtml(value(row.oltRxDbm, ' dBm'))}</td>
        <td>${escapeHtml(row.serviceState || '—')}</td>
        <td class="dp-port-nowrap">${escapeHtml(vlans)}</td>
        <td class="dp-port-nowrap" title="${escapeHtml(row.lastSeen ? `Последний MAC: ${row.lastSeen}` : '')}">${escapeHtml(macs)}</td>
        <td>${escapeHtml(row.description || '—')}</td>
      </tr>`;
  }

  function portBillingStyleTableHtml(rows) {
    return `
      <div class="dp-port-table-wrap">
        <table class="dp-port-table">
          <thead>
            <tr>
              <th>ONT ID</th>
              <th class="dp-port-added-col">Договор</th>
              <th class="dp-port-added-col">Улица</th>
              <th>Run</th>
              <th>Last UpTime</th>
              <th>Last DownTime</th>
              <th>DownCause</th>
              <th>SN</th>
              <th>Type</th>
              <th>Distance</th>
              <th>ONU Rx</th>
              <th>ONU Tx</th>
              <th>OLT Rx</th>
              <th>Service</th>
              <th>VLAN</th>
              <th>MAC абонента</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>${(rows || []).map(portTableRowHtml).join('')}</tbody>
        </table>
      </div>`;
  }

  function renderPortReport(result) {
    const container = document.querySelector('#dp-port-container');
    if (!container) return;
    const a = result.assessment;
    const stateClass = a.massIncident ? 'error' : a.conflicts || a.offline || a.weak ? 'warning' : 'ok';
    container.innerHTML = `
      <div class="dp-port-block ${stateClass}">
        <div class="dp-port-head">
          <span class="dp-port-title">Абоненты ${escapeHtml(result.context.ponPort)}</span>
          <span class="dp-port-state">${a.massIncident ? 'массовый признак' : 'готово'}</span>
        </div>
        <div class="dp-port-meta">${escapeHtml(result.context.oltName || 'OLT')} · ${escapeHtml(result.context.oltIp)} · UserSide deviceId ${escapeHtml(result.context.oltId)}</div>
        <div class="dp-port-metrics">
          ${portMetric('всего', a.total)}
          ${portMetric('online', a.online, 'online')}
          ${portMetric('offline', a.offline, a.offline ? 'offline' : '')}
          ${portMetric('unknown', a.unknown)}
          ${portMetric('с MAC', a.withMac)}
          ${portMetric('MAC ≤2ч', a.withFreshMac)}
          ${portMetric('конфликтов', a.conflicts, a.conflicts ? 'conflict' : '')}
        </div>
        <section class="dp-port-conclusion">
          <div class="dp-port-section-title">Вывод</div>
          <ul>${a.conclusions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
        <div class="dp-port-actions">
          <button type="button" id="dp-port-copy-text">Копировать текст</button>
          <button type="button" id="dp-port-copy-json">Копировать JSON</button>
        </div>
        <details class="dp-port-list" open>
          <summary>Штатная таблица порта (${escapeHtml(result.rows.length)})</summary>
          ${portBillingStyleTableHtml(result.rows)}
        </details>
        ${portRouteHypothesisHtml(result.rows)}
        <details class="dp-port-billing-raw">
          <summary>Опрос порта Billing · ${result.billingPoll.ok ? 'ответ получен' : 'не получен'} · распознано строк ${escapeHtml(result.billingPoll.evidence.length)}</summary>
          ${result.billingPoll.evidence.length ? `<div class="dp-port-evidence">${result.billingPoll.evidence.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>` : ''}
          ${result.billingPoll.raw ? `<pre class="dp-port-raw-output">${escapeHtml(result.billingPoll.raw.slice(0, 180000))}</pre>` : `<div class="dp-port-message">${escapeHtml(result.billingPoll.error || 'нет вывода')}</div>`}
        </details>
      </div>`;

    document.querySelector('#dp-port-copy-text')?.addEventListener('click', () => {
      const value = portResultAsText(result);
      try { GM_setClipboard(value, 'text'); } catch (_) { navigator.clipboard?.writeText(value); }
      journalLog('info', 'Текст отчёта PON-порта скопирован', { rows: result.rows.length });
    });
    document.querySelector('#dp-port-copy-json')?.addEventListener('click', () => {
      const value = JSON.stringify({
        generatedAt: new Date().toISOString(),
        context: result.context,
        assessment: result.assessment,
        rows: result.rows.map(({ raw, macRows, ...row }) => row),
        billingPortEvidence: result.billingPoll.evidence,
      }, null, 2);
      try { GM_setClipboard(value, 'text'); } catch (_) { navigator.clipboard?.writeText(value); }
      journalLog('info', 'JSON отчёта PON-порта скопирован', { rows: result.rows.length });
    });
    scheduleWorkspacePersist();
  }

  async function runPortSubscribersAnalysis() {
    const initial = portAnalysisRuntime.context;
    if (!initial || !initial.oltIp || !initial.ponPort) {
      renderStatus('сначала выполни диагностику и подтверди ONU с PON-позицией', 'warning');
      return;
    }
    if (blockStartWhenAnotherTabRuns()) return;
    if (!(await acquireWorkspaceLease('port', initial.contract || ''))) return;
    workspaceExplicitOperationKind = 'port';
    const runId = beginDiagnosticsRun();
    const active = () => isDiagnosticRunActive(runId);
    portAnalysisRuntime.result = null;
    portAnalysisRuntime.billingRaw = '';
    renderStatus(`собираю абонентов ${initial.ponPort}…`, 'loading');
    renderPortPending('проверяю подтверждённую OLT и интерфейс…', `${initial.oltIp} · ${initial.ponPort}`);
    journalLog('info', 'Старт анализа абонентов PON-порта', {
      contract: initial.contract,
      oltIp: initial.oltIp,
      vendor: initial.vendor || 'не определён',
      portType: initial.portType || 'не определён',
      portPath: initial.portPath || '',
      billingAction: initial.action || '',
      ponPort: initial.ponPort,
      currentOnu: initial.onuInterface,
    });

    try {
      const resolvedContext = await resolvePortOltIdentity(initial, active);
      if (!active()) return;
      const context = normalizedPortContext(resolvedContext);
      if (context.vendor === 'huawei' && context.action !== '313') {
        throw new Error(`защита классификации: Huawei должна опрашиваться через a=313, получено a=${context.action || 'не определено'}`);
      }
      journalLog('decision', 'Классификация OLT и PON-интерфейса подтверждена', {
        vendor: context.vendor || 'не определён',
        portType: context.portType || 'не определён',
        portPath: context.portPath || '',
        onuId: context.onuId || '',
        billingAction: context.action || '',
        interpretation: context.vendor === 'huawei' && context.portType === 'epon'
          ? 'Huawei EPON: раздел Billing a=313, интерфейс EPON'
          : 'производитель и технология порта учитываются раздельно',
      });
      setPortAnalysisContext(context);

      // Billing запускается параллельно и является полноценным резервом:
      // отсутствие UserSide if_index больше не завершает весь анализ.
      const billingPromise = requestBillingPortPoll(context, active);
      let billingPoll = null;
      let route = null;
      let ifIndex = '';
      let onuRows = [];
      let macRows = [];
      let userSideFallbackReason = '';
      let discoveredPorts = [];

      if (!context.oltId) {
        userSideFallbackReason = `не удалось сопоставить OLT ${context.oltIp} с UserSide deviceId`;
      } else {
        try {
          renderPortPending('запрашиваю карту интерфейсов и штатный askport…', `OLT deviceId ${context.oltId}`);
          const macIndexRaw = await gmRequest(`${BASE}/device/interface_mac_list?id=${encodeURIComponent(context.oltId)}`, 'GET', 30000);
          if (!active()) return;
          const routeResolution = await resolveUserSidePonPortRoute(context, parseHtml(macIndexRaw), active);
          if (!active()) return;
          route = routeResolution.route;
          discoveredPorts = routeResolution.discoveredPorts || [];
          ifIndex = String(route && (route.ifIndex || route.ponIface || route.ifaceOltNumber) || '');
          if (!route || !ifIndex) {
            const found = discoveredPorts.length ? discoveredPorts.join(', ') : 'PON-порты не распознаны';
            throw new Error(`в UserSide не найден маршрут для ${context.ponPort}; найдено: ${found}`);
          }

          renderPortPending('собираю ONU-list и MAC-таблицу выбранного интерфейса…', `${context.ponPort} · if_index ${ifIndex}`);
          onuRows = await fetchPortOnuRows(context.oltId, route, context.ponPort, active);
          if (!active()) return;

          // Ошибка MAC-таблицы не должна обнулять уже полученные ONU и Billing.
          try {
            const macRaw = await gmRequest(`${BASE}/device/interface_mac_list?id=${encodeURIComponent(context.oltId)}&if_index=${encodeURIComponent(ifIndex)}`, 'GET', 30000);
            if (!active()) return;
            macRows = parseInterfaceMacRows(parseHtml(macRaw), context.ponPort);
          } catch (error) {
            journalLog('warn', 'MAC-таблица PON-порта не получена; продолжаю по ONU-list и Billing', {
              ponPort: context.ponPort,
              ifIndex,
              reason: error.message || String(error),
            });
          }
        } catch (error) {
          userSideFallbackReason = error.message || String(error);
          journalLog('warn', 'UserSide-маршрут PON-порта не сработал; переключаюсь на Billing', {
            ponPort: context.ponPort,
            oltId: context.oltId,
            reason: userSideFallbackReason,
            discoveredPorts: discoveredPorts.slice(0, 80),
          });
        }
      }

      billingPoll = await billingPromise;
      if (!active()) return;
      if (userSideFallbackReason) billingPoll.userSideFallbackReason = userSideFallbackReason;

      let rows = mergePortSubscribers(onuRows, macRows, context);
      rows = mergeBillingPortStructuredRows(rows, billingPoll.structuredRows || [], context);
      if (!rows.length && !billingPoll.ok) {
        throw new Error(`UserSide: ${userSideFallbackReason || 'данные порта не получены'}; Billing: ${billingPoll.error || 'нет ответа'}`);
      }
      // Даже если формат Billing пока не разобран построчно, показываем RAW,
      // а не превращаем полезный резервный ответ в общую ошибку.
      const assessment = buildPortAssessment(rows, context, billingPoll);
      const result = {
        context: {
          ...context,
          ifIndex,
          userSideRouteSource: route && route.source || '',
          userSideDirectOnuUrl: route && route.directOnuUrl || '',
          userSideFallbackReason,
        },
        rows,
        onuRows,
        macRows,
        billingPoll,
        assessment,
      };
      portAnalysisRuntime.result = result;
      portAnalysisRuntime.billingRaw = billingPoll.raw || '';
      renderPortReport(result);

      const sourceWarning = Boolean(userSideFallbackReason);
      const statusState = assessment.massIncident ? 'error'
        : assessment.offline || assessment.conflicts || assessment.weak || sourceWarning ? 'warning'
        : 'ok';
      const sourceLabel = sourceWarning ? ' · резерв Billing' : '';
      renderStatus(`порт ${context.ponPort}: ${assessment.total} позиций · online ${assessment.online} · offline ${assessment.offline} · MAC ${assessment.withMac}${sourceLabel}`, statusState);
      journalLog(statusState === 'error' ? 'error' : statusState === 'warning' ? 'warn' : 'ok', 'Анализ PON-порта завершён', {
        oltIp: context.oltIp,
        oltId: context.oltId || 'не найден',
        ponPort: context.ponPort,
        ifIndex: ifIndex || 'не найден',
        routeSource: route && route.source || 'Billing fallback',
        positions: assessment.total,
        online: assessment.online,
        offline: assessment.offline,
        unknown: assessment.unknown,
        owners: assessment.withOwner,
        macs: assessment.withMac,
        freshMacs: assessment.withFreshMac,
        conflicts: assessment.conflicts,
        weakOptics: assessment.weak,
        billingAskport: billingPoll.ok ? `получен · строк ${billingPoll.structuredRows ? billingPoll.structuredRows.length : 0}` : `ошибка: ${billingPoll.error || 'нет ответа'}`,
        userSideFallback: userSideFallbackReason || 'нет',
      });
    } catch (error) {
      if (!active()) return;
      const message = error && error.message || String(error);
      renderPortFailure(message);
      renderStatus(`ошибка анализа PON-порта: ${message}`, 'error');
      journalLog('error', 'Анализ PON-порта завершился ошибкой', { reason: message });
    } finally {
      finishDiagnosticsRun(runId);
      releaseWorkspaceLease('анализ PON-порта завершён');
    }
  }

  /* ==========================================================
     ГЛАВНАЯ ФУНКЦИЯ ЗАПУСКА ДИАГНОСТИКИ (ВСТРОЕННЫЙ МОСТ)
     ========================================================== */
  let diagnosticsRunId = 0;

  async function runDiagnostics(contractInput) {
    if (!randomPonTestRuntime.running) setWorkspaceView('subscriber');
    const contract = String(contractInput || '').trim();
    if (!contract) {
      renderStatus('введи номер договора', 'error');
      return;
    }

    const nestedInRandomBatch = Boolean(randomPonTestRuntime.running && workspaceOwnsCurrentLease());
    if (!nestedInRandomBatch && blockStartWhenAnotherTabRuns()) return;
    let standaloneLease = false;
    if (!nestedInRandomBatch) {
      standaloneLease = await acquireWorkspaceLease('diagnostic', contract);
      if (!standaloneLease) return;
    }
    const input = document.querySelector('#dp-input');
    if (input) input.value = contract;
    if (!randomPonTestRuntime.running) workspaceExplicitOperationKind = 'diagnostic';
    const runId = beginDiagnosticsRun();
    setPortAnalysisContext(null);
    resetSystemJournal(contract);
    renderStatus('ищу договор в UserSide…', 'loading');
    clearAllFieldResults();
    renderAllFieldsPending();

    journalLog('info', 'Старт диагностики договора', { contract });

    try {
      const customerId = await resolveCustomerId(contract);
      if (!isDiagnosticRunActive(runId)) return;
      if (!customerId) {
        renderStatus('договор не найден в UserSide', 'error');
        journalLog('error', 'Договор не найден в UserSide', { contract });
        return;
      }

      renderStatus(`найден customerId ${customerId}; собираю данные…`, 'loading');
      journalLog('ok', 'Договор сопоставлен с customerId', { contract, customerId });

      const ctx = {
        contract,
        customerId,
        getSource: makeSourceCache(),
      };

      renderStatus('определяю базу Billing абонента…', 'loading');
      const selectedBillingProvider = await selectBillingProviderForContext(ctx);
      if (!isDiagnosticRunActive(runId)) return;
      if (!selectedBillingProvider) {
        renderStatus('не удалось определить Simnet или Looknet — выбери базу вручную в переключателе', 'warning');
        return;
      }
      renderStatus(`база ${activeBillingProfile.label}; собираю данные…`, 'loading');

      const results = {};
      for (const fieldDef of FIELD_DEFINITIONS) {
        if (!isDiagnosticRunActive(runId)) return;
        const res = await resolveField(fieldDef.chain, ctx, fieldDef.label);
        results[fieldDef.key] = res;
        renderFieldResult(fieldDef.key, fieldDef.label, res);
      }

      if (!isDiagnosticRunActive(runId)) return;
      renderStatus('данные собраны; запускаю опрос ONU в Billing…', 'loading');
      journalLog('info', 'Первичный сбор полей завершён, запускаю опрос ONU');

      const onuOutcome = await runBillingOnuPoll(ctx, runId);
      if (!isDiagnosticRunActive(runId)) return;

      if (onuOutcome && onuOutcome.confirmed) {
        setPortAnalysisContext(onuOutcome.portContext || null);
        const report = onuOutcome.attempt && onuOutcome.attempt.result && onuOutcome.attempt.result.analysis
          ? onuOutcome.attempt.result.analysis.report
          : null;
        const statusState = report && report.severity === 'error' ? 'error'
          : report && ['warn', 'conflict', 'unknown'].includes(report.severity) ? 'warning'
          : 'ok';
        renderStatus(report ? `диагностика завершена: ${report.badge} · ${report.summary}` : 'диагностика завершена: ONU подтверждена', statusState);
        journalLog(statusState === 'error' ? 'error' : statusState === 'warning' ? 'warn' : 'ok', 'Диагностика завершена: ONU подтверждена фактическим опросом', {
          result: report ? `${report.badge} · ${report.summary}` : 'ответ получен',
        });
      } else {
        renderStatus('диагностика завершена: ONU не подтверждена', 'warning');
        journalLog('warn', 'Диагностика завершена без подтверждения ONU', {
          attempts: onuOutcome && Array.isArray(onuOutcome.attempts) ? onuOutcome.attempts.length : 0,
          reason: onuOutcome && onuOutcome.error ? onuOutcome.error : 'ни одна гипотеза не дала подтверждённый ответ',
        });
      }
    } catch (error) {
      if (!isDiagnosticRunActive(runId)) return;
      const message = error && error.message || String(error);
      renderStatus(`ошибка: ${message}`, 'error');
      renderAllFieldsFailure(message);
      journalLog('error', 'Ошибка выполнения диагностики', { reason: message });
    } finally {
      finishDiagnosticsRun(runId);
      if (standaloneLease) releaseWorkspaceLease('диагностика договора завершена');
    }
  }


  function normalizeRandomPonContract(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const explicit = text.match(/\bab(?:on)?(\d{4,14})\b/i);
    if (explicit) return `abon${explicit[1]}`;
    const plain = text.match(/^\s*(\d{4,14})\s*$/);
    return plain ? `abon${plain[1]}` : '';
  }

  function uniqueRandomPonContracts(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const contract = normalizeRandomPonContract(raw);
      const key = contract.toLowerCase();
      if (!contract || seen.has(key)) continue;
      seen.add(key);
      result.push(contract);
    }
    return result;
  }

  function collectVisiblePonContracts() {
    const contracts = [];
    const rows = [...document.querySelectorAll('#tableListData tr.table_item, tr.table_item, #tableListData tbody tr')];
    for (const row of rows) {
      const rowText = String(row.textContent || '').replace(/\s+/g, ' ').trim();
      const agreementCell = row.querySelector('[id$="_agreement_full_Id"], [id*="agreement" i]');
      const agreementText = String(agreementCell && agreementCell.textContent || '');
      const contractLink = [...row.querySelectorAll('a[href]')].find(link => /\bab(?:on)?\d{4,14}\b/i.test(String(link.textContent || '')));
      const contract = normalizeRandomPonContract(
        agreementText
        || (contractLink && contractLink.textContent)
        || firstPollMatch(rowText, [/\b(ab(?:on)?\d{4,14})\b/i])
      );
      if (!contract) continue;

      const ponEvidence = /(?:\b(?:GPON|EPON|XPON|XGPON|XGSPON|PON)\b|\b(?:ONU|ONT)\b|FoxGate|оптич|gpon\d*\/|epon\d*\/)/i.test(rowText);
      const tariffCell = row.querySelector('[id*="tariff" i], [id$="_tariff_name_Id"]');
      const tariffPon = /pon/i.test(String(tariffCell && tariffCell.textContent || ''));
      const deviceEvidence = [...row.querySelectorAll('a[href*="/device/"]')].some(link =>
        /(?:ONU|ONT|GPON|EPON|XPON|PON|FoxGate)/i.test(`${link.textContent || ''} ${link.closest('td')?.textContent || ''}`)
      );
      if (ponEvidence || tariffPon || deviceEvidence) contracts.push(contract);
    }
    return uniqueRandomPonContracts(contracts);
  }

  function parseManualRandomPonContracts() {
    const textarea = document.querySelector('#dp-random-contracts');
    return uniqueRandomPonContracts(String(textarea && textarea.value || '').split(/[\s,;]+/));
  }

  function shuffledRandomPonContracts(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function normalizeRandomPonQueueItem(raw, fallbackMeta = {}) {
    const source = raw && typeof raw === 'object' ? raw : { contract: raw };
    const contract = normalizeRandomPonContract(source.contract || source.value || source.text || '');
    if (!contract) return null;
    const sourceMode = source.sourceMode === 'manual' ? 'manual' : (fallbackMeta.sourceMode === 'manual' ? 'manual' : 'page');
    const addedAt = Number(source.addedAt || Date.now());
    return {
      queueId: String(source.queueId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`),
      contract,
      sourceMode,
      sourceUrl: String(source.sourceUrl || fallbackMeta.sourceUrl || ''),
      sourceTitle: String(source.sourceTitle || fallbackMeta.sourceTitle || ''),
      sourcePage: String(source.sourcePage || fallbackMeta.sourcePage || ''),
      addedAt,
      addedLabel: String(source.addedLabel || new Date(addedAt).toLocaleString('ru-RU', { hour12: false })),
    };
  }

  function normalizeRandomPonQueue(items) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const item = normalizeRandomPonQueueItem(raw);
      if (!item) continue;
      const key = item.contract.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length >= RANDOM_PON_TEST_QUEUE_LIMIT) break;
    }
    return result;
  }

  function randomPonQueuedContracts() {
    return new Set(normalizeRandomPonQueue(randomPonTestRuntime.queue)
      .map(item => item.contract.toLowerCase()));
  }

  function makeRandomPonQueueItem(contract, sourceMeta) {
    return normalizeRandomPonQueueItem({
      contract,
      sourceMode: sourceMeta.sourceMode,
      sourceUrl: sourceMeta.sourceUrl,
      sourceTitle: sourceMeta.sourceTitle,
      sourcePage: sourceMeta.sourcePage,
      addedAt: Date.now(),
    }, sourceMeta);
  }

  function parseRandomPonCountSpec(rawValue, availableCount) {
    const source = String(rawValue == null ? '' : rawValue).trim().replace(/[–—]/g, '-');
    const range = source.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
    const exact = source.match(/^\d{1,2}$/);
    let min = 10;
    let max = 10;
    if (range) {
      min = Number(range[1]);
      max = Number(range[2]);
      if (min > max) [min, max] = [max, min];
    } else if (exact) {
      min = max = Number(source);
    }
    min = Math.max(1, Math.min(RANDOM_PON_TEST_ADD_MAX, min));
    max = Math.max(min, Math.min(RANDOM_PON_TEST_ADD_MAX, max));
    const requested = min === max
      ? min
      : min + Math.floor(Math.random() * (max - min + 1));
    const available = Math.max(0, Number(availableCount || 0));
    return {
      min,
      max,
      requested,
      selected: Math.min(requested, available),
      normalized: min === max ? String(min) : `${min}-${max}`,
    };
  }

  function randomPonResultFingerprint(item) {
    const explicit = String(item && item.resultId || '');
    if (explicit) return `id:${explicit}`;
    return [
      String(item && item.contract || '').toLowerCase(),
      String(item && item.startedAt || ''),
      Number(item && item.durationMs || 0),
      String(item && item.summary || item && item.statusText || '').slice(0, 500),
      String(item && item.oltIp || ''),
      String(item && item.onuInterface || item && item.ponPort || ''),
      String(item && item.rawOutput || '').length,
    ].join('|');
  }

  function dedupeRandomPonHistory(items) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || typeof raw !== 'object') continue;
      const fingerprint = randomPonResultFingerprint(raw);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push(raw);
    }
    return result.slice(-RANDOM_PON_TEST_HISTORY_LIMIT);
  }

  function randomPonSeenContracts() {
    return new Set(randomPonTestRuntime.results
      .map(item => normalizeRandomPonContract(item && item.contract))
      .filter(Boolean)
      .map(value => value.toLowerCase()));
  }

  function currentRandomPonSourceMeta(sourceMode = 'page') {
    let page = '';
    try {
      const url = new URL(location.href);
      page = url.searchParams.get('page') || url.searchParams.get('p') || '';
    } catch (_) {}
    return {
      sourceMode,
      sourceUrl: sanitizeJournalUrl(location.href),
      sourceTitle: String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      sourcePage: page,
    };
  }

  function captureRandomPonFieldSnapshot() {
    const snapshot = {};
    for (const field of FIELD_DEFINITIONS) {
      const root = document.querySelector(`#dp-field-${field.key}`);
      if (!root) continue;
      snapshot[field.key] = {
        label: field.label,
        value: String(root.querySelector('.dp-field-value')?.textContent || '').replace(/\s+/g, ' ').trim(),
        source: String(root.querySelector('.dp-field-source')?.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    }
    return snapshot;
  }

  function randomPonFieldValue(item, key) {
    return String(item && item.fields && item.fields[key] && item.fields[key].value || '').trim();
  }

  function randomPonJournalDetail(key) {
    for (let index = systemJournal.entries.length - 1; index >= 0; index -= 1) {
      const value = systemJournal.entries[index] && systemJournal.entries[index].details
        ? systemJournal.entries[index].details[key]
        : '';
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function serializableRandomPonHistory() {
    const history = dedupeRandomPonHistory(randomPonTestRuntime.results);
    const fullFrom = Math.max(0, history.length - RANDOM_PON_TEST_RECENT_FULL_LIMIT);
    return history.map((item, index) => ({
      ...item,
      // RAW — главный учебный образец парсера, поэтому сохраняется полностью
      // для всей истории. Старые подробные журналы компактнее, чтобы не
      // раздувать Tampermonkey-хранилище и не тормозить Chrome.
      rawOutput: String(item.rawOutput || '').slice(0, RANDOM_PON_TEST_RAW_LIMIT),
      journal: String(item.journal || '').slice(0, index >= fullFrom ? 80000 : 16000),
      panelText: String(item.panelText || '').slice(0, 60000),
    }));
  }

  function randomPonTestState() {
    return {
      schema: 4,
      savedAt: Date.now(),
      running: false,
      currentIndex: Number(randomPonTestRuntime.currentIndex || -1),
      queue: normalizeRandomPonQueue(randomPonTestRuntime.queue),
      results: serializableRandomPonHistory(),
      batchNo: Number(randomPonTestRuntime.batchNo || 0),
      activeBatchId: String(randomPonTestRuntime.activeBatchId || ''),
      manualContracts: String(document.querySelector('#dp-random-contracts')?.value || '').slice(0, 50000),
      countSpec: String(document.querySelector('#dp-random-count')?.value || '10').slice(0, 20),
      delaySeconds: Number(document.querySelector('#dp-random-delay')?.value || 3),
      sourceMode: String(document.querySelector('#dp-random-source')?.value || 'page'),
      allowRepeat: Boolean(document.querySelector('#dp-random-repeat')?.checked),
    };
  }

  function persistRandomPonTestState() {
    return;
    randomPonTestRuntime.queue = normalizeRandomPonQueue(randomPonTestRuntime.queue);
    randomPonTestRuntime.results = dedupeRandomPonHistory(randomPonTestRuntime.results);
    try { GM_setValue(RANDOM_PON_TEST_STATE_KEY, randomPonTestState()); } catch (_) {}
    scheduleWorkspacePersist();
  }

  function restoreRandomPonTestState() {
    return;
    let sourceKey = RANDOM_PON_TEST_STATE_KEY;
    let state = safeGetValue(RANDOM_PON_TEST_STATE_KEY, null);
    if (!state || typeof state !== 'object') {
      for (const key of RANDOM_PON_TEST_LEGACY_STATE_KEYS) {
        state = safeGetValue(key, null);
        if (state && typeof state === 'object') {
          sourceKey = key;
          break;
        }
      }
    }
    if (!state || typeof state !== 'object') return;
    restoreRandomPonFromWorkspace(state);
    renderRandomPonTestResults();

    // Записываем только при реальной миграции со старого ключа. Обычное
    // открытие ещё одной вкладки не должно перезаписывать живую очередь.
    if (sourceKey !== RANDOM_PON_TEST_STATE_KEY) {
      try { GM_setValue(RANDOM_PON_TEST_STATE_KEY, randomPonTestState()); } catch (_) {}
    }
  }

  function randomPonOutcomeLabel(item) {
    if (item.outcome === 'ok') return 'OK';
    if (item.outcome === 'warning') return 'WARN';
    if (item.outcome === 'error') return 'ERROR';
    if (item.outcome === 'stopped') return 'STOP';
    return 'UNKNOWN';
  }

  // Коллектор отдельно помечает случаи, когда фактический ONU-опрос не был
  // подтверждён. Это не обычный WARN состояния линии: оператору нужно сразу
  // видеть, что проблема в идентификации/привязке OLT, SN/MAC или отсутствии
  // установленной OLT, а не в состоянии уже найденной ONU.
  function randomPonCollectorMeta(item = {}) {
    const statusText = String(item.statusText || '');
    const summary = String(item.summary || '');
    const badge = String(item.badge || '');
    const rawOutput = String(item.rawOutput || '');
    const panelText = String(item.panelText || '');
    const journal = String(item.journal || '');
    const all = [statusText, summary, badge, rawOutput, panelText, journal].join('\n');

    const finalUnconfirmed = /(?:диагностика завершена:\s*ONU не подтверждена|Диагностика завершена без подтверждения ONU|ни одна гипотеза не дала подтвержд[её]нный ответ)/i.test(all);
    const finalConfirmed = /(?:Диагностика завершена:\s*ONU подтверждена фактическим опросом|Фактическая OLT подтверждена опросом)/i.test(journal)
      || (/диагностика завершена:\s*(?:OK|WARN|ERROR|UNKNOWN|CONFLICT)\b/i.test(statusText) && !finalUnconfirmed);
    const oltMissing = /(?:поле OLT пуст(?:о|ое)?|OLT(?:\s+из\s+Billing|\s+в\s+Billing)?\s*(?:не определена|не идентифицирована|не установлена|не найдена)|не удалось определить.{0,80}OLT|oltCandidates:\s*не найдено)/i.test(all);
    const identifierMismatch = /(?:identifierMatched:\s*нет|(?:SN|MAC|Serial|серийн\w*\s+номер|идентификатор).{0,100}(?:не совпад|mismatch)|не совпало.{0,80}(?:ONU|ONT|SN|MAC)|ONU.{0,80}(?:не соответствует|не совпадает))/i.test(all);
    const onuNotFound = /(?:(?:ONU|ONT).{0,100}(?:не найден|not\s+found)|classification:\s*not-found)/i.test(all);
    const billingUnavailable = /(?:Billing.{0,100}(?:не авторизован|сессия недоступна|PP не найден)|авторизованная вкладка Billing не объявила готовность)/i.test(all);
    const contractMissing = /договор не найден в UserSide/i.test(all);

    if (finalUnconfirmed || (!finalConfirmed && !rawOutput.trim() && (oltMissing || identifierMismatch || onuNotFound))) {
      let reason = 'ONU не подтверждена ни одной проверенной гипотезой OLT.';
      if (contractMissing) reason = 'Договор не найден в UserSide.';
      else if (billingUnavailable) reason = 'Опрос не выполнен: недоступна авторизованная сессия Billing.';
      else if (identifierMismatch) reason = 'Не совпал идентификатор ONU: SN/MAC/позиция не подтвердили ожидаемого абонента.';
      else if (oltMissing) reason = 'OLT не определена, не идентифицирована либо не установлена в доступных источниках.';
      else if (onuNotFound) reason = 'ONU не найдена на проверенных OLT.';
      return { className: 'unresolved', label: 'НЕ ОПРОШЕНА', reason };
    }

    // Когда ответ OLT получен, но итоговый отчёт именно CONFLICT из-за
    // несовпадения идентификатора, это тоже выделяется тем же семейством цвета,
    // но не называется «не опрошена»: RAW уже существует и его надо разбирать.
    if (finalConfirmed && identifierMismatch && /CONFLICT/i.test(badge)) {
      return {
        className: 'identity-conflict',
        label: 'КОНФЛИКТ ID',
        reason: 'Ответ OLT получен, но SN/MAC/идентификатор не совпал с ожидаемыми данными абонента.',
      };
    }

    return { className: '', label: '', reason: '' };
  }

  function renderRandomPonTestResults() {
    const summary = document.querySelector('#dp-random-summary');
    const live = document.querySelector('#dp-random-live');
    const completedCountNode = document.querySelector('#dp-random-completed-count');
    const pendingCountNode = document.querySelector('#dp-random-pending-count');
    const queueList = document.querySelector('#dp-random-queue');
    const list = document.querySelector('#dp-random-results');
    if (!summary || !queueList || !list) return;

    randomPonTestRuntime.queue = normalizeRandomPonQueue(randomPonTestRuntime.queue);
    randomPonTestRuntime.results = dedupeRandomPonHistory(randomPonTestRuntime.results);

    const queueCount = randomPonTestRuntime.queue.length;
    const total = randomPonTestRuntime.results.length;
    const ok = randomPonTestRuntime.results.filter(item => item.outcome === 'ok').length;
    const warning = randomPonTestRuntime.results.filter(item => item.outcome === 'warning').length;
    const error = randomPonTestRuntime.results.filter(item => item.outcome === 'error').length;
    const unresolved = randomPonTestRuntime.results.filter(item => randomPonCollectorMeta(item).className === 'unresolved').length;
    const identityConflicts = randomPonTestRuntime.results.filter(item => randomPonCollectorMeta(item).className === 'identity-conflict').length;
    const rawCount = randomPonTestRuntime.results.filter(item => item.hasRawOutput || String(item.rawOutput || '').trim()).length;
    const uniqueContracts = new Set(randomPonTestRuntime.results.map(item => String(item.contract || '').toLowerCase()).filter(Boolean)).size;

    const remoteRandomBusy = operationIsFresh(workspaceRemoteOperation) && workspaceRemoteOperation.mode === 'random-pon';
    const localRandomBusy = Boolean(randomPonTestRuntime.running);
    const cycleBusy = localRandomBusy || remoteRandomBusy;
    const activeContract = localRandomBusy
      ? String(randomPonTestRuntime.activeQueueItem && randomPonTestRuntime.activeQueueItem.contract || '')
      : remoteRandomBusy
        ? String(workspaceRemoteOperation.activeContract || '')
        : '';
    const selected = localRandomBusy
      ? Number(randomPonTestRuntime.runInitialCount || 0)
      : remoteRandomBusy
        ? Number(workspaceRemoteOperation.selected || 0)
        : queueCount;
    const processed = localRandomBusy
      ? Number(randomPonTestRuntime.runProcessedCount || 0)
      : remoteRandomBusy
        ? Number(workspaceRemoteOperation.processed || 0)
        : 0;
    const activeIsInQueue = Boolean(activeContract && randomPonTestRuntime.queue.some(item => String(item.contract || '').toLowerCase() === activeContract.toLowerCase()));
    const waitingCount = Math.max(0, queueCount - (cycleBusy && activeIsInQueue ? 1 : 0));
    const cycleNo = localRandomBusy
      ? Number(randomPonTestRuntime.batchNo || 0)
      : remoteRandomBusy
        ? Number(workspaceRemoteOperation.batchNo || randomPonTestRuntime.batchNo || 0)
        : Number(randomPonTestRuntime.batchNo || 0);
    const lastBatchResults = cycleNo > 0
      ? randomPonTestRuntime.results.filter(item => Number(item.batchNo || 0) === cycleNo).length
      : 0;

    summary.textContent = cycleBusy
      ? `Цикл №${cycleNo} · готово ${processed}/${selected} · сейчас ${activeContract || 'подготовка'} · ждут ${waitingCount} · история ${total}/${RANDOM_PON_TEST_HISTORY_LIMIT} · RAW ${rawCount}`
      : `Собрано в очередь ${queueCount}/${RANDOM_PON_TEST_QUEUE_LIMIT} · завершённых результатов ${total}/${RANDOM_PON_TEST_HISTORY_LIMIT} · RAW ${rawCount} · НЕ ОПРОШЕНЫ ${unresolved} · КОНФЛИКТ ID ${identityConflicts} · OK ${ok} · WARN ${warning} · ERROR ${error}`;

    if (live) {
      let stateClass = 'idle';
      let title = 'ОЖИДАНИЕ';
      let detail = queueCount
        ? `Собрано ${queueCount} договоров. Опрос начнётся только после команды «Старт опроса».`
        : total
          ? `Последний цикл №${cycleNo || '—'} завершён. В истории ${total} результатов.`
          : 'Очередь пуста. Сначала собери договоры с нужных страниц.';
      let metrics = queueCount
        ? `В очереди: ${queueCount}`
        : lastBatchResults
          ? `Последний цикл: ${lastBatchResults} результатов`
          : 'Процесс не запущен';

      if (localRandomBusy) {
        stateClass = 'owner';
        title = 'ОПРОС ИДЁТ · ИСПОЛНИТЕЛЬ — ЭТА ВКЛАДКА';
        detail = activeContract
          ? `Сейчас выполняется ${activeContract}. Не закрывай и не обновляй эту вкладку.`
          : 'Подготавливается следующий договор.';
        metrics = `Готово ${processed}/${selected} · ждут ${waitingCount}`;
      } else if (remoteRandomBusy) {
        stateClass = 'mirror';
        title = 'ОПРОС ИДЁТ · ЭТО ЗЕРКАЛО';
        detail = activeContract
          ? `Исполнитель в другой вкладке опрашивает ${activeContract}. Здесь данные подгружаются автоматически.`
          : 'Исполнитель в другой вкладке подготавливает следующий договор.';
        metrics = `Готово ${processed}/${selected} · ждут ${waitingCount}`;
      } else if (!queueCount && total) {
        stateClass = 'done';
        title = 'ПОСЛЕДНИЙ ЦИКЛ ЗАВЕРШЁН';
      } else if (queueCount) {
        stateClass = 'ready';
        title = 'ОЧЕРЕДЬ СОБРАНА · ОПРОС НЕ ЗАПУЩЕН';
      }

      live.className = `dp-random-live ${stateClass}`;
      live.innerHTML = `<span class="dp-random-live-dot" aria-hidden="true"></span><div><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div><strong>${escapeHtml(metrics)}</strong>`;
    }

    if (completedCountNode) completedCountNode.textContent = `${total} · последние сверху`;
    if (pendingCountNode) pendingCountNode.textContent = cycleBusy
      ? `сейчас ${activeContract || '—'} · ждут ${waitingCount}`
      : `${queueCount} договоров`;

    const activeLower = activeContract.toLowerCase();
    queueList.innerHTML = randomPonTestRuntime.queue.map((item, index) => {
      const sourceLabel = [item.sourcePage ? `стр. ${item.sourcePage}` : '', item.sourceMode === 'manual' ? 'список' : '', item.sourceTitle]
        .filter(Boolean).join(' · ');
      const active = Boolean(cycleBusy && activeLower && String(item.contract || '').toLowerCase() === activeLower);
      const position = cycleBusy
        ? Math.max(1, processed + 1 + (active ? 0 : Math.max(0, index - (activeIsInQueue ? 1 : 0))))
        : index + 1;
      return `<div class="dp-random-queue-item${active ? ' active' : ''}">
        <span class="dp-random-queue-state ${active ? 'active' : 'waiting'}" title="${active ? 'Сейчас опрашивается' : 'Ожидает опроса'}">${active ? '…' : position}</span>
        <b>${escapeHtml(item.contract)}</b>
        <small>${escapeHtml(active ? `СЕЙЧАС · ${sourceLabel || item.sourceUrl || 'источник не указан'}` : sourceLabel || item.sourceUrl || 'источник не указан')}</small>
        <button type="button" data-dp-random-remove="${escapeHtml(item.queueId)}" ${(localRandomBusy || remoteRandomBusy) ? 'disabled' : ''} title="Удалить из очереди">×</button>
      </div>`;
    }).join('') || '<div class="dp-random-empty">Ожидающих договоров нет.</div>';

    const disclosureSnapshot = captureRandomPonDisclosureState(list);
    const orderedResults = randomPonTestRuntime.results
      .map((item, originalIndex) => ({ item, originalIndex }))
      .sort((left, right) => {
        const batchDiff = Number(right.item.batchNo || 0) - Number(left.item.batchNo || 0);
        if (batchDiff) return batchDiff;
        const rightAt = Date.parse(String(right.item.startedAt || '')) || Number(right.item.durationMs || 0);
        const leftAt = Date.parse(String(left.item.startedAt || '')) || Number(left.item.durationMs || 0);
        if (rightAt !== leftAt) return rightAt - leftAt;
        return right.originalIndex - left.originalIndex;
      });

    list.innerHTML = orderedResults.map(({ item }, displayIndex) => {
      const collectorMeta = randomPonCollectorMeta(item);
      const disclosure = ensureRandomPonDisclosure(item, displayIndex === 0);
      const disclosureKey = disclosure.key;
      const disclosureState = disclosure.state;
      const sourceLabel = [item.sourceTitle, item.sourcePage ? `стр. ${item.sourcePage}` : '', item.sourceMode === 'manual' ? 'вставленный список' : 'страница UserSide']
        .filter(Boolean).join(' · ');
      const identity = [
        randomPonFieldValue(item, 'billingId') ? `Billing ${randomPonFieldValue(item, 'billingId')}` : '',
        item.customerId ? `customerId ${item.customerId}` : '',
      ].filter(Boolean).join(' · ');
      const hasRaw = Boolean(item.hasRawOutput || String(item.rawOutput || '').trim());
      const pollMarkClass = hasRaw ? 'polled' : collectorMeta.className === 'identity-conflict' ? 'conflict' : collectorMeta.className === 'unresolved' ? 'unresolved' : item.outcome === 'stopped' ? 'stopped' : 'completed';
      const pollMark = hasRaw ? '✓' : collectorMeta.className === 'identity-conflict' ? '≠' : collectorMeta.className === 'unresolved' ? '?' : item.outcome === 'stopped' ? '■' : '•';
      const pollMarkTitle = hasRaw
        ? 'Опрос завершён, системный вывод получен'
        : collectorMeta.className === 'unresolved'
          ? 'Фактический ONU-опрос не подтверждён'
          : 'Диагностика завершена без полного RAW';
      return `
      <details class="dp-random-result ${escapeHtml(item.outcome)} ${escapeHtml(collectorMeta.className)}" data-result-key="${escapeHtml(disclosureKey)}" ${disclosureState.card ? 'open' : ''}>
        <summary>
          <span class="dp-random-poll-mark ${escapeHtml(pollMarkClass)}" title="${escapeHtml(pollMarkTitle)}">${escapeHtml(pollMark)}</span>
          <span class="dp-random-contract-name">${escapeHtml(item.contract)}</span>
          <span class="dp-random-badge">${escapeHtml(collectorMeta.label || randomPonOutcomeLabel(item))}${hasRaw ? ' · RAW' : ''}</span>
          <span>${escapeHtml(item.durationText)}</span>
        </summary>
        <div class="dp-random-result-grid">
          <span>Результат</span><b>${escapeHtml(item.summary || item.statusText || 'не распознан')}</b>
          ${collectorMeta.reason ? `<span>Почему отдельно</span><b class="dp-random-special-reason">${escapeHtml(collectorMeta.reason)}</b>` : ''}
          <span>OLT</span><b>${escapeHtml([item.oltIp, item.vendor, item.action ? `a=${item.action}` : ''].filter(Boolean).join(' · ') || 'не определена')}</b>
          <span>ONU</span><b>${escapeHtml(item.onuInterface || item.ponPort || 'не определена')}</b>
          <span>ID</span><b>${escapeHtml(identity || 'не определены')}</b>
          <span>Адрес</span><b>${escapeHtml(randomPonFieldValue(item, 'address') || 'не определён')}</b>
          <span>ТМЦ/OLT</span><b>${escapeHtml(randomPonFieldValue(item, 'connectionPoint') || 'не определена')}</b>
          <span>Запуск</span><b>${escapeHtml(item.batchNo ? `№${item.batchNo}` : 'старая запись')}</b>
          <span>Источник</span><b>${escapeHtml(sourceLabel || item.sourceUrl || 'не указан')}</b>
          <span>Начало</span><b>${escapeHtml(item.startedLabel)}</b>
          <span>Системный вывод</span><b>${hasRaw ? 'сохранён полностью' : 'не получен'}</b>
        </div>
        ${item.rawOutput ? `<details data-dp-section="raw" ${disclosureState.raw ? 'open' : ''}><summary>Системный вывод Billing / OLT</summary><pre class="dp-random-raw dp-random-system-output">${escapeHtml(item.rawOutput)}</pre></details>` : ''}
        ${item.panelText ? `<details data-dp-section="workbench" ${disclosureState.workbench ? 'open' : ''}><summary>Расшифровка Workbench</summary><pre class="dp-random-raw">${escapeHtml(item.panelText)}</pre></details>` : ''}
        ${item.journal ? `<details data-dp-section="journal" ${disclosureState.journal ? 'open' : ''}><summary>Системный журнал опроса</summary><pre class="dp-random-raw">${escapeHtml(item.journal)}</pre></details>` : ''}
      </details>`;
    }).join('') || '<div class="dp-random-empty">Завершённых результатов пока нет. После каждого опроса новая карточка появится здесь сверху.</div>';
    // Перерисовка прогресса/heartbeat не должна прокручивать список и создавать
    // впечатление повторного клика по раскрытому системному выводу.
    list.scrollTop = disclosureSnapshot.scrollTop;

    updateRunControls();
  }

  function captureRandomPonTestResult(contract, startedAt) {
    const status = document.querySelector('#dp-status');
    const onuState = document.querySelector('#dp-onu-container .dp-onu-state');
    const onuSummary = document.querySelector('#dp-onu-container .dp-onu-summary');
    const rawOutput = document.querySelector('#dp-onu-container .dp-onu-output');
    const context = portAnalysisRuntime.context || {};
    const statusClass = String(status && status.className || '');
    const outcome = randomPonTestRuntime.stopRequested && /останов/i.test(String(status && status.textContent || ''))
      ? 'stopped'
      : statusClass.includes('error') ? 'error'
        : statusClass.includes('warning') ? 'warning'
          : statusClass.includes('ok') ? 'ok'
            : 'unknown';
    const durationMs = Math.max(0, Date.now() - startedAt);
    const rawText = String(rawOutput && rawOutput.textContent || '').slice(0, RANDOM_PON_TEST_RAW_LIMIT);
    const activeItem = randomPonTestRuntime.activeQueueItem || {};
    const sourceMeta = {
      sourceMode: activeItem.sourceMode || randomPonTestRuntime.activeSourceMode || 'page',
      sourceUrl: activeItem.sourceUrl || randomPonTestRuntime.activeSourceUrl || '',
      sourceTitle: activeItem.sourceTitle || randomPonTestRuntime.activeSourceTitle || '',
      sourcePage: activeItem.sourcePage || randomPonTestRuntime.activeSourcePage || '',
    };
    const panelText = String(document.querySelector('#dp-results')?.textContent || '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, RANDOM_PON_TEST_PANEL_TEXT_LIMIT);
    const captured = {
      resultId: `${randomPonTestRuntime.activeBatchId || Date.now().toString(36)}:${randomPonTestRuntime.currentIndex}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      contract,
      outcome,
      statusText: String(status && status.textContent || '').trim(),
      badge: String(onuState && onuState.textContent || '').trim(),
      summary: String(onuSummary && onuSummary.textContent || '').replace(/\s+/g, ' ').trim(),
      customerId: randomPonJournalDetail('customerId'),
      oltIp: String(context.oltIp || ''),
      vendor: String(context.vendor || ''),
      action: String(context.action || ''),
      ponPort: String(context.ponPort || ''),
      onuInterface: String(context.onuInterface || ''),
      batchId: String(randomPonTestRuntime.activeBatchId || ''),
      batchNo: Number(randomPonTestRuntime.batchNo || 0),
      batchCandidateCount: Number(randomPonTestRuntime.candidateCount || 0),
      requestedCountSpec: String(randomPonTestRuntime.requestedCountSpec || ''),
      sourceMode: String(randomPonTestRuntime.activeSourceMode || sourceMeta.sourceMode || 'page'),
      sourceUrl: String(randomPonTestRuntime.activeSourceUrl || sourceMeta.sourceUrl || ''),
      sourceTitle: String(randomPonTestRuntime.activeSourceTitle || sourceMeta.sourceTitle || ''),
      sourcePage: String(randomPonTestRuntime.activeSourcePage || sourceMeta.sourcePage || ''),
      startedAt: new Date(startedAt).toISOString(),
      startedLabel: new Date(startedAt).toLocaleString('ru-RU', { hour12: false }),
      durationMs,
      durationText: `${(durationMs / 1000).toFixed(1)}с`,
      hasRawOutput: Boolean(rawText.trim()),
      rawOutput: rawText,
      fields: captureRandomPonFieldSnapshot(),
      panelText,
      journal: currentRandomPonContractJournalAsText().slice(0, 180000),
    };
    const collectorMeta = randomPonCollectorMeta(captured);
    captured.collectorClass = collectorMeta.className;
    captured.collectorLabel = collectorMeta.label;
    captured.collectorReason = collectorMeta.reason;
    return captured;
  }

  function randomPonDelay(ms) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      const wait = () => {
        if (randomPonTestRuntime.stopRequested || Date.now() - startedAt >= ms) {
          resolve();
          return;
        }
        window.setTimeout(wait, Math.min(250, ms));
      };
      wait();
    });
  }

  function addRandomPonContractsToQueue() {
    if (randomPonTestRuntime.running || diagnosticRuntime.running) return;
    const sourceMode = document.querySelector('#dp-random-source')?.value === 'manual' ? 'manual' : 'page';
    const baseCandidates = sourceMode === 'manual' ? parseManualRandomPonContracts() : collectVisiblePonContracts();
    if (!baseCandidates.length) {
      renderStatus(sourceMode === 'manual'
        ? 'очередь PON: вставленный список договоров пуст'
        : 'очередь PON: на текущей странице PON-договоры не распознаны', 'warning');
      return;
    }

    const room = RANDOM_PON_TEST_QUEUE_LIMIT - randomPonTestRuntime.queue.length;
    if (room <= 0) {
      renderStatus(`очередь PON заполнена: ${RANDOM_PON_TEST_QUEUE_LIMIT}`, 'warning');
      return;
    }

    const allowRepeat = Boolean(document.querySelector('#dp-random-repeat')?.checked);
    const seenResults = randomPonSeenContracts();
    const queued = randomPonQueuedContracts();
    const candidates = baseCandidates.filter(contract => {
      const key = contract.toLowerCase();
      if (queued.has(key)) return false;
      return allowRepeat || !seenResults.has(key);
    });
    const skipped = baseCandidates.length - candidates.length;
    if (!candidates.length) {
      renderStatus(`очередь PON: подходящих новых договоров нет; найдено ${baseCandidates.length}, исключено ${skipped}`, 'warning');
      return;
    }

    const countInput = document.querySelector('#dp-random-count');
    const countSpec = parseRandomPonCountSpec(countInput && countInput.value || '10', Math.min(candidates.length, room));
    if (countInput) countInput.value = countSpec.normalized;
    const sourceMeta = currentRandomPonSourceMeta(sourceMode);
    const selected = shuffledRandomPonContracts(candidates)
      .slice(0, countSpec.selected)
      .map(contract => makeRandomPonQueueItem(contract, sourceMeta))
      .filter(Boolean);
    randomPonTestRuntime.queue.push(...selected);
    randomPonTestRuntime.queue = normalizeRandomPonQueue(randomPonTestRuntime.queue);
    persistRandomPonTestState();
    renderRandomPonTestResults();
    renderStatus(`в очередь добавлено ${selected.length} PON-договоров · всего ${randomPonTestRuntime.queue.length}; опрос ещё не запущен`, 'ok');
    journalLog('info', 'PON-договоры добавлены в накопительную очередь', {
      sourceMode,
      sourceUrl: sourceMeta.sourceUrl,
      sourcePage: sourceMeta.sourcePage,
      candidates: baseCandidates.length,
      skipped,
      countSpec: countSpec.normalized,
      added: selected.length,
      queueTotal: randomPonTestRuntime.queue.length,
    });
  }

  function randomPonQueueSourceSummary(queue) {
    const grouped = new Map();
    for (const item of normalizeRandomPonQueue(queue)) {
      const key = [
        item.sourcePage ? `стр. ${item.sourcePage}` : 'страница без номера',
        item.sourceTitle || item.sourceUrl || item.sourceMode || 'источник не указан',
      ].join(' · ');
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return [...grouped.entries()]
      .map(([source, count]) => `${source}: ${count}`)
      .join(' | ');
  }

  function logRandomPonQueueSnapshot(queue) {
    const contracts = normalizeRandomPonQueue(queue).map(item => item.contract);
    const chunkSize = 25;
    for (let offset = 0; offset < contracts.length; offset += chunkSize) {
      const chunk = contracts.slice(offset, offset + chunkSize);
      journalLog('info', `Очередь цикла · договоры ${offset + 1}–${offset + chunk.length}`, {
        contracts: chunk.join(', '),
      });
    }
  }

  function randomPonBatchStats(batchId) {
    const items = randomPonTestRuntime.results.filter(item => item.batchId === batchId);
    const stats = {
      total: items.length,
      raw: items.filter(item => item.hasRawOutput).length,
      ok: items.filter(item => item.outcome === 'ok').length,
      warn: items.filter(item => item.outcome === 'warning').length,
      error: items.filter(item => item.outcome === 'error').length,
      stopped: items.filter(item => item.outcome === 'stopped').length,
      unresolved: 0,
      conflicts: 0,
    };
    for (const item of items) {
      const meta = randomPonCollectorMeta(item);
      if (meta.className === 'unresolved') stats.unresolved += 1;
      if (meta.className === 'identity-conflict') stats.conflicts += 1;
    }
    return stats;
  }

  function startRandomPonHeartbeat(item) {
    stopRandomPonHeartbeat();
    const startedAt = Date.now();
    randomPonTestRuntime.heartbeatTimer = window.setInterval(() => {
      if (!randomPonTestRuntime.running || randomPonTestRuntime.stopRequested) {
        stopRandomPonHeartbeat();
        return;
      }
      journalLog('info', `PON-цикл · опрос ${item.contract} ещё выполняется`, {
        position: `${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}`,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        queueRemaining: randomPonTestRuntime.queue.length,
        state: 'ожидаю ответ UserSide/Billing/OLT',
      });
    }, 15000);
  }

  function stopRandomPonHeartbeat() {
    if (!randomPonTestRuntime.heartbeatTimer) return;
    window.clearInterval(randomPonTestRuntime.heartbeatTimer);
    randomPonTestRuntime.heartbeatTimer = 0;
  }

  async function runRandomPonTests() {
    if (randomPonTestRuntime.running || diagnosticRuntime.running) return;
    if (blockStartWhenAnotherTabRuns()) return;
    if (!(await acquireWorkspaceLease('random-pon', ''))) return;
    try {
      await executeRandomPonTests();
    } catch (error) {
      const message = error && error.message || String(error);
      try { journalLog('error', 'PON-цикл аварийно завершился', { reason: message }); } catch (_) {}
      renderStatus(`PON-цикл аварийно завершился: ${message}`, 'error');
    } finally {
      releaseWorkspaceLease('PON-цикл завершён или остановлен');
    }
  }

  async function executeRandomPonTests() {
    setWorkspaceView('process');
    if (randomPonTestRuntime.running || diagnosticRuntime.running) return;
    randomPonTestRuntime.queue = normalizeRandomPonQueue(randomPonTestRuntime.queue);
    if (!randomPonTestRuntime.queue.length) {
      renderStatus('очередь PON пуста: сначала собери договоры с одной или нескольких страниц', 'warning');
      return;
    }

    const delayInput = document.querySelector('#dp-random-delay');
    const delaySeconds = Math.max(2, Math.min(30, Number(delayInput && delayInput.value || 3)));
    randomPonTestRuntime.batchNo += 1;
    randomPonTestRuntime.activeBatchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const batchId = randomPonTestRuntime.activeBatchId;
    randomPonTestRuntime.currentIndex = -1;
    randomPonTestRuntime.running = true;
    randomPonTestRuntime.stopRequested = false;
    randomPonTestRuntime.startedAt = Date.now();
    randomPonTestRuntime.runInitialCount = randomPonTestRuntime.queue.length;
    randomPonTestRuntime.runProcessedCount = 0;
    randomPonTestRuntime.candidateCount = randomPonTestRuntime.queue.length;
    randomPonTestRuntime.requestedCountSpec = `queue:${randomPonTestRuntime.queue.length}`;
    randomPonTestRuntime.currentJournalStartIndex = 0;
    stopRandomPonHeartbeat();
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });

    // Отдельный старт системного журнала именно для всего цикла. Последующие
    // runDiagnostics() больше не очищают его между договорами.
    resetSystemJournalForRandomPonBatch();
    journalLog('info', `PON-ЦИКЛ №${randomPonTestRuntime.batchNo} · СТАРТ`, {
      selectedContracts: randomPonTestRuntime.runInitialCount,
      delayBetweenPolls: `${delaySeconds}с`,
      mode: 'последовательно, один активный ONU-опрос',
      sources: randomPonQueueSourceSummary(randomPonTestRuntime.queue) || 'не определены',
      billingSessionPp: safeGetValue(BILLING_PP_KEY, '') ? 'есть' : 'не найден',
    });
    logRandomPonQueueSnapshot(randomPonTestRuntime.queue);

    persistRandomPonTestState();
    renderRandomPonTestResults();
    updateRunControls();
    renderStatus(`PON-цикл №${randomPonTestRuntime.batchNo} запущен · выбрано ${randomPonTestRuntime.runInitialCount} договоров`, 'loading');

    while (randomPonTestRuntime.queue.length && !randomPonTestRuntime.stopRequested) {
      const item = normalizeRandomPonQueueItem(randomPonTestRuntime.queue[0]);
      if (!item) {
        journalLog('warn', 'Некорректная запись удалена из очереди PON-цикла', {
          queueRemainingBefore: randomPonTestRuntime.queue.length,
        });
        randomPonTestRuntime.queue.shift();
        continue;
      }

      randomPonTestRuntime.activeQueueItem = item;
      randomPonTestRuntime.currentIndex = randomPonTestRuntime.runProcessedCount;
      randomPonTestRuntime.activeSourceMode = item.sourceMode;
      randomPonTestRuntime.activeSourceUrl = item.sourceUrl;
      randomPonTestRuntime.activeSourceTitle = item.sourceTitle;
      randomPonTestRuntime.activeSourcePage = item.sourcePage;
      renderRandomPonTestResults();
      renderStatus(`PON-опрос ${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}: ${item.contract}`, 'loading');

      journalLog('decision', `Цикл №${randomPonTestRuntime.batchNo} · передаю договор в диагностику`, {
        contract: item.contract,
        position: `${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}`,
        queueRemaining: randomPonTestRuntime.queue.length,
        sourcePage: item.sourcePage || 'не указана',
        source: item.sourceTitle || item.sourceUrl || item.sourceMode || 'не указан',
      });

      const startedAt = Date.now();
      startRandomPonHeartbeat(item);
      try {
        await runDiagnostics(item.contract);
      } catch (error) {
        const reason = error && error.message || String(error);
        journalLog('error', `PON-цикл · необработанная ошибка договора ${item.contract}`, {
          reason,
          position: `${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}`,
        });
        renderStatus(`PON-опрос ${item.contract}: ${reason}`, 'error');
      } finally {
        stopRandomPonHeartbeat();
      }

      const captured = captureRandomPonTestResult(item.contract, startedAt);
      const collectorMeta = randomPonCollectorMeta(captured);
      journalLog(captured.outcome === 'error' ? 'error'
        : captured.outcome === 'warning' || captured.outcome === 'unknown' || collectorMeta.className ? 'warn'
          : captured.outcome === 'stopped' ? 'warn' : 'ok',
      `PON-цикл · результат ${item.contract} зафиксирован`, {
        position: `${randomPonTestRuntime.runProcessedCount + 1}/${randomPonTestRuntime.runInitialCount}`,
        outcome: randomPonOutcomeLabel(captured),
        specialClass: collectorMeta.label || 'нет',
        duration: captured.durationText,
        raw: captured.hasRawOutput ? 'сохранён' : 'нет',
        summary: captured.summary || captured.statusText || 'без сводки',
      });
      // В карточке результата сохраняется только фрагмент журнала текущего
      // договора, а общий системный журнал продолжает хранить весь цикл.
      captured.journal = currentRandomPonContractJournalAsText().slice(0, 180000);

      const fingerprint = randomPonResultFingerprint(captured);
      if (!randomPonTestRuntime.results.some(result => randomPonResultFingerprint(result) === fingerprint)) {
        randomPonTestRuntime.results.push(captured);
      }
      randomPonTestRuntime.results = dedupeRandomPonHistory(randomPonTestRuntime.results);

      if (captured.outcome !== 'stopped') {
        randomPonTestRuntime.queue.shift();
        randomPonTestRuntime.runProcessedCount += 1;
      }
      persistRandomPonTestState();
      renderRandomPonTestResults();

      if (randomPonTestRuntime.stopRequested || captured.outcome === 'stopped' || !randomPonTestRuntime.queue.length) break;

      const nextItem = normalizeRandomPonQueueItem(randomPonTestRuntime.queue[0]);
      journalLog('info', `PON-цикл · пауза ${delaySeconds}с перед следующим опросом`, {
        completed: randomPonTestRuntime.runProcessedCount,
        remaining: randomPonTestRuntime.queue.length,
        nextContract: nextItem ? nextItem.contract : 'не определён',
      });
      renderStatus(`результат ${item.contract} сохранён${captured.hasRawOutput ? ' с системным выводом' : ' без системного вывода'}; следующий через ${delaySeconds}с`, 'loading');
      const pauseStartedAt = Date.now();
      await randomPonDelay(delaySeconds * 1000);
      if (randomPonTestRuntime.stopRequested) {
        journalLog('warn', 'PON-цикл · пауза прервана оператором', {
          waitedSeconds: ((Date.now() - pauseStartedAt) / 1000).toFixed(1),
          remaining: randomPonTestRuntime.queue.length,
        });
        break;
      }
      journalLog('ok', 'PON-цикл · пауза завершена, продолжаю очередь', {
        waitedSeconds: ((Date.now() - pauseStartedAt) / 1000).toFixed(1),
        nextContract: nextItem ? nextItem.contract : 'не определён',
        remaining: randomPonTestRuntime.queue.length,
      });
    }

    stopRandomPonHeartbeat();
    const stopped = randomPonTestRuntime.stopRequested;
    const stats = randomPonBatchStats(batchId);
    const cycleDurationSeconds = ((Date.now() - randomPonTestRuntime.startedAt) / 1000).toFixed(1);
    journalLog(stopped ? 'warn' : 'ok', `PON-ЦИКЛ №${randomPonTestRuntime.batchNo} · ${stopped ? 'ОСТАНОВЛЕН' : 'ЗАВЕРШЁН'}`, {
      duration: `${cycleDurationSeconds}с`,
      selected: randomPonTestRuntime.runInitialCount,
      processed: stats.total,
      queueRemaining: randomPonTestRuntime.queue.length,
      raw: stats.raw,
      ok: stats.ok,
      warn: stats.warn,
      error: stats.error,
      notPolled: stats.unresolved,
      identityConflicts: stats.conflicts,
      stoppedResults: stats.stopped,
    });

    randomPonTestRuntime.running = false;
    randomPonTestRuntime.currentIndex = -1;
    randomPonTestRuntime.activeQueueItem = null;
    randomPonTestRuntime.currentJournalStartIndex = 0;
    updateRunControls();
    persistRandomPonTestState();
    renderRandomPonTestResults();
    renderStatus(stopped
      ? `опрос остановлен · зафиксировано ${stats.total}, RAW ${stats.raw} · в очереди осталось ${randomPonTestRuntime.queue.length}`
      : `очередь опрошена · зафиксировано ${stats.total}, RAW ${stats.raw} · всего результатов ${randomPonTestRuntime.results.length}`,
    stopped ? 'stopped' : 'ok');
    workspacePendingRemoteState = null;
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });
  }

  function stopRandomPonTests() {
    if (!randomPonTestRuntime.running) {
      if (operationIsFresh(workspaceRemoteOperation) && workspaceRemoteOperation.mode === 'random-pon') {
        requestRemoteWorkspaceStop();
      }
      return;
    }
    randomPonTestRuntime.stopRequested = true;
    stopRandomPonHeartbeat();
    journalLog('warn', `PON-ЦИКЛ №${randomPonTestRuntime.batchNo} · получена команда STOP`, {
      activeContract: randomPonTestRuntime.activeQueueItem && randomPonTestRuntime.activeQueueItem.contract || 'между опросами',
      processed: randomPonTestRuntime.runProcessedCount,
      selected: randomPonTestRuntime.runInitialCount,
      queueRemaining: randomPonTestRuntime.queue.length,
      source: 'кнопка оператора',
    });
    if (diagnosticRuntime.running) stopDiagnostics('рандом-тест остановлен оператором');
    else renderStatus('рандом-тест остановлен оператором', 'stopped');
    renderRandomPonTestResults();
  }

  function randomPonResultsAsText() {
    return randomPonTestRuntime.results.map((item, index) => [
      `${index + 1}. ${item.contract} · ${randomPonOutcomeLabel(item)} · ${item.durationText}${item.hasRawOutput ? ' · RAW' : ''}`,
      item.summary || item.statusText || '',
      [item.oltIp, item.vendor, item.action ? `a=${item.action}` : '', item.onuInterface || item.ponPort].filter(Boolean).join(' · '),
      `серия ${item.batchNo || '?'} · ${item.sourceTitle || item.sourceUrl || item.sourceMode || 'источник не указан'}`,
    ].filter(Boolean).join('\n')).join('\n\n');
  }

  function randomPonResultsAsFullText() {
    return randomPonTestRuntime.results.map((item, index) => {
      const fields = Object.values(item.fields || {})
        .map(field => `${field.label}: ${field.value || '—'}${field.source ? ` [${field.source}]` : ''}`)
        .join('\n');
      return [
        `====== PON SAMPLE ${index + 1}/${randomPonTestRuntime.results.length} ======`,
        `resultId: ${item.resultId || 'legacy'}`,
        `contract: ${item.contract}`,
        `outcome: ${randomPonOutcomeLabel(item)}`,
        `status: ${item.statusText || ''}`,
        `summary: ${item.summary || ''}`,
        `started: ${item.startedLabel || item.startedAt || ''}`,
        `duration: ${item.durationText || ''}`,
        `batch: ${item.batchNo || ''}`,
        `source: ${item.sourceTitle || ''} ${item.sourceUrl || ''}`.trim(),
        `customerId: ${item.customerId || ''}`,
        `OLT: ${[item.oltIp, item.vendor, item.action ? `a=${item.action}` : ''].filter(Boolean).join(' · ')}`,
        `ONU: ${item.onuInterface || item.ponPort || ''}`,
        '',
        '--- FIELDS ---',
        fields,
        '',
        '--- PANEL SNAPSHOT ---',
        item.panelText || '',
        '',
        '--- RAW ONU OUTPUT ---',
        item.rawOutput || '',
        '',
        '--- JOURNAL ---',
        item.journal || '',
      ].join('\n');
    }).join('\n\n');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderStatus(text, state = '') {
    const status = document.querySelector('#dp-status');
    if (!status) return;
    status.className = state;
    status.textContent = text;
    scheduleWorkspacePersist();
  }

  function clearAllFieldResults() {
    const container = document.querySelector('#dp-results');
    if (!container) return;
    container.innerHTML = FIELD_DEFINITIONS.map(field => `
      <div class="dp-field" id="dp-field-${field.key}">
        <div class="dp-field-label">${escapeHtml(field.label)}</div>
        <div class="dp-field-value pending">ожидание…</div>
      </div>
    `).join('') + `
      <div id="dp-mac-route-container"></div>
      <div id="dp-onu-container"></div>
      <div id="dp-port-container"></div>
    `;
    scheduleWorkspacePersist();
  }

  function renderAllFieldsPending() {
    for (const field of FIELD_DEFINITIONS) {
      const el = document.querySelector(`#dp-field-${field.key} .dp-field-value`);
      if (el) {
        el.className = 'dp-field-value pending';
        el.textContent = 'загрузка…';
      }
    }
    scheduleWorkspacePersist();
  }

  function renderFieldResult(key, label, res) {
    const fieldEl = document.querySelector(`#dp-field-${key}`);
    if (!fieldEl) return;
    fieldEl.innerHTML = `
      <div class="dp-field-label">${escapeHtml(label)}</div>
      <div class="dp-field-value">${res.ok ? escapeHtml(res.value) : '<span style="color:#ff7676">не найдено</span>'}</div>
      ${res.source ? `<div class="dp-field-source">${escapeHtml(res.source)}</div>` : ''}
    `;
    scheduleWorkspacePersist();
  }

  function renderAllFieldsFailure(message) {
    for (const field of FIELD_DEFINITIONS) {
      const fieldEl = document.querySelector(`#dp-field-${field.key}`);
      if (!fieldEl) return;
      fieldEl.innerHTML = `
        <div class="dp-field-label">${escapeHtml(field.label)}</div>
        <div class="dp-field-value" style="color:#ff7676">${escapeHtml(message)}</div>
      `;
    }
    scheduleWorkspacePersist();
  }

  function renderMacRoutePending(message, mac, candidate = null, routeType = 'обычная история') {
    const container = document.querySelector('#dp-mac-route-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-mac-route loading">
        <div class="dp-mac-route-head">
          <span class="dp-mac-route-title">Резервный маршрут OLT (MAC ${escapeHtml(mac)})</span>
          <span class="dp-mac-route-state">поиск (${escapeHtml(routeType)})</span>
        </div>
        <div class="dp-mac-route-message">${escapeHtml(message)}</div>
      </div>
    `;
    scheduleWorkspacePersist();
  }

  function renderMacRouteSuccess(alt) {
    const container = document.querySelector('#dp-mac-route-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-mac-route ok">
        <div class="dp-mac-route-head">
          <span class="dp-mac-route-title">Резервный маршрут OLT</span>
          <span class="dp-mac-route-state">подтверждён</span>
        </div>
        <div class="dp-mac-route-value"><b>${escapeHtml(alt.deviceName)}</b> · порту ${escapeHtml(alt.iface)} · OLT IP: <b>${escapeHtml(alt.oltIp)}</b></div>
        <div class="dp-mac-route-meaning">${escapeHtml(alt.interpretation)}</div>
      </div>
    `;
    scheduleWorkspacePersist();
  }

  function renderMacRouteFailure(message) {
    const container = document.querySelector('#dp-mac-route-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-mac-route warning">
        <div class="dp-mac-route-head">
          <span class="dp-mac-route-title">Резервный маршрут OLT</span>
          <span class="dp-mac-route-state">не найден</span>
        </div>
        <div class="dp-mac-route-message">${escapeHtml(message)}</div>
      </div>
    `;
    scheduleWorkspacePersist();
  }

  function renderMacUplinkDownlinkContext(ctx) {}

  function renderOnuPending(message, detail = '') {
    const container = document.querySelector('#dp-onu-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-onu-block loading">
        <div class="dp-onu-head">
          <span class="dp-onu-title">Опрос ONU в Billing</span>
          <span class="dp-onu-state">опрос…</span>
        </div>
        <div class="dp-onu-message">${escapeHtml(message)} ${detail ? `· <i>${escapeHtml(detail)}</i>` : ''}</div>
      </div>
    `;
    scheduleWorkspacePersist();
  }

  function onuReportListHtml(items, emptyText = '') {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) return emptyText ? `<div class="dp-onu-report-empty">${escapeHtml(emptyText)}</div>` : '';
    return `<ul class="dp-onu-report-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function onuReportSectionHtml(title, items, className = '') {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) return '';
    return `
      <section class="dp-onu-report-section ${escapeHtml(className)}">
        <div class="dp-onu-report-title">${escapeHtml(title)}</div>
        ${onuReportListHtml(values)}
      </section>`;
  }

  function renderOnuSuccess(result, meta) {
    const container = document.querySelector('#dp-onu-container');
    if (!container) return;
    const analysis = result && result.analysis;
    const report = analysis && analysis.report || {
      severity: 'unknown',
      badge: 'UNKNOWN',
      summary: 'Ответ OLT получен, но автоматическая интерпретация недоступна.',
      current: [],
      deviations: [],
      history: [],
      causes: null,
      conclusion: 'Открой полный ответ OLT для ручной проверки.',
    };
    const blockClass = report.severity === 'ok' ? 'ok'
      : report.severity === 'error' ? 'error'
      : report.severity === 'conflict' ? 'conflict'
      : report.severity === 'unknown' ? 'unknown'
      : 'warning';
    const rawOutput = String(result.rawOutput || result.output || '');
    const facts = analysis && analysis.facts;
    const identity = [
      facts && facts.onuInterface ? `ONU ${facts.onuInterface}` : '',
      facts && facts.serial ? `SN ${facts.serial}` : '',
    ].filter(Boolean).join(' · ');

    container.innerHTML = `
      <div class="dp-onu-block ${blockClass}">
        <div class="dp-onu-head">
          <span class="dp-onu-title">Опрос ONU: результат получен</span>
          <span class="dp-onu-state">${escapeHtml(report.badge)}</span>
        </div>
        <div class="dp-onu-meta">${escapeHtml(meta.technology)} · OLT ${escapeHtml(meta.oltIp)}${identity ? ` · ${escapeHtml(identity)}` : ''}</div>
        <div class="dp-onu-meta">${escapeHtml(meta.source)}</div>
        <div class="dp-onu-summary">${escapeHtml(report.summary)}</div>
        ${onuReportSectionHtml('Текущая картина', report.current)}
        ${onuReportSectionHtml('Обнаружено', report.deviations, 'deviations')}
        ${onuReportSectionHtml('История', report.history)}
        ${report.causes ? `
          <details class="dp-onu-causes">
            <summary>${escapeHtml(report.causes.title)}</summary>
            ${onuReportListHtml(report.causes.items)}
          </details>` : ''}
        ${report.conclusion ? `
          <section class="dp-onu-conclusion">
            <div class="dp-onu-report-title">Вывод</div>
            <div>${escapeHtml(report.conclusion)}</div>
          </section>` : ''}
        <details class="dp-onu-raw">
          <summary>Показать полный ответ OLT</summary>
          <pre class="dp-onu-output">${escapeHtml(rawOutput)}</pre>
        </details>
      </div>
    `;
    scheduleWorkspacePersist();
  }
  function renderOnuFailure(message, output, meta = {}) {
    const container = document.querySelector('#dp-onu-container');
    if (!container) return;
    container.innerHTML = `
      <div class="dp-onu-block ${meta.warning ? 'warning' : 'error'}">
        <div class="dp-onu-head">
          <span class="dp-onu-title">Опрос ONU: Не подтверждён</span>
          <span class="dp-onu-state">${escapeHtml(meta.stateText || 'нет ответа')}</span>
        </div>
        <div class="dp-onu-message">${escapeHtml(message)}</div>
        ${output ? `<details class="dp-onu-raw"><summary>Показать полный ответ OLT</summary><pre class="dp-onu-output">${escapeHtml(output)}</pre></details>` : ''}
      </div>
    `;
    scheduleWorkspacePersist();
  }

  function clampJournalHeight(rawHeight) {
    const panel = document.querySelector('#dp-panel');
    const panelHeight = panel ? panel.getBoundingClientRect().height : 760;
    const maxHeight = Math.max(120, panelHeight - 330);
    return Math.max(60, Math.min(maxHeight, Number(rawHeight) || 150));
  }

  function applyJournalHeight(rawHeight, persist = false) {
    const list = document.querySelector('#dp-journal-list');
    if (!list) return 150;
    const height = clampJournalHeight(rawHeight);
    list.style.setProperty('height', `${height}px`, 'important');
    if (persist) {
      try { GM_setValue(JOURNAL_HEIGHT_KEY, Math.round(height)); } catch (_) {}
    }
    return height;
  }

  function installJournalResizer() {
    const resizer = document.querySelector('#dp-journal-resizer');
    const list = document.querySelector('#dp-journal-list');
    if (!resizer || !list) return;
    applyJournalHeight(Number(safeGetValue(JOURNAL_HEIGHT_KEY, 150)) || 150, false);

    let startY = 0;
    let startHeight = 0;
    let pointerId = null;
    const stop = () => {
      if (pointerId === null) return;
      pointerId = null;
      resizer.classList.remove('dragging');
      document.body.style.removeProperty('user-select');
      applyJournalHeight(list.getBoundingClientRect().height, true);
      scheduleWorkspacePersist();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
    };
    const move = event => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const delta = startY - event.clientY;
      applyJournalHeight(startHeight + delta, false);
      event.preventDefault();
    };
    resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      startHeight = list.getBoundingClientRect().height;
      resizer.classList.add('dragging');
      document.body.style.setProperty('user-select', 'none', 'important');
      try { resizer.setPointerCapture(pointerId); } catch (_) {}
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', stop, true);
      window.addEventListener('pointercancel', stop, true);
      event.preventDefault();
    });
    window.addEventListener('resize', () => applyJournalHeight(list.getBoundingClientRect().height, false));
  }


  function capturePageDockBase() {
    const body = document.body;
    const html = document.documentElement;
    if (!body || !html || (pageDockRuntime.body === body && pageDockRuntime.html === html)) return;
    pageDockRuntime.body = body;
    pageDockRuntime.html = html;
    pageDockRuntime.basePaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    pageDockRuntime.baseBodyInline = {
      width: body.style.getPropertyValue('width'),
      widthPriority: body.style.getPropertyPriority('width'),
      maxWidth: body.style.getPropertyValue('max-width'),
      maxWidthPriority: body.style.getPropertyPriority('max-width'),
      paddingRight: body.style.getPropertyValue('padding-right'),
      paddingRightPriority: body.style.getPropertyPriority('padding-right'),
      boxSizing: body.style.getPropertyValue('box-sizing'),
      boxSizingPriority: body.style.getPropertyPriority('box-sizing'),
      overflowX: body.style.getPropertyValue('overflow-x'),
      overflowXPriority: body.style.getPropertyPriority('overflow-x'),
    };
    pageDockRuntime.baseHtmlInline = {
      width: html.style.getPropertyValue('width'),
      widthPriority: html.style.getPropertyPriority('width'),
      maxWidth: html.style.getPropertyValue('max-width'),
      maxWidthPriority: html.style.getPropertyPriority('max-width'),
      boxSizing: html.style.getPropertyValue('box-sizing'),
      boxSizingPriority: html.style.getPropertyPriority('box-sizing'),
      overflowX: html.style.getPropertyValue('overflow-x'),
      overflowXPriority: html.style.getPropertyPriority('overflow-x'),
    };
  }

  function restoreInlineProperty(node, name, value, priority = '') {
    if (!node) return;
    if (value) node.style.setProperty(name, value, priority || '');
    else node.style.removeProperty(name);
  }

  function applyPageDockReservation(panelWidth) {
    capturePageDockBase();
    const body = document.body;
    const html = document.documentElement;
    if (!body || !html) return 0;

    const reserve = window.innerWidth >= PANEL_DOCK_RESERVE_BREAKPOINT
      ? Math.max(0, Math.round(Number(panelWidth) || 0))
      : 0;
    const bodyBase = pageDockRuntime.baseBodyInline || {};
    const htmlBase = pageDockRuntime.baseHtmlInline || {};

    if (reserve > 0) {
      const pageWidth = `calc(100vw - ${reserve}px)`;
      // Настоящий dock: уменьшается корневой бокс страницы, а не добавляется
      // пустой padding. Поэтому шапки и блоки width:100% также заканчиваются
      // у левой границы Workbench.
      html.style.setProperty('width', pageWidth, 'important');
      html.style.setProperty('max-width', pageWidth, 'important');
      html.style.setProperty('box-sizing', 'border-box', 'important');
      html.style.setProperty('overflow-x', 'auto', 'important');
      body.style.setProperty('width', '100%', 'important');
      body.style.setProperty('max-width', '100%', 'important');
      body.style.setProperty('padding-right', `${pageDockRuntime.basePaddingRight}px`, 'important');
      body.style.setProperty('box-sizing', 'border-box', 'important');
      body.style.setProperty('overflow-x', 'auto', 'important');
    } else {
      restoreInlineProperty(html, 'width', htmlBase.width, htmlBase.widthPriority);
      restoreInlineProperty(html, 'max-width', htmlBase.maxWidth, htmlBase.maxWidthPriority);
      restoreInlineProperty(html, 'box-sizing', htmlBase.boxSizing, htmlBase.boxSizingPriority);
      restoreInlineProperty(html, 'overflow-x', htmlBase.overflowX, htmlBase.overflowXPriority);
      restoreInlineProperty(body, 'width', bodyBase.width, bodyBase.widthPriority);
      restoreInlineProperty(body, 'max-width', bodyBase.maxWidth, bodyBase.maxWidthPriority);
      restoreInlineProperty(body, 'padding-right', bodyBase.paddingRight, bodyBase.paddingRightPriority);
      restoreInlineProperty(body, 'box-sizing', bodyBase.boxSizing, bodyBase.boxSizingPriority);
      restoreInlineProperty(body, 'overflow-x', bodyBase.overflowX, bodyBase.overflowXPriority);
    }

    html.style.setProperty('--dp-workbench-dock-space', `${reserve}px`);
    html.classList.toggle('dp-workbench-dock-reserved', reserve > 0);
    return reserve;
  }

  function defaultPanelGeometry() {
    return {
      width: Math.min(
        PANEL_DOCK_MAX_WIDTH,
        Math.max(PANEL_DOCK_MIN_WIDTH, Math.min(PANEL_DOCK_DEFAULT_WIDTH, window.innerWidth - 12)),
      ),
      height: Math.max(260, window.innerHeight || 760),
    };
  }

  function clampPanelGeometry(raw = {}) {
    const viewportWidth = Math.max(320, window.innerWidth || 320);
    const minWidth = Math.min(PANEL_DOCK_MIN_WIDTH, Math.max(280, viewportWidth - 12));
    const desktopMax = Math.min(PANEL_DOCK_MAX_WIDTH, Math.floor(viewportWidth * 0.58));
    const maxWidth = viewportWidth < PANEL_DOCK_RESERVE_BREAKPOINT
      ? Math.max(minWidth, viewportWidth - 12)
      : Math.max(minWidth, desktopMax);
    return {
      width: Math.min(Math.max(minWidth, Number(raw.width) || PANEL_DOCK_DEFAULT_WIDTH), maxWidth),
      height: Math.max(260, window.innerHeight || Number(raw.height) || 760),
    };
  }

  function currentPanelGeometry() {
    const panel = document.querySelector('#dp-panel');
    if (!panel) return defaultPanelGeometry();
    const saved = safeGetValue(PANEL_GEOMETRY_KEY, null);
    const expandedWidth = Number(
      panel.dataset.expandedWidth
      || (saved && saved.width)
      || (!panel.classList.contains('collapsed') ? panel.getBoundingClientRect().width : 0)
      || PANEL_DOCK_DEFAULT_WIDTH
    );
    return clampPanelGeometry({ width: expandedWidth, height: window.innerHeight });
  }

  function applyPanelGeometry(rawGeometry, persist = false) {
    const panel = document.querySelector('#dp-panel');
    if (!panel) return null;
    const geometry = clampPanelGeometry(rawGeometry);
    const collapsed = panel.classList.contains('collapsed');
    const visibleWidth = collapsed ? PANEL_DOCK_COLLAPSED_WIDTH : geometry.width;

    const dockSide = String(safeGetValue(PANEL_SIDE_KEY, 'right') || 'right') === 'left' ? 'left' : 'right';
    panel.dataset.dockSide = dockSide;
    panel.style.setProperty('position', 'fixed', 'important');
    panel.style.setProperty('inset', '0 auto 0 auto', 'important');
    panel.style.setProperty('left', dockSide === 'left' ? '0' : 'auto', 'important');
    panel.style.setProperty('top', '0', 'important');
    panel.style.setProperty('right', dockSide === 'right' ? '0' : 'auto', 'important');
    panel.style.setProperty('bottom', '0', 'important');
    panel.style.setProperty('margin', '0', 'important');
    panel.style.setProperty('transform', 'none', 'important');
    panel.style.setProperty('border-radius', '0', 'important');
    panel.style.setProperty('width', `${Math.round(visibleWidth)}px`, 'important');
    panel.style.setProperty('height', '100dvh', 'important');
    panel.style.setProperty('min-height', '100vh', 'important');
    panel.dataset.expandedWidth = String(Math.round(geometry.width));
    // Панель не должна ломать страницу при открытом DevTools или уменьшении окна.
    // На широком viewport она резервирует место справа, на ограниченном — становится
    // независимым overlay и не сжимает UserSide/Billing.
    const viewportWidth = Math.max(320, window.innerWidth || 320);
    const overlayMode = !collapsed && (dockSide === 'left' || viewportWidth < PANEL_DOCK_RESERVE_BREAKPOINT || visibleWidth > viewportWidth * 0.48);
    panel.classList.toggle('overlay-mode', overlayMode);
    panel.style.setProperty('border-radius', overlayMode ? (dockSide === 'left' ? '0 12px 12px 0' : '12px 0 0 12px') : '0', 'important');
    panel.classList.toggle('compact-layout', !collapsed && geometry.width < 560);
    panel.classList.toggle('random-wide-layout', !collapsed && geometry.width >= 760);
    const randomWideButton = document.querySelector('#dp-random-wide');
    if (randomWideButton) {
      const wide = !collapsed && geometry.width >= 760;
      randomWideButton.textContent = wide ? 'Компактно' : 'Расширить';
      randomWideButton.title = wide
        ? 'Вернуть компактную ширину панели'
        : 'Расширить рабочую область результатов и очереди';
    }
    applyPageDockReservation(overlayMode ? 0 : visibleWidth);

    if (persist) {
      try { GM_setValue(PANEL_GEOMETRY_KEY, { width: geometry.width, height: geometry.height }); } catch (_) {}
    }
    return geometry;
  }

  function setPanelCollapsed(collapsed, persist = true) {
    const panel = document.querySelector('#dp-panel');
    const button = document.querySelector('#dp-minimize');
    if (!panel) return;
    const next = Boolean(collapsed);
    if (next && !panel.classList.contains('collapsed')) {
      panel.dataset.expandedWidth = String(Math.round(panel.getBoundingClientRect().width));
    }
    panel.classList.toggle('collapsed', next);
    if (button) {
      button.textContent = next ? '‹' : '›';
      button.title = next ? 'Развернуть боковую панель' : 'Свернуть боковую панель';
    }
    applyPanelGeometry(currentPanelGeometry(), false);
    if (!next) applyJournalHeight(Number(safeGetValue(JOURNAL_HEIGHT_KEY, 150)) || 150, false);
    if (persist) {
      try { GM_setValue(PANEL_COLLAPSED_KEY, next); } catch (_) {}
      scheduleWorkspacePersist();
    }
  }

  function installPanelMovementAndResize() {
    const panel = document.querySelector('#dp-panel');
    const resizeHandle = document.querySelector('#dp-panel-resize');
    const resetButton = document.querySelector('#dp-reset-panel');
    if (!panel || !resizeHandle) return;

    const saved = safeGetValue(PANEL_GEOMETRY_KEY, null);
    const initialGeometry = saved && typeof saved === 'object'
      ? { width: saved.width || PANEL_DOCK_DEFAULT_WIDTH, height: window.innerHeight }
      : defaultPanelGeometry();
    panel.dataset.expandedWidth = String(Math.round(clampPanelGeometry(initialGeometry).width));
    panel.classList.toggle('collapsed', Boolean(safeGetValue(PANEL_COLLAPSED_KEY, false)));
    setPanelCollapsed(panel.classList.contains('collapsed'), false);

    let pointerId = null;
    let startX = 0;
    let startWidth = 0;

    const stop = event => {
      if (pointerId === null) return;
      if (event && event.pointerId !== undefined && event.pointerId !== pointerId) return;
      pointerId = null;
      panel.classList.remove('resizing');
      document.body.style.removeProperty('user-select');
      applyPanelGeometry(currentPanelGeometry(), true);
      scheduleWorkspacePersist();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
    };

    const move = event => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const nextWidth = startWidth - (event.clientX - startX);
      applyPanelGeometry({ width: nextWidth, height: window.innerHeight }, false);
      event.preventDefault();
    };

    resizeHandle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pointerId !== null || panel.classList.contains('collapsed')) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = currentPanelGeometry().width;
      panel.classList.add('resizing');
      document.body.style.setProperty('user-select', 'none', 'important');
      try { resizeHandle.setPointerCapture(pointerId); } catch (_) {}
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', stop, true);
      window.addEventListener('pointercancel', stop, true);
      event.preventDefault();
    });

    if (resetButton) {
      resetButton.addEventListener('click', () => {
        panel.dataset.expandedWidth = String(PANEL_DOCK_DEFAULT_WIDTH);
        setPanelCollapsed(false, true);
        applyPanelGeometry(defaultPanelGeometry(), true);
      });
    }

    window.addEventListener('resize', () => {
      applyPanelGeometry(currentPanelGeometry(), true);
      applyJournalHeight(document.querySelector('#dp-journal-list')?.getBoundingClientRect().height || 150, false);
    });
  }

  /* ============================ UI ИНИЦИАЛИЗАЦИЯ ============================ */
  dpAddStyle(`
    html.dp-workbench-dock-reserved { margin-right: 0 !important; }
    html.dp-workbench-dock-reserved body { margin-right: 0 !important; }
    #dp-panel, #dp-panel * { box-sizing: border-box; }
    #dp-panel {
      --dp-bg: #111827;
      --dp-surface: #182235;
      --dp-surface-2: #202c42;
      --dp-border: #40506a;
      --dp-text: #f4f7fb;
      --dp-muted: #b8c2d3;
      --dp-accent: #5ee7d3;
      --dp-blue: #7db7ff;
      --dp-ok: #70e1a1;
      --dp-warn: #ffd166;
      --dp-error: #ff858f;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      left: auto !important;
      z-index: 2147483646 !important;
      width: 430px !important;
      height: 100dvh !important;
      min-width: 340px !important;
      min-height: 100vh !important;
      max-width: min(720px, 58vw) !important;
      max-height: 100vh !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      color: var(--dp-text) !important;
      background: var(--dp-bg) !important;
      border: 0 !important;
      border-left: 2px solid #43536c !important;
      border-radius: 0 !important;
      margin: 0 !important;
      transform: none !important;
      box-shadow: -2px 0 7px rgba(0, 0, 0, .22) !important;
      contain: layout paint style !important;
      isolation: isolate !important;
      font: 13.5px/1.48 Inter, "Segoe UI", Arial, sans-serif !important;
      letter-spacing: .01em !important;
    }
    #dp-head {
      display: flex !important;
      cursor: default !important;
      touch-action: none !important;
      align-items: center !important;
      justify-content: space-between !important;
      min-height: 46px !important;
      padding: 10px 14px !important;
      color: #ffffff !important;
      background: linear-gradient(135deg, #23334d, #172239) !important;
      border-bottom: 1px solid var(--dp-border) !important;
    }
    #dp-head b { font-size: 15px !important; font-weight: 750 !important; letter-spacing: .02em !important; }
    .dp-version { margin-left: 5px !important; color: #9fb2ca !important; font-size: 10px !important; font-weight: 800 !important; vertical-align: middle !important; }
    .dp-head-title { display: flex !important; flex-direction: column !important; gap: 3px !important; min-width: 0 !important; }
    #dp-session-badge {
      width: max-content !important;
      max-width: 100% !important;
      padding: 2px 7px !important;
      border: 1px solid !important;
      border-radius: 999px !important;
      font-size: 10.5px !important;
      font-weight: 750 !important;
      line-height: 1.35 !important;
    }
    #dp-session-badge.ok { color: #d9ffe8 !important; background: #17412f !important; border-color: #4da777 !important; }
    #dp-session-badge.pending { color: #ddecff !important; background: #233a5d !important; border-color: #5f8fc8 !important; }
    #dp-session-badge.missing { color: #fff1c7 !important; background: #4a3818 !important; border-color: #a9843f !important; }
    #dp-sync-badge {
      width: max-content !important;
      max-width: 100% !important;
      padding: 2px 7px !important;
      border: 1px solid #526784 !important;
      border-radius: 999px !important;
      color: #d8e7fb !important;
      background: #1e2c43 !important;
      font-size: 10px !important;
      font-weight: 750 !important;
      line-height: 1.35 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #dp-sync-badge.local { color: #d9ffe8 !important; background: #17412f !important; border-color: #4da777 !important; }
    #dp-sync-badge.remote { color: #f2e9ff !important; background: #4a2767 !important; border-color: #b084e7 !important; }
    #dp-role-banner {
      display: grid !important;
      gap: 2px !important;
      min-height: 48px !important;
      padding: 8px 14px !important;
      border-bottom: 1px solid var(--dp-border) !important;
      border-left: 6px solid #5f789b !important;
      background: #1b273b !important;
    }
    #dp-role-banner b { font-size: 12px !important; letter-spacing: .045em !important; }
    #dp-role-banner span { color: #bdc9da !important; font-size: 11px !important; line-height: 1.4 !important; }
    #dp-role-banner.owner { border-left-color: #48c78e !important; background: #153729 !important; }
    #dp-role-banner.owner b { color: #d9ffe8 !important; }
    #dp-role-banner.owner span { color: #bcebd2 !important; }
    #dp-role-banner.mirror { border-left-color: #b084e7 !important; background: #342047 !important; }
    #dp-role-banner.mirror b { color: #f5eaff !important; }
    #dp-role-banner.mirror span { color: #ddc9f4 !important; }
    #dp-role-banner.idle b { color: #d8e7fb !important; }
    #dp-panel[data-tab-role="owner"] { box-shadow: -4px 0 0 #48c78e, -2px 0 9px rgba(0,0,0,.28) !important; }
    #dp-panel[data-tab-role="mirror"] { box-shadow: -4px 0 0 #b084e7, -2px 0 9px rgba(0,0,0,.28) !important; }
    #dp-panel[data-tab-role="mirror"] #dp-form { background: #1c1730 !important; }
    #dp-panel[data-tab-role="mirror"] #dp-input[readonly] { color: #b8bfd0 !important; border-color: #745f94 !important; }
    .dp-head-controls { display:flex !important; align-items:center !important; gap:6px !important; }
    #dp-reload-extension {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      height: 28px !important;
      padding: 0 7px !important;
      color: #d9ffe8 !important;
      background: #17412f !important;
      border: 1px solid #4da777 !important;
      border-radius: 8px !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      line-height: 1 !important;
      white-space: nowrap !important;
    }
    #dp-reload-extension:hover { background: #205b42 !important; }
    #dp-reload-extension:disabled { cursor: wait !important; opacity: .72 !important; }
    #dp-reset-panel, #dp-minimize {
      display: grid !important;
      place-items: center !important;
      width: 30px !important;
      height: 28px !important;
      color: #ffffff !important;
      background: #34445f !important;
      border: 1px solid #667895 !important;
      border-radius: 8px !important;
      font-size: 18px !important;
      line-height: 1 !important;
    }
    #dp-status {
      min-height: 42px !important;
      padding: 10px 14px !important;
      color: var(--dp-text) !important;
      background: #162033 !important;
      border-bottom: 1px solid #35435a !important;
      font-weight: 650 !important;
    }
    #dp-status.loading { color: #d9edff !important; border-left: 5px solid var(--dp-blue) !important; }
    #dp-status.ok { color: #d9ffe8 !important; background: #133025 !important; border-left: 5px solid var(--dp-ok) !important; }
    #dp-status.warning { color: #fff1c7 !important; background: #382d18 !important; border-left: 5px solid var(--dp-warn) !important; }
    #dp-status.error { color: #ffe2e5 !important; background: #3a1d27 !important; border-left: 5px solid var(--dp-error) !important; }
    #dp-status.stopped { color: #fff1c7 !important; background: #382d18 !important; border-left: 5px solid var(--dp-warn) !important; }
    #dp-billing-provider {
      display: grid !important;
      grid-template-columns: auto minmax(118px, auto) minmax(0, 1fr) !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 8px 14px !important;
      color: var(--dp-text) !important;
      background: #162033 !important;
      border-bottom: 1px solid #35435a !important;
    }
    #dp-billing-provider > span { font-size: 11px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: .05em !important; }
    #dp-billing-provider-mode {
      height: 32px !important;
      padding: 0 28px 0 9px !important;
      color: #ffffff !important;
      background: #0c1422 !important;
      border: 1px solid #60718f !important;
      border-radius: 7px !important;
      font: 700 12px/1 "Segoe UI", Arial, sans-serif !important;
    }
    #dp-billing-provider-mode:focus { border-color: var(--dp-accent) !important; outline: none !important; }
    #dp-billing-provider-mode:disabled { cursor: not-allowed !important; opacity: .65 !important; }
    #dp-billing-provider-state { min-width: 0 !important; color: var(--dp-muted) !important; font-size: 11px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
    #dp-form {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto auto auto auto !important;
      gap: 8px !important;
      padding: 12px 14px !important;
      background: var(--dp-surface) !important;
      border-bottom: 1px solid var(--dp-border) !important;
    }
    #dp-input {
      width: 100% !important;
      min-width: 0 !important;
      height: 40px !important;
      padding: 0 12px !important;
      color: #ffffff !important;
      caret-color: var(--dp-accent) !important;
      background: #0c1422 !important;
      border: 1px solid #60718f !important;
      border-radius: 9px !important;
      outline: none !important;
      font: 650 14px/1 "Segoe UI", Arial, sans-serif !important;
    }
    #dp-input::placeholder { color: #9eabc0 !important; opacity: 1 !important; }
    #dp-input:focus { border-color: var(--dp-accent) !important; box-shadow: 0 0 0 3px rgba(94, 231, 211, .16) !important; }
    #dp-run, #dp-port-run, #dp-random-toggle, #dp-stop {
      min-width: 72px !important;
      height: 40px !important;
      padding: 0 13px !important;
      border-radius: 9px !important;
      font: 750 13px/1 "Segoe UI", Arial, sans-serif !important;
      cursor: pointer !important;
    }
    #dp-run { color: #071b18 !important; background: var(--dp-accent) !important; border: 1px solid #91f4e5 !important; }
    #dp-port-run { min-width: 138px !important; color: #eaf4ff !important; background: #265a83 !important; border: 1px solid #68a9d7 !important; }
    #dp-random-toggle { min-width: 116px !important; color: #f2ecff !important; background: #55417a !important; border: 1px solid #8e76bb !important; }
    #dp-stop { color: #fff5f5 !important; background: #b83f50 !important; border: 1px solid #f47b8a !important; }
    #dp-run:disabled, #dp-port-run:disabled, #dp-random-toggle:disabled, #dp-stop:disabled { cursor: default !important; filter: grayscale(.65) !important; opacity: .46 !important; }
    #dp-random-panel {
      flex: 0 1 auto !important;
      max-height: 62vh !important;
      overflow: auto !important;
      padding: 10px 12px !important;
      background: #151d2d !important;
      border-bottom: 1px solid var(--dp-border) !important;
    }
    #dp-random-panel[hidden] { display: none !important; }
    #dp-panel.random-wide-layout #dp-random-panel { max-height: 72vh !important; }
    .dp-random-head { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:10px !important; margin-bottom:8px !important; }
    .dp-random-head > div { display:grid !important; gap:2px !important; min-width:0 !important; }
    .dp-random-head b { color:#f4efff !important; }
    .dp-random-head span { color:#aebbd0 !important; font-size:11px !important; }
    #dp-random-wide { flex:0 0 auto !important; min-width:58px !important; height:28px !important; padding:0 9px !important; color:#eaf4ff !important; background:#28364b !important; border:1px solid #61728e !important; border-radius:7px !important; font:750 11px/1 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    #dp-random-contracts { width:100% !important; min-height:62px !important; resize:vertical !important; padding:8px 10px !important; color:#f4f7fb !important; background:#0c1422 !important; border:1px solid #566681 !important; border-radius:7px !important; font:12px/1.4 Consolas,monospace !important; }
    .dp-random-settings { display:grid !important; grid-template-columns:1fr 1fr !important; gap:8px !important; margin:8px 0 !important; }
    .dp-random-settings label { display:grid !important; grid-template-columns:1fr minmax(82px,120px) !important; align-items:center !important; gap:6px !important; color:#b8c2d3 !important; font-size:11.5px !important; }
    .dp-random-settings input, .dp-random-settings select { width:100% !important; height:30px !important; padding:0 7px !important; color:#fff !important; background:#0c1422 !important; border:1px solid #566681 !important; border-radius:6px !important; }
    .dp-random-repeat { display:flex !important; align-items:center !important; gap:7px !important; margin:4px 0 8px !important; color:#aebbd0 !important; font-size:11.5px !important; }
    .dp-random-repeat input { width:16px !important; height:16px !important; }
    .dp-random-actions { display:flex !important; flex-wrap:wrap !important; gap:6px !important; }
    .dp-random-actions button { min-height:32px !important; padding:0 10px !important; color:#eef4ff !important; background:#27354b !important; border:1px solid #61728e !important; border-radius:7px !important; font:700 11.5px/1 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    #dp-random-start { background:#2b6c56 !important; border-color:#58a98a !important; }
    #dp-random-stop { background:#8d3443 !important; border-color:#cf6675 !important; }
    .dp-random-actions button:disabled { opacity:.45 !important; cursor:default !important; }
    #dp-random-summary { margin:8px 0 6px !important; color:#d4deeb !important; font-size:11.5px !important; font-weight:650 !important; }
    .dp-random-live { display:grid !important; grid-template-columns:12px minmax(0,1fr) auto !important; align-items:center !important; gap:9px !important; margin:0 0 8px !important; padding:8px 10px !important; border:1px solid #3c4b62 !important; border-radius:8px !important; background:#111827 !important; }
    .dp-random-live > div { display:grid !important; gap:2px !important; min-width:0 !important; }
    .dp-random-live b { color:#f4f7fb !important; font-size:11.5px !important; }
    .dp-random-live span:not(.dp-random-live-dot) { color:#aebbd0 !important; font-size:10.8px !important; overflow-wrap:anywhere !important; }
    .dp-random-live strong { color:#e7edf6 !important; font-size:11px !important; white-space:nowrap !important; }
    .dp-random-live-dot { width:9px !important; height:9px !important; border-radius:50% !important; background:#64748b !important; }
    .dp-random-live.owner { border-color:#2f9a74 !important; background:#10271f !important; }
    .dp-random-live.owner .dp-random-live-dot { background:#55e3ad !important; animation:dp-random-pulse 1.15s infinite ease-in-out !important; }
    .dp-random-live.mirror { border-color:#8b6fc1 !important; background:#211a32 !important; }
    .dp-random-live.mirror .dp-random-live-dot { background:#b99af3 !important; animation:dp-random-pulse 1.15s infinite ease-in-out !important; }
    .dp-random-live.ready { border-color:#4c78a8 !important; background:#132236 !important; }
    .dp-random-live.ready .dp-random-live-dot { background:#64a8ed !important; }
    .dp-random-live.done { border-color:#3d8d68 !important; background:#13261f !important; }
    .dp-random-live.done .dp-random-live-dot { background:#60d394 !important; }
    @keyframes dp-random-pulse { 0%,100%{transform:scale(.75);opacity:.55} 50%{transform:scale(1.25);opacity:1} }
    #dp-random-workspace { display:grid !important; grid-template-columns:minmax(0,1fr) !important; gap:10px !important; align-items:start !important; }
    #dp-panel.random-wide-layout #dp-random-workspace { grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr) !important; }
    .dp-random-column { min-width:0 !important; }
    .dp-random-section-head { position:sticky !important; top:-10px !important; z-index:2 !important; display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; margin:0 0 5px !important; padding:7px 8px !important; color:#eef4ff !important; background:#1b2639 !important; border:1px solid #3a4961 !important; border-radius:7px !important; }
    .dp-random-section-head b { font-size:11.5px !important; }
    .dp-random-section-head span { color:#aab8cc !important; font-size:10.5px !important; }
    #dp-random-queue { margin:0 !important; border:1px solid #344157 !important; border-radius:7px !important; overflow:hidden !important; }
    .dp-random-queue-item { display:grid !important; grid-template-columns:30px minmax(90px,auto) minmax(0,1fr) 28px !important; align-items:center !important; gap:6px !important; min-height:32px !important; padding:4px 6px !important; color:#edf3fb !important; background:#101827 !important; border-bottom:1px solid #29364b !important; }
    .dp-random-queue-item:last-child { border-bottom:0 !important; }
    .dp-random-queue-item.active { background:#20344f !important; box-shadow:inset 4px 0 0 #5ee7d3 !important; }
    .dp-random-queue-state { display:inline-grid !important; place-items:center !important; min-width:24px !important; height:22px !important; padding:0 4px !important; color:#91a0b6 !important; background:#1b2639 !important; border:1px solid #40506a !important; border-radius:11px !important; font:750 10px/1 "Segoe UI",Arial,sans-serif !important; }
    .dp-random-queue-state.active { color:#08241d !important; background:#5ee7d3 !important; border-color:#9af3e6 !important; animation:dp-random-pulse 1.15s infinite ease-in-out !important; }
    .dp-random-queue-item small { color:#96a5ba !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-random-queue-item button { width:26px !important; height:24px !important; padding:0 !important; color:#e8eef7 !important; background:#28364b !important; border:1px solid #596b87 !important; border-radius:5px !important; cursor:pointer !important; }
    .dp-random-queue-item button:disabled { opacity:.4 !important; cursor:default !important; }
    .dp-random-result { margin-top:6px !important; border:1px solid #40506a !important; border-radius:7px !important; background:#111827 !important; }
    .dp-random-result.ok { border-left:4px solid var(--dp-ok) !important; }
    .dp-random-result.warning { border-left:4px solid var(--dp-warn) !important; }
    .dp-random-result.error { border-left:4px solid var(--dp-error) !important; }
    .dp-random-result.unresolved { border-left:5px solid #4fc3f7 !important; background:#102131 !important; }
    .dp-random-result.identity-conflict { border-left:5px solid #b388ff !important; background:#211a32 !important; }
    .dp-random-result.unresolved .dp-random-badge { color:#8bddff !important; }
    .dp-random-result.identity-conflict .dp-random-badge { color:#d4b9ff !important; }
    .dp-random-special-reason { color:#aee8ff !important; }
    .dp-random-result.identity-conflict .dp-random-special-reason { color:#decaff !important; }
    .dp-random-result.stopped { border-left:4px solid #aab7c9 !important; }
    #dp-random-results { min-width:0 !important; }
    .dp-random-result > summary { display:grid !important; grid-template-columns:24px minmax(0,1fr) auto auto !important; align-items:center !important; gap:8px !important; padding:7px 8px !important; cursor:pointer !important; color:#eef3fa !important; }
    .dp-random-contract-name { min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; font-weight:800 !important; }
    .dp-random-poll-mark { display:inline-grid !important; place-items:center !important; width:22px !important; height:22px !important; border-radius:50% !important; color:#dce5f2 !important; background:#253247 !important; border:1px solid #52647f !important; font:900 13px/1 "Segoe UI",Arial,sans-serif !important; }
    .dp-random-poll-mark.polled { color:#08251b !important; background:#5ee08f !important; border-color:#9cf0b9 !important; box-shadow:0 0 0 2px rgba(94,224,143,.12) !important; }
    .dp-random-poll-mark.unresolved { color:#08212c !important; background:#71d5ff !important; border-color:#b3eaff !important; }
    .dp-random-poll-mark.conflict { color:#241238 !important; background:#c6a5ff !important; border-color:#e3d1ff !important; }
    .dp-random-poll-mark.stopped { color:#1f2937 !important; background:#aab7c9 !important; border-color:#d7dee8 !important; border-radius:5px !important; }
    .dp-random-badge { color:#dce8f7 !important; font-weight:800 !important; white-space:nowrap !important; }
    .dp-random-result-grid { display:grid !important; grid-template-columns:82px minmax(0,1fr) !important; gap:4px 8px !important; padding:7px 9px !important; border-top:1px solid #344157 !important; font-size:11.5px !important; }
    .dp-random-result-grid span { color:#9eabc0 !important; }
    .dp-random-result-grid b { color:#eef3fa !important; overflow-wrap:anywhere !important; }
    .dp-random-raw { max-height:320px !important; overflow:auto !important; margin:5px 8px 8px !important; padding:8px !important; white-space:pre-wrap !important; color:#cad5e4 !important; background:#090f19 !important; border:1px solid #344157 !important; font:10.5px/1.35 Consolas,monospace !important; }
    .dp-random-system-output { color:#111827 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }
    .dp-random-empty { padding:8px 0 !important; color:#8f9db2 !important; }
    @media (max-width: 700px) {
      .dp-random-live { grid-template-columns:10px minmax(0,1fr) !important; }
      .dp-random-live strong { grid-column:2 !important; white-space:normal !important; }
      .dp-random-result > summary { grid-template-columns:24px minmax(0,1fr) auto !important; }
      .dp-random-result > summary > span:last-child { display:none !important; }
    }
    #dp-results {
      flex: 1 1 auto !important;
      min-height: 90px !important;
      max-height: none !important;
      overflow: auto !important;
      padding: 6px 12px 12px !important;
      background: var(--dp-bg) !important;
      scrollbar-color: #64748b #111827 !important;
    }
    .dp-field {
      display: grid !important;
      grid-template-columns: minmax(132px, 37%) minmax(0, 1fr) !important;
      gap: 4px 12px !important;
      padding: 10px 3px !important;
      border-bottom: 1px solid #35435a !important;
    }
    .dp-field-label { color: var(--dp-muted) !important; font-size: 12.5px !important; font-weight: 650 !important; }
    .dp-field-value { color: #ffffff !important; font-size: 14px !important; font-weight: 720 !important; overflow-wrap: anywhere !important; }
    .dp-field-value.pending { color: #b9c7da !important; font-weight: 600 !important; }
    .dp-field-source { grid-column: 2 !important; color: #94a8c4 !important; font-size: 11.5px !important; overflow-wrap: anywhere !important; }
    .dp-onu-block, .dp-mac-route {
      margin-top: 12px !important;
      padding: 13px !important;
      color: var(--dp-text) !important;
      background: var(--dp-surface-2) !important;
      border: 1px solid #566681 !important;
      border-left-width: 6px !important;
      border-radius: 11px !important;
    }
    .dp-onu-block.loading, .dp-mac-route.loading { border-left-color: var(--dp-blue) !important; }
    .dp-onu-block.ok, .dp-mac-route.ok { background: #153227 !important; border-color: #36795a !important; border-left-color: var(--dp-ok) !important; }
    .dp-onu-block.warning, .dp-mac-route.warning { background: #372e1a !important; border-color: #816b34 !important; border-left-color: var(--dp-warn) !important; }
    .dp-onu-block.error { background: #3a1d27 !important; border-color: #914654 !important; border-left-color: var(--dp-error) !important; }
    .dp-onu-head, .dp-mac-route-head { display: flex !important; align-items: flex-start !important; justify-content: space-between !important; gap: 12px !important; margin-bottom: 8px !important; }
    .dp-onu-title, .dp-mac-route-title { color: #ffffff !important; font-size: 14px !important; font-weight: 800 !important; }
    .dp-onu-state, .dp-mac-route-state { flex: 0 0 auto !important; max-width: 54% !important; padding: 3px 7px !important; color: #ffffff !important; background: rgba(0, 0, 0, .27) !important; border: 1px solid rgba(255, 255, 255, .22) !important; border-radius: 999px !important; font-size: 11px !important; font-weight: 750 !important; text-align: right !important; overflow-wrap: anywhere !important; }
    .dp-onu-message, .dp-onu-meta, .dp-mac-route-message, .dp-mac-route-value, .dp-mac-route-meaning { color: #e6edf7 !important; overflow-wrap: anywhere !important; }
    .dp-onu-meta, .dp-mac-route-meaning { margin-top: 5px !important; color: #bdc9d9 !important; font-size: 12px !important; }
    .dp-onu-output {
      max-height: 230px !important;
      margin: 10px 0 0 !important;
      padding: 11px !important;
      overflow: auto !important;
      color: #f7fbff !important;
      background: #09111e !important;
      border: 1px solid #596982 !important;
      border-radius: 8px !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
      font: 600 12.5px/1.5 Consolas, "Cascadia Mono", monospace !important;
    }
    .dp-onu-block.unknown { background: #202a3a !important; border-color: #60708a !important; border-left-color: #9fb3cc !important; }
    .dp-onu-block.conflict { background: #35263a !important; border-color: #7c5787 !important; border-left-color: #d59ae3 !important; }
    .dp-onu-summary {
      margin-top: 10px !important;
      padding: 10px 11px !important;
      color: #ffffff !important;
      background: rgba(0, 0, 0, .22) !important;
      border: 1px solid rgba(255, 255, 255, .16) !important;
      border-radius: 8px !important;
      font-size: 13.5px !important;
      font-weight: 760 !important;
      line-height: 1.48 !important;
    }
    .dp-onu-report-section, .dp-onu-conclusion {
      margin-top: 11px !important;
      padding-top: 9px !important;
      border-top: 1px solid rgba(255, 255, 255, .14) !important;
    }
    .dp-onu-report-section.deviations {
      padding: 9px 10px !important;
      background: rgba(255, 209, 102, .08) !important;
      border: 1px solid rgba(255, 209, 102, .28) !important;
      border-radius: 8px !important;
    }
    .dp-onu-report-title {
      margin-bottom: 5px !important;
      color: #dfe8f5 !important;
      font-size: 11.5px !important;
      font-weight: 850 !important;
      letter-spacing: .055em !important;
      text-transform: uppercase !important;
    }
    .dp-onu-report-list {
      margin: 0 !important;
      padding-left: 19px !important;
      color: #edf3fb !important;
    }
    .dp-onu-report-list li { margin: 3px 0 !important; }
    .dp-onu-conclusion { color: #ffffff !important; font-weight: 650 !important; }
    .dp-onu-causes, .dp-onu-raw {
      margin-top: 11px !important;
      color: #e7eef8 !important;
      background: rgba(0, 0, 0, .16) !important;
      border: 1px solid rgba(255, 255, 255, .18) !important;
      border-radius: 8px !important;
      overflow: hidden !important;
    }
    .dp-onu-causes > summary, .dp-onu-raw > summary {
      padding: 9px 10px !important;
      cursor: pointer !important;
      color: #eaf1fb !important;
      font-weight: 750 !important;
      list-style-position: inside !important;
      user-select: none !important;
    }
    .dp-onu-causes[open] > summary, .dp-onu-raw[open] > summary {
      border-bottom: 1px solid rgba(255, 255, 255, .15) !important;
    }
    .dp-onu-causes .dp-onu-report-list { padding: 8px 12px 10px 29px !important; }
    .dp-onu-raw .dp-onu-output {
      max-height: 330px !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
    }
    .dp-port-block {
      margin-top: 12px !important;
      padding: 11px !important;
      color: #edf4ff !important;
      background: #172438 !important;
      border: 1px solid #49617f !important;
      border-left: 5px solid #68a9d7 !important;
      border-radius: 10px !important;
    }
    .dp-port-block.ready { background: #17273a !important; border-left-color: #68a9d7 !important; }
    .dp-port-block.loading { background: #17283a !important; border-left-color: var(--dp-blue) !important; }
    .dp-port-block.ok { background: #143126 !important; border-left-color: var(--dp-ok) !important; }
    .dp-port-block.warning { background: #382d18 !important; border-left-color: var(--dp-warn) !important; }
    .dp-port-block.error { background: #3a1d27 !important; border-left-color: var(--dp-error) !important; }
    .dp-port-head, .dp-port-row-head { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:10px !important; }
    .dp-port-title { color:#fff !important; font-size:14px !important; font-weight:850 !important; }
    .dp-port-state { padding:2px 7px !important; color:#dcecff !important; background:rgba(0,0,0,.24) !important; border:1px solid rgba(255,255,255,.18) !important; border-radius:999px !important; font-size:10.5px !important; font-weight:800 !important; text-transform:uppercase !important; }
    .dp-port-message, .dp-port-meta { margin-top:7px !important; color:#d8e3f2 !important; line-height:1.45 !important; overflow-wrap:anywhere !important; }
    .dp-port-meta { color:#aebed2 !important; font-size:11.5px !important; }
    .dp-port-metrics { display:grid !important; grid-template-columns:repeat(7,minmax(64px,1fr)) !important; gap:6px !important; margin-top:10px !important; }
    .dp-port-metric { padding:7px 5px !important; text-align:center !important; background:rgba(0,0,0,.2) !important; border:1px solid rgba(255,255,255,.14) !important; border-radius:8px !important; }
    .dp-port-metric b { display:block !important; color:#fff !important; font-size:17px !important; }
    .dp-port-metric span { color:#aebed2 !important; font-size:10.5px !important; }
    .dp-port-metric.online { border-color:rgba(81,207,145,.55) !important; }
    .dp-port-metric.offline, .dp-port-metric.conflict { border-color:rgba(255,118,118,.58) !important; }
    .dp-port-conclusion { margin-top:10px !important; padding:9px 10px !important; background:rgba(0,0,0,.18) !important; border:1px solid rgba(255,255,255,.15) !important; border-radius:8px !important; }
    .dp-port-section-title { color:#fff !important; font-size:11.5px !important; font-weight:850 !important; letter-spacing:.05em !important; text-transform:uppercase !important; }
    .dp-port-conclusion ul { margin:6px 0 0 !important; padding-left:20px !important; }
    .dp-port-conclusion li { margin:4px 0 !important; line-height:1.42 !important; }
    .dp-port-actions { display:flex !important; gap:7px !important; margin-top:9px !important; }
    .dp-port-actions button { padding:6px 9px !important; color:#eaf4ff !important; background:#243650 !important; border:1px solid #607a9f !important; border-radius:7px !important; font-weight:750 !important; cursor:pointer !important; }
    .dp-port-list, .dp-port-billing-raw { margin-top:10px !important; background:rgba(0,0,0,.15) !important; border:1px solid rgba(255,255,255,.15) !important; border-radius:8px !important; overflow:hidden !important; }
    .dp-port-list > summary, .dp-port-billing-raw > summary { padding:9px 10px !important; color:#eaf2fc !important; cursor:pointer !important; font-weight:780 !important; }
    .dp-port-rows { padding:7px !important; }
    .dp-port-row { margin:6px 0 !important; padding:9px !important; background:#18263a !important; border:1px solid #445875 !important; border-left:4px solid #73859e !important; border-radius:8px !important; }
    .dp-port-row.online { border-left-color:#51cf91 !important; }
    .dp-port-row.offline { border-left-color:#ff7676 !important; }
    .dp-port-row.current { box-shadow:0 0 0 2px rgba(94,231,211,.38) inset !important; }
    .dp-port-row.conflict { background:#35263a !important; border-color:#8a5b91 !important; }
    .dp-port-position { color:#fff !important; font-weight:850 !important; }
    .dp-port-row-status { color:#c7d5e8 !important; font-size:10.5px !important; font-weight:850 !important; text-transform:uppercase !important; }
    .dp-port-owner { margin-top:5px !important; color:#e7eef8 !important; overflow-wrap:anywhere !important; }
    .dp-port-owner a { color:#85c8ff !important; text-decoration:none !important; }
    .dp-port-grid { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:4px 12px !important; margin-top:7px !important; color:#aebed2 !important; font-size:11.5px !important; }
    .dp-port-grid b { color:#f4f7fb !important; }
    .dp-port-address, .dp-port-reason { margin-top:6px !important; color:#c6d2e2 !important; font-size:11.5px !important; }
    .dp-port-reason { color:#ffd2a6 !important; }
    .dp-port-tags { margin-top:7px !important; display:flex !important; flex-wrap:wrap !important; gap:5px !important; }
    .dp-port-tag { padding:2px 6px !important; border-radius:999px !important; font-size:10px !important; font-weight:800 !important; }
    .dp-port-tag.conflict { color:#ffe8ff !important; background:#704676 !important; }
    .dp-port-tag.warning { color:#fff0c9 !important; background:#74551e !important; }
    .dp-port-tag.muted { color:#d8e1ed !important; background:#425168 !important; }
    .dp-port-table-wrap { width:100% !important; overflow:auto !important; border-top:1px solid rgba(255,255,255,.13) !important; background:#111c2c !important; }
    .dp-port-table { min-width:1640px !important; width:max-content !important; border-collapse:separate !important; border-spacing:0 !important; color:#dce6f3 !important; font:11px/1.35 "Segoe UI",Arial,sans-serif !important; }
    .dp-port-table th, .dp-port-table td { padding:6px 8px !important; border-right:1px solid #314159 !important; border-bottom:1px solid #314159 !important; vertical-align:top !important; text-align:left !important; white-space:normal !important; }
    .dp-port-table th { position:sticky !important; top:0 !important; z-index:2 !important; color:#f1f5fb !important; background:#223149 !important; font-weight:780 !important; white-space:nowrap !important; }
    .dp-port-table th.dp-port-added-col { color:#d7dfeb !important; background:#283548 !important; }
    .dp-port-table tbody tr:nth-child(even) td { background:#152134 !important; }
    .dp-port-table tbody tr:nth-child(odd) td { background:#111c2c !important; }
    .dp-port-table tbody tr:hover td { background:#1d2d43 !important; }
    .dp-port-table tbody tr.current td { box-shadow:inset 0 1px 0 rgba(94,231,211,.58), inset 0 -1px 0 rgba(94,231,211,.58) !important; }
    .dp-port-table tbody tr.current td:first-child { border-left:2px solid #5ee7d3 !important; }
    .dp-port-table tbody tr.conflict td { background:#2a2330 !important; }
    .dp-port-table a { color:#9fcdf6 !important; text-decoration:none !important; }
    .dp-port-col-id { min-width:58px !important; font-weight:800 !important; white-space:nowrap !important; }
    .dp-port-col-contract { min-width:105px !important; background:#1a2638 !important; font-weight:720 !important; }
    .dp-port-col-street { min-width:190px !important; max-width:260px !important; background:#1a2638 !important; color:#c9d3df !important; }
    .dp-port-current-mark { margin-right:4px !important; color:#5ee7d3 !important; }
    .dp-port-nowrap { white-space:nowrap !important; }
    .dp-port-num { text-align:right !important; white-space:nowrap !important; font-variant-numeric:tabular-nums !important; }
    .dp-port-table-status { display:inline-block !important; min-width:50px !important; padding:1px 5px !important; border:1px solid #53647b !important; border-radius:4px !important; text-align:center !important; font-size:10px !important; font-weight:780 !important; text-transform:lowercase !important; }
    .dp-port-table-status.online { color:#c7f2d9 !important; border-color:#47795f !important; background:#173326 !important; }
    .dp-port-table-status.offline { color:#f2c7cc !important; border-color:#7b4e57 !important; background:#382027 !important; }
    .dp-port-table-status.unknown { color:#d4dbe5 !important; background:#273247 !important; }
    .dp-port-route { margin-top:10px !important; background:rgba(0,0,0,.15) !important; border:1px solid rgba(255,255,255,.15) !important; border-radius:8px !important; overflow:hidden !important; }
    .dp-port-route > summary { padding:9px 10px !important; color:#eaf2fc !important; cursor:pointer !important; font-weight:780 !important; }
    .dp-port-route-warning, .dp-port-route-confidence { padding:8px 10px !important; color:#b9c5d5 !important; background:#121d2c !important; border-top:1px solid #314159 !important; font-size:11px !important; line-height:1.45 !important; }
    .dp-port-route-groups { padding:7px 9px !important; background:#101a29 !important; }
    .dp-port-route-group { margin:6px 0 !important; padding:8px 9px !important; background:#172438 !important; border:1px solid #3e506a !important; border-radius:6px !important; }
    .dp-port-route-streets { margin-top:3px !important; color:#c8d3df !important; }
    .dp-port-route-members { margin-top:4px !important; color:#9fadc0 !important; font-size:10.5px !important; line-height:1.4 !important; }
    .dp-port-evidence { max-height:220px !important; overflow:auto !important; padding:8px 10px !important; color:#d8e3f2 !important; border-top:1px solid rgba(255,255,255,.13) !important; font:11px/1.42 Consolas,monospace !important; }
    .dp-port-raw-output { max-height:360px !important; overflow:auto !important; margin:0 !important; padding:10px !important; color:#dce7f5 !important; background:#0c1422 !important; border:0 !important; border-top:1px solid rgba(255,255,255,.13) !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; font:11px/1.42 Consolas,monospace !important; }
    #dp-panel.resizing { transition: none !important; }
    #dp-panel.collapsed {
      width: 44px !important;
      min-width: 44px !important;
      max-width: 44px !important;
      height: 100vh !important;
      min-height: 100vh !important;
    }
    #dp-panel.collapsed > :not(#dp-head) { display: none !important; }
    #dp-panel.collapsed #dp-head {
      height: 100vh !important;
      min-height: 100vh !important;
      padding: 8px 6px !important;
      align-items: flex-start !important;
      justify-content: center !important;
    }
    #dp-panel.collapsed .dp-head-title,
    #dp-panel.collapsed #dp-reset-panel,
    #dp-panel.collapsed #dp-reload-extension { display: none !important; }
    #dp-panel.collapsed .dp-head-controls { flex-direction: column !important; }
    #dp-panel.collapsed #dp-minimize {
      width: 34px !important;
      height: 34px !important;
      font-size: 24px !important;
    }
    #dp-panel-resize {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      bottom: 0 !important;
      width: 9px !important;
      height: 100% !important;
      z-index: 20 !important;
      cursor: ew-resize !important;
      touch-action: none !important;
    }
    #dp-panel-resize::after {
      content: '' !important;
      position: absolute !important;
      left: 2px !important;
      top: 50% !important;
      width: 3px !important;
      height: 58px !important;
      transform: translateY(-50%) !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: #71819b !important;
    }
    #dp-panel-resize:hover::after,
    #dp-panel.resizing #dp-panel-resize::after { background: var(--dp-accent) !important; }
    #dp-journal-resizer {
      flex: 0 0 9px !important;
      height: 9px !important;
      cursor: ns-resize !important;
      background: #152033 !important;
      border-top: 1px solid #3d4c65 !important;
      border-bottom: 1px solid #3d4c65 !important;
      position: relative !important;
      touch-action: none !important;
    }
    #dp-journal-resizer::after {
      content: '' !important;
      position: absolute !important;
      left: 50% !important;
      top: 3px !important;
      width: 46px !important;
      height: 3px !important;
      transform: translateX(-50%) !important;
      border-radius: 999px !important;
      background: #71819b !important;
    }
    #dp-journal-resizer:hover::after, #dp-journal-resizer.dragging::after { background: var(--dp-accent) !important; }
    #dp-journal-wrap { flex: 0 0 auto !important; padding: 8px 12px 10px !important; background: #0d1522 !important; }
    .dp-journal-toolbar { color:#b8c2d3 !important; font-size:11.5px !important; display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; margin-bottom:4px !important; }
    .dp-journal-view-buttons { display:flex !important; gap:4px !important; }
    .dp-journal-view-button, #dp-copy-journal { padding:2px 7px !important; color:#b8c2d3 !important; background:#182235 !important; border:1px solid #52617a !important; border-radius:6px !important; font:700 10.5px/1.4 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    #dp-copy-journal { color:#e8eef7 !important; }
    .dp-journal-view-button.active { color:#071b18 !important; background:var(--dp-accent) !important; border-color:#91f4e5 !important; }
    #dp-journal-list { height: 150px !important; min-height: 60px !important; max-height: none !important; overflow-y: auto !important; color: #bac6d8 !important; font-size: 11px !important; }
    .dp-journal-entry { padding: 6px 0 !important; border-bottom: 1px solid #2c394d !important; }
    .dp-journal-entry.decision { margin: 4px 0 !important; padding: 7px 7px 7px 9px !important; background: #17283a !important; border-left: 4px solid var(--dp-accent) !important; border-bottom-color: #40516b !important; border-radius: 6px !important; }
    .dp-journal-entry.network { opacity: .76 !important; }
    .dp-journal-line { display: flex !important; justify-content: space-between !important; gap: 10px !important; color: #94a6bf !important; }
    .dp-journal-title { color: #e8eef7 !important; font-weight: 650 !important; }
    .dp-journal-details { color: #aab7c9 !important; overflow-wrap: anywhere !important; }
    @media (max-width: 560px) {
      #dp-panel { min-width: min(320px, calc(100vw - 12px)) !important; max-width: calc(100vw - 12px) !important; }
      #dp-form { grid-template-columns: minmax(0, 1fr) auto !important; }
      #dp-port-run, #dp-random-toggle, #dp-stop { grid-column: 1 / -1 !important; width: 100% !important; }
      .dp-port-metrics { grid-template-columns: repeat(3, minmax(64px, 1fr)) !important; }
      .dp-port-grid { grid-template-columns: 1fr !important; }
      .dp-field { grid-template-columns: 1fr !important; }
      .dp-field-source { grid-column: 1 !important; }
    }
  `);

  // 4.19: стабильное локальное состояние раскрытия карточек и RAW. Сетевая логика не меняется:
  // один исполнитель, остальные вкладки — зеркала общего состояния.
  dpAddStyle(`
    #dp-panel {
      --dp-bg:#eef2f7 !important;
      --dp-surface:#ffffff !important;
      --dp-surface-2:#f8fafc !important;
      --dp-border:#d5dde8 !important;
      --dp-text:#172033 !important;
      --dp-muted:#5f6d80 !important;
      --dp-accent:#2563eb !important;
      --dp-blue:#2563eb !important;
      --dp-ok:#15803d !important;
      --dp-warn:#b45309 !important;
      --dp-error:#b91c1c !important;
      color:#172033 !important;
      background:#eef2f7 !important;
      border-left:1px solid #c7d0dc !important;
      box-shadow:-10px 0 28px rgba(15,23,42,.16) !important;
      min-width:360px !important;
      max-width:none !important;
      font:13px/1.45 Inter,"Segoe UI",Arial,sans-serif !important;
      container-type:inline-size !important;
    }
    #dp-panel.overlay-mode { border:1px solid #c7d0dc !important; border-radius:12px 0 0 12px !important; box-shadow:-16px 0 40px rgba(15,23,42,.24) !important; }
    #dp-head { min-height:62px !important; padding:10px 14px !important; color:#172033 !important; background:#ffffff !important; border-bottom:1px solid #d5dde8 !important; }
    #dp-head b { color:#172033 !important; font-size:15px !important; }
    .dp-version { color:#64748b !important; }
    #dp-session-badge, #dp-sync-badge { border-radius:6px !important; font-size:10px !important; }
    #dp-session-badge.ok { color:#166534 !important; background:#ecfdf3 !important; border-color:#86d5a7 !important; }
    #dp-session-badge.pending { color:#1d4ed8 !important; background:#eff6ff !important; border-color:#93c5fd !important; }
    #dp-session-badge.missing { color:#92400e !important; background:#fffbeb !important; border-color:#f5c46d !important; }
    #dp-sync-badge { color:#334155 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }
    #dp-sync-badge.local { color:#166534 !important; background:#ecfdf3 !important; border-color:#86d5a7 !important; }
    #dp-sync-badge.remote { color:#6d28d9 !important; background:#f5f3ff !important; border-color:#c4b5fd !important; }
    #dp-reset-panel, #dp-minimize { color:#334155 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }

    #dp-role-banner { position:relative !important; min-height:58px !important; padding:9px 14px !important; color:#334155 !important; background:#f8fafc !important; border:0 !important; border-bottom:1px solid #d5dde8 !important; border-left:6px solid #94a3b8 !important; }
    #dp-role-banner b { color:#334155 !important; font-size:12px !important; }
    #dp-role-banner span { color:#526174 !important; font-size:11px !important; }
    #dp-role-banner.owner { background:#ecfdf3 !important; border-left-color:#16a34a !important; }
    #dp-role-banner.owner b { color:#166534 !important; }
    #dp-role-banner.owner span { color:#315c42 !important; }
    #dp-role-banner.mirror { background:#f5f3ff !important; border-left-color:#7c3aed !important; }
    #dp-role-banner.mirror b { color:#6d28d9 !important; }
    #dp-role-banner.mirror span { color:#5b4b75 !important; }
    #dp-panel[data-tab-role="owner"] { box-shadow:-5px 0 0 #16a34a,-10px 0 28px rgba(15,23,42,.16) !important; }
    #dp-panel[data-tab-role="mirror"] { box-shadow:-5px 0 0 #7c3aed,-10px 0 28px rgba(15,23,42,.16) !important; }
    #dp-panel[data-tab-role="mirror"] #dp-form { background:#faf9ff !important; }

    #dp-workspace-tabs { flex:0 0 auto !important; display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)) !important; gap:0 !important; padding:0 8px !important; background:#ffffff !important; border-bottom:1px solid #d5dde8 !important; }
    #dp-workspace-tabs button { min-width:0 !important; height:43px !important; padding:0 6px !important; display:flex !important; align-items:center !important; justify-content:center !important; gap:6px !important; color:#64748b !important; background:transparent !important; border:0 !important; border-bottom:3px solid transparent !important; font:700 11px/1 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    #dp-workspace-tabs button:hover { color:#1e40af !important; background:#f8fafc !important; }
    #dp-workspace-tabs button.active { color:#1d4ed8 !important; border-bottom-color:#2563eb !important; }
    #dp-workspace-tabs button b { min-width:20px !important; height:20px !important; display:inline-grid !important; place-items:center !important; padding:0 5px !important; color:#475569 !important; background:#eef2f7 !important; border-radius:999px !important; font-size:10px !important; }
    #dp-workspace-tabs button.active b { color:#1d4ed8 !important; background:#dbeafe !important; }

    #dp-status { min-height:38px !important; padding:8px 14px !important; color:#334155 !important; background:#ffffff !important; border-bottom:1px solid #d5dde8 !important; font-weight:650 !important; }
    #dp-status.loading { color:#1d4ed8 !important; background:#eff6ff !important; border-left:5px solid #2563eb !important; }
    #dp-status.ok { color:#166534 !important; background:#ecfdf3 !important; border-left:5px solid #16a34a !important; }
    #dp-status.warning, #dp-status.stopped { color:#92400e !important; background:#fffbeb !important; border-left:5px solid #d97706 !important; }
    #dp-status.error { color:#991b1b !important; background:#fef2f2 !important; border-left:5px solid #dc2626 !important; }

    #dp-billing-provider { color:#223043 !important; background:#f7f9fc !important; border-color:#d5dde8 !important; }
    #dp-billing-provider-mode { color:#223043 !important; background:#ffffff !important; border-color:#9baabc !important; }
    #dp-billing-provider-state { color:#64748b !important; }
    #dp-form { flex:0 0 auto !important; grid-template-columns:minmax(150px,1fr) repeat(4,auto) !important; gap:7px !important; padding:10px 12px !important; background:#ffffff !important; border-bottom:1px solid #d5dde8 !important; }
    #dp-input { height:38px !important; color:#172033 !important; caret-color:#2563eb !important; background:#ffffff !important; border-color:#aeb9c8 !important; border-radius:7px !important; }
    #dp-input::placeholder { color:#7b8798 !important; }
    #dp-input:focus { border-color:#2563eb !important; box-shadow:0 0 0 3px rgba(37,99,235,.13) !important; }
    #dp-run,#dp-port-run,#dp-random-toggle,#dp-stop { min-width:68px !important; height:38px !important; padding:0 11px !important; border-radius:7px !important; }
    #dp-run { color:#ffffff !important; background:#2563eb !important; border-color:#1d4ed8 !important; }
    #dp-port-run { min-width:122px !important; color:#1e3a5f !important; background:#e8f2ff !important; border-color:#9cc4f2 !important; }
    #dp-random-toggle { min-width:106px !important; color:#5b21b6 !important; background:#f3e8ff !important; border-color:#c4b5fd !important; }
    #dp-stop { color:#ffffff !important; background:#dc2626 !important; border-color:#b91c1c !important; }
    #dp-run:disabled,#dp-port-run:disabled,#dp-random-toggle:disabled,#dp-stop:disabled { filter:none !important; opacity:.42 !important; }

    #dp-random-panel { flex:1 1 auto !important; min-height:0 !important; max-height:none !important; overflow:auto !important; padding:10px 12px 14px !important; background:#eef2f7 !important; border-bottom:0 !important; }
    .dp-random-head { position:sticky !important; top:-10px !important; z-index:7 !important; margin:-10px -12px 10px !important; padding:10px 12px !important; background:rgba(255,255,255,.96) !important; border-bottom:1px solid #d5dde8 !important; backdrop-filter:blur(7px) !important; }
    .dp-random-head b { color:#172033 !important; }
    .dp-random-head span { color:#64748b !important; }
    #dp-random-wide { color:#334155 !important; background:#ffffff !important; border-color:#cbd5e1 !important; }
    #dp-random-config { margin:0 0 10px !important; background:#ffffff !important; border:1px solid #d5dde8 !important; border-radius:9px !important; overflow:hidden !important; }
    #dp-random-config > summary { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:10px !important; padding:9px 11px !important; color:#334155 !important; cursor:pointer !important; font-weight:750 !important; list-style-position:inside !important; }
    #dp-random-config > summary small { color:#7b8798 !important; font-size:10.5px !important; font-weight:500 !important; text-align:right !important; }
    .dp-random-config-body { padding:0 10px 10px !important; border-top:1px solid #e2e8f0 !important; }
    #dp-random-contracts { margin-top:10px !important; color:#172033 !important; background:#ffffff !important; border-color:#b8c2cf !important; }
    .dp-random-settings label,.dp-random-repeat { color:#526174 !important; }
    .dp-random-settings input,.dp-random-settings select { color:#172033 !important; background:#ffffff !important; border-color:#b8c2cf !important; }
    .dp-random-actions button { color:#334155 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }
    #dp-random-start { color:#ffffff !important; background:#15803d !important; border-color:#166534 !important; }
    #dp-random-stop { color:#ffffff !important; background:#dc2626 !important; border-color:#b91c1c !important; }
    #dp-random-summary { color:#475569 !important; }
    .dp-random-live { position:sticky !important; top:45px !important; z-index:6 !important; grid-template-columns:12px minmax(0,1fr) auto !important; padding:10px 11px !important; background:#ffffff !important; border-color:#cbd5e1 !important; border-radius:9px !important; box-shadow:0 4px 12px rgba(15,23,42,.08) !important; }
    .dp-random-live b { color:#172033 !important; }
    .dp-random-live span:not(.dp-random-live-dot) { color:#526174 !important; }
    .dp-random-live strong { color:#334155 !important; }
    .dp-random-live.owner { background:#ecfdf3 !important; border-color:#86d5a7 !important; }
    .dp-random-live.mirror { background:#f5f3ff !important; border-color:#c4b5fd !important; }
    .dp-random-live.ready { background:#eff6ff !important; border-color:#93c5fd !important; }
    .dp-random-live.done { background:#f0fdf4 !important; border-color:#86d5a7 !important; }
    #dp-random-workspace { gap:10px !important; }
    #dp-panel.random-wide-layout #dp-random-workspace { grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr) !important; }
    .dp-random-section-head { top:96px !important; color:#334155 !important; background:#ffffff !important; border-color:#d5dde8 !important; box-shadow:0 2px 7px rgba(15,23,42,.06) !important; }
    .dp-random-section-head span { color:#64748b !important; }
    #dp-random-queue { border-color:#d5dde8 !important; background:#ffffff !important; }
    .dp-random-queue-item { color:#172033 !important; background:#ffffff !important; border-bottom-color:#e2e8f0 !important; }
    .dp-random-queue-item.active { background:#eff6ff !important; box-shadow:inset 4px 0 0 #2563eb !important; }
    .dp-random-queue-state { color:#64748b !important; background:#f1f5f9 !important; border-color:#cbd5e1 !important; }
    .dp-random-queue-state.active { color:#ffffff !important; background:#2563eb !important; border-color:#1d4ed8 !important; }
    .dp-random-queue-item small { color:#64748b !important; }
    .dp-random-queue-item button { color:#475569 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }
    .dp-random-result { background:#ffffff !important; border-color:#d5dde8 !important; box-shadow:0 2px 7px rgba(15,23,42,.05) !important; }
    .dp-random-result.unresolved { background:#f0f9ff !important; }
    .dp-random-result.identity-conflict { background:#faf5ff !important; }
    .dp-random-result > summary { color:#172033 !important; }
    .dp-random-badge { color:#475569 !important; background:#f1f5f9 !important; border:1px solid #d5dde8 !important; border-radius:999px !important; padding:2px 7px !important; }
    .dp-random-result-grid { border-top-color:#e2e8f0 !important; }
    .dp-random-result-grid span { color:#64748b !important; }
    .dp-random-result-grid b { color:#172033 !important; }
    .dp-random-raw { color:#dbeafe !important; background:#0f172a !important; border-color:#334155 !important; }
    .dp-random-system-output { color:#172033 !important; background:#ffffff !important; border-color:#cbd5e1 !important; }
    .dp-random-empty { color:#64748b !important; }

    #dp-results { min-height:0 !important; padding:10px 12px 14px !important; color:#172033 !important; background:#eef2f7 !important; scrollbar-color:#94a3b8 #eef2f7 !important; }
    .dp-field { padding:10px 9px !important; background:#ffffff !important; border:1px solid #e2e8f0 !important; border-radius:8px !important; margin:6px 0 !important; }
    .dp-field-label { color:#64748b !important; }
    .dp-field-value { color:#172033 !important; }
    .dp-field-value.pending { color:#64748b !important; }
    .dp-field-source { color:#7b8798 !important; }
    .dp-onu-block,.dp-mac-route,.dp-port-block { color:#172033 !important; background:#ffffff !important; border-color:#d5dde8 !important; box-shadow:0 2px 8px rgba(15,23,42,.06) !important; }
    .dp-onu-block.ok,.dp-mac-route.ok,.dp-port-block.ok { background:#f0fdf4 !important; border-color:#a7d9b8 !important; }
    .dp-onu-block.warning,.dp-mac-route.warning,.dp-port-block.warning { background:#fffbeb !important; border-color:#f4cc7b !important; }
    .dp-onu-block.error,.dp-port-block.error { background:#fef2f2 !important; border-color:#f0a6a6 !important; }
    .dp-onu-block.unknown { background:#f8fafc !important; border-color:#cbd5e1 !important; }
    .dp-onu-block.conflict { background:#faf5ff !important; border-color:#d8b4fe !important; }
    .dp-onu-title,.dp-mac-route-title,.dp-port-title { color:#172033 !important; }
    .dp-onu-state,.dp-mac-route-state,.dp-port-state { color:#334155 !important; background:#f1f5f9 !important; border-color:#cbd5e1 !important; }
    .dp-onu-message,.dp-onu-meta,.dp-mac-route-message,.dp-mac-route-value,.dp-mac-route-meaning,.dp-port-message,.dp-port-meta { color:#475569 !important; }
    .dp-onu-summary { color:#172033 !important; background:rgba(255,255,255,.72) !important; border-color:#d5dde8 !important; }
    .dp-onu-report-section,.dp-onu-conclusion { border-top-color:#d5dde8 !important; }
    .dp-onu-report-title { color:#475569 !important; }
    .dp-onu-report-list,.dp-onu-conclusion { color:#172033 !important; }
    .dp-onu-causes,.dp-onu-raw { color:#172033 !important; background:#ffffff !important; border-color:#d5dde8 !important; }
    .dp-onu-causes > summary,.dp-onu-raw > summary { color:#334155 !important; }
    .dp-onu-causes[open] > summary,.dp-onu-raw[open] > summary { border-bottom-color:#d5dde8 !important; }
    .dp-onu-output { color:#dbeafe !important; background:#0f172a !important; border-color:#334155 !important; }

    #dp-journal-resizer { background:#e2e8f0 !important; border-color:#cbd5e1 !important; }
    #dp-journal-resizer::after,#dp-panel-resize::after { background:#94a3b8 !important; }
    #dp-journal-wrap { min-height:0 !important; padding:9px 12px 12px !important; background:#ffffff !important; border-top:1px solid #d5dde8 !important; }
    .dp-journal-toolbar { color:#475569 !important; }
    .dp-journal-view-button,#dp-copy-journal { color:#475569 !important; background:#f8fafc !important; border-color:#cbd5e1 !important; }
    .dp-journal-view-button.active { color:#ffffff !important; background:#2563eb !important; border-color:#1d4ed8 !important; }
    #dp-journal-list { color:#475569 !important; }
    .dp-journal-entry { border-bottom-color:#e2e8f0 !important; }
    .dp-journal-entry.decision { background:#eff6ff !important; border-left-color:#2563eb !important; border-bottom-color:#bfdbfe !important; }
    .dp-journal-line { color:#64748b !important; }
    .dp-journal-title { color:#172033 !important; }
    .dp-journal-details { color:#526174 !important; }

    /* Workspace views. Data are shared; selected section is also synchronized. */
    #dp-panel[data-workspace-view="process"] #dp-random-panel,
    #dp-panel[data-workspace-view="results"] #dp-random-panel,
    #dp-panel[data-workspace-view="queue"] #dp-random-panel { display:block !important; }
    #dp-panel[data-workspace-view="subscriber"] #dp-random-panel,
    #dp-panel[data-workspace-view="journal"] #dp-random-panel { display:none !important; }
    #dp-panel[data-workspace-view="subscriber"] #dp-results { display:block !important; flex:1 1 auto !important; }
    #dp-panel:not([data-workspace-view="subscriber"]) #dp-results { display:none !important; }
    #dp-panel[data-workspace-view="journal"] #dp-journal-wrap { display:flex !important; flex:1 1 auto !important; flex-direction:column !important; }
    #dp-panel[data-workspace-view="journal"] #dp-journal-list { height:auto !important; flex:1 1 auto !important; }
    #dp-panel[data-workspace-view="journal"] #dp-journal-resizer { display:none !important; }
    #dp-panel[data-workspace-view="process"] #dp-journal-wrap { display:block !important; flex:0 0 auto !important; }
    #dp-panel[data-workspace-view="process"] #dp-journal-resizer { display:block !important; }
    #dp-panel[data-workspace-view="results"] #dp-journal-wrap,
    #dp-panel[data-workspace-view="queue"] #dp-journal-wrap,
    #dp-panel[data-workspace-view="subscriber"] #dp-journal-wrap,
    #dp-panel[data-workspace-view="results"] #dp-journal-resizer,
    #dp-panel[data-workspace-view="queue"] #dp-journal-resizer,
    #dp-panel[data-workspace-view="subscriber"] #dp-journal-resizer { display:none !important; }
    #dp-panel[data-workspace-view="process"] #dp-random-config,
    #dp-panel[data-workspace-view="results"] #dp-random-config { display:none !important; }
    #dp-panel[data-workspace-view="results"] .dp-random-pending-column { display:none !important; }
    #dp-panel[data-workspace-view="results"] #dp-random-workspace { grid-template-columns:minmax(0,1fr) !important; }
    #dp-panel[data-workspace-view="queue"] .dp-random-completed-column { display:none !important; }
    #dp-panel[data-workspace-view="queue"] #dp-random-workspace { grid-template-columns:minmax(0,1fr) !important; }
    #dp-panel[data-workspace-view="queue"] .dp-random-live { position:relative !important; top:auto !important; }

    @container (max-width: 720px) {
      #dp-form { grid-template-columns:minmax(0,1fr) repeat(2,minmax(96px,auto)) !important; }
      #dp-input { grid-column:1 / -1 !important; }
      #dp-port-run,#dp-random-toggle { min-width:0 !important; }
      #dp-stop { grid-column:3 !important; }
      .dp-random-settings { grid-template-columns:1fr !important; }
      .dp-random-settings label { grid-template-columns:minmax(100px,1fr) minmax(110px,1fr) !important; }
      #dp-panel.random-wide-layout #dp-random-workspace { grid-template-columns:1fr !important; }
      .dp-random-live { grid-template-columns:10px minmax(0,1fr) !important; }
      .dp-random-live strong { grid-column:2 !important; white-space:normal !important; }
      .dp-port-metrics { grid-template-columns:repeat(3,minmax(64px,1fr)) !important; }
    }
    @container (max-width: 520px) {
      #dp-head { padding:9px 10px !important; }
      #dp-role-banner { padding:8px 10px !important; }
      #dp-workspace-tabs { padding:0 3px !important; }
      #dp-workspace-tabs button { height:46px !important; padding:0 2px !important; flex-direction:column !important; gap:3px !important; font-size:9.5px !important; }
      #dp-workspace-tabs button b { height:17px !important; min-width:17px !important; font-size:9px !important; }
      #dp-form { grid-template-columns:1fr 1fr !important; padding:8px !important; }
      #dp-input { grid-column:1 / -1 !important; }
      #dp-run,#dp-port-run,#dp-random-toggle,#dp-stop { width:100% !important; min-width:0 !important; }
      #dp-stop { grid-column:auto !important; }
      .dp-random-head { align-items:flex-start !important; }
      .dp-random-head > div { max-width:calc(100% - 82px) !important; }
      #dp-random-config > summary { align-items:flex-start !important; flex-direction:column !important; }
      #dp-random-config > summary small { text-align:left !important; }
      .dp-random-result > summary { grid-template-columns:24px minmax(0,1fr) auto !important; }
      .dp-random-result > summary > span:last-child { display:none !important; }
      .dp-random-result-grid { grid-template-columns:1fr !important; }
      .dp-random-result-grid span { margin-top:5px !important; }
      .dp-field { grid-template-columns:1fr !important; }
      .dp-field-source { grid-column:1 !important; }
      .dp-onu-head,.dp-mac-route-head,.dp-port-head { flex-direction:column !important; }
      .dp-onu-state,.dp-mac-route-state,.dp-port-state { max-width:100% !important; text-align:left !important; }
    }
    #dp-panel-launcher {
      position:fixed !important; right:6px !important; top:42% !important; z-index:2147483647 !important;
      border:1px solid #3b82f6 !important; border-radius:9px 0 0 9px !important; background:#0f2740 !important;
      color:#fff !important; padding:9px 7px !important; font:700 11px/1 Arial,sans-serif !important;
      box-shadow:0 5px 20px rgba(0,0,0,.3) !important; cursor:pointer !important;
    }
    #dp-panel-launcher[data-side="left"] { left:6px !important; right:auto !important; border-radius:0 9px 9px 0 !important; }
    #simnet-map-capture-panel-v2,#simnet-geo-olt-panel-v1 { display:none !important; }
    @media (max-width: 700px) {
      #dp-panel:not(.collapsed) { width:calc(100vw - 8px) !important; min-width:calc(100vw - 8px) !important; max-width:calc(100vw - 8px) !important; border-radius:10px 0 0 10px !important; }
    }
  `);

  const extensionManifestVersion = (() => {
    try { return String(globalThis.chrome?.runtime?.getManifest?.().version || 'dev'); } catch (_) { return 'dev'; }
  })();

  const panelHtml = `
    <div id="dp-panel" data-workbench-version="2.0.0-dev.5.8" data-layout="responsive-docked" data-workspace-view="process">
      <div id="dp-head">
        <div class="dp-head-title">
          <b>SIMNET · Диагностика <span class="dp-version">4.19</span></b>
          <span id="dp-session-badge" class="missing">Billing: проверка сессии…</span>
          <span id="dp-sync-badge">Единое состояние: инициализация…</span>
        </div>
        <div class="dp-head-controls">
          <button type="button" title="Перезагрузить unpacked-расширение из постоянной папки и обновить страницу" id="dp-reload-extension">↻ EXT ${extensionManifestVersion}</button>
          <button type="button" title="Переместить панель на другую сторону" id="dp-side-panel">⇆</button>
          <button type="button" title="Вернуть стандартную ширину боковой панели" id="dp-reset-panel">↺</button>
          <button type="button" title="Свернуть боковую панель" id="dp-minimize">›</button>
          <button type="button" title="Скрыть панель" id="dp-hide-panel">×</button>
        </div>
      </div>
      <div id="dp-role-banner" class="idle" aria-live="polite">
        <b id="dp-role-title">СВОБОДНАЯ ВКЛАДКА</b>
        <span id="dp-role-detail">Процесс не запущен. Старт можно выполнить здесь.</span>
      </div>
      <nav id="dp-workspace-tabs" role="tablist" aria-label="Разделы рабочей панели">
        <button type="button" data-dp-workspace-view="process" role="tab"><span>Процесс</span><b data-dp-workspace-badge="process">—</b></button>
        <button type="button" data-dp-workspace-view="results" role="tab"><span>Результаты</span><b data-dp-workspace-badge="results">0</b></button>
        <button type="button" data-dp-workspace-view="queue" role="tab"><span>Очередь</span><b data-dp-workspace-badge="queue">0</b></button>
        <button type="button" data-dp-workspace-view="subscriber" role="tab"><span>Абонент</span><b data-dp-workspace-badge="subscriber">—</b></button>
        <button type="button" data-dp-workspace-view="journal" role="tab"><span>Журнал</span><b data-dp-workspace-badge="journal">0</b></button>
      </nav>
      <div id="dp-status">Готов к работе</div>
      <label id="dp-billing-provider">
        <span>База</span>
        <select id="dp-billing-provider-mode" aria-label="Выбор базы Billing">
          <option value="auto">Авто</option>
          <option value="simnet">Simnet</option>
          <option value="looknet">Looknet</option>
        </select>
        <small id="dp-billing-provider-state">Авто → ещё не определено</small>
      </label>
      <div id="dp-form">
        <input type="text" id="dp-input" placeholder="Номер договора…" />
        <button id="dp-run">Пуск</button>
        <button id="dp-port-run" disabled>Абоненты порта</button>
        <button id="dp-random-toggle">Рандом-тест</button>
        <button id="dp-stop" disabled>СТОП</button>
      </div>
      <section id="dp-random-panel" hidden>
        <div class="dp-random-head">
          <div><b>Накопительная очередь PON-опросов</b><span>сбор без опроса · затем 1 опрос за раз · timeout 60с</span></div>
          <button type="button" id="dp-random-wide" title="Расширить рабочую область очереди и результатов">Шире</button>
        </div>
        <details id="dp-random-config">
          <summary><span>Настройка и сбор очереди</span><small>добавление договоров, пауза, экспорт и очистка</small></summary>
          <div class="dp-random-config-body">
            <textarea id="dp-random-contracts" placeholder="Ручной список договоров. Нажатие «Добавить в очередь» только сохраняет выборку — опрос не запускается."></textarea>
            <div class="dp-random-settings">
              <label>Источник
                <select id="dp-random-source">
                  <option value="page">Текущая страница PON</option>
                  <option value="manual">Вставленный список</option>
                </select>
              </label>
              <label>Количество <input id="dp-random-count" type="text" value="10" placeholder="10 или 5-10"></label>
              <label>Пауза, секунд <input id="dp-random-delay" type="number" min="2" max="30" value="3"></label>
            </div>
            <label class="dp-random-repeat"><input id="dp-random-repeat" type="checkbox"> Повторно опрашивать договоры, уже сохранённые в истории</label>
            <div class="dp-random-actions">
              <button type="button" id="dp-random-collect">Добавить в очередь</button>
              <button type="button" id="dp-random-start">Старт опроса</button>
              <button type="button" id="dp-random-stop" disabled>СТОП</button>
              <button type="button" id="dp-random-copy">Копировать итоги</button>
              <button type="button" id="dp-random-full">Копировать полный TXT</button>
              <button type="button" id="dp-random-json">Копировать JSON</button>
              <button type="button" id="dp-random-clear-queue">Очистить очередь</button>
              <button type="button" id="dp-random-clear">Очистить результаты</button>
            </div>
          </div>
        </details>
        <div id="dp-random-summary">Собрано в очередь 0/150 · завершённых результатов 0/150</div>
        <div id="dp-random-live" class="dp-random-live idle" aria-live="polite">
          <span class="dp-random-live-dot" aria-hidden="true"></span>
          <div><b>ОЖИДАНИЕ</b><span>Очередь пуста. Сначала собери договоры с нужных страниц.</span></div>
          <strong>Процесс не запущен</strong>
        </div>
        <div id="dp-random-workspace">
          <section class="dp-random-column dp-random-completed-column">
            <div class="dp-random-section-head"><b>Уже опрошены</b><span id="dp-random-completed-count">0 · последние сверху</span></div>
            <div id="dp-random-results"></div>
          </section>
          <section class="dp-random-column dp-random-pending-column">
            <div class="dp-random-section-head"><b>Остались в очереди</b><span id="dp-random-pending-count">0 договоров</span></div>
            <div id="dp-random-queue"></div>
          </section>
        </div>
      </section>
      <div id="dp-results"></div>
      <div id="dp-journal-resizer" title="Потяни вверх или вниз, чтобы изменить размер системного журнала"></div>
      <div id="dp-journal-wrap">
        <div class="dp-journal-toolbar">
          <span>Системный журнал (<span id="dp-journal-count">0</span>)</span>
          <div class="dp-journal-view-buttons">
            <button type="button" class="dp-journal-view-button" data-dp-journal-view="flow" title="Показывать решения, гипотезы и результаты без сетевого шума">Ход</button>
            <button type="button" class="dp-journal-view-button" data-dp-journal-view="all" title="Показывать также все сетевые запросы и технические детали">Все</button>
            <button type="button" id="dp-copy-journal" title="Скопировать текущий режим журнала: «Ход» или «Все»">Копировать</button>
          </div>
        </div>
        <div id="dp-journal-list"></div>
      </div>
      <div id="dp-panel-resize" title="Потяни левую границу, чтобы изменить ширину боковой панели"></div>
    </div>
  `;

  const panelTemplate = document.createElement('template');
  panelTemplate.innerHTML = panelHtml.trim();
  const panelElement = panelTemplate.content.firstElementChild;
  if (!panelElement) throw new Error('не удалось создать DOM боковой панели');
  document.body.appendChild(panelElement);
  const panelLauncher = document.createElement('button');
  panelLauncher.type = 'button';
  panelLauncher.id = 'dp-panel-launcher';
  panelLauncher.textContent = 'SIMNET';
  panelLauncher.title = 'Показать основную панель Workbench';
  panelLauncher.hidden = true;
  document.body.appendChild(panelLauncher);
  installStablePanelDisclosures();

  // Рандом-сбор вынесен в отдельный userscript. Основная панель не загружает
  // очередь, RAW-историю и интерфейс коллектора.
  document.querySelector('#dp-random-panel')?.remove();
  document.querySelector('#dp-random-toggle')?.remove();
  document.querySelectorAll('[data-dp-workspace-view="process"], [data-dp-workspace-view="results"], [data-dp-workspace-view="queue"]').forEach(node => node.remove());
  const mainTabs = document.querySelector('#dp-workspace-tabs');
  if (mainTabs) mainTabs.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
  // Сначала поднимаем старую очередь/историю как миграционный источник,
  // затем единый снимок v3 перекрывает её актуальным общим состоянием.
  restoreRandomPonTestState();
  installWorkspacePersistence();
  const workspaceRestored = restoreWorkspaceState();
  if (!workspaceRestored) {
    clearAllFieldResults();
    workspaceDirty = true;
    persistWorkspaceStateNow({ force: true });
  }
  const initialForeignLease = readWorkspaceLease();
  workspaceRemoteOperation = initialForeignLease && initialForeignLease.ownerTabId !== workspaceTabId
    ? workspaceLeaseAsOperation(initialForeignLease)
    : null;
  updateBillingProviderControl('initial');
  updateBillingSessionBadge();
  updateRunControls();
  installBillingPpSyncListener();
  installBillingTabBridge();
  installBillingProviderAutoDetection();
  installJournalResizer();
  installPanelMovementAndResize();
  workspaceActiveView = 'subscriber';
  setWorkspaceView(workspaceActiveView, { persist: false });
  document.querySelectorAll('[data-dp-workspace-view]').forEach(button => {
    button.addEventListener('click', () => setWorkspaceView(button.getAttribute('data-dp-workspace-view')));
  });
  document.querySelectorAll('[data-dp-journal-view]').forEach(button => {
    button.addEventListener('click', () => setJournalView(button.dataset.dpJournalView));
  });
  document.querySelector('#dp-copy-journal')?.addEventListener('click', copyCurrentJournal);
  renderSystemJournal();

  document.querySelector('#dp-billing-provider-mode')?.addEventListener('change', event => {
    setBillingProviderMode(event.target && event.target.value, 'ui');
  });

  document.querySelector('#dp-run').addEventListener('click', () => {
    const contract = document.querySelector('#dp-input').value;
    runDiagnostics(contract);
  });

  document.querySelector('#dp-port-run').addEventListener('click', () => {
    runPortSubscribersAnalysis();
  });

  document.querySelector('#dp-random-toggle')?.addEventListener('click', () => {
    setWorkspaceView(workspaceActiveView === 'process' ? 'queue' : 'process');
  });

  document.querySelector('#dp-random-wide')?.addEventListener('click', () => {
    const panel = document.querySelector('#dp-panel');
    if (!panel || panel.classList.contains('collapsed')) return;
    const current = currentPanelGeometry().width;
    const wideTarget = Math.min(PANEL_DOCK_MAX_WIDTH, Math.max(780, Math.floor((window.innerWidth || 1200) * 0.62)));
    const target = current >= 760 ? PANEL_DOCK_DEFAULT_WIDTH : wideTarget;
    applyPanelGeometry({ width: target, height: window.innerHeight }, true);
    scheduleWorkspacePersist();
  });

  document.querySelector('#dp-random-collect')?.addEventListener('click', addRandomPonContractsToQueue);

  document.querySelector('#dp-random-start')?.addEventListener('click', runRandomPonTests);
  document.querySelector('#dp-random-stop')?.addEventListener('click', stopRandomPonTests);
  document.querySelector('#dp-random-copy')?.addEventListener('click', async () => {
    try { await copyTextToClipboard(randomPonResultsAsText()); } catch (error) { renderStatus(`не удалось скопировать итоги: ${error.message}`, 'error'); }
  });
  document.querySelector('#dp-random-full')?.addEventListener('click', async () => {
    try { await copyTextToClipboard(randomPonResultsAsFullText()); } catch (error) { renderStatus(`не удалось скопировать полный TXT: ${error.message}`, 'error'); }
  });
  document.querySelector('#dp-random-json')?.addEventListener('click', async () => {
    try { await copyTextToClipboard(JSON.stringify(randomPonTestRuntime.results, null, 2)); } catch (error) { renderStatus(`не удалось скопировать JSON: ${error.message}`, 'error'); }
  });
  document.querySelector('#dp-random-queue')?.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-dp-random-remove]') : null;
    if (!button || randomPonTestRuntime.running || workspaceMutationBlocked()) return;
    const queueId = String(button.getAttribute('data-dp-random-remove') || '');
    randomPonTestRuntime.queue = randomPonTestRuntime.queue.filter(item => String(item && item.queueId || '') !== queueId);
    persistRandomPonTestState();
    renderRandomPonTestResults();
  });
  document.querySelector('#dp-random-clear-queue')?.addEventListener('click', () => {
    if (randomPonTestRuntime.running || workspaceMutationBlocked()) return;
    randomPonTestRuntime.queue = [];
    randomPonTestRuntime.currentIndex = -1;
    randomPonTestRuntime.activeQueueItem = null;
    persistRandomPonTestState();
    renderRandomPonTestResults();
    renderStatus('очередь PON очищена; сохранённые результаты не удалены', 'ok');
  });
  document.querySelector('#dp-random-clear')?.addEventListener('click', () => {
    if (randomPonTestRuntime.running || workspaceMutationBlocked()) return;
    randomPonTestRuntime.results = [];
    randomPonTestRuntime.currentIndex = -1;
    persistRandomPonTestState();
    renderRandomPonTestResults();
  });
  document.querySelector('#dp-random-contracts')?.addEventListener('input', persistRandomPonTestState);
  document.querySelector('#dp-random-count')?.addEventListener('change', persistRandomPonTestState);
  document.querySelector('#dp-random-delay')?.addEventListener('change', persistRandomPonTestState);
  document.querySelector('#dp-random-source')?.addEventListener('change', persistRandomPonTestState);
  document.querySelector('#dp-random-repeat')?.addEventListener('change', persistRandomPonTestState);

  document.querySelector('#dp-stop').addEventListener('click', () => {
    stopDiagnostics('остановлено оператором');
  });

  window.addEventListener('beforeunload', event => {
    if (!workspaceOwnsCurrentLease() || !(diagnosticRuntime.running || randomPonTestRuntime.running)) return;
    // Chrome shows its own generic confirmation text. This prevents accidental
    // reload/navigation/close of the only tab that owns the live Promise chain.
    persistRandomPonTestState();
    persistWorkspaceStateNow({ force: true });
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  window.addEventListener('pagehide', () => {
    if (workspaceOwnsCurrentLease()) {
      if (randomPonTestRuntime.running) randomPonTestRuntime.stopRequested = true;
      if (diagnosticRuntime.running) {
        stopDiagnostics('операция остановлена: вкладка закрыта или обновлена', {
          keepRandomBatch: true,
          silentStatus: true,
        });
      }
      releaseWorkspaceLease('вкладка закрыта или обновлена');
    }
    persistRandomPonTestState();
    const panel = document.querySelector('#dp-panel');
    if (!panel || panel.dataset.workbenchVersion !== ACTIVE_WORKBENCH_VERSION) return;
    // При обычном переходе следующая страница тут же создаст dock заново. Снятие
    // размеров не даёт старому документу оставлять боковой зазор в bfcache.
    applyPageDockReservation(0);
  });

  document.querySelector('#dp-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !document.querySelector('#dp-input').readOnly) {
      const contract = document.querySelector('#dp-input').value;
      runDiagnostics(contract);
    }
  });

  document.querySelector('#dp-minimize').addEventListener('click', () => {
    const panel = document.querySelector('#dp-panel');
    setPanelCollapsed(!(panel && panel.classList.contains('collapsed')), true);
  });

  const setMainPanelHidden = (hidden, persist = true) => {
    const panel = document.querySelector('#dp-panel');
    const launcher = document.querySelector('#dp-panel-launcher');
    if (!panel || !launcher) return;
    const next = Boolean(hidden);
    panel.style.setProperty('display', next ? 'none' : 'flex', 'important');
    launcher.hidden = !next;
    launcher.dataset.side = String(safeGetValue(PANEL_SIDE_KEY, 'right') || 'right');
    if (next) applyPageDockReservation(0);
    else applyPanelGeometry(currentPanelGeometry(), false);
    if (persist) {
      try { GM_setValue(PANEL_HIDDEN_KEY, next); } catch (_) {}
    }
  };

  document.querySelector('#dp-hide-panel')?.addEventListener('click', () => setMainPanelHidden(true, true));
  document.querySelector('#dp-panel-launcher')?.addEventListener('click', () => setMainPanelHidden(false, true));
  document.querySelector('#dp-reload-extension')?.addEventListener('click', () => {
    const button = document.querySelector('#dp-reload-extension');
    if (!button || button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    button.disabled = true;
    button.textContent = '↻ обновление…';
    try {
      const sendMessage = globalThis.chrome?.runtime?.sendMessage;
      if (typeof sendMessage !== 'function') throw new Error('chrome.runtime.sendMessage недоступен');
      window.dispatchEvent(new Event('simnet-workbench:dev-reload-page'));
      const request = sendMessage.call(globalThis.chrome.runtime, { type: 'SIMNET_WB_DEV_RELOAD' });
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch (error) {
      button.dataset.busy = '0';
      button.disabled = false;
      button.textContent = `↻ EXT ${extensionManifestVersion}`;
      renderStatus(`не удалось перезагрузить расширение: ${String(error?.message || error)}`, 'error');
    }
  });
  document.querySelector('#dp-side-panel')?.addEventListener('click', () => {
    const current = String(safeGetValue(PANEL_SIDE_KEY, 'right') || 'right') === 'left' ? 'left' : 'right';
    const next = current === 'right' ? 'left' : 'right';
    try { GM_setValue(PANEL_SIDE_KEY, next); } catch (_) {}
    const launcher = document.querySelector('#dp-panel-launcher');
    if (launcher) launcher.dataset.side = next;
    applyPanelGeometry(currentPanelGeometry(), true);
  });
  setMainPanelHidden(Boolean(safeGetValue(PANEL_HIDDEN_KEY, false)), false);

  window[INSTANCE_KEY] = { version: ACTIVE_WORKBENCH_VERSION, status: 'ready', startedAt: Number(window[INSTANCE_KEY] && window[INSTANCE_KEY].startedAt || Date.now()), readyAt: Date.now() };

  } catch (err) {
    window[INSTANCE_KEY] = { version: ACTIVE_WORKBENCH_VERSION, status: 'error', startedAt: Number(window[INSTANCE_KEY] && window[INSTANCE_KEY].startedAt || Date.now()), error: String(err && err.message || err) };
    try { console.error(`${BOOT_PREFIX} критическая ошибка инициализации`, err); } catch (_) {}
    try {
      document.getElementById('dp-panel')?.remove();
      document.getElementById('dp-panel-launcher')?.remove();
      const failure = document.createElement('section');
      failure.id = 'dp-workbench-boot-error';
      Object.assign(failure.style, {
        position: 'fixed', right: '8px', top: '8px', zIndex: '2147483647', maxWidth: 'calc(100vw - 16px)', width: '340px',
        padding: '10px', border: '2px solid #d92d20', borderRadius: '10px', background: '#fff', color: '#101828',
        boxShadow: '0 8px 30px rgba(0,0,0,.28)', font: '12px/1.35 Arial,sans-serif'
      });
      failure.innerHTML = `<b>Workbench не загрузился</b><div style="margin-top:5px;overflow-wrap:anywhere">${String(err && err.message || err).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}</div><button type="button" style="margin-top:8px;padding:6px 10px">Перезагрузить страницу</button>`;
      failure.querySelector('button')?.addEventListener('click', () => location.reload());
      (document.body || document.documentElement).appendChild(failure);
    } catch (_) {}
  }
})();

/* ==========================================================================
   NATIVE WORKBENCH FEATURE: HISTORICAL REASONING / EQUIPMENT LINEAGE

   Встроенный этап Workbench после обычной диагностики. Он использует текущий
   договор и уже собранные поля, дополняет их данными UserSide, разделяет
   связанные договоры и реальную цепочку ONU, строит хронологию, показывает
   складские движения, конфликты и уровень уверенности.

   Аналитический этап не выполняет POST/сохранение и не изменяет Billing/ТМЦ:
   изменение учётных данных должно оставаться отдельным явным действием
   оператора. Результат входит в общий #dp-results и синхронизируется зеркалам.
   ========================================================================== */
(function simnetHistoricalReasoningAddon() {
  'use strict';

  if (window.top !== window.self) return;

  const HR_VERSION = 'history-1.0';
  const HR_BASE = 'https://userside.simnet.kiev.ua';
  const HR_REQUEST_LIMIT = 12;
  const HR_RELATED_LIMIT = 3;
  const HR_TIMEOUT_MS = 15000;
  const HR_AUTO_DELAY_MS = 700;
  const HR_ARM_TTL_MS = 2 * 60 * 1000;
  const HR_MAC_RE = /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/ig;
  const HR_IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const HR_INTERFACE_RE = /\b(?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3}(?::\d+)?\b/ig;
  const HR_EVENT_RE = /(?:перен[ео]с|перемещ|переех|склад|возврат|повернул|забрал|замен|смен|привяз|отвяз|удален|видален|former|закрыт|заблок|актив|inactive|операци|operation|ремонт|монтаж|демонтаж)/i;
  const HR_DATE_RE = /\b(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/;
  const HR_STYLE_ID = 'dp-history-reasoning-style';

  const runtime = {
    installed: false,
    running: false,
    runId: 0,
    requests: 0,
    abortables: new Set(),
    lastContract: '',
    lastCompletedStatus: '',
    lastScheduledKey: '',
    armedContract: '',
    armedAt: 0,
    observer: null,
    installTimer: 0,
  };

  function hrEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hrText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function hrUnique(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const value = hrText(raw);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function hrNormalizeContract(raw) {
    const match = String(raw || '').match(/(?:abon)?(\d{4,14})/i);
    return match ? match[1] : '';
  }

  function hrNormalizeLogin(raw) {
    const contract = hrNormalizeContract(raw);
    return contract ? `abon${contract}` : hrText(raw).toLowerCase();
  }

  function hrNormalizeMac(raw) {
    const compact = String(raw || '').replace(/[^0-9a-f]/ig, '').toUpperCase();
    return compact.length === 12 ? compact.match(/.{2}/g).join(':') : '';
  }

  function hrCompactIdentifier(raw) {
    return String(raw || '').replace(/[^0-9a-z]/ig, '').toUpperCase();
  }

  function hrNormalizeName(raw) {
    return hrText(raw)
      .toLowerCase()
      .replace(/[«»"'`]/g, '')
      .replace(/\b(?:фоп|тов|дп|пп|ооо)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hrNormalizeAddress(raw) {
    return hrText(raw)
      .toLowerCase()
      .replace(/\b(?:украина|україна|киев|київ|город|місто|г\.)\b/g, '')
      .replace(/[.,;()[\]]/g, ' ')
      .replace(/\b(?:улица|вулиця|ул\.|вул\.)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hrParseHtml(raw) {
    return new DOMParser().parseFromString(String(raw || ''), 'text/html');
  }

  function hrNodeText(node) {
    return hrText(node && (node.innerText || node.textContent) || '');
  }

  function hrExtractLabel(doc, labels) {
    const wanted = (Array.isArray(labels) ? labels : [labels]).map(label => String(label).replace(/:\s*$/, '').toLowerCase());
    for (const node of doc.querySelectorAll('.left_data, dt, th, label, b, strong')) {
      const label = hrText(node.textContent).replace(/:\s*$/, '').toLowerCase();
      if (!wanted.includes(label)) continue;
      const sibling = node.nextElementSibling;
      if (sibling && hrNodeText(sibling)) return hrNodeText(sibling);
      const parent = node.parentElement;
      if (parent) {
        const value = hrNodeText(parent).slice(hrNodeText(node).length).trim();
        if (value) return value;
      }
    }
    return '';
  }

  function hrExtractMacs(text) {
    return hrUnique((String(text || '').match(HR_MAC_RE) || []).map(hrNormalizeMac).filter(Boolean));
  }

  function hrExtractIps(text) {
    return hrUnique((String(text || '').match(HR_IP_RE) || []).filter(ip => {
      const parts = ip.split('.').map(Number);
      return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
    }));
  }

  function hrExtractSerials(text) {
    const source = String(text || '');
    const values = [];
    const patterns = [
      /(?:\bSN\b|Serial(?:\s+Number)?|серийн(?:ый|ий)?\s+номер|серійний\s+номер)\s*[:#=]?\s*([A-Z0-9_-]{8,32})/ig,
      /\b(?:FGXP|XPON|HWTC|ZTEG|CDAT|FHTT|ALCL)[A-Z0-9_-]{6,28}\b/ig,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) values.push(match[1] || match[0]);
    }
    return hrUnique(values.map(hrCompactIdentifier).filter(value => value.length >= 8));
  }

  function hrExtractInterfaces(text) {
    return hrUnique(String(text || '').match(HR_INTERFACE_RE) || []);
  }

  function hrExtractOltRefs(doc) {
    const values = [];
    for (const anchor of doc.querySelectorAll('a[href*="/device/"]')) {
      const context = hrNodeText(anchor.closest('tr,.item,td,div') || anchor.parentElement);
      if (!/\bOLT\b|Huawei|BDCOM|GCOM|MA\d{3,5}|GP\d{3,5}|P3600/i.test(context)) continue;
      const ip = hrExtractIps(context).find(value => /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value)) || '';
      const iface = hrExtractInterfaces(context)[0] || '';
      values.push([hrNodeText(anchor), ip, iface].filter(Boolean).join(' · '));
    }
    return hrUnique(values);
  }

  function hrExtractEvents(doc, source, contract) {
    const result = [];
    const seen = new Set();
    const selectors = 'tr.table_item,tr,.item,li,p,article';
    for (const node of doc.querySelectorAll(selectors)) {
      const text = hrNodeText(node);
      if (text.length < 12 || text.length > 1800 || !HR_EVENT_RE.test(text)) continue;
      const dateMatch = text.match(HR_DATE_RE);
      const operationMatch = text.match(/\b(?:операци\w*|operation)\s*[№#:]?\s*(\d{4,12})\b/i);
      const key = `${dateMatch ? dateMatch[0] : ''}|${operationMatch ? operationMatch[1] : ''}|${text.slice(0, 220)}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        contract: hrNormalizeContract(contract),
        date: dateMatch ? dateMatch[0] : '',
        operationId: operationMatch ? operationMatch[1] : '',
        text: text.slice(0, 1000),
        source,
      });
      if (result.length >= 28) break;
    }
    return result;
  }

  function hrPanelField(key) {
    return hrText(document.querySelector(`#dp-field-${key} .dp-field-value`)?.textContent || '');
  }

  function hrPanelSnapshot() {
    return {
      requested: hrText(document.querySelector('#dp-input')?.value || ''),
      contract: hrNormalizeContract(hrPanelField('contract') || document.querySelector('#dp-input')?.value || ''),
      login: hrNormalizeLogin(hrPanelField('login')),
      name: hrPanelField('fio'),
      address: hrPanelField('address'),
      sessionMac: hrNormalizeMac(hrPanelField('sessionMac')),
      deviceMac: hrNormalizeMac(hrPanelField('deviceMac')),
      connectionPoint: hrPanelField('connectionPoint'),
      status: hrText(document.querySelector('#dp-status')?.textContent || ''),
      onuText: hrText(document.querySelector('#dp-onu-container')?.textContent || ''),
      onuRaw: hrText(document.querySelector('#dp-onu-container pre')?.textContent || ''),
    };
  }

  function hrPanelRole() {
    return String(document.querySelector('#dp-panel')?.dataset.tabRole || 'idle');
  }

  function hrIsMirror() {
    return hrPanelRole() === 'mirror';
  }

  function hrNotifyWorkbenchChanged() {
    const results = document.querySelector('#dp-results');
    if (!results) return;
    // Основной Workbench уже слушает toggle на #dp-results и через него
    // публикует общий workspace-снимок. Так исторический разбор попадает
    // в зеркальные вкладки без доступа к внутреннему scope главной IIFE.
    try { results.dispatchEvent(new Event('toggle', { bubbles: true })); } catch (_) {}
  }

  function hrUpdateButtonState() {
    const button = document.querySelector('#dp-history-run');
    if (!button) return;
    const statusText = hrText(document.querySelector('#dp-status')?.textContent || '');
    const mainBusy = /ищу договор|собираю данные|запускаю опрос|опрос ONU|PON-цикл/i.test(statusText)
      && !/диагностика завершена/i.test(statusText);
    const mirror = hrIsMirror();
    button.disabled = Boolean(runtime.running || mainBusy || mirror);
    button.title = mirror
      ? 'Зеркало: исторический разбор запускается во вкладке-исполнителе'
      : runtime.running
        ? 'Исторический разбор выполняется'
        : mainBusy
          ? 'Сначала дождись завершения основной диагностики'
          : 'Встроенный разбор связанных договоров, ONU, оборудования и хронологии';
  }

  function hrArmAutomaticRun(contract) {
    const normalized = hrNormalizeContract(contract);
    if (!normalized || hrPanelRole() !== 'owner') return false;
    runtime.armedContract = normalized;
    runtime.armedAt = Date.now();
    return true;
  }

  function hrAutomaticRunArmed(contract) {
    const normalized = hrNormalizeContract(contract);
    return Boolean(normalized
      && runtime.armedContract === normalized
      && runtime.armedAt > 0
      && Date.now() - runtime.armedAt <= HR_ARM_TTL_MS
      && !hrIsMirror());
  }

  function hrAbort() {
    runtime.runId += 1;
    runtime.running = false;
    for (const handle of runtime.abortables) {
      try { handle.abort(); } catch (_) {}
    }
    runtime.abortables.clear();
  }

  function hrRequest(url, runId) {
    if (runtime.requests >= HR_REQUEST_LIMIT) return Promise.reject(new Error(`лимит исторического анализа: ${HR_REQUEST_LIMIT} GET`));
    runtime.requests += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      let handle = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (handle) runtime.abortables.delete(handle);
        callback(value);
      };
      handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        timeout: HR_TIMEOUT_MS,
        onload: response => {
          if (runId !== runtime.runId) return finish(reject, new Error('анализ заменён новым запуском'));
          if (response.status >= 200 && response.status < 400) return finish(resolve, response.responseText || '');
          return finish(reject, new Error(`HTTP ${response.status}`));
        },
        onerror: () => finish(reject, new Error('network error')),
        ontimeout: () => finish(reject, new Error('timeout')),
        onabort: () => finish(reject, new Error('остановлено')),
      });
      runtime.abortables.add(handle);
    });
  }

  function hrExactResolverCandidates(raw, requested) {
    let html = '';
    try {
      const parsed = JSON.parse(String(raw || ''));
      html = String(parsed && parsed.data || '');
    } catch (_) {
      html = String(raw || '');
    }
    const doc = hrParseHtml(html);
    const requestedLogin = hrNormalizeLogin(requested);
    const requestedContract = hrNormalizeContract(requested);
    const candidates = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll('a[href^="/customer/"],a[href*="/customer/"]')) {
      const idMatch = String(anchor.getAttribute('href') || '').match(/\/customer\/(\d+)/);
      if (!idMatch) continue;
      const row = anchor.closest('tr,li,.item,div') || anchor.parentElement;
      const text = hrNodeText(row);
      const logins = hrUnique(text.match(/\babon\d{4,14}\b/ig) || []).map(value => value.toLowerCase());
      const agreements = hrUnique(text.match(/\b\d{4,14}\b/g) || []);
      const exactLogin = logins.includes(requestedLogin);
      const exactAgreement = agreements.includes(requestedContract);
      const key = idMatch[1];
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        customerId: idMatch[1],
        text,
        logins,
        agreements,
        exactLogin,
        exactAgreement,
      });
    }
    return candidates.sort((a, b) => Number(b.exactLogin) - Number(a.exactLogin)
      || Number(b.exactAgreement) - Number(a.exactAgreement));
  }

  function hrChooseExactCandidate(candidates, requested) {
    const explicitLogin = /^abon\d{4,14}$/i.test(hrText(requested));
    if (explicitLogin) return candidates.find(candidate => candidate.exactLogin) || null;
    const exact = candidates.filter(candidate => candidate.exactAgreement || candidate.exactLogin);
    return exact.length === 1 ? exact[0] : null;
  }

  function hrParseSubscriberMatches(raw, searchMac) {
    const doc = hrParseHtml(raw);
    const rows = [...doc.querySelectorAll('tr.table_item,tr')];
    const result = [];
    for (const row of rows) {
      const customerLink = row.querySelector('a[href^="/customer/"],a[href*="/customer/"]');
      const idMatch = customerLink && String(customerLink.getAttribute('href') || '').match(/\/customer\/(\d+)/);
      if (!idMatch) continue;
      const text = hrNodeText(row);
      const agreementCell = row.querySelector('[id$="_agreement_full_Id"]');
      const identityCell = row.querySelector('[id$="_ip_username_Id"]');
      const nameCell = row.querySelector('[id$="_name_full_Id"]');
      const addressCell = row.querySelector('[id$="_adr_full_Id"]');
      const statusCell = row.querySelector('[id$="_state_name_Id"]');
      const activityCell = row.querySelector('[id$="_date_activity_Id"]');
      const agreement = hrNormalizeContract(hrNodeText(agreementCell) || text);
      const login = (hrNodeText(identityCell).match(/\babon\d{4,14}\b/i) || [])[0] || '';
      result.push({
        customerId: idMatch[1],
        agreement,
        login,
        name: hrNodeText(nameCell),
        address: hrNodeText(addressCell),
        status: hrNodeText(statusCell),
        activity: hrNodeText(activityCell),
        searchMac: hrNormalizeMac(searchMac),
        rowText: text.slice(0, 1200),
      });
    }
    return result;
  }

  function hrSnapshotFromPages(meta, mainRaw, supportRaw) {
    const mainDoc = hrParseHtml(mainRaw);
    const supportDoc = hrParseHtml(supportRaw);
    const mainText = hrNodeText(mainDoc.body);
    const supportText = hrNodeText(supportDoc.body);
    const allText = `${mainText}\n${supportText}`;
    const contract = hrNormalizeContract(
      hrExtractLabel(mainDoc, ['Договор', 'Договір'])
      || meta.agreement
      || meta.login
      || meta.contract
    );
    const name = hrExtractLabel(mainDoc, ['ФИО', 'ПІБ', 'Наименование', 'Найменування']) || meta.name || '';
    const address = hrExtractLabel(mainDoc, ['Адрес', 'Адреса']) || meta.address || '';
    const status = hrExtractLabel(mainDoc, ['Статус', 'Состояние', 'Стан']) || meta.status || '';
    const group = hrExtractLabel(mainDoc, ['Группа', 'Група']) || '';
    const reason = hrExtractLabel(mainDoc, ['Причина', 'Комментарий', 'Коментар']) || '';
    const serials = hrExtractSerials(allText);
    const macs = hrExtractMacs(allText);
    const ipAddresses = hrExtractIps(mainText);
    const interfaces = hrExtractInterfaces(mainText);
    const oltRefs = hrExtractOltRefs(mainDoc);
    const events = [
      ...hrExtractEvents(mainDoc, 'UserSide · основная карточка', contract),
      ...hrExtractEvents(supportDoc, 'UserSide · задания/история', contract),
    ];
    return {
      contract,
      customerId: String(meta.customerId || ''),
      login: hrNormalizeLogin(meta.login || contract),
      name,
      address,
      status,
      group,
      reason,
      activity: meta.activity || '',
      serials,
      macs,
      ipAddresses,
      interfaces,
      oltRefs,
      events,
      searchMac: hrNormalizeMac(meta.searchMac),
      mainText: mainText.slice(0, 120000),
      supportText: supportText.slice(0, 80000),
    };
  }

  function hrIntersection(left, right) {
    const other = new Set((right || []).map(value => String(value).toUpperCase()));
    return hrUnique((left || []).filter(value => other.has(String(value).toUpperCase())));
  }

  function hrEventTimestamp(event) {
    const raw = String(event && event.date || '');
    const match = raw.match(/(\d{1,4})[-./](\d{1,2})[-./](\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return 0;
    let year;
    let month;
    let day;
    if (match[1].length === 4) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    } else {
      day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
      if (year < 100) year += 2000;
    }
    return new Date(year, month - 1, day, Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)).getTime() || 0;
  }

  function hrRelationEvidence(current, candidate) {
    const evidence = [];
    const sharedSerials = hrIntersection(current.serials, candidate.serials);
    const sharedMacs = hrIntersection(current.macs, candidate.macs);
    const sameName = Boolean(hrNormalizeName(current.name)
      && hrNormalizeName(current.name) === hrNormalizeName(candidate.name));
    const sameAddress = Boolean(hrNormalizeAddress(current.address)
      && hrNormalizeAddress(current.address) === hrNormalizeAddress(candidate.address));
    const searchMac = candidate.searchMac && current.macs.includes(candidate.searchMac) ? candidate.searchMac : '';
    if (sharedSerials.length) evidence.push({ kind: 'serial', weight: 8, text: `тот же Serial: ${sharedSerials.join(', ')}` });
    if (sharedMacs.length) evidence.push({ kind: 'mac', weight: 6, text: `совпадает MAC: ${sharedMacs.join(', ')}` });
    if (searchMac && !sharedMacs.includes(searchMac)) evidence.push({ kind: 'mac-history', weight: 5, text: `договор найден по истории MAC ${searchMac}` });
    if (sameName) evidence.push({ kind: 'name', weight: 2, text: 'совпадает абонент/наименование' });
    if (sameAddress) evidence.push({ kind: 'address', weight: 2, text: 'совпадает адрес' });
    if (candidate.activity) evidence.push({ kind: 'time', weight: 1, text: `последняя активность: ${candidate.activity}` });
    const moveText = candidate.events.map(event => event.text).join(' ');
    const explicitMove = HR_EVENT_RE.test(moveText) && /(?:перен[ео]с|перемещ|склад|повернул|забрал)/i.test(moveText);
    if (explicitMove) evidence.push({ kind: 'movement', weight: 7, text: 'есть датированная запись о переносе/складском движении' });
    const equipmentEvidence = evidence.some(item => ['serial', 'movement'].includes(item.kind));
    const score = evidence.reduce((sum, item) => sum + item.weight, 0);
    return {
      contract: candidate.contract,
      customerId: candidate.customerId,
      evidence,
      sharedSerials,
      sharedMacs,
      role: equipmentEvidence ? 'equipment-lineage' : 'related-contract',
      confidence: score >= 12 ? 'high' : score >= 6 ? 'medium' : 'low',
      score,
      candidate,
    };
  }

  function hrNearIdentifierConflict(snapshot) {
    const conflicts = [];
    for (const serial of snapshot.serials || []) {
      const serialTail = hrCompactIdentifier(serial).slice(-4);
      if (serialTail.length !== 4) continue;
      for (const mac of snapshot.macs || []) {
        const macTail = hrCompactIdentifier(mac).slice(-4);
        if (macTail.length !== 4 || serialTail === macTail) continue;
        if (serialTail.slice(0, 3) === macTail.slice(0, 3)) {
          conflicts.push(`Serial …${serialTail} и MAC …${macTail} похожи, но последний символ не совпадает.`);
        }
      }
    }
    return hrUnique(conflicts);
  }

  function hrExtractStructuredMoves(snapshots) {
    const moves = [];
    for (const snapshot of snapshots) {
      for (const event of snapshot.events || []) {
        const text = event.text;
        if (!/(?:перен[ео]с|перемещ|склад|повернул|забрал|выдан|видан|возврат)/i.test(text)) continue;
        const contracts = hrUnique((text.match(/\b(?:abon)?\d{4,14}\b/ig) || []).map(hrNormalizeContract).filter(Boolean));
        const fromMatch = text.match(/(?:\bс\b|\bсо\b|\bиз\b|\bз\b)\s+(?:договора?|договору|контракт[а-яіїє]*)?\s*(?:abon)?(\d{4,14})/i);
        const toMatch = text.match(/(?:\bна\b|\bв\b|\bдо\b)\s+(?:договор|контракт[а-яіїє]*)?\s*(?:abon)?(\d{4,14})/i);
        const warehouse = /склад/i.test(text);
        moves.push({
          from: fromMatch ? fromMatch[1] : contracts[0] || snapshot.contract || '',
          to: toMatch ? toMatch[1] : contracts[1] || (warehouse ? 'склад' : snapshot.contract || ''),
          warehouse,
          date: event.date,
          operationId: event.operationId,
          text,
          source: event.source,
        });
      }
    }
    return moves.sort((a, b) => hrEventTimestamp(a) - hrEventTimestamp(b));
  }

  function hrAnalyzeModel(model) {
    const current = model.current;
    const related = model.related || [];
    const relations = related.map(candidate => hrRelationEvidence(current, candidate))
      .filter(relation => relation.evidence.length)
      .sort((a, b) => b.score - a.score);
    const snapshots = [current, ...related];
    const moves = Array.isArray(model.moves) ? model.moves.slice() : hrExtractStructuredMoves(snapshots);
    const conflicts = [...hrNearIdentifierConflict(current)];

    for (const relation of relations.filter(item => item.role === 'equipment-lineage')) {
      const oltRefs = hrUnique([...current.oltRefs, ...relation.candidate.oltRefs]);
      const interfaces = hrUnique([...current.interfaces, ...relation.candidate.interfaces]);
      if (oltRefs.length > 1) conflicts.push(`Для связанного оборудования найдены разные OLT: ${oltRefs.join(' | ')}`);
      if (interfaces.length > 1) conflicts.push(`Для связанного оборудования найдены разные интерфейсы: ${interfaces.join(' | ')}`);
    }

    const requestedContract = hrNormalizeContract(model.requested || current.contract);
    if (requestedContract && current.contract && requestedContract !== current.contract) {
      conflicts.unshift(`Запрошен договор ${requestedContract}, а точная карточка определена как ${current.contract}.`);
    }

    const closedHistorical = /удален|видален|former|закрыт|архив|заблокирован/i.test(
      `${current.status} ${current.group} ${current.reason}`
    );
    const movementRelations = relations.filter(item => item.role === 'equipment-lineage');
    const confidence = moves.some(move => move.operationId) && movementRelations.length
      ? 'high'
      : movementRelations.some(item => item.confidence === 'high')
        ? 'high'
        : relations.some(item => ['high', 'medium'].includes(item.confidence))
          ? 'medium'
          : 'low';

    let conclusion;
    if (movementRelations.length && moves.length) {
      conclusion = 'Есть признаки подтверждаемой цепочки оборудования: совпадение Serial/записи движения согласуются по времени. Связи клиента и движение ONU показаны отдельно.';
    } else if (movementRelations.length) {
      conclusion = 'Одинаковый Serial или сильные записи оборудования связывают договоры, но для окончательной цепочки не хватает датированной складской операции.';
    } else if (relations.length) {
      conclusion = 'Найдены связанные договоры клиента/адреса/MAC. Прямой перенос конкретной ONU этими совпадениями пока не доказан.';
    } else {
      conclusion = 'Надёжная историческая связь с другими договорами не найдена в доступных источниках.';
    }
    if (closedHistorical) {
      conclusion = `Текущий договор имеет признаки закрытого/исторического. ${conclusion}`;
    }
    if (conflicts.length) {
      conclusion += ' Обнаруженные расхождения оставлены как конфликты и не исправляются автоматически.';
    }

    const timeline = snapshots.flatMap(snapshot => snapshot.events || [])
      .sort((a, b) => hrEventTimestamp(a) - hrEventTimestamp(b))
      .slice(-16);

    return {
      current,
      relations,
      moves,
      conflicts: hrUnique(conflicts),
      timeline,
      closedHistorical,
      confidence,
      conclusion,
      missing: [
        relations.length ? '' : 'не найдены другие договоры по доступным MAC/истории',
        movementRelations.length && !moves.length ? 'нет точной датированной операции переноса/склада' : '',
        current.serials.length ? '' : 'не извлечён Serial текущей ONU',
      ].filter(Boolean),
    };
  }

  function hrConfidenceLabel(value) {
    return value === 'high' ? 'ВЫСОКАЯ' : value === 'medium' ? 'СРЕДНЯЯ' : 'НИЗКАЯ';
  }

  function hrEnsureContainer() {
    let container = document.querySelector('#dp-history-reasoning-container');
    if (container) return container;
    const results = document.querySelector('#dp-results');
    if (!results) return null;
    container = document.createElement('div');
    container.id = 'dp-history-reasoning-container';
    const anchor = results.querySelector('#dp-mac-route-container,#dp-onu-container');
    if (anchor) results.insertBefore(container, anchor);
    else results.appendChild(container);
    return container;
  }

  function hrRenderPending(message) {
    const container = hrEnsureContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="dp-history-reasoning loading">
        <div class="dp-history-head">
          <span>Исторический разбор Workbench</span>
          <b>СОПОСТАВЛЕНИЕ…</b>
        </div>
        <div class="dp-history-summary">${hrEscape(message)}</div>
      </div>`;
    hrNotifyWorkbenchChanged();
  }

  function hrRenderError(message) {
    const container = hrEnsureContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="dp-history-reasoning warning">
        <div class="dp-history-head">
          <span>Исторический разбор Workbench</span>
          <b>НЕТ ВЫВОДА</b>
        </div>
        <div class="dp-history-summary">${hrEscape(message)}</div>
        <div class="dp-history-note">Основной диагностический отчёт сохранён; этот этап завершился без достаточных данных.</div>
      </div>`;
    hrNotifyWorkbenchChanged();
  }

  function hrEvidenceList(relation) {
    return relation.evidence.map(item => `<li>${hrEscape(item.text)}</li>`).join('');
  }

  function hrRenderResult(report, requestCount, selfTests) {
    const container = hrEnsureContainer();
    if (!container) return;
    const current = report.current;
    const currentBits = [
      `договор ${current.contract || 'не определён'}`,
      current.group ? `группа: ${current.group}` : '',
      current.status ? `статус: ${current.status}` : '',
      current.address ? `адрес: ${current.address}` : '',
      current.serials.length ? `SN: ${current.serials.join(', ')}` : '',
    ].filter(Boolean);
    const relationsHtml = report.relations.length
      ? report.relations.map(relation => `
          <div class="dp-history-relation ${relation.role}">
            <div>
              <b>${hrEscape(relation.contract || relation.candidate.login || relation.candidate.customerId)}</b>
              <span>${relation.role === 'equipment-lineage' ? 'цепочка оборудования' : 'связанный договор'}</span>
              <i>${hrEscape(hrConfidenceLabel(relation.confidence))}</i>
            </div>
            <ul>${hrEvidenceList(relation)}</ul>
          </div>`).join('')
      : '<div class="dp-history-empty">Связанные договоры по доступным данным не найдены.</div>';
    const movesHtml = report.moves.length
      ? `<ol>${report.moves.slice(-10).map(move => `<li>${hrEscape([
          move.date,
          move.operationId ? `операция ${move.operationId}` : '',
          move.from && move.to ? `${move.from} → ${move.to}` : '',
          move.text,
        ].filter(Boolean).join(' · '))}</li>`).join('')}</ol>`
      : '<div class="dp-history-empty">Точная складская цепочка не извлечена.</div>';
    const conflictsHtml = report.conflicts.length
      ? `<ul>${report.conflicts.map(item => `<li>${hrEscape(item)}</li>`).join('')}</ul>`
      : '<div class="dp-history-empty">Явных противоречий в извлечённых фактах нет.</div>';
    const timelineHtml = report.timeline.length
      ? `<ol>${report.timeline.map(event => `<li>${hrEscape([
          event.date || 'дата не извлечена',
          event.contract ? `договор ${event.contract}` : '',
          event.text,
          event.source,
        ].filter(Boolean).join(' · '))}</li>`).join('')}</ol>`
      : '<div class="dp-history-empty">Датированные события не извлечены.</div>';
    const testsPassed = selfTests.filter(test => test.ok).length;
    const testHtml = selfTests.map(test => `<li class="${test.ok ? 'ok' : 'bad'}">${test.ok ? '✓' : '✕'} ${hrEscape(test.name)}${test.ok ? '' : ` · ${hrEscape(test.detail)}`}</li>`).join('');

    container.innerHTML = `
      <div class="dp-history-reasoning ${report.conflicts.length ? 'warning' : report.confidence === 'high' ? 'ok' : ''}">
        <div class="dp-history-head">
          <span>Исторический разбор Workbench <small>${HR_VERSION}</small></span>
          <b>${hrEscape(hrConfidenceLabel(report.confidence))}</b>
        </div>
        <div class="dp-history-current">${currentBits.map(item => `<span>${hrEscape(item)}</span>`).join('')}</div>
        <div class="dp-history-summary">${hrEscape(report.conclusion)}</div>

        <section>
          <h4>Связанные договоры и роль связи</h4>
          ${relationsHtml}
        </section>
        <section>
          <h4>Движение оборудования</h4>
          ${movesHtml}
        </section>
        <section class="${report.conflicts.length ? 'conflicts' : ''}">
          <h4>Противоречия</h4>
          ${conflictsHtml}
        </section>
        <details>
          <summary>Хронология и найденные записи</summary>
          ${timelineHtml}
        </details>
        <details>
          <summary>Недостающие доказательства и самопроверка</summary>
          ${report.missing.length ? `<ul>${report.missing.map(item => `<li>${hrEscape(item)}</li>`).join('')}</ul>` : '<div class="dp-history-empty">Критических пробелов для текущего уровня вывода не отмечено.</div>'}
          <div class="dp-history-tests">Самопроверка правил: ${testsPassed}/${selfTests.length}</div>
          <ul class="dp-history-test-list">${testHtml}</ul>
        </details>
        <div class="dp-history-note">Встроенный этап Workbench · ${requestCount}/${HR_REQUEST_LIMIT} дополнительных GET · изменения учётных данных не выполнялись</div>
      </div>`;
    hrNotifyWorkbenchChanged();
  }

  function hrRunSelfTests() {
    const makeSnapshot = overrides => ({
      contract: '',
      customerId: '',
      login: '',
      name: '',
      address: '',
      status: '',
      group: '',
      reason: '',
      activity: '',
      serials: [],
      macs: [],
      ipAddresses: [],
      interfaces: [],
      oltRefs: [],
      events: [],
      searchMac: '',
      ...overrides,
    });

    const case497719 = hrAnalyzeModel({
      requested: '497719',
      current: makeSnapshot({
        contract: '497719',
        name: 'Ліник Павло Володимирович',
        address: 'Макогона 19/A',
        serials: ['FGXP15A2BD1B'],
        macs: ['B4:64:15:A2:BD:1A', '78:44:76:C3:89:3D'],
        oltRefs: ['BDCOM · 172.16.1.239 · epon0/9:24'],
        interfaces: ['epon0/9:24'],
      }),
      related: [
        makeSnapshot({
          contract: '442562',
          name: 'Ліник Павло Володимирович',
          address: 'Полевая 12/A',
          macs: ['78:44:76:C3:89:3D'],
          searchMac: '78:44:76:C3:89:3D',
        }),
        makeSnapshot({
          contract: '481183',
          name: 'Ліник Павло Володимирович',
          address: 'Полевая 25',
          serials: ['FGXP15A2BD1B'],
          macs: ['78:44:76:C3:89:3D'],
          events: [{ contract: '481183', date: '19.06.2026 09:44', operationId: '179497', text: 'ONU FGXP15A2BD1B перемещена с договора 481183 на склад', source: 'fixture' }],
        }),
      ],
      moves: [
        { from: '481183', to: 'склад', date: '19.06.2026 09:44', operationId: '179497', text: 'ONU на склад', source: 'fixture' },
        { from: 'склад', to: '497719', date: '19.06.2026 09:45', operationId: '179498', text: 'ONU со склада на 497719', source: 'fixture' },
      ],
    });

    const case23768 = hrAnalyzeModel({
      requested: '23768',
      current: makeSnapshot({
        contract: '23768',
        name: 'Один клиент',
        address: 'старый адрес',
        group: 'Удаленные',
        reason: '_Переехал',
        serials: ['OLDONU1234'],
        macs: ['E8:94:F6:93:11:2F'],
      }),
      related: [
        makeSnapshot({
          contract: '500747',
          name: 'Один клиент',
          address: 'новый адрес',
          serials: ['XPON50120741'],
          macs: ['E8:94:F6:93:11:2F', 'C4:CD:50:12:07:41'],
          searchMac: 'E8:94:F6:93:11:2F',
        }),
      ],
    });

    const relation442562 = case497719.relations.find(item => item.contract === '442562');
    const relation481183 = case497719.relations.find(item => item.contract === '481183');
    const relation500747 = case23768.relations.find(item => item.contract === '500747');
    const tests = [
      {
        name: '442562 остаётся связанным договором, а не источником ONU',
        ok: Boolean(relation442562 && relation442562.role === 'related-contract'),
        detail: relation442562 ? relation442562.role : 'связь не построена',
      },
      {
        name: '481183 определяется как часть цепочки оборудования',
        ok: Boolean(relation481183 && relation481183.role === 'equipment-lineage'),
        detail: relation481183 ? relation481183.role : 'связь не построена',
      },
      {
        name: 'Складская цепочка сортируется 481183 → склад → 497719',
        ok: case497719.moves.length === 2
          && case497719.moves[0].from === '481183'
          && case497719.moves[1].to === '497719',
        detail: case497719.moves.map(move => `${move.from}→${move.to}`).join(', '),
      },
      {
        name: 'BD1B/BD1A выводится как конфликт, а не исправляется',
        ok: case497719.conflicts.some(item => /BD1B.*BD1A/i.test(item)),
        detail: case497719.conflicts.join(' | '),
      },
      {
        name: '«Удаленные» трактуется как исторический/закрытый договор',
        ok: case23768.closedHistorical,
        detail: case23768.conclusion,
      },
      {
        name: 'Новый договор с другой ONU не объявляется переносом этой же ONU',
        ok: Boolean(relation500747 && relation500747.role === 'related-contract'),
        detail: relation500747 ? relation500747.role : 'связь не построена',
      },
    ];
    return tests;
  }

  async function hrRun(reason = 'manual') {
    const panel = document.querySelector('#dp-panel');
    if (!panel) return;
    if (hrIsMirror()) {
      if (reason === 'manual') hrRenderError('Эта вкладка является зеркалом. Запусти разбор во вкладке-исполнителе или в свободной вкладке.');
      hrUpdateButtonState();
      return;
    }
    const runButton = document.querySelector('#dp-history-run');
    const panelSnapshot = hrPanelSnapshot();
    const requested = panelSnapshot.requested;
    if (!requested) {
      hrRenderError('Сначала введи договор и запусти обычную диагностику.');
      return;
    }

    hrAbort();
    const runId = runtime.runId;
    runtime.running = true;
    runtime.requests = 0;
    runtime.lastContract = requested;
    if (runButton) runButton.disabled = true;
    hrRenderPending(`проверяю точный договор ${requested}, затем связи по MAC, адресу, Serial и истории…`);

    try {
      const resolverUrl = `${HR_BASE}/customer_list/ajax_search?token=${Date.now()}&search=${encodeURIComponent(requested)}`;
      const resolverRaw = await hrRequest(resolverUrl, runId);
      const resolverCandidates = hrExactResolverCandidates(resolverRaw, requested);
      const exact = hrChooseExactCandidate(resolverCandidates, requested);
      if (!exact) {
        const partial = resolverCandidates.slice(0, 4).map(item => item.logins[0] || item.agreements[0] || `customerId ${item.customerId}`);
        throw new Error(`точное совпадение ${requested} не найдено${partial.length ? `; похожие: ${partial.join(', ')}` : ''}. Анализ чужой карточки не выполнялся.`);
      }

      const currentMainUrl = `${HR_BASE}/customer/tab?tab=main&id=${encodeURIComponent(exact.customerId)}`;
      const currentSupportUrl = `${HR_BASE}/customer/tab?tab=support&id=${encodeURIComponent(exact.customerId)}`;
      const [currentMainRaw, currentSupportRaw] = await Promise.all([
        hrRequest(currentMainUrl, runId),
        hrRequest(currentSupportUrl, runId).catch(() => ''),
      ]);
      if (runId !== runtime.runId) return;

      const current = hrSnapshotFromPages({
        customerId: exact.customerId,
        agreement: hrNormalizeContract(requested),
        login: hrNormalizeLogin(requested),
      }, currentMainRaw, currentSupportRaw);
      current.macs = hrUnique([
        ...current.macs,
        panelSnapshot.sessionMac,
        panelSnapshot.deviceMac,
        ...hrExtractMacs(panelSnapshot.onuRaw),
      ].filter(Boolean));
      current.serials = hrUnique([...current.serials, ...hrExtractSerials(panelSnapshot.onuRaw)]);
      current.oltRefs = hrUnique([...current.oltRefs, panelSnapshot.connectionPoint].filter(Boolean));

      const seedMacs = hrUnique([
        panelSnapshot.sessionMac,
        panelSnapshot.deviceMac,
        ...current.macs,
      ].map(hrNormalizeMac).filter(Boolean)).slice(0, 3);

      const rawMatches = [];
      for (const mac of seedMacs) {
        if (runtime.requests >= HR_REQUEST_LIMIT - 2) break;
        const url = `${HR_BASE}/customer_list/search_page?search=${encodeURIComponent(mac)}&uplinkport=1`;
        try {
          const raw = await hrRequest(url, runId);
          rawMatches.push(...hrParseSubscriberMatches(raw, mac));
        } catch (_) {}
      }

      const deduped = new Map();
      for (const match of rawMatches) {
        if (!match.customerId || match.customerId === exact.customerId) continue;
        const existing = deduped.get(match.customerId);
        if (!existing || (!existing.agreement && match.agreement)) deduped.set(match.customerId, match);
      }
      const relatedMetas = [...deduped.values()]
        .sort((a, b) => Number(Boolean(b.agreement)) - Number(Boolean(a.agreement)))
        .slice(0, HR_RELATED_LIMIT);

      const related = [];
      for (const meta of relatedMetas) {
        if (runtime.requests >= HR_REQUEST_LIMIT - 1) break;
        const mainUrl = `${HR_BASE}/customer/tab?tab=main&id=${encodeURIComponent(meta.customerId)}`;
        const supportUrl = `${HR_BASE}/customer/tab?tab=support&id=${encodeURIComponent(meta.customerId)}`;
        try {
          const mainRaw = await hrRequest(mainUrl, runId);
          const supportRaw = runtime.requests < HR_REQUEST_LIMIT
            ? await hrRequest(supportUrl, runId).catch(() => '')
            : '';
          related.push(hrSnapshotFromPages(meta, mainRaw, supportRaw));
        } catch (_) {}
      }

      if (runId !== runtime.runId) return;
      const report = hrAnalyzeModel({
        requested,
        current,
        related,
        panelSnapshot,
        reason,
      });
      const selfTests = hrRunSelfTests();
      hrRenderResult(report, runtime.requests, selfTests);
      runtime.lastCompletedStatus = `${hrNormalizeContract(requested)}|${panelSnapshot.status}`;
      runtime.armedContract = '';
      runtime.armedAt = 0;
    } catch (error) {
      if (runId === runtime.runId) hrRenderError(error && error.message || String(error));
    } finally {
      if (runId === runtime.runId) {
        runtime.running = false;
        runtime.abortables.clear();
        hrUpdateButtonState();
      }
    }
  }

  function hrInstallStyle() {
    if (document.getElementById(HR_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HR_STYLE_ID;
    style.textContent = `
      #dp-history-actions { display:flex; justify-content:flex-end; gap:8px; padding:0 14px 10px; background:var(--dp-surface,#17212b); border-bottom:1px solid var(--dp-border,#354657); }
      #dp-history-run { background:#345a7e !important; color:#fff !important; border-color:#4b769e !important; }
      #dp-panel.collapsed #dp-history-actions { display:none !important; }
      #dp-history-run:disabled { opacity:.55 !important; cursor:not-allowed !important; }
      .dp-history-reasoning { margin:8px 0; border:1px solid #566779; border-left:4px solid #6f8eaa; border-radius:8px; background:#17212b; color:#e9eef5; overflow:hidden; }
      .dp-history-reasoning.ok { border-left-color:#48c78e; }
      .dp-history-reasoning.warning { border-left-color:#f3c969; }
      .dp-history-reasoning.loading { border-left-color:#63a4dc; }
      .dp-history-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; background:#202e3b; }
      .dp-history-head > span { font-weight:700; color:#eef6ff; }
      .dp-history-head small { margin-left:5px; color:#8fa6ba; font-size:9px; font-weight:400; }
      .dp-history-head b { padding:3px 7px; border-radius:999px; background:#31465a; color:#dcecff; font-size:9px; white-space:nowrap; }
      .dp-history-current { display:flex; flex-wrap:wrap; gap:5px; padding:8px 10px 0; }
      .dp-history-current span { padding:3px 6px; border:1px solid #405366; border-radius:5px; background:#202c38; font-size:10px; }
      .dp-history-summary { padding:9px 10px; color:#f3f7fb; line-height:1.45; }
      .dp-history-reasoning section,.dp-history-reasoning details { margin:0 9px 8px; padding:8px; border:1px solid #354657; border-radius:6px; background:#1c2732; }
      .dp-history-reasoning h4 { margin:0 0 6px; color:#9fc5e8; font-size:11px; }
      .dp-history-reasoning ul,.dp-history-reasoning ol { margin:5px 0 0 18px; padding:0; }
      .dp-history-reasoning li { margin:3px 0; line-height:1.35; }
      .dp-history-relation { margin:6px 0; padding:7px; border-left:3px solid #6f8eaa; border-radius:4px; background:#222f3b; }
      .dp-history-relation.equipment-lineage { border-left-color:#48c78e; }
      .dp-history-relation > div { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
      .dp-history-relation > div span { color:#b8c9d8; font-size:10px; }
      .dp-history-relation > div i { margin-left:auto; color:#8fb8da; font-size:9px; font-style:normal; }
      .dp-history-reasoning .conflicts { border-color:#826b38; background:#2b291f; }
      .dp-history-empty,.dp-history-note { color:#9fb0c0; font-size:10px; }
      .dp-history-note { padding:0 10px 9px; }
      .dp-history-reasoning summary { cursor:pointer; color:#b9d8f1; font-weight:600; }
      .dp-history-tests { margin-top:8px; color:#9fc5e8; font-weight:700; }
      .dp-history-test-list .ok { color:#93ddb8; }
      .dp-history-test-list .bad { color:#ff9b9b; }
      @media (prefers-color-scheme: light) {
        .dp-history-reasoning { background:#fff; color:#243444; border-color:#c9d4de; }
        .dp-history-head { background:#edf4fa; }
        .dp-history-head > span { color:#17365d; }
        .dp-history-current span,.dp-history-reasoning section,.dp-history-reasoning details,.dp-history-relation { background:#f7f9fb; border-color:#d7e0e8; color:#243444; }
        .dp-history-summary { color:#243444; }
        .dp-history-reasoning .conflicts { background:#fff9e8; border-color:#e4c66d; }
      }
    `;
    document.head.appendChild(style);
  }

  function hrInstall() {
    const panel = document.querySelector('#dp-panel');
    const form = document.querySelector('#dp-form');
    const status = document.querySelector('#dp-status');
    if (!panel || !form || !status) return false;
    if (runtime.installed) return true;
    runtime.installed = true;
    hrInstallStyle();

    let actions = document.querySelector('#dp-history-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'dp-history-actions';
      form.insertAdjacentElement('afterend', actions);
    }

    let button = document.querySelector('#dp-history-run');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'dp-history-run';
      button.textContent = 'Разобрать историю';
      actions.appendChild(button);
    } else if (button.parentElement !== actions) {
      actions.appendChild(button);
    }
    button.title = 'Встроенный разбор связанных договоров, ONU, оборудования и хронологии';
    hrEnsureContainer();
    button.addEventListener('click', () => hrRun('manual'));
    hrUpdateButtonState();

    runtime.observer = new MutationObserver(() => {
      const text = hrText(status.textContent);
      const requested = hrText(document.querySelector('#dp-input')?.value || '');
      const contract = hrNormalizeContract(requested);
      const started = /ищу договор|собираю данные|запускаю опрос|опрос ONU/i.test(text)
        && !/диагностика завершена/i.test(text);

      if (started) {
        hrArmAutomaticRun(contract);
        if (runtime.running) hrAbort();
        const container = hrEnsureContainer();
        if (container && hrPanelRole() === 'owner') {
          container.innerHTML = '';
          hrNotifyWorkbenchChanged();
        }
        hrUpdateButtonState();
        return;
      }

      hrUpdateButtonState();
      if (!/диагностика завершена/i.test(text) || !contract) return;
      const completionKey = `${contract}|${text}`;
      if (completionKey === runtime.lastCompletedStatus || completionKey === runtime.lastScheduledKey) return;
      if (!hrAutomaticRunArmed(contract)) return;

      runtime.lastScheduledKey = completionKey;
      window.setTimeout(() => {
        const currentText = hrText(status.textContent);
        const currentContract = hrNormalizeContract(document.querySelector('#dp-input')?.value || '');
        if (/диагностика завершена/i.test(currentText)
          && currentContract === contract
          && hrAutomaticRunArmed(contract)
          && !runtime.running) {
          hrRun('automatic');
        }
      }, HR_AUTO_DELAY_MS);
    });
    runtime.observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true });

    const panelObserver = new MutationObserver(hrUpdateButtonState);
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['data-tab-role'] });
    return true;
  }

  function hrScheduleInstall() {
    if (hrInstall()) return;
    let attempts = 0;
    runtime.installTimer = window.setInterval(() => {
      attempts += 1;
      if (hrInstall() || attempts >= 120) {
        window.clearInterval(runtime.installTimer);
        runtime.installTimer = 0;
      }
    }, 500);
  }

  // Тестовый hook не участвует в работе интерфейса и создаётся только локальным harness.
  if (typeof globalThis !== 'undefined' && globalThis.__SIMNET_HISTORY_TEST_HOOK__) {
    Object.assign(globalThis.__SIMNET_HISTORY_TEST_HOOK__, {
      analyzeModel: hrAnalyzeModel,
      runSelfTests: hrRunSelfTests,
      normalizeContract: hrNormalizeContract,
      normalizeMac: hrNormalizeMac,
    });
  }

  window.addEventListener('pagehide', hrAbort);
  hrScheduleInstall();
})();

/* ==========================================================================
   ADDITIVE MODULE: VERIFIED NEIGHBOR OLT CANDIDATES

   Независимый модуль Workbench. После основной диагностики он сопоставляет
   текущий адрес с соседними абонентами, читает их карточки UserSide и учитывает
   только подтверждённые связи «Найдено на OLT». Для частного сектора модуль
   проверяет до 20 абонентов той же улицы с пагинацией и охватом обеих сторон.
   Итог — до трёх предполагаемых OLT с количеством доказательств и уверенностью.

   Модуль не изменяет основную IIFE, не использует её runtime и не выполняет
   POST/сохранение. Все запросы — отдельные ограниченные GET с параллельностью 2.
   ========================================================================== */
(function simnetVerifiedNeighborOltModule() {
  'use strict';

  if (window.top !== window.self) return;

  const NB_VERSION = 'neighbor-olt-1.1-private-sector-20';
  const NB_BASE = 'https://userside.simnet.kiev.ua';
  const NB_STYLE_ID = 'dp-neighbor-olt-style';
  const NB_REQUEST_LIMIT = 42;
  const NB_VERIFY_LIMIT = 20;
  const NB_CONCURRENCY = 2;
  const NB_TIMEOUT_MS = 16000;
  const NB_AUTO_DELAY_MS = 1600;
  const NB_ARM_TTL_MS = 3 * 60 * 1000;
  const NB_STREET_PAGE_LIMIT = 8;
  const NB_STREET_DISCOVERY_LIMIT = 160;
  const NB_PRIVATE_SECTOR_MIN_SAMPLE = 10;
  const NB_PRIVATE_SECTOR_EXACT_HOUSE_MAX = 3;
  const NB_PRIVATE_IP_RE = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3})\b/g;
  const NB_INTERFACE_RE = /\b(?:xgs?pon|xgpon|xpon|gpon|epon|pon)\d*(?:\/\d+){1,3}(?::\d+)?\b/ig;

  const runtime = {
    installed: false,
    running: false,
    runId: 0,
    requests: 0,
    abortables: new Set(),
    observer: null,
    installTimer: 0,
    armedContract: '',
    armedAt: 0,
    lastCompletedKey: '',
    lastScheduledKey: '',
  };

  function nbText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function nbEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nbUnique(values, keyFn = value => String(value || '').toLowerCase()) {
    const result = [];
    const seen = new Set();
    for (const value of values || []) {
      const key = keyFn(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function nbNormalizeContract(raw) {
    const match = String(raw || '').match(/(?:abon)?(\d{4,14})/i);
    return match ? match[1] : '';
  }

  function nbNormalizeLogin(raw) {
    const contract = nbNormalizeContract(raw);
    return contract ? `abon${contract}` : nbText(raw).toLowerCase();
  }

  function nbParseHtml(raw) {
    return new DOMParser().parseFromString(String(raw || ''), 'text/html');
  }

  function nbNodeText(node) {
    return nbText(node && (node.innerText || node.textContent) || '');
  }

  function nbExtractLabel(doc, labels) {
    const wanted = (Array.isArray(labels) ? labels : [labels])
      .map(label => String(label || '').replace(/:\s*$/, '').toLowerCase());
    for (const node of doc.querySelectorAll('.left_data,dt,th,label,b,strong')) {
      const label = nbText(node.textContent).replace(/:\s*$/, '').toLowerCase();
      if (!wanted.includes(label)) continue;
      const sibling = node.nextElementSibling;
      if (sibling && nbNodeText(sibling)) return nbNodeText(sibling);
      const parent = node.parentElement;
      if (parent) {
        const full = nbNodeText(parent);
        const own = nbNodeText(node);
        const rest = full.slice(own.length).trim();
        if (rest) return rest;
      }
    }
    return '';
  }

  function nbNormalizeStreet(raw) {
    return nbText(raw)
      .toLowerCase()
      .replace(/[«»"'`]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/(?:украина|україна|киев|київ|м\.?\s*київ|г\.?\s*киев)/g, ' ')
      .replace(/(?:улица|вулиця|ул\.?|вул\.?|проспект|просп\.?|пр-т|переулок|провулок|пер\.?|пров\.?|бульвар|бул\.?|бульв\.?|шоссе|шосе|набережная|набережна|наб\.?)/g, ' ')
      .replace(/[^a-zа-яёіїєґ0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nbNormalizeHouse(raw) {
    return nbText(raw)
      .toUpperCase()
      .replace(/^(?:БУД|ДОМ|Д|HOUSE|№)\.?\s*/g, '')
      .replace(/\s+/g, '')
      .replace(/\\/g, '/')
      .replace(/[^0-9A-ZА-ЯЁІЇЄҐ\/-]/g, '');
  }

  function nbHouseNumber(raw) {
    const match = String(raw || '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function nbNormalizeLocality(raw) {
    return nbText(raw)
      .toLowerCase()
      .replace(/[«»"'`]/g, '')
      .replace(/\b(?:украина|україна)\b/g, ' ')
      .replace(/\b(?:киевская|київська)\s+(?:обл(?:асть)?|обл\.)\b/g, ' ')
      .replace(/\b(?:обл(?:асть)?|обл\.|район|р-н)\b/g, ' ')
      .replace(/^(?:м\.?|г\.?|с\.?|село|смт\.?|пгт\.?|пос(?:елок|ёлок)?\.?)\s*/i, '')
      .replace(/[^a-zа-яёіїєґ0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nbAddressIdentity(raw) {
    const original = nbText(raw);
    if (!original) return {
      original: '', locality: '', localityLabel: '', street: '', streetLabel: '',
      house: '', key: '', houseNumber: null, houseSuffix: '', hasApartment: false, label: '',
    };

    const hasApartment = /(?:^|,|\s)(?:кв\.?|квартира|оф\.?|офис|офіс|комн\.?|кімн\.?)\s*\d/i.test(original);
    const withoutApartment = original
      .replace(/(?:,|\s)\s*(?:кв\.?|квартира|оф\.?|офис|офіс|комн\.?|кімн\.?)\s*\d.*$/i, '')
      .trim();
    const parts = withoutApartment.split(/\s*,\s*/).map(nbText).filter(Boolean);
    const streetMarker = /(?:^|\s)(?:вул\.?|ул\.?|улица|вулиця|просп\.?|проспект|пр-т|пров\.?|пер\.?|переулок|провулок|бульв\.?|бул\.?|бульвар|шосе|шоссе|наб\.?)(?:\s|$)/i;
    let streetIndex = parts.findIndex(part => streetMarker.test(part));
    if (streetIndex < 0) {
      streetIndex = parts.findIndex((part, index) => index > 0 && /[a-zа-яёіїєґ]/i.test(part) && !/^\d/.test(part));
    }
    if (streetIndex < 0) streetIndex = 0;

    let streetRaw = parts[streetIndex] || '';
    let houseRaw = '';
    for (let index = streetIndex + 1; index < parts.length; index += 1) {
      if (/\d/.test(parts[index]) && !/(?:кв\.?|квартира|офис|офіс)/i.test(parts[index])) {
        houseRaw = parts[index];
        break;
      }
    }

    if (!houseRaw) {
      const inline = streetRaw.match(/^(.*?)(?:\s+|,)(?:буд\.?|дом|д\.?)?\s*(\d+[0-9a-zа-яёіїєґ\/-]*)\s*$/i);
      if (inline) {
        streetRaw = inline[1];
        houseRaw = inline[2];
      }
    }
    if (!houseRaw) {
      const tail = withoutApartment.match(/(?:^|,|\s)(?:буд\.?|дом|д\.?|№)?\s*(\d+[0-9a-zа-яёіїєґ\/-]*)\s*$/i);
      if (tail) houseRaw = tail[1];
    }

    const localityRaw = parts.slice(0, Math.max(0, streetIndex)).reverse().find(part => {
      if (!/[a-zа-яёіїєґ]/i.test(part)) return false;
      if (/(?:обл(?:асть)?|район|р-н|украина|україна)/i.test(part)) return false;
      return true;
    }) || '';
    const locality = nbNormalizeLocality(localityRaw);
    const street = nbNormalizeStreet(streetRaw);
    const house = nbNormalizeHouse(houseRaw);
    const houseNumber = nbHouseNumber(house);
    const suffixMatch = house.match(/^\d+(.*)$/);
    const houseSuffix = suffixMatch ? suffixMatch[1] : '';
    return {
      original,
      locality,
      localityLabel: localityRaw,
      street,
      streetLabel: streetRaw,
      house,
      key: street && house ? `${locality || '*'}|${street}|${house}` : '',
      houseNumber,
      houseSuffix,
      hasApartment,
      label: [localityRaw, streetRaw, houseRaw].filter(Boolean).join(', '),
    };
  }

  function nbSameLocality(left, right) {
    if (!left || !right) return false;
    if (!left.locality || !right.locality) return true;
    return left.locality === right.locality;
  }

  function nbSameHouse(left, right) {
    return Boolean(left && right
      && left.street && left.street === right.street
      && left.house && left.house === right.house
      && nbSameLocality(left, right));
  }

  function nbNearbyStreet(left, right) {
    if (!left || !right || !left.street || left.street !== right.street) return false;
    if (!nbSameLocality(left, right)) return false;
    return Number.isFinite(left.houseNumber) && Number.isFinite(right.houseNumber);
  }

  function nbPanelRole() {
    return String(document.querySelector('#dp-panel')?.dataset.tabRole || 'idle');
  }

  function nbIsMirror() {
    return nbPanelRole() === 'mirror';
  }

  function nbPanelSnapshot() {
    const field = key => nbText(document.querySelector(`#dp-field-${key} .dp-field-value`)?.textContent || '');
    const onuText = nbText(document.querySelector('#dp-onu-container')?.textContent || '');
    const connectionPoint = field('connectionPoint');
    return {
      requested: nbText(document.querySelector('#dp-input')?.value || ''),
      contract: nbNormalizeContract(field('contract') || document.querySelector('#dp-input')?.value || ''),
      address: field('address'),
      status: nbText(document.querySelector('#dp-status')?.textContent || ''),
      connectionPoint,
      onuText,
      targetTechnology: /\bepon\b/i.test(`${connectionPoint} ${onuText}`)
        ? 'epon'
        : /\b(?:gpon|xgpon|xgspon|xpon)\b/i.test(`${connectionPoint} ${onuText}`)
          ? 'gpon'
          : '',
      confirmedOltIps: nbUnique((`${connectionPoint} ${onuText}`.match(NB_PRIVATE_IP_RE) || [])),
    };
  }

  function nbNotifyWorkbenchChanged() {
    const results = document.querySelector('#dp-results');
    if (!results) return;
    try { results.dispatchEvent(new Event('toggle', { bubbles: true })); } catch (_) {}
  }

  function nbAbort() {
    runtime.runId += 1;
    runtime.running = false;
    for (const handle of runtime.abortables) {
      try { handle.abort(); } catch (_) {}
    }
    runtime.abortables.clear();
  }

  function nbRequest(url, runId) {
    if (runtime.requests >= NB_REQUEST_LIMIT) {
      return Promise.reject(new Error(`лимит модуля соседей: ${NB_REQUEST_LIMIT} GET`));
    }
    runtime.requests += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      let handle = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (handle) runtime.abortables.delete(handle);
        callback(value);
      };
      handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        timeout: NB_TIMEOUT_MS,
        onload: response => {
          if (runId !== runtime.runId) return finish(reject, new Error('запуск заменён новой диагностикой'));
          if (response.status >= 200 && response.status < 400) return finish(resolve, response.responseText || '');
          return finish(reject, new Error(`HTTP ${response.status}`));
        },
        onerror: () => finish(reject, new Error('network error')),
        ontimeout: () => finish(reject, new Error('timeout')),
        onabort: () => finish(reject, new Error('остановлено')),
      });
      runtime.abortables.add(handle);
    });
  }

  function nbExactResolverCandidates(raw, requested) {
    let html = '';
    try {
      const parsed = JSON.parse(String(raw || ''));
      html = String(parsed && parsed.data || '');
    } catch (_) {
      html = String(raw || '');
    }
    const doc = nbParseHtml(html);
    const requestedLogin = nbNormalizeLogin(requested);
    const requestedContract = nbNormalizeContract(requested);
    const result = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll('a[href*="/customer/"]')) {
      const match = String(anchor.getAttribute('href') || '').match(/\/customer\/(\d+)/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      const row = anchor.closest('tr,li,.item,div') || anchor.parentElement;
      const text = nbNodeText(row);
      const logins = (text.match(/\babon\d{4,14}\b/ig) || []).map(value => value.toLowerCase());
      const agreements = text.match(/\b\d{4,14}\b/g) || [];
      result.push({
        customerId: match[1],
        exactLogin: logins.includes(requestedLogin),
        exactAgreement: agreements.includes(requestedContract),
      });
    }
    return result.sort((a, b) => Number(b.exactLogin) - Number(a.exactLogin)
      || Number(b.exactAgreement) - Number(a.exactAgreement));
  }

  function nbChooseExactCandidate(candidates, requested) {
    const explicitLogin = /^abon\d{4,14}$/i.test(nbText(requested));
    if (explicitLogin) return candidates.find(candidate => candidate.exactLogin) || null;
    const exact = candidates.filter(candidate => candidate.exactAgreement || candidate.exactLogin);
    return exact.length === 1 ? exact[0] : null;
  }

  function nbCellText(row, suffix) {
    const cell = row.querySelector(`[id$="${suffix}"]`);
    return nbNodeText(cell);
  }

  function nbParseCustomerRows(raw, source = '') {
    const doc = nbParseHtml(raw);
    const rows = [];
    const seen = new Set();
    const rowNodes = [...doc.querySelectorAll('tr.table_item,tr')];
    for (const row of rowNodes) {
      const link = row.querySelector('a[href^="/customer/"],a[href*="/customer/"]');
      const match = link && String(link.getAttribute('href') || '').match(/\/customer\/(\d+)/);
      if (!match || seen.has(match[1])) continue;
      const address = nbCellText(row, '_adr_full_Id');
      if (!address) continue;
      seen.add(match[1]);
      const identity = nbCellText(row, '_ip_username_Id');
      const agreementText = nbCellText(row, '_agreement_full_Id');
      const rowText = nbNodeText(row);
      rows.push({
        customerId: match[1],
        contract: nbNormalizeContract(agreementText || identity || rowText),
        login: (identity.match(/\babon\d{4,14}\b/i) || [])[0] || '',
        name: nbCellText(row, '_name_full_Id'),
        address,
        addressIdentity: nbAddressIdentity(address),
        status: nbCellText(row, '_state_name_Id'),
        activity: nbCellText(row, '_date_activity_Id'),
        tariff: nbCellText(row, '_tariff_name_Id'),
        source,
        rowText: rowText.slice(0, 1600),
      });
    }

    // В attach/ajax_frame могут отсутствовать стандартные ID колонок.
    for (const link of doc.querySelectorAll('a[href^="/customer/"],a[href*="/customer/"]')) {
      const match = String(link.getAttribute('href') || '').match(/\/customer\/(\d+)/);
      if (!match || seen.has(match[1])) continue;
      const container = link.closest('tr,.item,li,article') || link.parentElement;
      const text = nbNodeText(container);
      const addressMatch = text.match(/(?:Адрес|Адреса)\s*:?\s*(.+?)(?=(?:Договор|Договір|Статус|Тариф|Абонент|$))/i);
      const address = nbText(addressMatch && addressMatch[1] || '');
      if (!address || !/\d/.test(address)) continue;
      seen.add(match[1]);
      rows.push({
        customerId: match[1],
        contract: nbNormalizeContract(text),
        login: (text.match(/\babon\d{4,14}\b/i) || [])[0] || '',
        name: '',
        address,
        addressIdentity: nbAddressIdentity(address),
        status: '',
        activity: '',
        tariff: '',
        source,
        rowText: text.slice(0, 1600),
      });
    }
    return rows;
  }

  function nbSearchQuery(identity, exact = true) {
    if (!identity) return '';
    const locality = identity.localityLabel || identity.locality || '';
    const street = identity.streetLabel || identity.street || '';
    const house = exact ? identity.house : '';
    return [locality, street, house].map(nbText).filter(Boolean).join(' ');
  }

  function nbCandidateScope(candidate, currentAddress) {
    if (nbSameHouse(candidate.addressIdentity, currentAddress)) return 'same-house';
    if (nbNearbyStreet(candidate.addressIdentity, currentAddress)) return 'nearby-street';
    return '';
  }

  function nbHouseDistance(identity, currentAddress) {
    if (!identity || !currentAddress
      || !Number.isFinite(identity.houseNumber)
      || !Number.isFinite(currentAddress.houseNumber)) return Number.POSITIVE_INFINITY;
    return Math.abs(identity.houseNumber - currentAddress.houseNumber);
  }

  function nbSameStreetSide(identity, currentAddress) {
    if (!identity || !currentAddress
      || !Number.isFinite(identity.houseNumber)
      || !Number.isFinite(currentAddress.houseNumber)) return null;
    return identity.houseNumber % 2 === currentAddress.houseNumber % 2;
  }

  function nbSortStreetCandidates(rows, currentAddress) {
    return [...rows].sort((a, b) => {
      const aDistance = nbHouseDistance(a.addressIdentity, currentAddress);
      const bDistance = nbHouseDistance(b.addressIdentity, currentAddress);
      const aActive = /актив|active|работ/i.test(a.status) ? 1 : 0;
      const bActive = /актив|active|работ/i.test(b.status) ? 1 : 0;
      const aSuffix = a.addressIdentity.houseSuffix ? 0 : 1;
      const bSuffix = b.addressIdentity.houseSuffix ? 0 : 1;
      return aDistance - bDistance
        || aSuffix - bSuffix
        || bActive - aActive
        || Number(a.customerId) - Number(b.customerId);
    });
  }

  function nbInterleaveStreetSides(rows, currentAddress) {
    const sameSide = [];
    const otherSide = [];
    const unknownSide = [];
    for (const row of nbSortStreetCandidates(rows, currentAddress)) {
      const side = nbSameStreetSide(row.addressIdentity, currentAddress);
      if (side === true) sameSide.push(row);
      else if (side === false) otherSide.push(row);
      else unknownSide.push(row);
    }
    const result = [];
    let index = 0;
    while (sameSide.length || otherSide.length || unknownSide.length) {
      const primary = index % 2 === 0 ? sameSide : otherSide;
      const secondary = index % 2 === 0 ? otherSide : sameSide;
      if (primary.length) result.push(primary.shift());
      else if (secondary.length) result.push(secondary.shift());
      else if (unknownSide.length) result.push(unknownSide.shift());
      index += 1;
    }
    return result;
  }

  function nbSelectNeighbors(rows, currentCustomerId, currentAddress, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || NB_VERIFY_LIMIT), NB_VERIFY_LIMIT));
    const unique = nbUnique(
      rows.filter(row => row.customerId && row.customerId !== String(currentCustomerId || '')),
      row => row.customerId,
    ).map(row => {
      const scope = nbCandidateScope(row, currentAddress);
      return {
        ...row,
        scope,
        distance: nbHouseDistance(row.addressIdentity, currentAddress),
        sameStreetSide: nbSameStreetSide(row.addressIdentity, currentAddress),
      };
    }).filter(row => row.scope);

    const exact = unique.filter(row => row.scope === 'same-house').sort((a, b) => {
      const aActive = /актив|active|работ/i.test(a.status) ? 1 : 0;
      const bActive = /актив|active|работ/i.test(b.status) ? 1 : 0;
      return bActive - aActive || Number(a.customerId) - Number(b.customerId);
    });
    const street = nbInterleaveStreetSides(unique.filter(row => row.scope === 'nearby-street'), currentAddress);
    return [...exact, ...street].slice(0, limit);
  }

  function nbValidIpv4(raw) {
    const parts = String(raw || '').split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  }

  function nbExtractDeviceId(rawHref) {
    const match = String(rawHref || '').match(/\/device\/(\d+)/);
    return match ? match[1] : '';
  }

  function nbExtractVerifiedOlt(mainRaw) {
    const doc = nbParseHtml(mainRaw);
    const candidates = [];
    for (const anchor of doc.querySelectorAll('a[href*="/device/"]')) {
      const deviceId = nbExtractDeviceId(anchor.getAttribute('href'));
      if (!deviceId) continue;
      let container = anchor;
      let bestContainer = anchor.parentElement;
      for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
        const text = nbNodeText(container);
        if (!text || text.length > 4500) break;
        if (/Найдено\s+на\s+OLT|Знайдено\s+на\s+OLT|\bOLT\b|Interface\s*:/i.test(text)) bestContainer = container;
        NB_INTERFACE_RE.lastIndex = 0;
        NB_PRIVATE_IP_RE.lastIndex = 0;
        if (/Найдено\s+на\s+OLT|Знайдено\s+на\s+OLT/i.test(text)
          && (NB_INTERFACE_RE.test(text) || NB_PRIVATE_IP_RE.test(text))) {
          bestContainer = container;
          break;
        }
        NB_INTERFACE_RE.lastIndex = 0;
        NB_PRIVATE_IP_RE.lastIndex = 0;
      }
      const context = nbNodeText(bestContainer || anchor.parentElement);
      NB_PRIVATE_IP_RE.lastIndex = 0;
      NB_INTERFACE_RE.lastIndex = 0;
      const ips = (context.match(NB_PRIVATE_IP_RE) || []).filter(nbValidIpv4);
      const interfaces = context.match(NB_INTERFACE_RE) || [];
      const name = nbNodeText(anchor);
      const explicitMarker = /Найдено\s+на\s+OLT|Знайдено\s+на\s+OLT/i.test(context);
      const oltIdentity = /\bOLT\b|Huawei|BDCOM|GCOM|MA\d{3,5}|GP\d{3,5}|P3600|ZTE|C-?DATA|V-?SOL|FiberHome/i.test(`${name} ${context}`);
      const looksOnlyOnu = /\b(?:ONU|ONT)\b|FoxGate|xPON-?ONU/i.test(name) && !/\bOLT\b|Huawei|BDCOM|GCOM|MA\d{3,5}|ZTE/i.test(name);
      let score = 0;
      if (explicitMarker) score += 260;
      if (oltIdentity) score += 120;
      if (ips.length) score += 90;
      if (interfaces.length) score += 90;
      if (looksOnlyOnu) score -= 180;
      candidates.push({
        deviceId,
        name,
        ip: ips[0] || '',
        interface: interfaces[0] || '',
        explicitMarker,
        score,
        context: context.slice(0, 1800),
      });
    }
    candidates.sort((a, b) => b.score - a.score
      || Number(Boolean(b.ip)) - Number(Boolean(a.ip))
      || Number(Boolean(b.interface)) - Number(Boolean(a.interface)));
    const best = candidates[0] || null;
    if (!best) return null;
    const verified = Boolean(
      best.explicitMarker
      && best.deviceId
      && (best.ip || best.interface)
      && best.score >= 350
    );
    return verified ? { ...best, verified: true } : null;
  }

  async function nbMapLimit(items, limit, worker) {
    const output = new Array(items.length);
    let nextIndex = 0;
    async function runWorker() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
    return output;
  }

  function nbOltKey(olt) {
    if (olt.ip) return `ip:${olt.ip}`;
    if (olt.deviceId) return `device:${olt.deviceId}`;
    return `name:${nbNormalizeStreet(olt.name)}`;
  }

  function nbTechnologyFromInterface(raw) {
    if (/\bepon/i.test(String(raw || ''))) return 'epon';
    if (/\b(?:gpon|xgpon|xgspon|xpon)/i.test(String(raw || ''))) return 'gpon';
    return '';
  }

  function nbConfidence(candidate, totalVerified, scanned = 0) {
    const share = totalVerified ? candidate.count / totalVerified : 0;
    const enoughSample = scanned >= NB_PRIVATE_SECTOR_MIN_SAMPLE;
    if (enoughSample && ((candidate.count >= 7 && share >= 0.45) || candidate.count >= 10)) return 'high';
    if ((candidate.count >= 4 && share >= 0.30) || (candidate.count >= 3 && share >= 0.50)) return 'medium';
    return 'low';
  }

  function nbAnalyzeVerifiedNeighbors(input) {
    const samples = (input.samples || []).filter(sample => sample && sample.olt && sample.olt.verified);
    const groups = new Map();
    for (const sample of samples) {
      const key = nbOltKey(sample.olt);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: sample.olt.name || `OLT ${sample.olt.deviceId}`,
          ip: sample.olt.ip || '',
          deviceId: sample.olt.deviceId || '',
          count: 0,
          exactHouseCount: 0,
          nearbyStreetCount: 0,
          activeCount: 0,
          technologyMatches: 0,
          sameSideCount: 0,
          distanceSum: 0,
          interfaces: [],
          contracts: [],
          addresses: [],
          weightedScore: 0,
        });
      }
      const group = groups.get(key);
      const exactHouse = sample.neighbor.scope === 'same-house';
      const active = /актив|active|работ/i.test(sample.neighbor.status || '');
      const technology = nbTechnologyFromInterface(sample.olt.interface);
      const techMatch = Boolean(input.targetTechnology && technology === input.targetTechnology);
      const distance = Number.isFinite(sample.neighbor.distance) ? sample.neighbor.distance : 999;
      const proximityWeight = exactHouse ? 14
        : distance <= 2 ? 9
          : distance <= 5 ? 8
            : distance <= 10 ? 7
              : distance <= 20 ? 5
                : distance <= 40 ? 3
                  : 2;
      group.count += 1;
      group.exactHouseCount += exactHouse ? 1 : 0;
      group.nearbyStreetCount += exactHouse ? 0 : 1;
      group.activeCount += active ? 1 : 0;
      group.technologyMatches += techMatch ? 1 : 0;
      group.sameSideCount += sample.neighbor.sameStreetSide === true ? 1 : 0;
      group.distanceSum += exactHouse ? 0 : distance;
      group.interfaces.push(sample.olt.interface || '');
      group.contracts.push(sample.neighbor.login || (sample.neighbor.contract ? `abon${sample.neighbor.contract}` : sample.neighbor.customerId));
      group.addresses.push(sample.neighbor.address || '');
      group.weightedScore += proximityWeight;
      if (active) group.weightedScore += 1;
      if (techMatch) group.weightedScore += 2;
      if (sample.olt.ip) group.weightedScore += 1;
      if (sample.neighbor.sameStreetSide === true) group.weightedScore += 1;
    }

    const totalVerified = samples.length;
    const scanned = Number(input.scanned || 0);
    const candidates = [...groups.values()].map(candidate => ({
      ...candidate,
      interfaces: nbUnique(candidate.interfaces.filter(Boolean)),
      contracts: nbUnique(candidate.contracts.filter(Boolean)),
      addresses: nbUnique(candidate.addresses.filter(Boolean)),
      share: totalVerified ? candidate.count / totalVerified : 0,
      averageDistance: candidate.nearbyStreetCount ? candidate.distanceSum / candidate.nearbyStreetCount : 0,
      confidence: nbConfidence(candidate, totalVerified, scanned),
      matchesCurrentOlt: Boolean(candidate.ip && (input.confirmedOltIps || []).includes(candidate.ip)),
    })).sort((a, b) => b.weightedScore - a.weightedScore
      || b.count - a.count
      || a.averageDistance - b.averageDistance
      || b.exactHouseCount - a.exactHouseCount
      || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 3);

    const discovery = input.discovery || {};
    let conclusion = '';
    if (!totalVerified) {
      conclusion = 'У проверенных абонентов улицы не удалось извлечь явную связь «Найдено на OLT». Предположение не сформировано.';
    } else if (scanned < NB_PRIVATE_SECTOR_MIN_SAMPLE && discovery.privateSectorMode) {
      conclusion = `Выборка частного сектора неполная: проверено ${scanned}, желательно не менее ${NB_PRIVATE_SECTOR_MIN_SAMPLE}. Текущий лидер — ${[candidates[0]?.name, candidates[0]?.ip].filter(Boolean).join(' · ') || 'не определён'}.`;
    } else if (candidates.length === 1) {
      conclusion = `Единственный подтверждённый кандидат — ${[candidates[0].name, candidates[0].ip].filter(Boolean).join(' · ')}.`;
    } else {
      conclusion = `Основной кандидат — ${[candidates[0].name, candidates[0].ip].filter(Boolean).join(' · ')}; рейтинг построен по ${scanned} проверенным карточкам с учётом близости домов и обеих сторон улицы.`;
    }

    return {
      candidates,
      totalVerified,
      scanned,
      failed: Number(input.failed || 0),
      exactHouseScanned: (input.neighbors || []).filter(item => item.scope === 'same-house').length,
      nearbyStreetScanned: (input.neighbors || []).filter(item => item.scope === 'nearby-street').length,
      discovery,
      conclusion,
    };
  }

  function nbConfidenceLabel(value) {
    return value === 'high' ? 'ВЫСОКАЯ'
      : value === 'medium' ? 'СРЕДНЯЯ'
      : 'НИЗКАЯ';
  }

  function nbEnsureContainer() {
    const results = document.querySelector('#dp-results');
    if (!results) return null;
    let container = document.querySelector('#dp-neighbor-olt-container');
    if (container) return container;
    container = document.createElement('div');
    container.id = 'dp-neighbor-olt-container';
    const history = document.querySelector('#dp-history-reasoning-container');
    if (history && history.parentElement === results) history.insertAdjacentElement('afterend', container);
    else results.appendChild(container);
    return container;
  }

  function nbRenderPending(message) {
    const container = nbEnsureContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="dp-neighbor-olt loading">
        <div class="dp-neighbor-olt-head"><span>OLT по проверенным соседям</span><b>СОБИРАЮ…</b></div>
        <div class="dp-neighbor-olt-summary">${nbEscape(message)}</div>
      </div>`;
    nbNotifyWorkbenchChanged();
  }

  function nbRenderError(message) {
    const container = nbEnsureContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="dp-neighbor-olt warning">
        <div class="dp-neighbor-olt-head"><span>OLT по проверенным соседям</span><b>НЕТ ВЫВОДА</b></div>
        <div class="dp-neighbor-olt-summary">${nbEscape(message)}</div>
        <div class="dp-neighbor-olt-note">Основная диагностика не изменена. Модуль соседей завершился отдельно.</div>
      </div>`;
    nbNotifyWorkbenchChanged();
  }

  function nbRenderResult(report, context) {
    const container = nbEnsureContainer();
    if (!container) return;
    const cards = report.candidates.length ? report.candidates.map((candidate, index) => `
      <div class="dp-neighbor-olt-card ${index === 0 ? 'primary' : ''}">
        <div class="dp-neighbor-olt-rank">${index + 1}</div>
        <div class="dp-neighbor-olt-card-body">
          <div class="dp-neighbor-olt-title">
            <b>${nbEscape(candidate.name || `OLT ${candidate.deviceId}`)}</b>
            ${candidate.ip ? `<code>${nbEscape(candidate.ip)}</code>` : ''}
            <span>${nbEscape(nbConfidenceLabel(candidate.confidence))}</span>
          </div>
          <div class="dp-neighbor-olt-metrics">
            <span>подтверждено абонентами: <b>${candidate.count}</b></span>
            <span>доля подтверждений: <b>${Math.round(candidate.share * 100)}%</b></span>
            <span>тот же дом: <b>${candidate.exactHouseCount}</b></span>
            ${candidate.nearbyStreetCount ? `<span>по улице: <b>${candidate.nearbyStreetCount}</b></span>` : ''}
            ${candidate.averageDistance ? `<span>средняя удалённость: <b>${candidate.averageDistance.toFixed(1)}</b> дома</span>` : ''}
            ${candidate.sameSideCount ? `<span>та же сторона: <b>${candidate.sameSideCount}</b></span>` : ''}
            ${candidate.technologyMatches ? `<span>совпала технология: <b>${candidate.technologyMatches}</b></span>` : ''}
          </div>
          ${candidate.interfaces.length ? `<div class="dp-neighbor-olt-evidence">PON: ${nbEscape(candidate.interfaces.slice(0, 8).join(', '))}</div>` : ''}
          ${candidate.contracts.length ? `<div class="dp-neighbor-olt-evidence">Примеры: ${nbEscape(candidate.contracts.slice(0, 8).join(', '))}</div>` : ''}
          ${candidate.addresses.length ? `<div class="dp-neighbor-olt-evidence">Адреса: ${nbEscape(candidate.addresses.slice(0, 5).join(' | '))}</div>` : ''}
          ${candidate.matchesCurrentOlt ? '<div class="dp-neighbor-olt-match">Совпадает с OLT, уже найденной основной диагностикой.</div>' : ''}
        </div>
      </div>`).join('') : '<div class="dp-neighbor-olt-empty">Подтверждённые OLT в проверенной выборке не найдены.</div>';

    const overall = report.candidates[0]?.confidence || 'low';
    const discovery = report.discovery || {};
    container.innerHTML = `
      <div class="dp-neighbor-olt ${report.candidates.length ? 'ok' : 'warning'}">
        <div class="dp-neighbor-olt-head">
          <span>Предполагаемые OLT для абонента <small>${NB_VERSION}</small></span>
          <b>${nbEscape(nbConfidenceLabel(overall))}</b>
        </div>
        <div class="dp-neighbor-olt-context">
          <span>адрес: ${nbEscape(context.currentAddress.original || 'не определён')}</span>
          <span>режим: ${discovery.privateSectorMode ? 'частный сектор' : 'точный дом'}</span>
          <span>найдено строк улицы: ${Number(discovery.discoveredStreetRows || 0)}</span>
          <span>страниц улицы: ${Number(discovery.streetPagesFetched || 0)}</span>
          <span>выбрано для проверки: ${Number(discovery.selectedForVerification || report.scanned)}</span>
          <span>проверено карточек: ${report.scanned}/${Number(discovery.selectedForVerification || report.scanned)}</span>
          <span>явно подтверждено OLT: ${report.totalVerified}</span>
          ${context.targetTechnology ? `<span>технология цели: ${nbEscape(context.targetTechnology.toUpperCase())}</span>` : ''}
        </div>
        <div class="dp-neighbor-olt-summary">${nbEscape(report.conclusion)}</div>
        <section>
          <h4>Рейтинг кандидатов</h4>
          ${cards}
        </section>
        <details>
          <summary>Как формировалась выборка</summary>
          <ul>
            <li>Для частного сектора модуль собирает до ${NB_VERIFY_LIMIT} абонентов по той же улице, а не ограничивается одним соседним домом.</li>
            <li>Сначала идут тот же дом и ближайшие номера; затем выборка чередуется по чётной и нечётной стороне улицы. Дробные номера и литеры учитываются отдельно.</li>
            <li>Поиск улицы читает до ${NB_STREET_PAGE_LIMIT} страниц выдачи UserSide, пока не собрана достаточная выборка.</li>
            <li>В рейтинг включены только карточки, где UserSide явно показывает «Найдено на OLT» и удалось извлечь устройство плюс IP или PON-интерфейс.</li>
            <li>Это гипотеза для дальнейшего штатного ONU-опроса, а не автоматическое изменение OLT в Billing.</li>
            ${report.failed ? `<li>Не удалось прочитать карточек: ${report.failed}.</li>` : ''}
          </ul>
        </details>
        <div class="dp-neighbor-olt-note">Встроенный независимый модуль · ${runtime.requests}/${NB_REQUEST_LIMIT} GET · параллельность ${NB_CONCURRENCY} · основная диагностика не изменяется</div>
      </div>`;
    nbNotifyWorkbenchChanged();
  }

  function nbUpdateButtonState() {
    const button = document.querySelector('#dp-neighbor-olt-run');
    if (!button) return;
    const status = nbText(document.querySelector('#dp-status')?.textContent || '');
    const busy = /ищу договор|собираю данные|запускаю опрос|опрос ONU|PON-цикл/i.test(status)
      && !/диагностика завершена/i.test(status);
    button.disabled = Boolean(runtime.running || busy || nbIsMirror());
    button.title = nbIsMirror()
      ? 'Зеркало: сетевой сбор выполняется только во вкладке-исполнителе'
      : runtime.running
        ? 'Проверка соседей выполняется'
        : busy
          ? 'Сначала дождись завершения основной диагностики'
          : 'Проверить подтверждённые OLT соседних абонентов';
  }

  function nbArmAutomatic(contract) {
    const normalized = nbNormalizeContract(contract);
    if (!normalized || nbPanelRole() !== 'owner') return false;
    runtime.armedContract = normalized;
    runtime.armedAt = Date.now();
    return true;
  }

  function nbAutomaticArmed(contract) {
    const normalized = nbNormalizeContract(contract);
    return Boolean(normalized
      && runtime.armedContract === normalized
      && Date.now() - runtime.armedAt <= NB_ARM_TTL_MS
      && !nbIsMirror());
  }

  async function nbWaitForHistory(runId) {
    const startedAt = Date.now();
    while (runId === runtime.runId && Date.now() - startedAt < 30000) {
      const loading = document.querySelector('#dp-history-reasoning-container .dp-history-reasoning.loading');
      if (!loading) return;
      await new Promise(resolve => window.setTimeout(resolve, 500));
    }
  }

  function nbPaginationMaxPage(raw) {
    const doc = nbParseHtml(raw);
    let maxPage = 1;
    const bodyText = nbNodeText(doc.body || doc);
    const summary = bodyText.match(/(?:Страница|Сторінка)\s+\d+\s+(?:из|з)\s+(\d+)/i);
    if (summary) maxPage = Math.max(maxPage, Number(summary[1]) || 1);
    for (const anchor of doc.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href') || '', NB_BASE);
        const page = Number(url.searchParams.get('page') || 0);
        if (Number.isFinite(page) && page > maxPage) maxPage = page;
      } catch (_) {}
    }
    return Math.max(1, Math.min(maxPage, NB_STREET_PAGE_LIMIT));
  }

  async function nbCollectSearchRows(query, source, runId, options = {}) {
    if (!query || runtime.requests >= NB_REQUEST_LIMIT) return { rows: [], pagesFetched: 0 };
    const baseUrl = `${NB_BASE}/customer_list/search_page?search=${encodeURIComponent(query)}`;
    const firstRaw = await nbRequest(baseUrl, runId);
    const rows = [...nbParseCustomerRows(firstRaw, `${source} · стр. 1`)];
    let pagesFetched = 1;
    const maxPage = options.paginate === false ? 1 : nbPaginationMaxPage(firstRaw);
    for (let page = 2; page <= maxPage; page += 1) {
      if (runId !== runtime.runId || runtime.requests >= NB_REQUEST_LIMIT) break;
      if (rows.length >= Number(options.rowLimit || NB_STREET_DISCOVERY_LIMIT)) break;
      try {
        const url = new URL(baseUrl);
        url.searchParams.set('page', String(page));
        const raw = await nbRequest(url.toString(), runId);
        rows.push(...nbParseCustomerRows(raw, `${source} · стр. ${page}`));
        pagesFetched += 1;
      } catch (_) {}
    }
    return {
      rows: nbUnique(rows, row => row.customerId),
      pagesFetched,
    };
  }

  async function nbDiscoverNeighborRows(currentCustomerId, currentAddress, runId) {
    const allRows = [];
    let exactPagesFetched = 0;
    let streetPagesFetched = 0;
    try {
      const attachUrl = `${NB_BASE}/attach/ajax_frame?obj_typer=customer&obj_code=${encodeURIComponent(currentCustomerId)}`;
      const raw = await nbRequest(attachUrl, runId);
      allRows.push(...nbParseCustomerRows(raw, 'адресная карточка'));
    } catch (_) {}

    const exactQuery = nbSearchQuery(currentAddress, true);
    if (exactQuery && runtime.requests < NB_REQUEST_LIMIT) {
      try {
        const exact = await nbCollectSearchRows(exactQuery, 'поиск точного дома', runId, { paginate: false });
        allRows.push(...exact.rows);
        exactPagesFetched += exact.pagesFetched;
      } catch (_) {}
    }

    const exactCount = nbUnique(
      allRows.filter(row => nbSameHouse(row.addressIdentity, currentAddress)),
      row => row.customerId,
    ).length;
    const privateSectorMode = !currentAddress.hasApartment && exactCount <= NB_PRIVATE_SECTOR_EXACT_HOUSE_MAX;
    const targetLimit = privateSectorMode ? NB_VERIFY_LIMIT : Math.min(NB_VERIFY_LIMIT, Math.max(10, exactCount));

    if ((privateSectorMode || exactCount < targetLimit) && currentAddress.street && runtime.requests < NB_REQUEST_LIMIT) {
      try {
        const streetQuery = nbSearchQuery(currentAddress, false);
        const street = await nbCollectSearchRows(streetQuery, 'поиск улицы', runId, {
          paginate: true,
          rowLimit: NB_STREET_DISCOVERY_LIMIT,
        });
        allRows.push(...street.rows);
        streetPagesFetched += street.pagesFetched;
      } catch (_) {}
    }

    const uniqueRows = nbUnique(allRows, row => row.customerId);
    const sameStreetRows = uniqueRows.filter(row => nbNearbyStreet(row.addressIdentity, currentAddress));
    const neighbors = nbSelectNeighbors(uniqueRows, currentCustomerId, currentAddress, { limit: targetLimit });
    return {
      neighbors,
      discovery: {
        privateSectorMode,
        exactHouseFound: exactCount,
        discoveredStreetRows: sameStreetRows.length,
        selectedForVerification: neighbors.length,
        exactPagesFetched,
        streetPagesFetched,
        targetLimit,
      },
    };
  }

  async function nbRun(reason = 'manual') {
    const panel = document.querySelector('#dp-panel');
    if (!panel) return;
    if (nbIsMirror()) {
      if (reason === 'manual') nbRenderError('Эта вкладка является зеркалом. Проверка соседей запускается во вкладке-исполнителе или в свободной вкладке.');
      nbUpdateButtonState();
      return;
    }

    const snapshot = nbPanelSnapshot();
    if (!snapshot.requested) {
      nbRenderError('Сначала введи договор и запусти обычную диагностику.');
      return;
    }

    nbAbort();
    const runId = runtime.runId;
    runtime.running = true;
    runtime.requests = 0;
    nbUpdateButtonState();
    nbRenderPending(`определяю точный адрес ${snapshot.requested}, затем проверяю OLT соседей…`);

    try {
      if (reason === 'automatic') await nbWaitForHistory(runId);
      if (runId !== runtime.runId) return;

      const resolverUrl = `${NB_BASE}/customer_list/ajax_search?token=${Date.now()}&search=${encodeURIComponent(snapshot.requested)}`;
      const resolverRaw = await nbRequest(resolverUrl, runId);
      const exact = nbChooseExactCandidate(nbExactResolverCandidates(resolverRaw, snapshot.requested), snapshot.requested);
      if (!exact) throw new Error(`точный договор ${snapshot.requested} не найден; чужие карточки не анализировались`);

      const currentMainRaw = await nbRequest(`${NB_BASE}/customer/tab?tab=main&id=${encodeURIComponent(exact.customerId)}`, runId);
      if (runId !== runtime.runId) return;
      const currentDoc = nbParseHtml(currentMainRaw);
      const address = nbExtractLabel(currentDoc, ['Адрес', 'Адреса']) || snapshot.address;
      const currentAddress = nbAddressIdentity(address);
      if (!currentAddress.street || !currentAddress.house) {
        throw new Error(`не удалось выделить улицу и дом из адреса «${address || 'пусто'}»`);
      }

      nbRenderPending(`адрес ${currentAddress.label || currentAddress.original}: собираю соседей и проверяю только явные связи «Найдено на OLT»…`);
      const discoveryResult = await nbDiscoverNeighborRows(exact.customerId, currentAddress, runId);
      const neighbors = discoveryResult.neighbors || [];
      const discovery = discoveryResult.discovery || {};
      if (!neighbors.length) throw new Error(`по дому ${currentAddress.label || currentAddress.original} и улице абоненты для проверки не найдены`);

      nbRenderPending(discovery.privateSectorMode
        ? `частный сектор: найдено ${discovery.discoveredStreetRows || 0} абонентов улицы; проверяю до ${NB_VERIFY_LIMIT} ближайших карточек с обеих сторон…`
        : `точный дом: найдено ${discovery.exactHouseFound || neighbors.length} соседей; проверяю подтверждённые OLT…`);

      let failed = 0;
      const checked = await nbMapLimit(neighbors, NB_CONCURRENCY, async neighbor => {
        if (runId !== runtime.runId || runtime.requests >= NB_REQUEST_LIMIT) return null;
        try {
          const raw = await nbRequest(`${NB_BASE}/customer/tab?tab=main&id=${encodeURIComponent(neighbor.customerId)}`, runId);
          return { neighbor, olt: nbExtractVerifiedOlt(raw) };
        } catch (_) {
          failed += 1;
          return { neighbor, olt: null };
        }
      });
      if (runId !== runtime.runId) return;

      const report = nbAnalyzeVerifiedNeighbors({
        neighbors,
        samples: checked.filter(Boolean),
        scanned: checked.filter(Boolean).length,
        failed,
        targetTechnology: snapshot.targetTechnology,
        confirmedOltIps: snapshot.confirmedOltIps,
        discovery,
      });
      nbRenderResult(report, {
        currentAddress,
        targetTechnology: snapshot.targetTechnology,
      });
      runtime.lastCompletedKey = `${snapshot.contract}|${snapshot.status}`;
      runtime.armedContract = '';
      runtime.armedAt = 0;
    } catch (error) {
      if (runId === runtime.runId) nbRenderError(error && error.message || String(error));
    } finally {
      if (runId === runtime.runId) {
        runtime.running = false;
        runtime.abortables.clear();
        nbUpdateButtonState();
      }
    }
  }

  function nbRunSelfTests() {
    const target = nbAddressIdentity('Київська обл., с. Петропавлівська Борщагівка, вул. Польова, 21/А');
    const same = nbAddressIdentity('с. Петропавлівська Борщагівка, вулиця Польова, буд. 21/А');
    const otherVillage = nbAddressIdentity('с. Софіївська Борщагівка, вул. Польова, 23');
    const rows = [];
    for (let number = 1; number <= 60; number += 1) {
      rows.push({
        customerId: String(1000 + number),
        contract: String(500000 + number),
        login: `abon${500000 + number}`,
        address: `с. Петропавлівська Борщагівка, вул. Польова, ${number}`,
        addressIdentity: nbAddressIdentity(`с. Петропавлівська Борщагівка, вул. Польова, ${number}`),
        status: number % 3 ? 'Активен' : 'Заблокирован',
      });
    }
    rows.push({
      customerId: '9999',
      contract: '999999',
      login: 'abon999999',
      address: otherVillage.original,
      addressIdentity: otherVillage,
      status: 'Активен',
    });
    const selected = nbSelectNeighbors(rows, '', target, { limit: 20 });
    const sameSide = selected.filter(row => row.sameStreetSide === true).length;
    const otherSide = selected.filter(row => row.sameStreetSide === false).length;

    const samples = selected.map((neighbor, index) => ({
      neighbor,
      olt: index < 11
        ? { verified: true, name: 'Huawei MA5800 Polevaya', ip: '172.16.1.10', deviceId: '501', interface: `gpon0/1/${index + 1}:1` }
        : index < 17
          ? { verified: true, name: 'BDCOM Polevaya', ip: '172.16.1.20', deviceId: '502', interface: `epon0/3:${index + 1}` }
          : null,
    }));
    const report = nbAnalyzeVerifiedNeighbors({
      neighbors: selected,
      samples,
      scanned: selected.length,
      failed: 0,
      targetTechnology: 'gpon',
      confirmedOltIps: [],
      discovery: { privateSectorMode: true, selectedForVerification: 20, discoveredStreetRows: 60 },
    });
    return [
      { name: 'населённый пункт и улица нормализуются одинаково', ok: nbSameHouse(target, same), detail: `${target.key} / ${same.key}` },
      { name: 'одноимённая улица другого села исключается', ok: !nbNearbyStreet(target, otherVillage), detail: `${target.locality} / ${otherVillage.locality}` },
      { name: 'частный сектор выбирает двадцать карточек', ok: selected.length === 20, detail: String(selected.length) },
      { name: 'выборка покрывает обе стороны улицы', ok: sameSide >= 8 && otherSide >= 8, detail: `${sameSide}/${otherSide}` },
      { name: 'ближайшие номера имеют приоритет', ok: Math.max(...selected.slice(0, 6).map(row => row.distance)) <= 4, detail: selected.slice(0, 6).map(row => row.addressIdentity.house).join(', ') },
      { name: 'неподтверждённые карточки не входят в рейтинг', ok: report.totalVerified === 17, detail: String(report.totalVerified) },
      { name: 'Huawei занимает первое место по расширенной выборке', ok: report.candidates[0]?.ip === '172.16.1.10', detail: report.candidates.map(item => `${item.ip}:${item.count}`).join(', ') },
      { name: 'вывод ограничен тремя OLT-кандидатами', ok: report.candidates.length <= 3, detail: String(report.candidates.length) },
    ];
  }

  function nbInstallStyle() {
    if (document.getElementById(NB_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = NB_STYLE_ID;
    style.textContent = `
      #dp-neighbor-olt-run { background:#456547 !important; color:#fff !important; border-color:#638865 !important; }
      #dp-neighbor-olt-run:disabled { opacity:.55 !important; cursor:not-allowed !important; }
      .dp-neighbor-olt { margin:8px 0; border:1px solid #566779; border-left:4px solid #6d9c70; border-radius:8px; background:#17212b; color:#e9eef5; overflow:hidden; }
      .dp-neighbor-olt.ok { border-left-color:#48c78e; }
      .dp-neighbor-olt.warning { border-left-color:#f3c969; }
      .dp-neighbor-olt.loading { border-left-color:#63a4dc; }
      .dp-neighbor-olt-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; background:#202e3b; }
      .dp-neighbor-olt-head > span { font-weight:700; color:#eef6ff; }
      .dp-neighbor-olt-head small { margin-left:5px; color:#8fa6ba; font-size:9px; font-weight:400; }
      .dp-neighbor-olt-head > b { padding:3px 7px; border-radius:999px; background:#31465a; color:#dcecff; font-size:9px; white-space:nowrap; }
      .dp-neighbor-olt-context { display:flex; flex-wrap:wrap; gap:5px; padding:8px 10px 0; }
      .dp-neighbor-olt-context span { padding:3px 6px; border:1px solid #405366; border-radius:5px; background:#202c38; font-size:10px; }
      .dp-neighbor-olt-summary { padding:9px 10px; color:#f3f7fb; line-height:1.45; }
      .dp-neighbor-olt section,.dp-neighbor-olt details { margin:0 9px 8px; padding:8px; border:1px solid #354657; border-radius:6px; background:#1c2732; }
      .dp-neighbor-olt h4 { margin:0 0 7px; color:#a8d5aa; font-size:11px; }
      .dp-neighbor-olt-card { display:flex; gap:8px; margin:6px 0; padding:8px; border:1px solid #405366; border-radius:6px; background:#222f3b; }
      .dp-neighbor-olt-card.primary { border-color:#5d9964; box-shadow:inset 3px 0 0 #48c78e; }
      .dp-neighbor-olt-rank { display:flex; align-items:center; justify-content:center; min-width:25px; height:25px; border-radius:50%; background:#31465a; font-weight:700; }
      .dp-neighbor-olt-card-body { min-width:0; flex:1; }
      .dp-neighbor-olt-title { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
      .dp-neighbor-olt-title code { padding:2px 5px; border-radius:4px; background:#17212b; color:#b7dbff; }
      .dp-neighbor-olt-title span { margin-left:auto; color:#9fd6a4; font-size:9px; font-weight:700; }
      .dp-neighbor-olt-metrics { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
      .dp-neighbor-olt-metrics span { padding:2px 5px; border-radius:4px; background:#1b2630; color:#b8c9d8; font-size:10px; }
      .dp-neighbor-olt-evidence { margin-top:5px; color:#aab9c7; font-size:10px; overflow-wrap:anywhere; }
      .dp-neighbor-olt-match { margin-top:6px; color:#93ddb8; font-size:10px; font-weight:700; }
      .dp-neighbor-olt-empty,.dp-neighbor-olt-note { color:#9fb0c0; font-size:10px; }
      .dp-neighbor-olt-note { padding:0 10px 9px; }
      .dp-neighbor-olt summary { cursor:pointer; color:#b9d8f1; font-weight:600; }
      .dp-neighbor-olt ul { margin:6px 0 0 18px; padding:0; }
      .dp-neighbor-olt li { margin:4px 0; line-height:1.35; }
      @media (prefers-color-scheme: light) {
        .dp-neighbor-olt { background:#fff; color:#243444; border-color:#c9d4de; }
        .dp-neighbor-olt-head { background:#edf4fa; }
        .dp-neighbor-olt-head > span { color:#17365d; }
        .dp-neighbor-olt-context span,.dp-neighbor-olt section,.dp-neighbor-olt details,.dp-neighbor-olt-card { background:#f7f9fb; border-color:#d7e0e8; color:#243444; }
        .dp-neighbor-olt-summary { color:#243444; }
        .dp-neighbor-olt-title code { background:#eef3f7; color:#244d73; }
        .dp-neighbor-olt-metrics span { background:#eef3f7; color:#42576b; }
      }
    `;
    document.head.appendChild(style);
  }

  function nbInstall() {
    const panel = document.querySelector('#dp-panel');
    const form = document.querySelector('#dp-form');
    const status = document.querySelector('#dp-status');
    if (!panel || !form || !status) return false;
    if (runtime.installed) return true;
    runtime.installed = true;
    nbInstallStyle();

    let actions = document.querySelector('#dp-history-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'dp-history-actions';
      form.insertAdjacentElement('afterend', actions);
    }
    let button = document.querySelector('#dp-neighbor-olt-run');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'dp-neighbor-olt-run';
      button.textContent = 'OLT по соседям';
      actions.appendChild(button);
    }
    nbEnsureContainer();
    button.addEventListener('click', () => nbRun('manual'));
    nbUpdateButtonState();

    runtime.observer = new MutationObserver(() => {
      const text = nbText(status.textContent);
      const contract = nbNormalizeContract(document.querySelector('#dp-input')?.value || '');
      const started = /ищу договор|собираю данные|запускаю опрос|опрос ONU/i.test(text)
        && !/диагностика завершена/i.test(text);
      if (started) {
        nbArmAutomatic(contract);
        if (runtime.running) nbAbort();
        const container = nbEnsureContainer();
        if (container && nbPanelRole() === 'owner') {
          container.innerHTML = '';
          nbNotifyWorkbenchChanged();
        }
        nbUpdateButtonState();
        return;
      }

      nbUpdateButtonState();
      if (!/диагностика завершена/i.test(text) || !contract || !nbAutomaticArmed(contract)) return;
      const key = `${contract}|${text}`;
      if (key === runtime.lastCompletedKey || key === runtime.lastScheduledKey) return;
      runtime.lastScheduledKey = key;
      window.setTimeout(() => {
        const currentText = nbText(status.textContent);
        const currentContract = nbNormalizeContract(document.querySelector('#dp-input')?.value || '');
        if (/диагностика завершена/i.test(currentText)
          && currentContract === contract
          && nbAutomaticArmed(contract)
          && !runtime.running) {
          nbRun('automatic');
        }
      }, NB_AUTO_DELAY_MS);
    });
    runtime.observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true });

    const roleObserver = new MutationObserver(nbUpdateButtonState);
    roleObserver.observe(panel, { attributes: true, attributeFilter: ['data-tab-role'] });
    return true;
  }

  function nbScheduleInstall() {
    if (nbInstall()) return;
    let attempts = 0;
    runtime.installTimer = window.setInterval(() => {
      attempts += 1;
      if (nbInstall() || attempts >= 120) {
        window.clearInterval(runtime.installTimer);
        runtime.installTimer = 0;
      }
    }, 500);
  }

  if (typeof globalThis !== 'undefined' && globalThis.__SIMNET_NEIGHBOR_OLT_TEST_HOOK__) {
    Object.assign(globalThis.__SIMNET_NEIGHBOR_OLT_TEST_HOOK__, {
      addressIdentity: nbAddressIdentity,
      sameHouse: nbSameHouse,
      nearbyStreet: nbNearbyStreet,
      selectNeighbors: nbSelectNeighbors,
      paginationMaxPage: nbPaginationMaxPage,
      analyzeVerifiedNeighbors: nbAnalyzeVerifiedNeighbors,
      runSelfTests: nbRunSelfTests,
    });
  }

  window.addEventListener('pagehide', nbAbort);
  nbScheduleInstall();
})();

/* ============================================================================
 * ADDITIVE MODULE: USERSIDE MAP EVIDENCE CAPTURE
 * Version: map-capture.3
 *
 * Назначение:
 * - пассивно перехватывает только нужные ответы карты UserSide;
 * - не меняет логику основной диагностики и модулей Workbench;
 * - сохраняет геокодирование, bbox-запросы, GeoJSON домов и tooltip объектов;
 * - экспортирует отдельный диагностический JSON без API-ключей и credentials.
 * ========================================================================== */
(function () {
  'use strict';

  const MODULE_VERSION = 'map-capture.3';
  const GUARD = '__SIMNET_USERSIDE_MAP_EVIDENCE_CAPTURE_V2__';
  if (window[GUARD]) return;
  window[GUARD] = { version: MODULE_VERSION, startedAt: new Date().toISOString() };

  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const PAGE_EVENT = 'simnet-map-evidence-capture-v2';
  const STORAGE_KEY = 'SIMNET_MAP_EVIDENCE_CAPTURE_V2';
  const PANEL_ID = 'simnet-map-capture-panel-v2';
  const API_KEY = '__SIMNET_MAP_CAPTURE_API_V3__';
  const STATE_EVENT = 'simnet-map-capture-state-v3';
  const MAX_ITEMS = 90;
  const MAX_TOTAL_CHARS = 4_500_000;

  const runtime = {
    items: [],
    loaded: false,
    saveTimer: 0,
    installTimer: 0,
    lastFingerprint: '',
    hookMode: 'ожидание',
    hookError: '',
    panelTimer: 0,
  };

  function mcNowIso() {
    return new Date().toISOString();
  }

  function mcUid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function mcCompact(value, max = 400) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function mcSafeJsonParse(value) {
    try { return JSON.parse(String(value || '')); } catch (_) { return null; }
  }

  function mcHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function mcRedactUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:key|api_key|apikey|token|password|passwd|session|sid)$/i.test(key)) {
          url.searchParams.set(key, '{redacted}');
        } else if (/^session_id$/i.test(key)) {
          const value = url.searchParams.get(key) || '';
          url.searchParams.set(key, value ? `{session:${mcHash(value)}}` : '{session}');
        }
      }
      return url.toString();
    } catch (_) {
      return mcCompact(rawUrl, 1400);
    }
  }

  function mcRequestMeta(rawUrl) {
    const meta = {};
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      if (/maps\.googleapis\.com$/i.test(url.hostname) && /\/maps\/api\/geocode\/json$/i.test(url.pathname)) {
        meta.address = url.searchParams.get('address') || '';
      }
      if (url.pathname === '/map/request_by_ws') {
        meta.zoom = Number(url.searchParams.get('zoom') || 0) || null;
        meta.ne = url.searchParams.get('ne') || '';
        meta.sw = url.searchParams.get('sw') || '';
      }
      if (url.pathname === '/map/load_from_ws') meta.idx = url.searchParams.get('idx') || '';
      if (url.pathname === '/map/tooltip') {
        meta.objectType = url.searchParams.get('obj_type') || '';
        meta.objectId = url.searchParams.get('obj_id') || '';
      }
      if (url.pathname === '/map/ajax_find') {
        meta.unitName = url.searchParams.get('unit_name') || '';
        meta.mapCenter = url.searchParams.get('map_center') || '';
      }
    } catch (_) {}
    return meta;
  }

  function mcClassify(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      if (/maps\.googleapis\.com$/i.test(url.hostname) && /\/maps\/api\/geocode\/json$/i.test(url.pathname)) return 'geocode';
      if (url.hostname !== 'userside.simnet.kiev.ua' && url.hostname !== location.hostname) return '';
      if (url.pathname === '/map/ajax_find') return 'map-find';
      if (url.pathname === '/map/request_by_ws') return 'map-window-request';
      if (url.pathname === '/map/load_from_ws') return 'map-features';
      if (url.pathname === '/map/tooltip') {
        const objectType = url.searchParams.get('obj_type') || '';
        return objectType === 'house' ? 'house-tooltip' : 'map-tooltip';
      }
    } catch (_) {}
    return '';
  }

  function mcFeatureSummary(parsed) {
    const features = Array.isArray(parsed && parsed.features) ? parsed.features : [];
    const counts = {};
    let houseCount = 0;
    let nodeCount = 0;
    const houseIds = [];
    const nodeIds = [];

    for (const feature of features) {
      const type = String(feature && feature.properties && feature.properties.type || 'unknown');
      counts[type] = Number(counts[type] || 0) + 1;
      const id = feature && feature.properties && feature.properties.id;
      if (type === 'house') {
        houseCount += 1;
        if (id != null && houseIds.length < 1000) houseIds.push(String(id));
      }
      if (type === 'node') {
        nodeCount += 1;
        if (id != null && nodeIds.length < 1000) nodeIds.push(String(id));
      }
    }

    return {
      totalFeatures: features.length,
      counts,
      houseCount,
      nodeCount,
      houseIds,
      nodeIds,
      captureTruncated: Boolean(parsed && parsed.__capture && parsed.__capture.truncated),
      originalFeatureCount: Number(parsed && parsed.__capture && parsed.__capture.originalFeatureCount || features.length),
    };
  }

  function mcGeocodeSummary(parsed) {
    const first = parsed && Array.isArray(parsed.results) ? parsed.results[0] : null;
    const geometry = first && first.geometry || {};
    const components = Array.isArray(first && first.address_components) ? first.address_components : [];
    const component = type => {
      const found = components.find(item => Array.isArray(item.types) && item.types.includes(type));
      return found && found.long_name || '';
    };
    return {
      status: parsed && parsed.status || '',
      formattedAddress: first && first.formatted_address || '',
      placeId: first && first.place_id || '',
      resultTypes: Array.isArray(first && first.types) ? first.types : [],
      partialMatch: Boolean(first && first.partial_match),
      locationType: geometry.location_type || '',
      lat: Number(geometry.location && geometry.location.lat),
      lng: Number(geometry.location && geometry.location.lng),
      streetNumber: component('street_number'),
      subpremise: component('subpremise'),
      route: component('route'),
      locality: component('locality'),
    };
  }

  function mcNormalizePayload(payload) {
    const kind = mcClassify(payload && payload.url);
    if (!kind) return null;

    const body = String(payload && payload.body || '');
    const parsed = mcSafeJsonParse(body);
    const request = mcRequestMeta(payload.url);
    const record = {
      id: mcUid('map_capture'),
      at: String(payload.at || mcNowIso()),
      moduleVersion: MODULE_VERSION,
      transport: String(payload.transport || ''),
      method: String(payload.method || 'GET').toUpperCase(),
      status: Number(payload.status || 0),
      ok: Boolean(payload.ok),
      kind,
      url: mcRedactUrl(payload.url),
      request,
      response: null,
      summary: {},
    };

    if (kind === 'geocode') {
      record.response = parsed || body.slice(0, 300000);
      record.summary = mcGeocodeSummary(parsed);
    } else if (kind === 'map-features') {
      record.response = parsed || body.slice(0, 1800000);
      record.summary = mcFeatureSummary(parsed);
    } else {
      record.response = parsed || body.slice(0, 500000);
      record.summary = {
        responseChars: body.length,
        objectType: request.objectType || '',
        objectId: request.objectId || '',
        preview: parsed ? '' : mcCompact(body.replace(/<[^>]+>/g, ' '), 700),
      };
    }

    record.fingerprint = mcHash([
      record.kind,
      record.url,
      record.status,
      JSON.stringify(record.summary),
    ].join('|'));
    return record;
  }

  function mcTrimItems(items) {
    const out = Array.isArray(items) ? items.slice(-MAX_ITEMS) : [];
    let size = 0;
    try { size = JSON.stringify(out).length; } catch (_) { return out.slice(-20); }
    while (out.length > 1 && size > MAX_TOTAL_CHARS) {
      out.shift();
      try { size = JSON.stringify(out).length; } catch (_) { break; }
    }
    return out;
  }

  async function mcLoad() {
    if (runtime.loaded) return;
    runtime.loaded = true;
    try {
      if (typeof GM_getValue === 'function') {
        const value = await Promise.resolve(GM_getValue(STORAGE_KEY, []));
        runtime.items = mcTrimItems(Array.isArray(value) ? value : []);
      }
    } catch (_) {
      runtime.items = [];
    }
    mcRenderPanel();
  }

  function mcScheduleSave() {
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = window.setTimeout(async () => {
      runtime.saveTimer = 0;
      runtime.items = mcTrimItems(runtime.items);
      try {
        if (typeof GM_setValue === 'function') await Promise.resolve(GM_setValue(STORAGE_KEY, runtime.items));
      } catch (_) {}
    }, 350);
  }

  function mcAdd(payload) {
    const record = mcNormalizePayload(payload);
    if (!record) return;
    const duplicate = runtime.items.some(item => item && item.fingerprint === record.fingerprint && item.at === record.at);
    if (duplicate) return;
    runtime.items.push(record);
    runtime.items = mcTrimItems(runtime.items);
    runtime.lastFingerprint = record.fingerprint;
    mcScheduleSave();
    mcRenderPanel();
  }

  function mcCounts() {
    const counts = { geocode: 0, windows: 0, features: 0, houses: 0, houseObservations: 0, houseTooltips: 0 };
    const houseIds = new Set();
    for (const item of runtime.items) {
      if (item.kind === 'geocode') counts.geocode += 1;
      if (item.kind === 'map-window-request') counts.windows += 1;
      if (item.kind === 'map-features') {
        counts.features += 1;
        counts.houseObservations += Number(item.summary && item.summary.houseCount || 0);
        const features = item.response && Array.isArray(item.response.features) ? item.response.features : [];
        for (const feature of features) {
          if (String(feature && feature.properties && feature.properties.type || '') !== 'house') continue;
          const id = String(feature && feature.properties && feature.properties.id || '');
          if (id) houseIds.add(id);
        }
      }
      if (item.kind === 'house-tooltip') counts.houseTooltips += 1;
    }
    counts.houses = houseIds.size;
    return counts;
  }

  function mcDownload(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mcExport() {
    const payload = {
      schema: 'simnet-userside-map-evidence-v1',
      moduleVersion: MODULE_VERSION,
      exportedAt: mcNowIso(),
      page: {
        href: mcRedactUrl(location.href),
        title: document.title || '',
      },
      note: 'API keys, credentials and session identifiers are redacted. Capture contains only map/geocode evidence.',
      counts: mcCounts(),
      items: runtime.items,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mcDownload(`simnet_map_evidence_${stamp}.json`, JSON.stringify(payload, null, 2));
  }

  async function mcClear() {
    runtime.items = [];
    runtime.lastFingerprint = '';
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = 0;
    try {
      if (typeof GM_deleteValue === 'function') await Promise.resolve(GM_deleteValue(STORAGE_KEY));
      else if (typeof GM_setValue === 'function') await Promise.resolve(GM_setValue(STORAGE_KEY, []));
    } catch (_) {}
    mcRenderPanel();
  }

  function mcExposeApi() {
    const api = {
      version: MODULE_VERSION,
      counts: () => mcCounts(),
      exportEvidence: () => mcExport(),
      clear: () => mcClear(),
      getItems: () => runtime.items.slice(),
      status: () => ({ hookMode: runtime.hookMode, hookError: runtime.hookError, onMap: /^\/map(?:\/|$)/.test(location.pathname) }),
    };
    try { globalThis[API_KEY] = api; } catch (_) {}
    try { window[API_KEY] = api; } catch (_) {}
    return api;
  }

  function mcRenderPanel() {
    document.getElementById(PANEL_ID)?.remove();
    mcExposeApi();
    try {
      document.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: JSON.stringify({ counts: mcCounts(), status: { hookMode: runtime.hookMode, hookError: runtime.hookError } }) }));
    } catch (_) {}
  }

  function mcInstallUnsafeWindowHook() {
    let pageWindow = null;
    try {
      pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : null;
    } catch (_) {}
    if (!pageWindow) return false;

    const pageGuard = '__SIMNET_MAP_CAPTURE_UNSAFEWINDOW_V2__';
    try {
      if (pageWindow[pageGuard]) {
        runtime.hookMode = 'unsafeWindow';
        runtime.hookError = '';
        return true;
      }

      const classify = rawUrl => {
        try {
          const url = new URL(String(rawUrl || ''), location.href);
          if (/maps\.googleapis\.com$/i.test(url.hostname) && /\/maps\/api\/geocode\/json$/i.test(url.pathname)) return true;
          if (url.hostname !== location.hostname) return false;
          return ['/map/ajax_find', '/map/request_by_ws', '/map/load_from_ws', '/map/tooltip'].includes(url.pathname);
        } catch (_) { return false; }
      };

      const emitCapture = (transport, method, rawUrl, status, ok, body) => {
        if (!classify(rawUrl)) return;
        let prepared = String(body || '');
        try {
          const url = new URL(String(rawUrl || ''), location.href);
          if (url.pathname === '/map/load_from_ws') {
            const parsed = JSON.parse(prepared || '{}');
            const all = Array.isArray(parsed.features) ? parsed.features : [];
            const chosen = all.filter(feature => {
              const type = String(feature && feature.properties && feature.properties.type || '');
              return type === 'house' || type === 'node';
            }).slice(0, 1800);
            prepared = JSON.stringify({
              type: parsed.type || 'FeatureCollection',
              features: chosen,
              __capture: {
                originalFeatureCount: all.length,
                selectedFeatureCount: chosen.length,
                exportedFeatureCount: chosen.length,
                truncated: all.length > 1800,
              },
            });
          } else {
            prepared = prepared.slice(0, 500000);
          }
        } catch (_) {
          prepared = prepared.slice(0, 500000);
        }
        mcAdd({
          at: mcNowIso(),
          transport,
          method: String(method || 'GET').toUpperCase(),
          url: new URL(String(rawUrl || ''), location.href).toString(),
          status: Number(status || 0),
          ok: Boolean(ok),
          body: prepared,
        });
      };

      const originalFetch = pageWindow.fetch;
      if (typeof originalFetch === 'function' && !originalFetch.__simnetMapCaptureV2) {
        const wrappedFetch = function(...args) {
          const input = args[0];
          const init = args[1] || {};
          const rawUrl = typeof input === 'string' ? input : input && input.url || '';
          const method = String(init.method || input && input.method || 'GET').toUpperCase();
          const promise = originalFetch.apply(this, args);
          Promise.resolve(promise).then(response => {
            if (!classify(rawUrl)) return;
            try {
              response.clone().text().then(text => emitCapture('fetch', method, rawUrl, response.status, response.ok, text)).catch(() => {});
            } catch (_) {}
          }).catch(() => {});
          return promise;
        };
        wrappedFetch.__simnetMapCaptureV2 = true;
        pageWindow.fetch = wrappedFetch;
      }

      const proto = pageWindow.XMLHttpRequest && pageWindow.XMLHttpRequest.prototype;
      if (proto && !proto.__simnetMapCaptureV2) {
        const originalOpen = proto.open;
        const originalSend = proto.send;
        proto.open = function(method, rawUrl, ...rest) {
          this.__simnetMapCaptureV2Meta = { method: String(method || 'GET').toUpperCase(), url: String(rawUrl || '') };
          return originalOpen.call(this, method, rawUrl, ...rest);
        };
        proto.send = function(...args) {
          const xhr = this;
          xhr.addEventListener('loadend', () => {
            const meta = xhr.__simnetMapCaptureV2Meta || { method: 'GET', url: '' };
            if (!classify(meta.url)) return;
            let body = '';
            try {
              if (!xhr.responseType || xhr.responseType === 'text') body = String(xhr.responseText || '');
              else if (xhr.responseType === 'json') body = JSON.stringify(xhr.response || null);
            } catch (_) {}
            emitCapture('xhr', meta.method, meta.url, xhr.status, xhr.status >= 200 && xhr.status < 400, body);
          }, { once: true });
          return originalSend.apply(this, args);
        };
        proto.__simnetMapCaptureV2 = true;
      }

      pageWindow[pageGuard] = true;
      runtime.hookMode = 'unsafeWindow';
      runtime.hookError = '';
      mcRenderPanel();
      return true;
    } catch (error) {
      runtime.hookError = String(error && error.message || error || 'unsafeWindow failed').slice(0, 160);
      mcRenderPanel();
      return false;
    }
  }

  function mcInjectPageHook() {
    if (document.documentElement.dataset.simnetMapCaptureHook === '1') return true;
    document.documentElement.dataset.simnetMapCaptureHook = '1';

    const source = `(() => {
      'use strict';
      const GUARD = '__SIMNET_MAP_CAPTURE_PAGE_HOOK_V2__';
      if (window[GUARD]) return;
      window[GUARD] = true;
      const EVENT_NAME = ${JSON.stringify(PAGE_EVENT)};
      const MAX_GENERIC_BODY = 500000;
      const MAX_MAP_FEATURES = 1800;

      const classify = rawUrl => {
        try {
          const url = new URL(String(rawUrl || ''), location.href);
          if (/maps\\.googleapis\\.com$/i.test(url.hostname) && /\\/maps\\/api\\/geocode\\/json$/i.test(url.pathname)) return 'geocode';
          if (url.hostname !== location.hostname) return '';
          if (url.pathname === '/map/ajax_find') return 'map-find';
          if (url.pathname === '/map/request_by_ws') return 'map-window-request';
          if (url.pathname === '/map/load_from_ws') return 'map-features';
          if (url.pathname === '/map/tooltip') return 'map-tooltip';
        } catch (_) {}
        return '';
      };

      const compactMapFeatures = text => {
        try {
          const parsed = JSON.parse(String(text || ''));
          const features = Array.isArray(parsed.features) ? parsed.features : [];
          const selected = features.filter(feature => {
            const type = String(feature && feature.properties && feature.properties.type || '');
            return type === 'house' || type === 'node';
          });
          const limited = selected.slice(0, MAX_MAP_FEATURES);
          return JSON.stringify({
            type: parsed.type || 'FeatureCollection',
            features: limited,
            __capture: {
              originalFeatureCount: features.length,
              selectedFeatureCount: selected.length,
              exportedFeatureCount: limited.length,
              truncated: selected.length > limited.length
            }
          });
        } catch (_) {
          return String(text || '').slice(0, MAX_GENERIC_BODY);
        }
      };

      const prepareBody = (kind, text) => {
        const raw = String(text || '');
        if (kind === 'map-features') return compactMapFeatures(raw);
        if (kind === 'geocode') return raw.slice(0, 500000);
        return raw.slice(0, MAX_GENERIC_BODY);
      };

      const emit = payload => {
        try {
          document.dispatchEvent(new CustomEvent(EVENT_NAME, {
            detail: JSON.stringify(payload)
          }));
        } catch (_) {}
      };

      const capture = (transport, method, rawUrl, status, ok, body) => {
        const kind = classify(rawUrl);
        if (!kind) return;
        emit({
          at: new Date().toISOString(),
          transport,
          method: String(method || 'GET').toUpperCase(),
          url: new URL(String(rawUrl || ''), location.href).toString(),
          status: Number(status || 0),
          ok: Boolean(ok),
          body: prepareBody(kind, body)
        });
      };

      try {
        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function' && !originalFetch.__simnetMapCaptureWrapped) {
          const wrappedFetch = function(...args) {
            const input = args[0];
            const init = args[1] || {};
            const rawUrl = typeof input === 'string' ? input : input && input.url || '';
            const method = String(init.method || input && input.method || 'GET').toUpperCase();
            const promise = originalFetch.apply(this, args);
            Promise.resolve(promise).then(response => {
              if (!classify(rawUrl)) return;
              try {
                const clone = response.clone();
                clone.text().then(text => capture('fetch', method, rawUrl, response.status, response.ok, text)).catch(() => {});
              } catch (_) {}
            }).catch(() => {});
            return promise;
          };
          wrappedFetch.__simnetMapCaptureWrapped = true;
          window.fetch = wrappedFetch;
        }
      } catch (_) {}

      try {
        const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
        if (proto && !proto.__simnetMapCaptureWrapped) {
          const originalOpen = proto.open;
          const originalSend = proto.send;
          proto.open = function(method, rawUrl, ...rest) {
            this.__simnetMapCaptureMeta = { method: String(method || 'GET').toUpperCase(), url: String(rawUrl || '') };
            return originalOpen.call(this, method, rawUrl, ...rest);
          };
          proto.send = function(...args) {
            const xhr = this;
            xhr.addEventListener('loadend', () => {
              const meta = xhr.__simnetMapCaptureMeta || { method: 'GET', url: '' };
              if (!classify(meta.url)) return;
              let body = '';
              try {
                if (!xhr.responseType || xhr.responseType === 'text') body = String(xhr.responseText || '');
                else if (xhr.responseType === 'json') body = JSON.stringify(xhr.response || null);
              } catch (_) {}
              capture('xhr', meta.method, meta.url, xhr.status, xhr.status >= 200 && xhr.status < 400, body);
            }, { once: true });
            return originalSend.apply(this, args);
          };
          proto.__simnetMapCaptureWrapped = true;
        }
      } catch (_) {}
    })();`;

    try {
      const script = document.createElement('script');
      script.textContent = source;
      (document.documentElement || document.head).appendChild(script);
      script.remove();
      runtime.hookMode = 'page-hook';
      runtime.hookError = '';
      mcRenderPanel();
      return true;
    } catch (error) {
      runtime.hookError = String(error && error.message || error || 'inject failed').slice(0, 160);
      mcRenderPanel();
      return false;
    }
  }

  document.addEventListener(PAGE_EVENT, event => {
    const payload = mcSafeJsonParse(event && event.detail);
    if (payload) mcAdd(payload);
  });

  window.addEventListener('popstate', mcRenderPanel);
  window.addEventListener('hashchange', mcRenderPanel);

  void mcLoad();
  mcRenderPanel();

  const hookedByUnsafeWindow = mcInstallUnsafeWindowHook();
  if (!hookedByUnsafeWindow && !mcInjectPageHook()) {
    let attempts = 0;
    runtime.installTimer = window.setInterval(() => {
      attempts += 1;
      if (mcInstallUnsafeWindowHook() || mcInjectPageHook() || attempts >= 40) {
        window.clearInterval(runtime.installTimer);
        runtime.installTimer = 0;
        if (attempts >= 40 && runtime.hookMode === 'ожидание') {
          runtime.hookError = runtime.hookError || 'перехватчик не установился';
          mcRenderPanel();
        }
      }
    }, 250);
  }

  window.addEventListener('pagehide', () => {
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
  }, { once: true });
})();

/* ============================================================================
 * ISOLATED MODULE: USERSIDE SEARCH RADAR + GEOGRAPHIC OLT INVESTIGATION
 * Version: geo-radar.1
 *
 * Источник точки: только конечный центр штатного окна карты UserSide после
 * нажатия штатной кнопки «Найти». Геокодер, tooltip соседнего дома и название
 * другой улицы не имеют права заменить эту точку.
 * ========================================================================== */
(function simnetUserSideRadarModuleSafeBoot() {
  'use strict';

  const VERSION = 'geo-radar.1';
  const GUARD_KEY = '__SIMNET_USERSIDE_RADAR_500M_V3__';
  const PANEL_ID = 'simnet-map-investigation-panel-v3';
  const LAUNCHER_ID = 'simnet-map-investigation-launcher-v3';
  const RADAR_ID = 'simnet-userside-radar-500m-v3';
  const STYLE_ID = 'simnet-userside-radar-style-v3';
  const UI_KEY = 'simnet_geo_radar_ui_v3';
  const SEARCH_KEY = 'SIMNET_USERSIDE_MAP_LAST_SEARCH_V2';
  const ANCHOR_KEY = 'SIMNET_USERSIDE_MAP_LAST_ANCHOR_V2';
  const REPORT_KEY = 'SIMNET_GEO_OLT_LAST_REPORT_V2';
  const CAPTURE_API_KEY = '__SIMNET_MAP_CAPTURE_API_V3__';
  const CAPTURE_STORAGE_KEY = 'SIMNET_MAP_EVIDENCE_CAPTURE_V2';
  const CAPTURE_EVENT = 'simnet-map-capture-state-v3';
  const BASE = 'https://userside.simnet.kiev.ua';
  const RADIUS_METERS = 500;
  const MAX_REQUESTS = 64;
  const HOUSE_TOOLTIP_LIMIT = 20;
  const HOUSE_SEARCH_LIMIT = 12;
  const CARD_LIMIT = 18;
  const CONCURRENCY = 2;

  function text(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nowIso() { return new Date().toISOString(); }
  function parseHtml(raw) { return new DOMParser().parseFromString(String(raw || ''), 'text/html'); }
  function safeJson(raw) { try { return JSON.parse(String(raw || '')); } catch (_) { return null; } }

  function safeGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, fallback);
        return value == null ? fallback : value;
      }
    } catch (_) {}
    return fallback;
  }

  function safeSet(key, value) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, value); } catch (_) {}
  }

  function safeDelete(key) {
    try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (_) {}
  }

  function unique(items, keyFn) {
    const output = [];
    const seen = new Set();
    for (const item of items || []) {
      const key = String(keyFn(item));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function parsePair(raw) {
    const match = String(raw || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function windowBounds(item) {
    if (!item || item.kind !== 'map-window-request') return null;
    let ne = parsePair(item.request && item.request.ne);
    let sw = parsePair(item.request && item.request.sw);
    let zoom = Number(item.request && item.request.zoom || 0) || null;
    if (!ne || !sw) {
      try {
        const url = new URL(String(item.url || ''), location.href);
        ne = parsePair(url.searchParams.get('ne'));
        sw = parsePair(url.searchParams.get('sw'));
        zoom = zoom || Number(url.searchParams.get('zoom') || 0) || null;
      } catch (_) {}
    }
    if (!ne || !sw || ne.lat <= sw.lat || ne.lng <= sw.lng) return null;
    return {
      ne,
      sw,
      zoom,
      center: { lat: (ne.lat + sw.lat) / 2, lng: (ne.lng + sw.lng) / 2 },
    };
  }

  function distanceMeters(left, right) {
    if (!left || !right) return Infinity;
    const lat1 = Number(left.lat);
    const lng1 = Number(left.lng);
    const lat2 = Number(right.lat);
    const lng2 = Number(right.lng);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function centroid(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const points = [];
    const walk = value => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        points.push({ lng: Number(value[0]), lat: Number(value[1]) });
        return;
      }
      value.forEach(walk);
    };
    walk(geometry.coordinates);
    if (!points.length) return null;
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
  }

  function captureApi() {
    try { return window[CAPTURE_API_KEY] || globalThis[CAPTURE_API_KEY] || null; } catch (_) { return null; }
  }

  function captureItems() {
    try {
      const api = captureApi();
      if (api && typeof api.getItems === 'function') {
        const items = api.getItems();
        if (Array.isArray(items)) return items;
      }
    } catch (_) {}
    const stored = safeGet(CAPTURE_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored : [];
  }

  function captureCounts(items) {
    const counts = { geocode: 0, windows: 0, features: 0, houses: 0, observations: 0, tooltips: 0 };
    const houses = new Set();
    for (const item of items || []) {
      if (!item) continue;
      if (item.kind === 'geocode') counts.geocode += 1;
      if (item.kind === 'map-window-request') counts.windows += 1;
      if (item.kind === 'map-features') {
        counts.features += 1;
        const response = item.response && typeof item.response === 'object' ? item.response : safeJson(item.response);
        const features = Array.isArray(response && response.features) ? response.features : [];
        for (const feature of features) {
          if (text(feature && feature.properties && feature.properties.type) !== 'house') continue;
          const id = feature && feature.properties && feature.properties.id;
          if (id == null) continue;
          houses.add(String(id));
          counts.observations += 1;
        }
      }
      if (item.kind === 'house-tooltip') counts.tooltips += 1;
    }
    counts.houses = houses.size;
    return counts;
  }

  function latestWindow(items) {
    const windows = (items || [])
      .filter(item => item && item.kind === 'map-window-request')
      .map(item => ({ item, bounds: windowBounds(item), ts: Date.parse(String(item.at || '')) || 0 }))
      .filter(entry => entry.bounds)
      .sort((a, b) => a.ts - b.ts);
    return windows.length ? windows[windows.length - 1] : null;
  }

  function mapContainer() {
    const candidates = [];
    const push = node => {
      if (!node || node.nodeType !== 1 || node.id === RADAR_ID || (node.closest && node.closest('#' + PANEL_ID))) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 180) return;
      candidates.push({ node, area: rect.width * rect.height });
    };
    try { document.querySelectorAll('.leaflet-container').forEach(push); } catch (_) {}
    try { push(document.getElementById('map')); } catch (_) {}
    try {
      document.querySelectorAll('[id]').forEach(node => {
        const id = String(node.id || '').toLowerCase();
        if (id.includes('map')) push(node);
      });
    } catch (_) {}
    candidates.sort((a, b) => b.area - a.area);
    return candidates.length ? candidates[0].node : null;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{position:fixed;left:8px;top:72px;width:min(390px,calc(100vw - 16px));max-height:calc(100vh - 84px);z-index:2147483644;display:flex;flex-direction:column;background:#fff;color:#17202a;border:1px solid #8ea4b8;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.32);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #${PANEL_ID}[hidden]{display:none!important}
      #${PANEL_ID} .gr-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;background:#17365d;color:#fff;touch-action:none;cursor:move}
      #${PANEL_ID} .gr-title{display:flex;gap:7px;align-items:baseline;min-width:0}#${PANEL_ID} .gr-title b{font-size:13px}#${PANEL_ID} .gr-title small{opacity:.75}
      #${PANEL_ID} .gr-head button{width:28px;height:26px;border:1px solid rgba(255,255,255,.35);border-radius:6px;background:rgba(255,255,255,.12);color:#fff;font-weight:700}
      #${PANEL_ID} .gr-body{padding:9px;overflow:auto}#${PANEL_ID}.collapsed .gr-body{display:none}
      #${PANEL_ID} .gr-status{padding:7px 8px;border-radius:7px;background:#edf4fa;border:1px solid #c9d8e6;margin-bottom:7px}
      #${PANEL_ID} .gr-status.ok{background:#eaf8ef;border-color:#8fd0a7}#${PANEL_ID} .gr-status.error{background:#fff0ef;border-color:#e59a94}#${PANEL_ID} .gr-status.running{background:#fff8df;border-color:#e4c765}
      #${PANEL_ID} .gr-detail{font-size:11px;color:#475467;margin-top:3px;overflow-wrap:anywhere}
      #${PANEL_ID} .gr-counts{font-size:11px;color:#344054;margin:6px 0}
      #${PANEL_ID} .gr-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}#${PANEL_ID} .gr-actions button{border:1px solid #9fb2c5;border-radius:7px;background:#f7f9fb;padding:6px 8px;color:#183b5b;font-weight:700}
      #${PANEL_ID} .gr-actions .primary{background:#1769aa;color:#fff;border-color:#1769aa}#${PANEL_ID} .gr-actions .stop{background:#b42318;color:#fff;border-color:#b42318}
      #${PANEL_ID} .gr-anchor{padding:7px 8px;background:#0b2535;color:#ecfdf5;border-radius:8px;margin:7px 0;overflow-wrap:anywhere}#${PANEL_ID} .gr-anchor code{color:#a7f3d0}
      #${PANEL_ID} .gr-card{border:1px solid #d0d9e2;border-radius:8px;padding:7px;margin-top:7px;background:#f8fafc}#${PANEL_ID} .gr-card.primary{border-color:#15803d;background:#eefbf2}
      #${PANEL_ID} .gr-card-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap}#${PANEL_ID} .gr-card-head code{background:#e7eef5;padding:1px 4px;border-radius:4px}
      #${PANEL_ID} .gr-metrics{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}#${PANEL_ID} .gr-metrics span{background:#e9eef3;padding:2px 5px;border-radius:5px;font-size:11px}
      #${PANEL_ID} details{margin-top:7px;border:1px solid #d8e0e8;border-radius:7px;padding:5px;background:#fff}#${PANEL_ID} summary{cursor:pointer;font-weight:700}
      #${LAUNCHER_ID}{position:fixed;left:8px;top:72px;z-index:2147483645;border:1px solid #0f766e;border-radius:8px;background:#0f766e;color:#fff;padding:7px 10px;font:700 12px Arial,sans-serif;box-shadow:0 5px 18px rgba(0,0,0,.3)}#${LAUNCHER_ID}[hidden]{display:none!important}
      #${RADAR_ID}{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:950!important}
      #${RADAR_ID}[hidden]{display:none!important}
      #${RADAR_ID} .gr-ring{position:absolute;border:2px solid rgba(5,150,105,.95);border-radius:50%;box-sizing:border-box;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(255,255,255,.62),0 0 22px rgba(16,185,129,.58),inset 0 0 20px rgba(16,185,129,.11)}
      #${RADAR_ID} .gr-ring.minor{border-width:1px;border-color:rgba(5,150,105,.52);box-shadow:none}
      #${RADAR_ID} .gr-axis{position:absolute;background:rgba(5,150,105,.45);transform:translate(-50%,-50%)}#${RADAR_ID} .gr-axis.h{height:1px}#${RADAR_ID} .gr-axis.v{width:1px}
      #${RADAR_ID} .gr-center{position:absolute;width:15px;height:15px;border-radius:50%;transform:translate(-50%,-50%);background:#10b981;border:3px solid #fff;box-shadow:0 0 0 2px #047857,0 0 20px rgba(16,185,129,.95)}
      #${RADAR_ID} .gr-label{position:absolute;transform:translate(-50%,-100%);padding:4px 7px;border-radius:6px;background:rgba(5,31,42,.92);border:1px solid #34d399;color:#ecfdf5;font:700 11px/1.2 Arial,sans-serif;white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,.35)}
      #${RADAR_ID} .gr-distance{position:absolute;transform:translate(-50%,-50%);padding:1px 4px;border-radius:4px;background:rgba(255,255,255,.9);color:#047857;font:700 10px Arial,sans-serif}
      @media(max-width:600px){#${PANEL_ID}{left:6px;top:58px;width:calc(100vw - 12px);max-height:calc(100vh - 66px)}#${LAUNCHER_ID}{left:6px;top:58px}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const previous = (() => { try { return window[GUARD_KEY]; } catch (_) { return null; } })();
  if (previous && previous.version === VERSION && previous.ready) return;
  if (previous && typeof previous.destroy === 'function') {
    try { previous.destroy(); } catch (_) {}
  }

  const runtime = {
    ready: false,
    running: false,
    runId: 0,
    requests: 0,
    stage: 'Ожидает штатного поиска адреса',
    detail: 'Открой поиск на карте UserSide, введи точный адрес и нажми «Найти».',
    progress: '',
    pending: safeGet(SEARCH_KEY, null),
    anchor: safeGet(ANCHOR_KEY, null),
    report: safeGet(REPORT_KEY, null),
    errors: [],
    handles: new Set(),
    timers: new Set(),
    lastWindowFingerprint: '',
    lastWindowChangedAt: 0,
    destroyed: false,
  };

  let ui = safeGet(UI_KEY, null);
  if (!ui || ui.version !== VERSION) {
    ui = { version: VERSION, hidden: false, collapsed: false, left: 8, top: 72 };
    safeSet(UI_KEY, ui);
  } else {
    ui = {
      version: VERSION,
      hidden: Boolean(ui.hidden),
      collapsed: Boolean(ui.collapsed),
      left: Number.isFinite(Number(ui.left)) ? Number(ui.left) : 8,
      top: Number.isFinite(Number(ui.top)) ? Number(ui.top) : 72,
    };
  }

  function saveUi() { safeSet(UI_KEY, ui); }

  function setTimer(callback, delay) {
    const id = window.setTimeout(() => {
      runtime.timers.delete(id);
      if (!runtime.destroyed) callback();
    }, delay);
    runtime.timers.add(id);
    return id;
  }

  function applyUi(panel) {
    if (!panel) return;
    panel.hidden = Boolean(ui.hidden);
    panel.classList.toggle('collapsed', Boolean(ui.collapsed));
    panel.style.left = Math.max(4, Math.min(Number(ui.left) || 8, Math.max(4, window.innerWidth - 120))) + 'px';
    panel.style.top = Math.max(4, Math.min(Number(ui.top) || 72, Math.max(4, window.innerHeight - 60))) + 'px';
    const launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) launcher.hidden = !ui.hidden;
  }

  function installDrag(panel) {
    if (!panel || panel.dataset.dragInstalled === '1') return;
    panel.dataset.dragInstalled = '1';
    let drag = null;
    const move = event => {
      if (!drag || event.pointerId !== drag.id) return;
      ui.left = drag.left + event.clientX - drag.x;
      ui.top = drag.top + event.clientY - drag.y;
      applyUi(panel);
      event.preventDefault();
    };
    const stop = event => {
      if (!drag || (event && event.pointerId != null && event.pointerId !== drag.id)) return;
      drag = null;
      saveUi();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
    };
    panel.addEventListener('pointerdown', event => {
      const head = event.target && event.target.closest ? event.target.closest('.gr-head') : null;
      if (!head || (event.target.closest && event.target.closest('button')) || event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', stop, true);
      window.addEventListener('pointercancel', stop, true);
      event.preventDefault();
    });
  }

  function ensurePanel() {
    installStyle();
    ['simnet-map-capture-panel-v2', 'simnet-geo-olt-panel-v1', 'simnet-map-investigation-panel-v2'].forEach(id => {
      const old = document.getElementById(id);
      if (old) old.remove();
    });
    let launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) {
      launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.id = LAUNCHER_ID;
      launcher.textContent = 'Карта / OLT';
      launcher.addEventListener('click', () => {
        ui.hidden = false;
        saveUi();
        render();
      });
      (document.body || document.documentElement).appendChild(launcher);
    }
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      (document.body || document.documentElement).appendChild(panel);
      panel.addEventListener('click', event => {
        const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'run') runInvestigation();
        else if (action === 'stop') abortRun('Остановлено оператором');
        else if (action === 'export') exportReport();
        else if (action === 'capture-export') {
          const api = captureApi();
          if (api && typeof api.exportEvidence === 'function') api.exportEvidence();
        } else if (action === 'clear') {
          if (!window.confirm('Очистить точку радара, результат и захват карты?')) return;
          runtime.pending = null;
          runtime.anchor = null;
          runtime.report = null;
          runtime.stage = 'Ожидает штатного поиска адреса';
          runtime.detail = 'Введи точный адрес в штатном поиске UserSide.';
          safeDelete(SEARCH_KEY);
          safeDelete(ANCHOR_KEY);
          safeDelete(REPORT_KEY);
          const radar = document.getElementById(RADAR_ID);
          if (radar) radar.remove();
          const api = captureApi();
          Promise.resolve(api && typeof api.clear === 'function' ? api.clear() : null).finally(render);
        } else if (action === 'collapse') {
          ui.collapsed = !ui.collapsed;
          saveUi();
          render();
        } else if (action === 'hide') {
          ui.hidden = true;
          saveUi();
          applyUi(panel);
        } else if (action === 'reset') {
          ui = { version: VERSION, hidden: false, collapsed: false, left: 8, top: 72 };
          saveUi();
          render();
        }
      });
      installDrag(panel);
    }
    applyUi(panel);
    return panel;
  }

  function reportHtml(report) {
    if (!report) return '';
    const candidates = Array.isArray(report.oltCandidates) ? report.oltCandidates : [];
    const cards = candidates.length ? candidates.map((candidate, index) => `
      <div class="gr-card ${index === 0 ? 'primary' : ''}">
        <div class="gr-card-head"><b>${index + 1}. ${escapeHtml(candidate.name || ('OLT ' + candidate.deviceId))}</b>${candidate.ip ? `<code>${escapeHtml(candidate.ip)}</code>` : ''}</div>
        <div class="gr-metrics"><span>подтверждений ${candidate.count}</span><span>домов ${candidate.houseCount}</span><span>улиц ${candidate.streetCount}</span><span>средняя дистанция ${Math.round(candidate.averageDistanceMeters)} м</span></div>
        ${candidate.interfaces.length ? `<div class="gr-detail">PON: ${escapeHtml(candidate.interfaces.slice(0, 6).join(', '))}</div>` : ''}
        ${candidate.addresses.length ? `<div class="gr-detail">Адреса: ${escapeHtml(candidate.addresses.slice(0, 4).join(' | '))}</div>` : ''}
      </div>`).join('') : '<div class="gr-card">Явные привязки «Найдено на OLT» в проверенных карточках не обнаружены.</div>';
    return `
      <div class="gr-anchor"><b>Исходная точка не менялась:</b><br>${escapeHtml(report.anchor.address)}<br><code>${Number(report.anchor.center.lat).toFixed(6)}, ${Number(report.anchor.center.lng).toFixed(6)}</code> · радиус ${RADIUS_METERS} м</div>
      <div class="gr-detail">В круге полигонов: ${report.sample.polygonsInRadius} · tooltip: ${report.sample.tooltipsChecked} · домов: ${report.sample.housesSelected.length} · карточек: ${report.subscribers.cardsChecked} · OLT: ${report.subscribers.verifiedOlt}</div>
      ${cards}
      <details><summary>Проверенные дома</summary><ul>${report.sample.housesSelected.map(house => `<li>${Math.round(house.distanceMeters)} м · ${escapeHtml(house.address || ('house ' + house.id))}</li>`).join('')}</ul></details>
      <details><summary>Принцип работы</summary><ul><li>Точка — центр конечного окна штатного поиска UserSide.</li><li>Ни один соседний дом не заменяет точку.</li><li>Отбор выполняется только внутри 500 м.</li><li>Итоговые OLT — кандидаты до живого опроса Billing.</li></ul></details>`;
  }

  function render() {
    try {
      const panel = ensurePanel();
      const items = captureItems();
      const counts = captureCounts(items);
      const anchor = runtime.anchor;
      const className = runtime.errors.length && /ошиб/i.test(runtime.stage) ? 'error' : runtime.running ? 'running' : anchor ? 'ok' : '';
      panel.innerHTML = `
        <div class="gr-head">
          <div class="gr-title"><b>Карта / расследование OLT</b><small>${VERSION}</small></div>
          <div><button data-action="reset" title="Сбросить положение">↺</button><button data-action="collapse" title="Свернуть">${ui.collapsed ? '□' : '—'}</button><button data-action="hide" title="Скрыть">×</button></div>
        </div>
        <div class="gr-body">
          <div class="gr-status ${className}"><b>${escapeHtml(runtime.stage)}</b><div class="gr-detail">${escapeHtml(runtime.detail)}</div>${runtime.progress ? `<div class="gr-detail">${escapeHtml(runtime.progress)} · GET ${runtime.requests}/${MAX_REQUESTS}</div>` : ''}</div>
          <div class="gr-counts">окна ${counts.windows} · ответы ${counts.features} · дома ${counts.houses} · наблюдения ${counts.observations} · tooltip ${counts.tooltips}</div>
          ${anchor && anchor.center ? `<div class="gr-anchor"><b>Зафиксировано штатным поиском:</b><br>${escapeHtml(anchor.address)}<br><code>${Number(anchor.center.lat).toFixed(6)}, ${Number(anchor.center.lng).toFixed(6)}</code> · радар ${RADIUS_METERS} м</div>` : runtime.pending ? `<div class="gr-anchor">Ожидаю конечное положение карты для:<br><b>${escapeHtml(runtime.pending.address)}</b></div>` : ''}
          <div class="gr-actions"><button class="primary" data-action="run" ${runtime.running || !anchor ? 'disabled' : ''}>Разобрать радиус 500 м</button><button class="stop" data-action="stop" ${runtime.running ? '' : 'disabled'}>СТОП</button><button data-action="export" ${runtime.report ? '' : 'disabled'}>Экспорт результата</button></div>
          <div class="gr-actions"><button data-action="capture-export">Экспорт захвата</button><button data-action="clear">Очистить</button></div>
          ${reportHtml(runtime.report)}
        </div>`;
      applyUi(panel);
    } catch (error) {
      try { console.error('[SIMNET geo-radar] render error', error); } catch (_) {}
    }
  }

  function radarRender() {
    try {
      installStyle();
      const anchor = runtime.anchor;
      const container = mapContainer();
      if (!anchor || !anchor.center || !container) {
        const old = document.getElementById(RADAR_ID);
        if (old) old.remove();
        return false;
      }
      const current = latestWindow(captureItems());
      const bounds = current && current.bounds ? current.bounds : anchor.bounds;
      if (!bounds) return false;
      let overlay = document.getElementById(RADAR_ID);
      if (!overlay || overlay.parentElement !== container) {
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = RADAR_ID;
        const computed = window.getComputedStyle ? window.getComputedStyle(container) : null;
        if (!computed || computed.position === 'static') container.style.position = 'relative';
        container.appendChild(overlay);
      }
      const width = Math.max(1, Number(container.clientWidth) || container.getBoundingClientRect().width || 1);
      const height = Math.max(1, Number(container.clientHeight) || container.getBoundingClientRect().height || 1);
      const lngSpan = bounds.ne.lng - bounds.sw.lng;
      const latSpan = bounds.ne.lat - bounds.sw.lat;
      if (!(lngSpan > 0) || !(latSpan > 0)) return false;
      const x = (Number(anchor.center.lng) - bounds.sw.lng) / lngSpan * width;
      const y = (bounds.ne.lat - Number(anchor.center.lat)) / latSpan * height;
      const horizontalMeters = distanceMeters({ lat: Number(anchor.center.lat), lng: bounds.sw.lng }, { lat: Number(anchor.center.lat), lng: bounds.ne.lng });
      const verticalMeters = distanceMeters({ lat: bounds.sw.lat, lng: Number(anchor.center.lng) }, { lat: bounds.ne.lat, lng: Number(anchor.center.lng) });
      const radiusPx = RADIUS_METERS * (((width / Math.max(1, horizontalMeters)) + (height / Math.max(1, verticalMeters))) / 2);
      const visible = x >= -radiusPx && x <= width + radiusPx && y >= -radiusPx && y <= height + radiusPx;
      overlay.hidden = !visible;
      if (!visible) return false;
      const ring = fraction => {
        const diameter = radiusPx * 2 * fraction;
        return `left:${x}px;top:${y}px;width:${diameter}px;height:${diameter}px`;
      };
      overlay.innerHTML = `
        <div class="gr-ring" style="${ring(1)}"></div>
        <div class="gr-ring minor" style="${ring(.75)}"></div>
        <div class="gr-ring minor" style="${ring(.5)}"></div>
        <div class="gr-ring minor" style="${ring(.25)}"></div>
        <div class="gr-axis h" style="left:${x}px;top:${y}px;width:${radiusPx * 2}px"></div>
        <div class="gr-axis v" style="left:${x}px;top:${y}px;height:${radiusPx * 2}px"></div>
        <div class="gr-center" style="left:${x}px;top:${y}px"></div>
        <div class="gr-label" style="left:${x}px;top:${Math.max(25, y - radiusPx - 8)}px">${escapeHtml(anchor.address)} · центр</div>
        <div class="gr-distance" style="left:${x + radiusPx * .25}px;top:${y}px">125 м</div>
        <div class="gr-distance" style="left:${x + radiusPx * .50}px;top:${y}px">250 м</div>
        <div class="gr-distance" style="left:${x + radiusPx * .75}px;top:${y}px">375 м</div>
        <div class="gr-distance" style="left:${x + radiusPx}px;top:${y}px">500 м</div>`;
      return true;
    } catch (error) {
      runtime.errors.push('radar: ' + text(error && error.message || error));
      try { console.error('[SIMNET geo-radar] radar error', error); } catch (_) {}
      return false;
    }
  }

  function searchInputValue() {
    const input = document.getElementById('text_field_id');
    return text(input && input.value || '');
  }

  function beginSearchCapture() {
    const address = searchInputValue();
    if (!address) return false;
    const startedAt = Date.now();
    runtime.pending = {
      schema: 'simnet-userside-map-search-v2',
      searchId: startedAt.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      address,
      startedAt,
      startedAtIso: new Date(startedAt).toISOString(),
    };
    runtime.anchor = null;
    runtime.report = null;
    runtime.lastWindowFingerprint = '';
    runtime.lastWindowChangedAt = startedAt;
    runtime.stage = 'Штатный поиск UserSide запущен';
    runtime.detail = `Жду конечную точку карты для «${address}».`;
    runtime.progress = '';
    safeSet(SEARCH_KEY, runtime.pending);
    safeDelete(ANCHOR_KEY);
    safeDelete(REPORT_KEY);
    const radar = document.getElementById(RADAR_ID);
    if (radar) radar.remove();
    render();
    scheduleAnchorCheck(250);
    return true;
  }

  function scheduleAnchorCheck(delay) { setTimer(checkAnchor, Math.max(150, Number(delay) || 250)); }

  function checkAnchor() {
    try {
      const pending = runtime.pending;
      if (!pending || !pending.startedAt) return;
      const windows = captureItems()
        .filter(item => item && item.kind === 'map-window-request')
        .map(item => ({ item, bounds: windowBounds(item), ts: Date.parse(String(item.at || '')) || 0 }))
        .filter(entry => entry.bounds && entry.ts >= Number(pending.startedAt) - 150)
        .sort((a, b) => a.ts - b.ts);
      if (!windows.length) {
        runtime.detail = `Поиск «${pending.address}» зафиксирован, ожидаю сетевой ответ карты.`;
        render();
        scheduleAnchorCheck(450);
        return;
      }
      const latest = windows[windows.length - 1];
      const fingerprint = [latest.item.at, latest.bounds.ne.lat, latest.bounds.ne.lng, latest.bounds.sw.lat, latest.bounds.sw.lng].join('|');
      if (runtime.lastWindowFingerprint !== fingerprint) {
        runtime.lastWindowFingerprint = fingerprint;
        runtime.lastWindowChangedAt = Date.now();
        runtime.detail = `Карта перемещается к «${pending.address}»…`;
        render();
        scheduleAnchorCheck(650);
        return;
      }
      if (Date.now() - runtime.lastWindowChangedAt < 900) {
        scheduleAnchorCheck(350);
        return;
      }
      runtime.anchor = {
        schema: 'simnet-userside-map-anchor-v2',
        source: 'userside-final-map-window-center-after-native-search',
        address: pending.address,
        searchId: pending.searchId,
        searchAt: pending.startedAtIso,
        searchTimestamp: pending.startedAt,
        windowAt: latest.item.at,
        center: latest.bounds.center,
        bounds: { ne: latest.bounds.ne, sw: latest.bounds.sw },
        zoom: latest.bounds.zoom,
        radiusMeters: RADIUS_METERS,
        capturedAt: nowIso(),
      };
      safeSet(ANCHOR_KEY, runtime.anchor);
      runtime.stage = 'Точка штатного поиска зафиксирована';
      runtime.detail = `${runtime.anchor.address} → ${runtime.anchor.center.lat.toFixed(6)}, ${runtime.anchor.center.lng.toFixed(6)} · радиус ${RADIUS_METERS} м.`;
      runtime.progress = '';
      radarRender();
      render();
    } catch (error) {
      runtime.stage = 'Ошибка фиксации точки';
      runtime.detail = text(error && error.message || error);
      runtime.errors.push(runtime.detail);
      render();
    }
  }

  function installSearchListeners() {
    document.addEventListener('click', event => {
      const target = event.target && event.target.closest ? event.target.closest('#linkSearchOnAjaxMapId') : null;
      if (target) beginSearchCapture();
    }, true);
    document.addEventListener('submit', event => {
      const form = event.target;
      if (form && form.querySelector && form.querySelector('#text_field_id')) beginSearchCapture();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target && event.target.id === 'text_field_id') beginSearchCapture();
    }, true);
  }

  function featureSet(items, anchor) {
    const startTs = Number(anchor && anchor.searchTimestamp || 0) - 2000;
    const map = new Map();
    for (const item of items || []) {
      if (!item || item.kind !== 'map-features') continue;
      const ts = Date.parse(String(item.at || '')) || 0;
      if (startTs && ts < startTs) continue;
      const response = item.response && typeof item.response === 'object' ? item.response : safeJson(item.response);
      const features = Array.isArray(response && response.features) ? response.features : [];
      for (const feature of features) {
        const type = text(feature && feature.properties && feature.properties.type);
        const id = feature && feature.properties && feature.properties.id;
        if (!type || id == null) continue;
        const center = centroid(feature.geometry);
        if (!center) continue;
        map.set(type + ':' + id, { type, id: String(id), center, geometry: feature.geometry, properties: feature.properties || {} });
      }
    }
    return Array.from(map.values());
  }

  function request(url, runId, timeout) {
    if (runId !== runtime.runId) return Promise.reject(new Error('остановлено'));
    if (runtime.requests >= MAX_REQUESTS) return Promise.reject(new Error('достигнут лимит ' + MAX_REQUESTS + ' GET'));
    runtime.requests += 1;
    render();
    return new Promise((resolve, reject) => {
      let handle = null;
      const cleanup = () => { if (handle) runtime.handles.delete(handle); };
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: timeout || 15000,
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          onload: response => {
            cleanup();
            if (runId !== runtime.runId) return reject(new Error('остановлено'));
            if (response.status >= 200 && response.status < 400) resolve(String(response.responseText || ''));
            else reject(new Error('HTTP ' + response.status));
          },
          onerror: () => { cleanup(); reject(new Error('network error')); },
          ontimeout: () => { cleanup(); reject(new Error('timeout')); },
          onabort: () => { cleanup(); reject(new Error('остановлено')); },
        });
        runtime.handles.add(handle);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async function mapLimit(items, limit, worker) {
    const output = new Array(items.length);
    let index = 0;
    async function runner() {
      while (index < items.length) {
        const current = index++;
        output[current] = await worker(items[current], current);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return output;
  }

  function parseHouseTooltip(raw, feature, anchor) {
    const doc = parseHtml(raw);
    const bold = doc.querySelector('b');
    const address = text(bold && bold.textContent || '').replace(/\s+#\d+\s*$/, '');
    const body = text(doc.body && doc.body.textContent || raw);
    const count = body.match(/абонентов\s*:\s*(\d+)/i);
    return {
      id: feature.id,
      address,
      subscribers: count ? Number(count[1]) : null,
      center: feature.center,
      distanceMeters: distanceMeters(anchor.center, feature.center),
    };
  }

  function customerRows(raw, house) {
    const doc = parseHtml(raw);
    const rows = [];
    const links = Array.from(doc.querySelectorAll('a[href*="/customer/"]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const idMatch = href.match(/\/customer\/(\d+)/);
      if (!idMatch) continue;
      const row = link.closest('tr') || link.closest('.table_item') || link.parentElement;
      const rowText = text(row && row.textContent || link.textContent || '');
      const contractMatch = rowText.match(/\b(?:abon)?(\d{4,14})\b/i);
      rows.push({
        customerId: idMatch[1],
        contract: contractMatch ? contractMatch[1] : '',
        address: house.address,
        houseId: house.id,
        houseCenter: house.center,
        distanceMeters: house.distanceMeters,
      });
    }
    return unique(rows, item => item.customerId);
  }

  function explicitOlt(raw, subscriber) {
    const doc = parseHtml(raw);
    const bodyText = text(doc.body && doc.body.textContent || '');
    if (!/(?:Найдено|Знайдено)\s+на\s+OLT/i.test(bodyText)) return null;
    const links = Array.from(doc.querySelectorAll('a[href*="/device/"]'));
    const candidates = [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const idMatch = href.match(/\/device\/(\d+)/);
      if (!idMatch) continue;
      let node = link;
      let context = '';
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const value = text(node.textContent || '');
        if (value.length > 3000) break;
        if (/(?:Найдено|Знайдено)\s+на\s+OLT/i.test(value)) context = value;
        if (context && /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./.test(context)) break;
      }
      if (!context) continue;
      const ip = (context.match(/\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3})\b/) || [])[0] || '';
      const iface = (context.match(/\b(?:gpon|epon|xgpon|xgspon|xpon)\s*\d+(?:\s*\/\s*\d+){1,3}(?::\d+)?\b/i) || [])[0] || '';
      const name = text(link.textContent || '');
      let score = 0;
      if (/(?:Найдено|Знайдено)\s+на\s+OLT/i.test(context)) score += 200;
      if (ip) score += 100;
      if (iface) score += 80;
      if (/OLT|Huawei|BDCOM|GCOM|MA\d{3,5}|ZTE/i.test(name + ' ' + context)) score += 80;
      candidates.push({ deviceId: idMatch[1], name, ip, interface: iface, context, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < 250) return null;
    return {
      ...best,
      customerId: subscriber.customerId,
      contract: subscriber.contract,
      address: subscriber.address,
      houseId: subscriber.houseId,
      distanceMeters: subscriber.distanceMeters,
    };
  }

  function rankOlts(evidence, checkedCards) {
    const map = new Map();
    for (const item of evidence || []) {
      const key = item.deviceId || item.ip || item.name;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, deviceId: item.deviceId, name: item.name, ip: item.ip, count: 0, houses: new Set(), streets: new Set(), distances: [], interfaces: new Set(), contracts: new Set(), addresses: new Set() });
      const entry = map.get(key);
      entry.count += 1;
      if (item.houseId) entry.houses.add(item.houseId);
      if (item.address) {
        entry.addresses.add(item.address);
        entry.streets.add(text(item.address).replace(/\d.*$/, '').toLowerCase());
      }
      if (Number.isFinite(Number(item.distanceMeters))) entry.distances.push(Number(item.distanceMeters));
      if (item.interface) entry.interfaces.add(item.interface.replace(/\s+/g, ''));
      if (item.contract) entry.contracts.add(item.contract);
    }
    return Array.from(map.values()).map(entry => ({
      deviceId: entry.deviceId,
      name: entry.name,
      ip: entry.ip,
      count: entry.count,
      houseCount: entry.houses.size,
      streetCount: entry.streets.size,
      averageDistanceMeters: entry.distances.length ? entry.distances.reduce((a, b) => a + b, 0) / entry.distances.length : RADIUS_METERS,
      interfaces: Array.from(entry.interfaces),
      contracts: Array.from(entry.contracts),
      addresses: Array.from(entry.addresses),
      score: entry.count * 100 + entry.houses.size * 45 + entry.streets.size * 20 + Math.max(0, RADIUS_METERS - (entry.distances.length ? entry.distances.reduce((a, b) => a + b, 0) / entry.distances.length : RADIUS_METERS)) / 10,
      share: checkedCards ? entry.count / checkedCards : 0,
    })).sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function abortRun(message) {
    runtime.runId += 1;
    runtime.running = false;
    for (const handle of runtime.handles) {
      try { handle.abort(); } catch (_) {}
    }
    runtime.handles.clear();
    runtime.stage = message || 'Остановлено';
    runtime.detail = 'Сетевой сбор прекращён.';
    runtime.progress = '';
    render();
  }

  async function runInvestigation() {
    if (runtime.running) return;
    const anchor = runtime.anchor;
    if (!anchor || !anchor.center) {
      runtime.stage = 'Нет точки штатного поиска';
      runtime.detail = 'Сначала введи адрес в поиске UserSide и нажми «Найти».';
      render();
      return;
    }
    runtime.running = true;
    runtime.runId += 1;
    const runId = runtime.runId;
    runtime.requests = 0;
    runtime.errors = [];
    runtime.report = null;
    runtime.stage = 'Собираю дома внутри радара';
    runtime.detail = `Центр остаётся ${anchor.center.lat.toFixed(6)}, ${anchor.center.lng.toFixed(6)}. Радиус ${RADIUS_METERS} м.`;
    runtime.progress = '';
    render();
    radarRender();

    try {
      const features = featureSet(captureItems(), anchor);
      const housesInRadius = features
        .filter(feature => feature.type === 'house')
        .map(feature => ({ ...feature, distanceMeters: distanceMeters(anchor.center, feature.center) }))
        .filter(feature => feature.distanceMeters <= RADIUS_METERS)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
      if (!housesInRadius.length) throw new Error('в ответах карты нет полигонов домов внутри 500 м; дождись загрузки карты или приблизь её');
      const tooltipTargets = housesInRadius.slice(0, HOUSE_TOOLTIP_LIMIT);
      let completed = 0;
      runtime.progress = `tooltip 0/${tooltipTargets.length}`;
      render();
      const tooltipRows = await mapLimit(tooltipTargets, CONCURRENCY, async feature => {
        try {
          const raw = await request(`${BASE}/map/tooltip?obj_type=house&obj_id=${encodeURIComponent(feature.id)}`, runId, 12000);
          completed += 1;
          runtime.progress = `tooltip ${completed}/${tooltipTargets.length}`;
          render();
          return parseHouseTooltip(raw, feature, anchor);
        } catch (error) {
          completed += 1;
          runtime.errors.push('house ' + feature.id + ': ' + text(error && error.message || error));
          runtime.progress = `tooltip ${completed}/${tooltipTargets.length}`;
          render();
          return null;
        }
      });
      const houses = tooltipRows.filter(item => item && item.address).slice(0, HOUSE_SEARCH_LIMIT);
      if (!houses.length) throw new Error('tooltip ближайших домов не вернули адресов');

      runtime.stage = 'Ищу абонентов домов внутри 500 м';
      runtime.detail = `Точка не меняется. Проверяю ${houses.length} адресов вокруг неё.`;
      completed = 0;
      runtime.progress = `адреса 0/${houses.length}`;
      render();
      const subscriberGroups = await mapLimit(houses, CONCURRENCY, async house => {
        try {
          const raw = await request(`${BASE}/customer_list/search_page?search=${encodeURIComponent(house.address)}`, runId, 14000);
          completed += 1;
          runtime.progress = `адреса ${completed}/${houses.length}`;
          render();
          return customerRows(raw, house);
        } catch (error) {
          completed += 1;
          runtime.errors.push('address ' + house.address + ': ' + text(error && error.message || error));
          runtime.progress = `адреса ${completed}/${houses.length}`;
          render();
          return [];
        }
      });
      const subscribers = unique(subscriberGroups.flat(), item => item.customerId).slice(0, CARD_LIMIT);
      if (!subscribers.length) throw new Error('по адресам внутри 500 м абоненты не найдены');

      runtime.stage = 'Проверяю явные привязки OLT';
      runtime.detail = `Карточек: ${subscribers.length}. Учитывается только «Найдено на OLT».`;
      completed = 0;
      runtime.progress = `карточки 0/${subscribers.length}`;
      render();
      const evidence = (await mapLimit(subscribers, CONCURRENCY, async subscriber => {
        try {
          const raw = await request(`${BASE}/customer/tab?tab=main&id=${encodeURIComponent(subscriber.customerId)}`, runId, 15000);
          completed += 1;
          runtime.progress = `карточки ${completed}/${subscribers.length}`;
          render();
          return explicitOlt(raw, subscriber);
        } catch (error) {
          completed += 1;
          runtime.errors.push('customer ' + subscriber.customerId + ': ' + text(error && error.message || error));
          runtime.progress = `карточки ${completed}/${subscribers.length}`;
          render();
          return null;
        }
      })).filter(Boolean);

      runtime.report = {
        schema: 'simnet-userside-radar-olt-v1',
        moduleVersion: VERSION,
        createdAt: nowIso(),
        anchor,
        sample: {
          radiusMeters: RADIUS_METERS,
          polygonsInRadius: housesInRadius.length,
          tooltipsChecked: tooltipTargets.length,
          housesSelected: houses.map(house => ({ id: house.id, address: house.address, distanceMeters: house.distanceMeters, subscribers: house.subscribers })),
        },
        subscribers: { selected: subscribers.length, cardsChecked: subscribers.length, verifiedOlt: evidence.length },
        oltCandidates: rankOlts(evidence, subscribers.length),
        evidence,
        errors: runtime.errors.slice(),
        requests: runtime.requests,
      };
      safeSet(REPORT_KEY, runtime.report);
      runtime.stage = 'Расследование радиуса завершено';
      runtime.detail = runtime.report.oltCandidates.length
        ? `Найдено кандидатов OLT: ${runtime.report.oltCandidates.length}. Исходная точка не менялась.`
        : 'Подтверждённые OLT в проверенных карточках не найдены. Исходная точка не менялась.';
      runtime.progress = '';
    } catch (error) {
      if (runId === runtime.runId) {
        runtime.stage = 'Ошибка расследования';
        runtime.detail = text(error && error.message || error);
        runtime.errors.push(runtime.detail);
        runtime.progress = '';
      }
    } finally {
      if (runId === runtime.runId) {
        runtime.running = false;
        runtime.handles.clear();
        radarRender();
        render();
      }
    }
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimer(() => URL.revokeObjectURL(url), 1200);
  }

  function exportReport() {
    if (!runtime.report) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    download(`simnet_geo_radar_olt_${stamp}.json`, JSON.stringify(runtime.report, null, 2));
  }

  function destroy() {
    runtime.destroyed = true;
    abortRun('Модуль заменён новой версией');
    runtime.timers.forEach(id => window.clearTimeout(id));
    runtime.timers.clear();
    [PANEL_ID, LAUNCHER_ID, RADAR_ID].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.remove();
    });
  }

  function safePeriodicRender() {
    if (runtime.destroyed) return;
    try {
      if (runtime.pending && !runtime.anchor) checkAnchor();
      radarRender();
      render();
    } catch (error) {
      try { console.error('[SIMNET geo-radar] periodic error', error); } catch (_) {}
    }
    setTimer(safePeriodicRender, 1800);
  }

  function boot() {
    if (location.hostname !== 'userside.simnet.kiev.ua') return;
    installStyle();
    ensurePanel();
    installSearchListeners();
    render();
    radarRender();
    runtime.ready = true;
    window[GUARD_KEY] = { version: VERSION, ready: true, destroy };
    document.addEventListener(CAPTURE_EVENT, () => {
      try {
        if (runtime.pending && !runtime.anchor) scheduleAnchorCheck(300);
        radarRender();
        render();
      } catch (_) {}
    });
    window.addEventListener('resize', () => { radarRender(); applyUi(document.getElementById(PANEL_ID)); });
    window.addEventListener('popstate', () => { radarRender(); render(); });
    window.addEventListener('hashchange', () => { radarRender(); render(); });
    window.addEventListener('pagehide', destroy, { once: true });
    safePeriodicRender();
  }

  try {
    boot();
  } catch (error) {
    try { console.error('[SIMNET geo-radar] boot error', error); } catch (_) {}
    try {
      installStyle();
      const fallback = document.createElement('button');
      fallback.id = LAUNCHER_ID;
      fallback.type = 'button';
      fallback.textContent = 'Карта / OLT: ошибка';
      fallback.title = text(error && error.message || error);
      fallback.style.background = '#b42318';
      fallback.addEventListener('click', () => window.alert('Ошибка запуска геомодуля: ' + fallback.title));
      (document.body || document.documentElement).appendChild(fallback);
    } catch (_) {}
  }
})();
    // END ORIGINAL USERSCRIPT BODY
    console.log(`${LOG_PREFIX} Workbench 2.0.0-dev.5.8 loaded`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Workbench startup failed`, error);

    try {
      if (!document.getElementById("simnet-workbench-extension-startup-error")) {
        const notice = document.createElement("div");
        notice.id = "simnet-workbench-extension-startup-error";
        notice.textContent = `SIMNET Workbench Extension: ${error instanceof Error ? error.message : String(error)}`;
        Object.assign(notice.style, {
          position: "fixed",
          right: "12px",
          bottom: "12px",
          zIndex: "2147483647",
          maxWidth: "420px",
          padding: "12px",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          background: "#7f1d1d",
          color: "#fff",
          font: "13px/1.4 system-ui, sans-serif"
        });
        (document.body || document.documentElement).append(notice);
      }
    } catch (noticeError) {
      console.error(`${LOG_PREFIX} Startup notice failed`, noticeError);
    }
  }
})();
