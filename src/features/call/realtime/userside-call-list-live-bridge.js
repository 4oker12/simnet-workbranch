(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;
  if (location.hostname !== 'userside.simnet.kiev.ua' || location.pathname !== '/message/call_list') return;

  const STORAGE_KEY = 'simnet_call_live_call_list_6047_v1';
  const OPERATOR_EXTENSION = '6047';
  const LIVE_TOLERANCE_MS = 20_000;
  const LIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const WRITE_BUCKET_MS = 4_000;

  let observer = null;
  let scheduled = false;
  let lastSignature = '';
  let lastState = null;

  const text = node => String(node?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const digits = value => String(value == null ? '' : value).replace(/\D+/g, '');

  function parseDurationSeconds(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return 0;
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

  function normalizePhone(value = '') {
    const raw = digits(value);
    if (/^380\d{9}$/.test(raw)) return `0${raw.slice(3)}`;
    if (/^80\d{9}$/.test(raw)) return `0${raw.slice(2)}`;
    return raw.length >= 6 && raw.length <= 15 ? raw : '';
  }

  function rowCall(row, now = Date.now()) {
    const answerCell = row?.querySelector?.('[id$="_ANSWERPHONE_Id"]');
    if (!answerCell) return null;
    const answerDigits = digits(text(answerCell));
    if (!answerDigits.includes(OPERATOR_EXTENSION)) return null;

    const duration = text(row.querySelector('[id$="_callIntervalInt_Id"]'));
    const durationSeconds = parseDurationSeconds(duration);
    const startedAtMs = parseStartedAt(text(row.querySelector('[id$="_DATEADD_Id"]')));
    if (!startedAtMs || now < startedAtMs || now - startedAtMs > LIVE_MAX_AGE_MS) return null;

    const displayedEndMs = startedAtMs + durationSeconds * 1000;
    if (Math.abs(now - displayedEndMs) > LIVE_TOLERANCE_MS) return null;

    const usersideCallId = callIdFromRow(row);
    const phone = normalizePhone(text(row.querySelector('[id$="_PHONE_Id"]')));
    const direction = text(row.querySelector('[id$="_direction_Id"]'));
    const dateNodeText = text(row.querySelector('[id$="_DATEADD_Id"]'));
    const dateMatch = dateNodeText.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
    const time = dateMatch ? `${dateMatch[4]}:${dateMatch[5]}` : '';

    return {
      source: 'userside:call_list:live-dom',
      usersideCallId,
      callKey: usersideCallId ? `call:${usersideCallId}` : '',
      callerId: phone,
      callerMasked: phone,
      date,
      time,
      startedAtMs,
      duration,
      durationSeconds,
      agentExtension: OPERATOR_EXTENSION,
      direction,
      status: 'ongoing',
      ongoing: true,
      bindable: Boolean(usersideCallId),
      snapshotStatus: 'live'
    };
  }

  function findLiveCall() {
    const now = Date.now();
    let best = null;
    for (const row of document.querySelectorAll('tr.table_item')) {
      const call = rowCall(row, now);
      if (!call) continue;
      if (!best || Number(call.startedAtMs || 0) > Number(best.startedAtMs || 0)) best = call;
    }
    return best;
  }

  function buildState() {
    const now = Date.now();
    const call = findLiveCall();
    return {
      schema: 'simnet-wb-call-list-live-v1',
      active: Boolean(call),
      agentExtension: OPERATOR_EXTENSION,
      observedAtMs: now,
      source: 'userside-call-list-dom',
      call: call || null
    };
  }

  function publish(force = false) {
    scheduled = false;
    const state = buildState();
    lastState = state;
    const bucket = Math.floor(state.observedAtMs / WRITE_BUCKET_MS);
    const signature = [state.active ? 1 : 0, state.call?.startedAtMs || 0, state.call?.usersideCallId || '', bucket].join(':');
    if (!force && signature === lastSignature) return state;
    lastSignature = signature;
    try { chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch {}
    return state;
  }

  function schedulePublish() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => publish(false));
  }

  observer = new MutationObserver(schedulePublish);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  window.addEventListener('pageshow', schedulePublish);
  document.addEventListener('visibilitychange', schedulePublish);
  lastState = publish(true);

  WB.callListLiveBridge = Object.freeze({
    probe() { return publish(true); },
    state() { return lastState ? { ...lastState, call: lastState.call ? { ...lastState.call } : null } : null; }
  });

  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('pageshow', schedulePublish);
    document.removeEventListener('visibilitychange', schedulePublish);
  }, { once: true });
})();
