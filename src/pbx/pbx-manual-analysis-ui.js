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
      .wb-pbx-manual-tools{display:inline-flex;align-items:center;gap:4px;width:54px;margin-left:6px;vertical-align:middle;white-space:nowrap}
      .wb-pbx-manual-run,.wb-pbx-manual-result{height:24px;width:25px;min-width:25px;box-sizing:border-box;padding:0 4px;border:1px solid #d5dde6;border-radius:7px;background:#fff;color:#344256;box-shadow:0 1px 2px rgba(15,23,42,.05);font:800 10px/22px Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-align:center;cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
      .wb-pbx-manual-run:hover,.wb-pbx-manual-result:hover{border-color:#b7c2ce;box-shadow:0 2px 6px rgba(15,23,42,.10)}
      .wb-pbx-manual-run{color:#a50046}
      .wb-pbx-manual-run[data-mode="cancel"]{background:#fff5f5;border-color:#efb7b7;color:#a33232}
      .wb-pbx-manual-result[data-state="idle"]{visibility:hidden;pointer-events:none}
      .wb-pbx-manual-result[data-state="processing"]{background:#fff8e6;border-color:#ead18a;color:#805d00;cursor:progress}
      .wb-pbx-manual-result[data-state="ready"]{background:#ecfdf3;border-color:#a8d7b7;color:#23723b}
      .wb-pbx-manual-result[data-state="partial"]{background:#eef7fb;border-color:#b8d4e0;color:#376477}
      .wb-pbx-manual-result[data-state="stopped"]{background:#f4f6f8;border-color:#d7dde4;color:#5f6c7b}
      .wb-pbx-manual-result[data-state="error"]{background:#fff1f1;border-color:#efb7b7;color:#a33232}

      #${POPOVER_ID}{position:fixed;z-index:2147483645;display:none;width:min(540px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 24px));overflow:auto;box-sizing:border-box;padding:0;border:1px solid #dce3eb;border-radius:16px;background:#f8fafc;color:#243247;box-shadow:0 18px 50px rgba(15,23,42,.24);font:12px/1.48 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;scrollbar-width:thin}
      #${POPOVER_ID}[data-open="1"]{display:block}
      #${POPOVER_ID} .wb-card-head{position:sticky;top:0;z-index:2;padding:14px 15px 12px;border-bottom:1px solid #e7ebf0;background:rgba(255,255,255,.98);backdrop-filter:blur(8px)}
      #${POPOVER_ID} .wb-card-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
      #${POPOVER_ID} .h{min-width:0;color:#243247;font-size:14px;font-weight:850;line-height:1.2}
      #${POPOVER_ID} .wb-status{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:9px;font-weight:850;letter-spacing:.01em}
      #${POPOVER_ID} .wb-status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
      #${POPOVER_ID} .wb-status[data-tone="ready"]{background:#ecfdf3;color:#23723b}
      #${POPOVER_ID} .wb-status[data-tone="busy"]{background:#fff8e6;color:#805d00}
      #${POPOVER_ID} .wb-status[data-tone="partial"]{background:#eef7fb;color:#376477}
      #${POPOVER_ID} .wb-status[data-tone="error"]{background:#fff1f1;color:#a33232}
      #${POPOVER_ID} .wb-status[data-tone="stopped"]{background:#f2f4f7;color:#667085}
      #${POPOVER_ID} .m{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;color:#667085;font-size:10px}
      #${POPOVER_ID} .m span{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border:1px solid #e5eaf0;border-radius:7px;background:#f8fafc;overflow-wrap:anywhere}
      #${POPOVER_ID} .wb-card-body{display:grid;gap:8px;padding:10px}
      #${POPOVER_ID} .s{margin:0;padding:10px 11px;border:1px solid #e1e7ee;border-radius:11px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.025)}
      #${POPOVER_ID} .l{margin-bottom:4px;color:#7b8797;font-size:9px;font-weight:850;letter-spacing:.045em;text-transform:uppercase}
      #${POPOVER_ID} .s>div:last-child{color:#2e3d51;font-size:12px;line-height:1.48;white-space:pre-wrap;overflow-wrap:anywhere}
      #${POPOVER_ID} .s[data-kind="summary"]{border-left:3px solid #a50046;background:#fff}
      #${POPOVER_ID} .s[data-kind="error"]{border-color:#f0c3c3;background:#fff7f7}
      #${POPOVER_ID} .s[data-kind="meta"]{background:#f6f8fb}
      #${POPOVER_ID} details{margin:0;border:1px solid #dfe6ed;border-radius:11px;background:#fff;overflow:hidden}
      #${POPOVER_ID} summary{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;color:#344256;font-size:11px;font-weight:850;cursor:pointer;list-style:none;user-select:none}
      #${POPOVER_ID} summary::-webkit-details-marker{display:none}
      #${POPOVER_ID} summary::after{content:'▾';color:#98a2b3;font-size:11px;transition:transform .12s}
      #${POPOVER_ID} details[open] summary::after{transform:rotate(180deg)}
      #${POPOVER_ID} details[open] summary{border-bottom:1px solid #edf0f4}
      #${POPOVER_ID} pre{margin:0;padding:12px 13px;max-height:310px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#fbfcfd;color:#344256;font:12px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      @media (max-width:620px){#${POPOVER_ID}{width:calc(100vw - 16px);max-height:calc(100vh - 16px);border-radius:13px}#${POPOVER_ID} .wb-card-head{padding:12px}#${POPOVER_ID} .wb-card-body{padding:8px}}
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

  function formatTokens(value) {
    const count = Math.max(0, Number(value || 0) || 0);
    return new Intl.NumberFormat('ru-RU').format(count);
  }

  function tokenUsageText(record = {}) {
    const analysis = record.analysis || {};
    if (!analysis.cleanText) return '';
    const usage = analysis.usage || {};
    const total = Number(usage.totalTokens || 0) || 0;
    const prompt = Number(usage.promptTokens || 0) || 0;
    const completion = Number(usage.completionTokens || 0) || 0;
    const model = String(analysis.model || '').trim();
    if (!total && !prompt && !completion) {
      return [model, 'токены: нет данных (старый разбор)'].filter(Boolean).join(' · ');
    }
    const parts = [
      model,
      `${formatTokens(total || prompt + completion)} токенов всего`,
      `${formatTokens(prompt)} вход`,
      `${formatTokens(completion)} ответ`
    ].filter(Boolean);
    if (Array.isArray(analysis.usageAttempts) && analysis.usageAttempts.length > 1) {
      parts.push(`${analysis.usageAttempts.length} AI-попытки`);
    }
    return parts.join(' · ');
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
    setTitle(view.result, state.state === 'ready' ? `AI-разбор готов${record?.analysis?.usage?.totalTokens ? ` · ${formatTokens(record.analysis.usage.totalTokens)} токенов` : ''}`
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
      console.error('[SIMNET Workbench][PBX MANUAL ANALYSIS] start click failed', { recordId: call.recordId, error });
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
      console.error('[SIMNET Workbench][PBX MANUAL ANALYSIS] cancel click failed', { recordId: call.recordId, error });
    }
    refreshOne(call.recordId);
  }

  function addText(parent, label, value, kind = '') {
    const text = String(value || '').trim();
    if (!text) return;
    const section = document.createElement('div');
    section.className = 's';
    if (kind) section.dataset.kind = kind;
    const title = document.createElement('div');
    title.className = 'l';
    title.textContent = label;
    const body = document.createElement('div');
    body.textContent = text;
    section.append(title, body);
    parent.appendChild(section);
  }

  function statusPresentation(record = {}) {
    const status = String(record.status || 'idle');
    if (status === 'ready') return { text: 'AI готов', tone: 'ready' };
    if (status === 'transcribed') return { text: 'Текст готов', tone: 'partial' };
    if (status === 'downloading') return { text: 'PBX · загрузка', tone: 'busy' };
    if (status === 'transcribing') return { text: 'Whisper', tone: 'busy' };
    if (status === 'analyzing') return { text: 'AI анализ', tone: 'busy' };
    if (status === 'queued') return { text: 'В очереди', tone: 'busy' };
    if (status === 'cancelling') return { text: 'Остановка', tone: 'busy' };
    if (status === 'error') return { text: 'Ошибка', tone: 'error' };
    if (status === 'cancelled') return { text: 'Отменено', tone: 'stopped' };
    if (status === 'interrupted') return { text: 'Прервано', tone: 'stopped' };
    return { text: 'Звонок', tone: 'stopped' };
  }

  function appendMeta(meta, value, label = '') {
    const text = String(value || '').trim();
    if (!text) return;
    const chip = document.createElement('span');
    chip.textContent = label ? `${label}: ${text}` : text;
    meta.appendChild(chip);
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

    const cardHead = document.createElement('div');
    cardHead.className = 'wb-card-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'wb-card-title-row';
    const head = document.createElement('div');
    head.className = 'h';
    head.textContent = 'Разбор звонка';
    const status = statusPresentation(record);
    const statusNode = document.createElement('span');
    statusNode.className = 'wb-status';
    statusNode.dataset.tone = status.tone;
    statusNode.textContent = status.text;
    titleRow.append(head, statusNode);

    const meta = document.createElement('div');
    meta.className = 'm';
    appendMeta(meta, [record.call?.date, record.call?.time].filter(Boolean).join(' '));
    appendMeta(meta, record.call?.duration, 'Длительность');
    appendMeta(meta, record.call?.callerId, 'Номер');
    appendMeta(meta, record.call?.agent, 'Оператор');
    appendMeta(meta, record.call?.contract, 'Договор');
    cardHead.append(titleRow, meta);

    const body = document.createElement('div');
    body.className = 'wb-card-body';
    popover.append(cardHead, body);

    if (record.status === 'error') addText(body, 'Ошибка', record.error || 'Неизвестная ошибка', 'error');
    else if (record.status === 'cancelled') addText(body, 'Статус', 'Обработка отменена. Нажмите ↻ возле звонка, чтобы продолжить.', 'meta');
    else if (record.status === 'interrupted') addText(body, 'Статус', record.error || 'Обработка была прервана. Нажмите ↻, чтобы продолжить.', 'meta');
    else if (ACTIVE_STATUSES.has(record.status)) {
      const text = record.status === 'downloading' ? 'Загружается запись из PBX. Нажмите ×, чтобы отменить.'
        : record.status === 'transcribing' ? 'Whisper распознаёт аудио. Нажмите ×, чтобы отменить.'
          : record.status === 'analyzing' ? 'Транскрипт готов; идёт AI-разбор. Нажмите ×, чтобы отменить.'
            : record.status === 'queued' ? 'Звонок ожидает своей очереди на обработку.'
              : 'Звонок находится в обработке.';
      addText(body, 'Статус', text, 'meta');
    } else {
      addText(body, 'Суть', record.analysis?.summary, 'summary');
      addText(body, 'Причина обращения', record.analysis?.issue);
      addText(body, 'Действия оператора', record.analysis?.actions);
      addText(body, 'Результат', record.analysis?.result);
      addText(body, 'Следующий шаг', record.analysis?.nextStep);
      if (record.analysis?.cleanText) addText(body, 'AI / токены', tokenUsageText(record), 'meta');
      if (record.aiError) addText(body, 'AI', `${record.aiError} Транскрипт сохранён.`, 'error');
    }

    const transcript = record.analysis?.cleanText || record.transcript?.text || '';
    if (transcript) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Расшифровка · ${new Intl.NumberFormat('ru-RU').format(transcript.length)} симв.`;
      const pre = document.createElement('pre');
      pre.textContent = transcript;
      details.append(summary, pre);
      body.appendChild(details);
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

  function mountCurrentPage() {
    installStyle();
    for (const call of parseCalls()) mount(call);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    const recordId = String(message?.payload?.recordId || '');
    if (recordId) void refreshStatus(recordId);
    else void refreshStatus();
    return false;
  });

  installStyle();
  mountCurrentPage();
  void refreshStatus();
})();
