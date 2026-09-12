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
  const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

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
    return { active: value.active === true, talkStartMs: Math.max(0, Number(value.talkStartMs || 0)), observedAtMs };
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

  function normalizeCallId(value = '') {
    const raw = String(value || '').trim();
    if (new RegExp(`^${UUID_PATTERN}$`, 'i').test(raw)) return raw.toLowerCase();
    return /^\d{5,24}$/.test(raw) ? raw : '';
  }

  function callIdFromRow(row) {
    const html = String(row?.innerHTML || '');
    const attrs = [row?.getAttribute?.('data-call-id'), row?.getAttribute?.('data-message-id'), row?.dataset?.callId, row?.dataset?.messageId];
    const attrId = attrs.map(normalizeCallId).find(Boolean);
    if (attrId) return attrId;

    const uuid = html.match(new RegExp(`call_comment_add\\?uuid=(${UUID_PATTERN})`, 'i'))?.[1]
      || html.match(new RegExp(`callCommentAdd(${UUID_PATTERN})Id`, 'i'))?.[1]
      || html.match(new RegExp(`loadRecordFile\\(\\s*["'](${UUID_PATTERN})["']`, 'i'))?.[1]
      || html.match(new RegExp(`audioRecordId(${UUID_PATTERN})`, 'i'))?.[1];
    if (uuid) return uuid.toLowerCase();

    return html.match(/\/message\/(\d+)\/call_comment_add/i)?.[1]
      || html.match(/callCommentAdd(\d+)Id/i)?.[1]
      || html.match(/loadRecordFile\(\s*(\d+)\s*,/i)?.[1]
      || html.match(/audioRecordId(\d+)/i)?.[1]
      || html.match(/name=["'](?:call_id|message_id)["'][^>]*value=["'](\d+)["']/i)?.[1]
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

  function parseSubscriberLabel(raw = '') {
    const value = String(raw || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const login = value.match(/\babon\d+\b/i)?.[0] || '';
    const fullName = login
      ? value.replace(new RegExp(`\\s*[-–—]?\\s*${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim()
      : value;
    return { fullName, fio: fullName, login, contract: login.replace(/^abon/i, '') };
  }

  function customerIdFromHref(href = '') {
    const raw = String(href || '');
    return raw.match(/\/customer\/(\d{1,14})(?:[/?#]|$)/i)?.[1]
      || raw.match(/[?&](?:customer_id|customerId)=(\d{1,14})(?:&|$)/i)?.[1]
      || '';
  }

  function subscriberFromRow(row, explicitCell = null) {
    const empty = { customerId: '', fullName: '', fio: '', login: '', contract: '', customerCandidates: [] };
    if (!row) return empty;
    let cell = explicitCell || row.querySelector?.('[id$="_CUSTOMER_Id"]') || null;
    if (!cell) {
      cell = Array.from(row.querySelectorAll?.('td') || []).find(candidate => candidate.querySelector?.('a[href*="/customer/"]') || /\babon\d+\b/i.test(text(candidate))) || null;
    }
    if (!cell) return empty;

    const candidates = [];
    const seen = new Set();
    for (const link of Array.from(cell.querySelectorAll?.('a[href*="/customer/"]') || [])) {
      const customerId = customerIdFromHref(link.getAttribute('href') || link.href || '');
      const label = parseSubscriberLabel(text(link));
      const key = customerId || label.login.toLowerCase() || text(link).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ customerId, ...label });
    }

    if (!candidates.length) {
      const label = parseSubscriberLabel(text(cell));
      if (!label.login && !label.fullName) return empty;
      return { customerId: '', ...label, customerCandidates: [] };
    }
    if (candidates.length !== 1) return { ...empty, customerCandidates: candidates };
    return { ...candidates[0], customerCandidates: candidates };
  }

  function erpRowParts(row) {
    if (!row?.classList?.contains('erp-table__row')) return null;
    const cells = Array.from(row.children || []).filter(node => node?.tagName === 'TD');
    if (cells.length < 9) return null;
    const leftNumber = digits(text(cells[4]));
    const rightNumber = digits(text(cells[6]));
    let agentExtension = '';
    let phone = '';
    if (leftNumber === OPERATOR_EXTENSION) {
      agentExtension = OPERATOR_EXTENSION;
      phone = normalizePhone(text(cells[6]));
    } else if (rightNumber === OPERATOR_EXTENSION) {
      agentExtension = OPERATOR_EXTENSION;
      phone = normalizePhone(text(cells[4]));
    }
    return { cells, direction: text(cells[1]).toUpperCase(), dateCell: cells[2], customerCell: cells[5], operCell: cells[7], durationCell: cells[8], agentExtension, phone };
  }

  function rowData(row) {
    if (!row) return null;
    const erp = erpRowParts(row);
    let agentExtension = '';
    let dateText = '';
    let duration = '';
    let phone = '';
    let direction = '';
    let subscriber = null;
    let oper = '';
    let employeeId = '';

    if (erp) {
      agentExtension = erp.agentExtension;
      dateText = text(erp.dateCell);
      duration = text(erp.durationCell);
      phone = erp.phone;
      direction = erp.direction;
      subscriber = subscriberFromRow(row, erp.customerCell);
      oper = text(erp.operCell);
      employeeId = String(erp.operCell?.querySelector?.('a[href*="/employee/"]')?.getAttribute?.('href') || '').match(/\/employee\/(\d+)/i)?.[1] || '';
    } else {
      const answerCell = row.querySelector?.('[id$="_ANSWERPHONE_Id"]');
      agentExtension = digits(text(answerCell));
      dateText = text(row.querySelector('[id$="_DATEADD_Id"]'));
      duration = text(row.querySelector('[id$="_callIntervalInt_Id"]'));
      phone = normalizePhone(text(row.querySelector('[id$="_PHONE_Id"]')));
      direction = text(row.querySelector('[id$="_direction_Id"]'));
      subscriber = subscriberFromRow(row);
      const operCell = row.querySelector('[id$="_OPER_Id"]');
      oper = text(operCell);
      employeeId = String(operCell?.querySelector?.('a[href*="/employee/"]')?.getAttribute?.('href') || '').match(/\/employee\/(\d+)/i)?.[1] || '';
    }

    if (agentExtension !== OPERATOR_EXTENSION) return null;
    const startedAtMs = parseStartedAt(dateText);
    if (!startedAtMs) return null;
    const age = Date.now() - startedAtMs;
    if (age < -120_000 || age > LIVE_MAX_AGE_MS) return null;
    const dateMatch = dateText.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    const usersideCallId = callIdFromRow(row);

    return {
      source: 'userside:call_list:live-dom', usersideCallId, callKey: usersideCallId ? `call:${usersideCallId}` : '',
      recordId: recordIdFromRow(row), callerId: phone, callerMasked: phone,
      date: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '', time: dateMatch ? `${dateMatch[4]}:${dateMatch[5]}` : '',
      startedAtMs, duration, durationSeconds: parseDurationSeconds(duration), agentExtension: OPERATOR_EXTENSION,
      agent: [OPERATOR_EXTENSION, oper].filter(Boolean).join(' '), oper, employeeId, direction,
      ...(subscriber || subscriberFromRow(row))
    };
  }

  function findTableBody() {
    const erpBody = document.querySelector('tr.erp-table__row')?.closest?.('tbody');
    if (erpBody) return erpBody;
    const bodyFromCell = document.querySelector('[id$="_ANSWERPHONE_Id"]')?.closest?.('tbody');
    if (bodyFromCell) return bodyFromCell;
    return document.querySelector('tr.table_item')?.closest?.('tbody') || null;
  }

  function latestOwnRow() {
    const body = tableBody || findTableBody();
    if (!body) return null;
    const rows = body.children || [];
    const limit = Math.min(rows.length, MAX_ROWS_TO_SCAN);
    for (let index = 0; index < limit; index += 1) {
      const row = rows[index];
      if (!row?.classList?.contains('erp-table__row') && !row?.classList?.contains('table_item')) continue;
      if (rowData(row)) return row;
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
    if (call.durationSeconds > 0) return Math.abs(now - (Number(call.startedAtMs) + Number(call.durationSeconds) * 1000)) <= LIVE_CLOCK_TOLERANCE_MS;
    return now - Number(call.startedAtMs) <= FRESH_BLANK_ROW_MS;
  }

  function candidatesSignature(call) {
    return (Array.isArray(call?.customerCandidates) ? call.customerCandidates : []).map(item => [item?.customerId || '', item?.login || '', item?.fio || item?.fullName || ''].join('/')).join(',');
  }

  function observationSignature(call, status) {
    return [status, call?.usersideCallId || '', call?.startedAtMs || 0, call?.callerId || '', call?.customerId || '', call?.login || '', call?.fio || '', candidatesSignature(call), status === 'completed' ? Number(call?.durationSeconds || 0) : 0, call?.recordId || ''].join(':');
  }

  function sendObservation(call, status) {
    if (!call) return;
    const signature = observationSignature(call, status);
    if (signature === lastObservationSignature) return;
    lastObservationSignature = signature;
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE, payload: { call: { ...call, status, ongoing: status === 'ongoing', bindable: Boolean(call.usersideCallId) } } }, () => void chrome.runtime.lastError);
    } catch {}
  }

  function buildState() {
    const raw = rowData(latestOwnRow());
    const live = raw && rowLooksLive(raw) ? raw : null;
    if (live) {
      lastLiveStartMs = Number(live.startedAtMs || 0);
      sendObservation(live, 'ongoing');
      return { schema: 'simnet-wb-call-list-live-v1', active: true, agentExtension: OPERATOR_EXTENSION, observedAtMs: Date.now(), source: 'userside-call-list-dom', call: { ...live, status: 'ongoing', ongoing: true, snapshotStatus: 'live' } };
    }

    let completedCall = null;
    if (raw && lastLiveStartMs && Math.abs(Number(raw.startedAtMs || 0) - lastLiveStartMs) <= START_MATCH_TOLERANCE_MS && Number(raw.durationSeconds || 0) > 0) {
      completedCall = { ...raw, status: 'completed', ongoing: false };
      sendObservation(completedCall, 'completed');
      lastLiveStartMs = 0;
    }
    return { schema: 'simnet-wb-call-list-live-v1', active: false, agentExtension: OPERATOR_EXTENSION, observedAtMs: Date.now(), source: 'userside-call-list-dom', call: completedCall };
  }

  function stateSignature(state) {
    return [state.active ? 1 : 0, state.call?.startedAtMs || 0, state.call?.usersideCallId || '', state.call?.callerId || '', state.call?.customerId || '', state.call?.login || '', state.call?.fio || '', candidatesSignature(state.call), state.call?.status || ''].join(':');
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
    tableObserver.observe(tableBody, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-call-id', 'data-message-id'] });
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    schedulePublish();
    return true;
  }

  function startDiscovery() {
    if (attachTableObserver() || discoveryObserver) return;
    discoveryObserver = new MutationObserver(() => { attachTableObserver(); });
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
