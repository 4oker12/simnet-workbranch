(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (location.hostname !== 'pbx.simnet.kiev.ua') return;

  const MESSAGE = 'PBX_RECENT_CALLS_OBSERVED';
  const SCHEMA = 'simnet-pbx-recent-calls-v1';
  const MAX_CALLS_PER_SNAPSHOT = 80;
  const OPERATOR_EXTENSION = '6047';
  const OPERATOR_LOGIN = 'zyatev_andriy';
  const OPERATOR_TEAM = 'opw';
  let lastSignature = '';
  let publishTimer = 0;

  const compact = (value, max = 160) => {
    const text = String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };



  const normalizedHeader = value => compact(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_#]+/g, '');

  function recordIdOf(cell) {
    if (!cell) return '';
    const candidates = [
      ...Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick]') || []).flatMap(node => [
        node.getAttribute?.('id') || '',
        node.getAttribute?.('href') || '',
        node.getAttribute?.('onclick') || ''
      ]),
      cell.getAttribute?.('id') || '',
      cell.innerHTML || '',
      cell.textContent || ''
    ];
    for (const candidate of candidates) {
      const match = String(candidate).match(/(?:textid-|getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i);
      if (match) return match[1];
    }
    return '';
  }

  function phoneOf(value) {
    const raw = compact(value, 40);
    const digits = raw.replace(/\D+/g, '');
    return digits.length >= 6 && digits.length <= 15 ? digits : '';
  }

  function durationSeconds(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function localStartedAtMs(date, time) {
    const dateMatch = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(time || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!dateMatch || !timeMatch) return 0;
    const value = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] || 0)
    ).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function parseTable(table) {
    const rows = Array.from(table?.rows || table?.querySelectorAll?.('tr') || []);
    if (rows.length < 2) return [];
    const headerCells = Array.from(rows[0].cells || rows[0].querySelectorAll?.('th,td') || []);
    const headers = headerCells.map(cell => normalizedHeader(cell.textContent));
    if (!headers.includes('callerid') || !headers.includes('callid')) return [];

    const index = name => headers.indexOf(name);
    const textAt = (cells, name) => {
      const position = index(name);
      return position >= 0 ? compact(cells[position]?.textContent || '') : '';
    };

    const calls = [];
    for (const row of rows.slice(1)) {
      const cells = Array.from(row.cells || row.querySelectorAll?.('td') || []);
      const callCell = cells[index('callid')] || null;
      const recordId = recordIdOf(callCell);
      if (!recordId) continue;

      const agent = textAt(cells, 'agent');
      const extensionText = textAt(cells, 'extension');
      // Prefer dedicated extension column; fall back to leading digits in agent ("6047 / Name").
      const agentExtension = String(
        (extensionText.match(/\b(\d{3,6})\b/) || [])[1]
        || (agent.match(/^\s*(\d{3,6})\b/) || [])[1]
        || ''
      );
      const date = textAt(cells, 'date');
      const time = textAt(cells, 'time');
      const duration = textAt(cells, 'duration');
      const ip = textAt(cells, 'ip');
      const providerCode = compact(textAt(cells, 'prov'), 12);

      calls.push({
        callKey: `pbx:${recordId}`,
        recordId,
        recordUrl: `https://pbx.simnet.kiev.ua/fop2/getrec.php?id=${encodeURIComponent(recordId)}`,
        date,
        time,
        startedAtMs: localStartedAtMs(date, time),
        timeSemantics: 'end',
        callerId: phoneOf(textAt(cells, 'callerid')),
        providerCode,
        contract: textAt(cells, 'contract'),
        subscriberIp: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : '',
        holdtime: Math.max(0, Number.parseInt(textAt(cells, 'holdtime'), 10) || 0),
        duration,
        durationSeconds: durationSeconds(duration),
        queue: textAt(cells, 'queue'),
        agent,
        agentExtension,
        observedAt: new Date().toISOString()
      });
    }
    return calls;
  }

  /**
   * Own accepted call = answered on this operator's extension and had talk time.
   * Primary key is extension (6047), not OPER/agent free-text.
   * Login/team strings are soft hints only when extension is missing from the row.
   */
  function normalizeExtension(value) {
    const digits = String(value == null ? '' : value).replace(/\D+/g, '');
    if (!digits) return '';
    // Prefer exact operator length match when a longer digit run appears.
    if (digits === OPERATOR_EXTENSION) return digits;
    if (digits.endsWith(OPERATOR_EXTENSION) && digits.length <= OPERATOR_EXTENSION.length + 2) {
      return OPERATOR_EXTENSION;
    }
    const match = String(value || '').match(/\b(\d{3,6})\b/);
    return match ? match[1] : digits.slice(0, 6);
  }

  function isOwnAcceptedCall(call = {}) {
    let extension = normalizeExtension(call.agentExtension);
    if (!extension) {
      // Soft fallback: agent text may be "6047 / Zyatev_Andriy / OPW"
      extension = normalizeExtension(call.agent);
    }
    if (extension !== OPERATOR_EXTENSION) return false;
    // Completed/accepted: require positive talk duration (not ring-only / missed).
    if (!(Number(call.durationSeconds || 0) > 0)) return false;
    // Soft reject only when agent text clearly names a *different* leading extension.
    const agent = compact(call.agent || '', 120);
    const agentLead = (agent.match(/^\s*(\d{3,6})\b/) || [])[1] || '';
    if (agentLead && agentLead !== OPERATOR_EXTENSION) return false;
    return true;
  }

  function parsePbxRecentCalls(root = document) {
    const byKey = new Map();
    for (const table of Array.from(root?.querySelectorAll?.('table') || [])) {
      for (const call of parseTable(table)) {
        if (!isOwnAcceptedCall(call)) continue;
        byKey.set(call.callKey, call);
      }
    }
    return [...byKey.values()]
      .sort((left, right) => Number(right.startedAtMs || 0) - Number(left.startedAtMs || 0))
      .slice(0, MAX_CALLS_PER_SNAPSHOT);
  }

  async function publish() {
    const calls = parsePbxRecentCalls(document);
    if (!calls.length) return;
    const signature = calls.map(call => [
      call.callKey,
      call.providerCode,
      call.contract,
      call.subscriberIp,
      call.agent,
      call.duration
    ].join(':')).join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE,
        payload: {
          schema: SCHEMA,
          observedAt: new Date().toISOString(),
          pageUrl: location.href,
          calls
        }
      });
      if (!response?.success) throw new Error(response?.error || 'PBX snapshot rejected by Service Worker');
    } catch (error) {
      if (!/context invalidated|receiving end does not exist/i.test(String(error?.message || error))) {
        console.error('[SIMNET Workbench][PBX] snapshot rejected', error);
      }
    }
  }

  function mutationTouchesCallTables(mutations = []) {
    return mutations.some(mutation => {
      const target = mutation?.target?.nodeType === 1 ? mutation.target : mutation?.target?.parentElement;
      if (target?.closest?.('table')) return true;
      for (const node of mutation?.addedNodes || []) {
        if (node?.nodeType !== 1) continue;
        if (String(node.tagName || '').toLowerCase() === 'table' || node.querySelector?.('table')) return true;
      }
      for (const node of mutation?.removedNodes || []) {
        if (node?.nodeType !== 1) continue;
        if (String(node.tagName || '').toLowerCase() === 'table' || node.querySelector?.('table')) return true;
      }
      return false;
    });
  }

  function schedulePublish(mutations = null) {
    if (Array.isArray(mutations) && mutations.length && !mutationTouchesCallTables(mutations)) return;
    clearTimeout(publishTimer);
    publishTimer = window.setTimeout(() => void publish(), 120);
  }

  const observer = new MutationObserver(schedulePublish);
  let observerActive = false;

  function startObserver() {
    if (observerActive || !document.documentElement) return false;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    observerActive = true;
    return true;
  }

  function stopObserver() {
    clearTimeout(publishTimer);
    publishTimer = 0;
    if (!observerActive) return false;
    observer.disconnect();
    observerActive = false;
    return true;
  }

  startObserver();
  window.addEventListener('pagehide', stopObserver);
  window.addEventListener('pageshow', () => {
    startObserver();
    schedulePublish();
  });

  // Fresh re-parse on demand when operator opens call registration.
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'PBX_FORCE_REFRESH') {
        lastSignature = '';
        schedulePublish();
        // Publish immediately as well for lower latency.
        void publish().then(
          () => sendResponse({ success: true }),
          error => sendResponse({ success: false, error: String(error?.message || error) })
        );
        return true;
      }
      return false;
    });
  } catch {}

  globalThis.__SIMNET_WB_PBX_TEST_API__ = Object.freeze({
    recordIdOf,
    durationSeconds,
    isOwnAcceptedCall,
    parsePbxRecentCalls
  });

  schedulePublish();
})();
