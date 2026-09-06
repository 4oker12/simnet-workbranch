(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const START = 'PBX_MANUAL_ANALYSIS_START';
  const CANCEL = 'PBX_MANUAL_ANALYSIS_CANCEL';
  const STATUS = 'PBX_MANUAL_ANALYSIS_STATUS';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const STYLE_ID = 'simnet-wb-pbx-manual-analysis-style';
  const POPOVER_ID = 'simnet-wb-pbx-manual-analysis-popover';
  const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'analyzing', 'cancelling']);
  const mounted = new Map();
  let records = {};
  let scanTimer = 0;
  let hideTimer = 0;

  function compact(value, max = 320) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function headerKey(value) {
    return compact(value, 80).toLowerCase().replace(/[^a-z0-9_#]+/g, '');
  }

  function recordIdOf(cell) {
    if (!cell) return '';
    const nodes = Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick]') || []);
    const values = [
      ...nodes.flatMap(node => [
        node.getAttribute?.('id') || '',
        node.getAttribute?.('href') || '',
        node.getAttribute?.('onclick') || ''
      ]),
      cell.innerHTML || '',
      cell.textContent || ''
    ];
    for (const value of values) {
      const match = String(value).match(/(?:getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i);
      if (match) return match[1];
    }
    return '';
  }

  function phoneOf(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    return digits.length >= 6 && digits.length <= 15 ? digits : '';
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .wb-pbx-manual-tools{display:inline-flex;align-items:center;gap:4px;width:52px;margin-left:6px;vertical-align:middle;white-space:nowrap}
      .wb-pbx-manual-run,.wb-pbx-manual-result{height:22px;width:24px;min-width:24px;box-sizing:border-box;padding:0 4px;border:1px solid #8798a3;border-radius:4px;background:#fff;color:#17384d;font:700 11px/20px Arial,sans-serif;text-align:center;cursor:pointer}
      .wb-pbx-manual-run[data-mode="cancel"]{background:#fff2f2;border-color:#c96b6b;color:#8a2424}
      .wb-pbx-manual-result[data-state="idle"]{visibility:hidden;pointer-events:none}
      .wb-pbx-manual-result[data-state="processing"]{background:#fff7dc;border-color:#bf9b35;color:#6a5200;cursor:progress}
      .wb-pbx-manual-result[data-state="ready"]{background:#e9f6ec;border-color:#4f9461;color:#245d31}
      .wb-pbx-manual-result[data-state="partial"]{background:#edf4f8;border-color:#6e91a5;color:#36586b}
      .wb-pbx-manual-result[data-state="stopped"]{background:#f3f4f6;border-color:#9ca3af;color:#4b5563}
      .wb-pbx-manual-result[data-state="error"]{background:#fff0f0;border-color:#b85c5c;color:#8a2424}
      #${POPOVER_ID}{position:fixed;z-index:2147483645;display:none;width:min(430px,calc(100vw - 24px));max-height:min(520px,calc(100vh - 24px));overflow:auto;box-sizing:border-box;padding:12px;border:1px solid #7e8f9a;border-radius:7px;background:#fff;color:#152630;box-shadow:0 10px 30px rgba(0,0,0,.22);font:13px/1.42 Arial,sans-serif}
      #${POPOVER_ID}[data-open="1"]{display:block}
      #${POPOVER_ID} .h{font-weight:700;font-size:14px;margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #d8e0e5}
      #${POPOVER_ID} .m{color:#63717a;font-size:11px;margin-bottom:8px}
      #${POPOVER_ID} .s{margin-top:8px}
      #${POPOVER_ID} .l{font-weight:700;color:#3a5261;margin-bottom:2px}
      #${POPOVER_ID} details{margin-top:10px}
      #${POPOVER_ID} pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f9fa;border:1px solid #dce3e7;border-radius:4px;padding:8px;max-height:220px;overflow:auto;font:12px/1.42 Arial,sans-serif}
    `;
    document.documentElement.appendChild(style);
  }

  function textAt(cells, headers, key) {
    const index = headers.indexOf(key);
    return index >= 0 ? compact(cells[index]?.textContent || '', 300) : '';
  }

  function callFromRow(row, headers) {
    const cells = Array.from(row.cells || row.querySelectorAll?.('td') || []);
    const callIndex = headers.indexOf('callid');
    if (callIndex < 0) return null;
    const callCell = cells[callIndex] || null;
    const recordId = recordIdOf(callCell);
    if (!recordId) return null;
    const street = textAt(cells, headers, 'adr_name_street');
    const house = textAt(cells, headers, 'adr_house');
    const room = textAt(cells, headers, 'adr_room');
    return {
      row,
      callCell,
      recordId,
      rowNumber: textAt(cells, headers, '#') || compact(cells[0]?.textContent || '', 24),
      date: textAt(cells, headers, 'date'),
      time: textAt(cells, headers, 'time'),
      callerId: phoneOf(textAt(cells, headers, 'callerid')),
      providerCode: textAt(cells, headers, 'prov'),
      contract: textAt(cells, headers, 'contract'),
      fio: textAt(cells, headers, 'fio'),
      address: [street, house, room].filter(Boolean).join(', '),
      duration: textAt(cells, headers, 'duration'),
      queue: textAt(cells, headers, 'queue'),
      agent: textAt(cells, headers, 'agent')
    };
  }

  function parseCalls() {
    const result = [];
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const rows = Array.from(table.rows || []);
      if (rows.length < 2) continue;
      const headers = Array.from(rows[0].cells || []).map(cell => headerKey(cell.textContent));
      if (!headers.includes('callid')) continue;
      for (const row of rows.slice(1)) {
        const call = callFromRow(row, headers);
        if (call) result.push(call);
      }
    }
    return result;
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function viewState(record) {
    if (!record || record.status === 'idle') return { state: 'idle', badge: '', busy: false };
    if (ACTIVE_STATUSES.has(record.status)) {
      const badge = record.status === 'downloading' ? 'DL'
        : record.status === 'transcribing' ? 'TXT'
          : record.status === 'analyzing' ? 'AI…'
            : record.status === 'cancelling' ? '×' : '…';
      return { state: 'processing', badge, busy: true };
    }
    if (record.status === 'ready') return { state: 'ready', badge: 'AI', busy: false };
    if (record.status === 'transcribed') return { state: 'partial', badge: 'TXT', busy: false };
    if (['cancelled', 'interrupted'].includes(record.status)) return { state: 'stopped', badge: '■', busy: false };
    if (record.status === 'error') return { state: 'error', badge: '!', busy: false };
    return { state: 'idle', badge: '', busy: false };
  }

  function setText(node, value) {
    const next = String(value == null ? '' : value);
    if (node && node.textContent !== next) node.textContent = next;
  }

  function setTitle(node, value) {
    const next = String(value == null ? '' : value);
    if (node && node.title !== next) node.title = next;
  }

  function setData(node, key, value) {
    const next = String(value == null ? '' : value);
    if (node && node.dataset?.[key] !== next) node.dataset[key] = next;
  }

  function refreshOne(recordId) {
    const view = mounted.get(recordId);
    if (!view?.root?.isConnected) {
      mounted.delete(recordId);
      return;
    }
    const record = records[recordId] || null;
    const state = viewState(record);
    setData(view.run, 'mode', state.busy ? 'cancel' : 'run');
    setText(view.run, state.busy ? '×' : (record && record.status !== 'idle' ? '↻' : '✦'));
    setTitle(view.run, state.busy
      ? 'Отменить текущую обработку'
      : record && record.status !== 'idle'
        ? 'Продолжить/перезапустить разбор этого звонка'
        : 'Разобрать этот звонок');
    setData(view.result, 'state', state.state);
    setText(view.result, state.badge);
    setTitle(view.result, state.state === 'ready' ? 'AI-разбор готов'
      : state.state === 'error' ? 'Ошибка разбора'
        : state.state === 'stopped' ? 'Обработка остановлена — можно продолжить' : 'Состояние разбора');
  }

  function refreshAll() {
    for (const recordId of mounted.keys()) refreshOne(recordId);
  }

  async function refreshStatus(recordId = '') {
    try {
      const data = await runtimeRequest(STATUS, recordId ? { recordId } : {});
      if (recordId) {
        if (data) records = { ...records, [recordId]: data };
        else if (records[recordId]) {
          const next = { ...records };
          delete next[recordId];
          records = next;
        }
        refreshOne(recordId);
      } else {
        records = data && typeof data === 'object' ? data : {};
        refreshAll();
      }
      return data;
    } catch (error) {
      console.warn('[SIMNET Workbench][PBX MANUAL ANALYSIS] status unavailable', error);
      return null;
    }
  }

  async function requestAnalysis(call) {
    const old = records[call.recordId] || null;
    records = { ...records, [call.recordId]: { ...(old || {}), recordId: call.recordId, call, status: 'queued', error: '', aiError: '' } };
    refreshOne(call.recordId);
    try {
      const result = await runtimeRequest(START, {
        call: {
          recordId: call.recordId,
          rowNumber: call.rowNumber,
          date: call.date,
          time: call.time,
          callerId: call.callerId,
          providerCode: call.providerCode,
          contract: call.contract,
          fio: call.fio,
          address: call.address,
          duration: call.duration,
          queue: call.queue,
          agent: call.agent
        },
        force: Boolean(old),
        forceTranscribe: false,
        forceAnalysis: Boolean(old)
      });
      if (result) records = { ...records, [call.recordId]: result };
    } catch (error) {
      records = { ...records, [call.recordId]: { ...(records[call.recordId] || {}), status: 'error', error: compact(error?.message || error || 'Не удалось запустить разбор', 700) } };
      console.error('[SIMNET Workbench][PBX MANUAL ANALYSIS]', error);
    }
    refreshOne(call.recordId);
  }

  async function cancelAnalysis(call) {
    const previous = records[call.recordId] || {};
    records = { ...records, [call.recordId]: { ...previous, recordId: call.recordId, call, status: 'cancelling' } };
    refreshOne(call.recordId);
    try {
      const result = await runtimeRequest(CANCEL, { recordId: call.recordId });
      if (result) records = { ...records, [call.recordId]: result };
    } catch (error) {
      records = { ...records, [call.recordId]: { ...previous, status: 'error', error: compact(error?.message || error || 'Не удалось отменить обработку', 700) } };
    }
    refreshOne(call.recordId);
  }

  function addText(parent, label, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const section = document.createElement('div');
    section.className = 's';
    const title = document.createElement('div');
    title.className = 'l';
    title.textContent = label;
    const body = document.createElement('div');
    body.textContent = text;
    section.append(title, body);
    parent.appendChild(section);
  }

  function ensurePopover() {
    let popover = document.getElementById(POPOVER_ID);
    if (!popover) {
      popover = document.createElement('div');
      popover.id = POPOVER_ID;
      popover.dataset.open = '0';
      popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      popover.addEventListener('mouseleave', hidePopoverSoon);
      document.body.appendChild(popover);
    }
    return popover;
  }

  function showPopover(recordId, anchor) {
    clearTimeout(hideTimer);
    const record = records[recordId];
    if (!record) return;
    void refreshStatus(recordId);

    const popover = ensurePopover();
    popover.replaceChildren();
    const head = document.createElement('div');
    head.className = 'h';
    head.textContent = record.analysis?.summary || 'Разбор звонка';
    const meta = document.createElement('div');
    meta.className = 'm';
    meta.textContent = [record.call?.date, record.call?.time, record.call?.duration, record.call?.callerId, record.call?.agent].filter(Boolean).join(' · ');
    popover.append(head, meta);

    if (record.status === 'error') addText(popover, 'Ошибка', record.error || 'Неизвестная ошибка');
    else if (record.status === 'cancelled') addText(popover, 'Статус', 'Обработка отменена. Нажмите ↻ возле звонка, чтобы продолжить.');
    else if (record.status === 'interrupted') addText(popover, 'Статус', record.error || 'Обработка была прервана. Нажмите ↻, чтобы продолжить.');
    else if (ACTIVE_STATUSES.has(record.status)) {
      const text = record.status === 'downloading' ? 'Загружается запись из PBX. Нажмите ×, чтобы отменить.'
        : record.status === 'transcribing' ? 'Whisper распознаёт аудио. Нажмите ×, чтобы отменить.'
          : record.status === 'analyzing' ? 'Транскрипт готов; идёт AI-разбор. Нажмите ×, чтобы отменить.'
            : 'Звонок находится в обработке.';
      addText(popover, 'Статус', text);
    } else {
      addText(popover, 'Суть', record.analysis?.summary);
      addText(popover, 'Причина обращения', record.analysis?.issue);
      addText(popover, 'Действия оператора', record.analysis?.actions);
      addText(popover, 'Результат', record.analysis?.result);
      addText(popover, 'Следующий шаг', record.analysis?.nextStep);
      if (record.aiError) addText(popover, 'AI', `${record.aiError} Транскрипт сохранён.`);
    }

    const transcript = record.analysis?.cleanText || record.transcript?.text || '';
    if (transcript) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Транскрипт';
      const pre = document.createElement('pre');
      pre.textContent = transcript;
      details.append(summary, pre);
      popover.appendChild(details);
    }

    popover.dataset.open = '1';
    popover.style.left = '10px';
    popover.style.top = '10px';
    const rect = anchor.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    let left = rect.right + 7;
    if (left + box.width > innerWidth - 10) left = rect.left - box.width - 7;
    left = Math.max(10, Math.min(left, innerWidth - box.width - 10));
    let top = Math.max(10, rect.top - 8);
    if (top + box.height > innerHeight - 10) top = Math.max(10, innerHeight - box.height - 10);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function hidePopoverSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const popover = document.getElementById(POPOVER_ID);
      if (popover) popover.dataset.open = '0';
    }, 180);
  }

  function mount(call) {
    if (mounted.get(call.recordId)?.root?.isConnected) return;
    if (call.callCell.querySelector(`.wb-pbx-manual-tools[data-record-id="${call.recordId}"]`)) return;
    const root = document.createElement('span');
    root.className = 'wb-pbx-manual-tools';
    root.dataset.recordId = call.recordId;
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'wb-pbx-manual-run';
    run.textContent = '✦';
    run.title = 'Разобрать этот звонок';
    run.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const record = records[call.recordId] || null;
      if (record && ACTIVE_STATUSES.has(record.status)) void cancelAnalysis(call);
      else void requestAnalysis(call);
    });
    const result = document.createElement('span');
    result.className = 'wb-pbx-manual-result';
    result.dataset.state = 'idle';
    result.tabIndex = 0;
    result.addEventListener('mouseenter', () => showPopover(call.recordId, result));
    result.addEventListener('mouseleave', hidePopoverSoon);
    result.addEventListener('focus', () => showPopover(call.recordId, result));
    result.addEventListener('blur', hidePopoverSoon);
    root.append(run, result);
    call.callCell.appendChild(root);
    mounted.set(call.recordId, { root, run, result, call });
    refreshOne(call.recordId);
  }

  function isOwnedMutationNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element) return false;
    return Boolean(
      element.matches?.('.wb-pbx-manual-tools,#simnet-wb-pbx-manual-analysis-popover')
      || element.closest?.('.wb-pbx-manual-tools,#simnet-wb-pbx-manual-analysis-popover')
    );
  }

  function mutationNeedsScan(mutations = []) {
    return mutations.some(mutation => {
      const target = mutation?.target?.nodeType === 1 ? mutation.target : mutation?.target?.parentElement;
      if (isOwnedMutationNode(target)) return false;

      const changedNodes = [
        ...Array.from(mutation?.addedNodes || []),
        ...Array.from(mutation?.removedNodes || [])
      ].filter(node => node?.nodeType === 1);
      if (changedNodes.length && changedNodes.every(isOwnedMutationNode)) return false;

      if (target?.closest?.('table')) return true;
      return changedNodes.some(node => (
        String(node.tagName || '').toLowerCase() === 'table'
        || Boolean(node.querySelector?.('table'))
      ));
    });
  }

  function scan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      installStyle();
      for (const call of parseCalls()) mount(call);
    }, 80);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    const recordId = String(message?.payload?.recordId || '');
    if (recordId) void refreshStatus(recordId);
    else void refreshStatus();
    return false;
  });

  const observer = new MutationObserver(mutations => {
    if (mutationNeedsScan(mutations)) scan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installStyle();
  void refreshStatus();
  scan();
})();
