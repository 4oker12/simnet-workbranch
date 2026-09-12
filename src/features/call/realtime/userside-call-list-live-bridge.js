(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;
  if (location.hostname !== 'userside.simnet.kiev.ua' || location.pathname !== '/message/call_list') return;

  const STORAGE_KEY = 'simnet_call_live_call_list_6047_v1';
  const NATIVE_STATE_KEY = 'simnet_call_active_6047_v1';
  const MESSAGE_TYPE = 'CALL_LIVE_ROW_OBSERVED';
  const OPERATOR_EXTENSION = '6047';
  const MAX_ROWS_TO_SCAN = 40;
  const LIVE_CLOCK_TOLERANCE_MS = 75_000;
  const START_MATCH_TOLERANCE_MS = 90_000;
  const FRESH_BLANK_ROW_MS = 90_000;
  const LIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  let tableObserver = null;
  let discoveryObserver = null;
  let tableBody = null;
  let scheduled = false;
  let nativeState = null;
  let lastState = null;
  let lastStateSignature = '';
  let lastObservationSignature = '';
  let lastLiveStartMs = 0;

  const text = node => String(node?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');

  function normalizeNative(value = null) {
    if (!value || value.schema !== 'simnet-wb-native-pbx-state-v1') return null;
    if (String(value.agentExtension || '') !== OPERATOR_EXTENSION) return null;
    const observedAtMs = Math.max(0, Number(value.observedAtMs || 0));
    if (!observedAtMs || Date.now() - observedAtMs > 15_000) return null;
    return {
      active: value.active === true,
      talkStartMs: Math.max(0, Number(value.talkStartMs || 0)),
      observedAtMs
    };
  }

  function parseDurationSeconds(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw) || 0;
    const parts = raw.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function parseStartedAt(value = '') {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return 0;
    const [, dd, mm, yyyy, hh, min, ss = '00'] = match;
    const ms = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
    return Number.isFinite(ms) ? ms : 0;
  }

  function callIdFromRow(row) {
    const html = String(row?.innerHTML || '');
    return html.match(/\/message\/(\d+)\/call_comment_add/i)?.[1]
      || html.match(/callCommentAdd(\d+)Id/i)?.[1]
      || html.match(/loadRecordFile\(\s*(\d+)\s*,/i)?.[1]
      || html.match(/audioRecordId(\d+)/i)?.[1]
      || '';
  }

  function recordIdFromRow(row) {
    return String(row?.innerHTML || '').match(/getrec\.php\?id=([0-9]{9,12}\.[0-9]{1,12})/i)?.[1] || '';
  }

  function normalizePhone(value = '') {
    const raw = digits(value);
    if (/^380\d{9}$/.test(raw)) return `0${raw.slice(3)}`;
    if (/^80\d{9}$/.test(raw)) return `0${raw.slice(2)}`;
    return raw.length >= 6 && raw.length <= 15 ? raw : '';
  }

  function subscriberFromRow(row) {
    const cell = row?.querySelector?.('[id$="_CUSTOMER_Id"]');
    if (!cell) return { customerId: '', fullName: '', fio: '', login: '', contract: '' };
    const links = Array.from(cell.querySelectorAll('a[href*="/customer/"]'));
    if (links.length !== 1) return { customerId: '', fullName: '', fio: '', login: '', contract: '' };
    const link = links[0];
    const customerId = String(link.getAttribute('href') || '').match(/\/customer\/(\d+)/i)?.[1] || '';
    const raw = text(link);
    const login = raw.match(/\babon\d+\b/i)?.[0] || '';
    const fullName = login
      ? raw.replace(new RegExp(`\\s*[-–—]?\\s*${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim()
      : raw;
    return {
      customerId,
      fullName,
      fio: fullName,
      login,
      contract: login.replace(/^abon/i, '')
    };
  }

  function rowData(row) {
    if (!row) return null;
    const answerCell = row.querySelector?.('[id$="_ANSWERPHONE_Id"]');
    const agentExtension = digits(text(answerCell));
    if (agentExtension !== OPERATOR_EXTENSION) return null;

    const dateText = text(row.querySelector('[id$="_DATEADD_Id"]'));
    const startedAtMs = parseStartedAt(dateText);
    if (!startedAtMs) return null;
    const age = Date.now() - startedAtMs;
    if (age < -120_000 || age > LIVE_MAX_AGE_MS) return null;

    const dateMatch = dateText.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    const duration = text(row.querySelector('[id$="_callIntervalInt_Id"]'));
    const phone = normalizePhone(text(row.querySelector('[id$="_PHONE_Id"]')));
    const usersideCallId = callIdFromRow(row);

    return {
      source: 'userside:call_list:live-dom',
      usersideCallId,
      callKey: usersideCallId ? `call:${usersideCallId}` : '',
      recordId: recordIdFromRow(row),
      callerId: phone,
      callerMasked: phone,
      date: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '',
      time: dateMatch ? `${dateMatch[4]}:${dateMatch[5]}` : '',
      startedAtMs,
      duration,
      durationSeconds: parseDurationSeconds(duration),
      agentExtension: OPERATOR_EXTENSION,
      direction: text(row.querySelector('[id$="_direction_Id"]')),
      ...subscriberFromRow(row)
    };
  }

  function findTableBody() {
    const answerCell = document.querySelector('[id$="_ANSWERPHONE_Id"]');
    const bodyFromCell = answerCell?.closest?.('tbody');
    if (bodyFromCell) return bodyFromCell;
    const row = document.querySelector('tr.table_item');
    return row?.closest?.('tbody') || null;
  }

  function latestOwnRow() {
    const body = tableBody || findTableBody();
    if (!body) return null;
    const rows = body.children || [];
    const limit = Math.min(rows.length, MAX_ROWS_TO_SCAN);
    for (let index = 0; index < limit; index += 1) {
      const row = rows[index];
      if (!row?.classList?.contains('table_item')) continue;
      const answer = digits(text(row.querySelector?.('[id$="_ANSWERPHONE_Id"]')));
      if (answer === OPERATOR_EXTENSION) return row;
    }
    return null;
  }

  function nativeMatches(call) {
    const state = normalizeNative(nativeState);
    if (!state?.active || !call?.startedAtMs) return false;
    return !state.talkStartMs || Math.abs(Number(call.startedAtMs) - state.talkStartMs) <= START_MATCH_TOLERANCE_MS;
  }

  function rowLooksLive(call) {
    if (!call?.startedAtMs) return false;
    const now = Date.now();
    if (nativeMatches(call)) return true;
    if (call.durationSeconds > 0) {
      const displayedEndMs = Number(call.startedAtMs) + Number(call.durationSeconds) * 1000;
      return Math.abs(now - displayedEndMs) <= LIVE_CLOCK_TOLERANCE_MS;
    }
    return now - Number(call.startedAtMs) <= FRESH_BLANK_ROW_MS;
  }

  function observationSignature(call, status) {
    return [
      status,
      call?.usersideCallId || '',
      call?.startedAtMs || 0,
      call?.callerId || '',
      call?.customerId || '',
      status === 'completed' ? Number(call?.durationSeconds || 0) : 0,
      call?.recordId || ''
    ].join(':');
  }

  function sendObservation(call, status) {
    if (!call) return;
    const signature = observationSignature(call, status);
    if (signature === lastObservationSignature) return;
    lastObservationSignature = signature;
    const payload = {
      call: {
        ...call,
        status,
        ongoing: status === 'ongoing',
        bindable: Boolean(call.usersideCallId)
      }
    };
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload }, () => void chrome.runtime.lastError);
    } catch {}
  }

  function buildState() {
    const raw = rowData(latestOwnRow());
    const live = raw && rowLooksLive(raw) ? raw : null;

    if (live) {
      lastLiveStartMs = Number(live.startedAtMs || 0);
      sendObservation(live, 'ongoing');
      return {
        schema: 'simnet-wb-call-list-live-v1',
        active: true,
        agentExtension: OPERATOR_EXTENSION,
        observedAtMs: Date.now(),
        source: 'userside-call-list-dom',
        call: { ...live, status: 'ongoing', ongoing: true, snapshotStatus: 'live' }
      };
    }

    let completedCall = null;
    if (raw && lastLiveStartMs && Math.abs(Number(raw.startedAtMs || 0) - lastLiveStartMs) <= START_MATCH_TOLERANCE_MS && Number(raw.durationSeconds || 0) > 0) {
      completedCall = { ...raw, status: 'completed', ongoing: false };
      sendObservation(completedCall, 'completed');
      lastLiveStartMs = 0;
    }

    return {
      schema: 'simnet-wb-call-list-live-v1',
      active: false,
      agentExtension: OPERATOR_EXTENSION,
      observedAtMs: Date.now(),
      source: 'userside-call-list-dom',
      call: completedCall
    };
  }

  function stateSignature(state) {
    return [
      state.active ? 1 : 0,
      state.call?.startedAtMs || 0,
      state.call?.usersideCallId || '',
      state.call?.callerId || '',
      state.call?.customerId || '',
      state.call?.status || ''
    ].join(':');
  }

  function publish(force = false) {
    scheduled = false;
    const state = buildState();
    lastState = state;
    const signature = stateSignature(state);
    if (!force && signature === lastStateSignature) return state;
    lastStateSignature = signature;
    try { chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch {}
    return state;
  }

  function schedulePublish() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => publish(false));
  }

  function attachTableObserver() {
    const nextBody = findTableBody();
    if (!nextBody) return false;
    if (tableBody === nextBody && tableObserver) return true;
    tableObserver?.disconnect();
    tableBody = nextBody;
    tableObserver = new MutationObserver(schedulePublish);
    tableObserver.observe(tableBody, { subtree: true, childList: true, characterData: true });
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    schedulePublish();
    return true;
  }

  function startDiscovery() {
    if (attachTableObserver() || discoveryObserver) return;
    discoveryObserver = new MutationObserver(() => {
      if (attachTableObserver()) return;
    });
    discoveryObserver.observe(document.documentElement, { subtree: true, childList: true });
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes?.[NATIVE_STATE_KEY]) return;
    nativeState = changes[NATIVE_STATE_KEY].newValue || null;
    schedulePublish();
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  try {
    chrome.storage.local.get(NATIVE_STATE_KEY, result => {
      if (!chrome.runtime.lastError) nativeState = result?.[NATIVE_STATE_KEY] || null;
      startDiscovery();
      publish(true);
    });
  } catch {
    startDiscovery();
    publish(true);
  }

  window.addEventListener('pageshow', schedulePublish);
  document.addEventListener('visibilitychange', schedulePublish);

  WB.callListLiveBridge = Object.freeze({
    probe() { return publish(false); },
    state() { return lastState ? { ...lastState, call: lastState.call ? { ...lastState.call } : null } : null; }
  });

  window.addEventListener('pagehide', () => {
    tableObserver?.disconnect();
    discoveryObserver?.disconnect();
    tableObserver = null;
    discoveryObserver = null;
    tableBody = null;
    chrome.storage.onChanged.removeListener(onStorageChanged);
    window.removeEventListener('pageshow', schedulePublish);
    document.removeEventListener('visibilitychange', schedulePublish);
  }, { once: true });
})();
