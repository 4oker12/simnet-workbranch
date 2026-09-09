(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const START = 'PBX_MANUAL_ANALYSIS_START';
  const CANCEL = 'PBX_MANUAL_ANALYSIS_CANCEL';
  const STATUS = 'PBX_MANUAL_ANALYSIS_STATUS';
  const ASK = 'PBX_TRANSCRIPT_ASK';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const PAGE_STYLE_ID = 'simnet-wb-pbx-manual-analysis-page-style';
  const HOST_ID = 'simnet-wb-pbx-analysis-host';
  const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'analyzing', 'cancelling']);
  const mounted = new Map();
  const qaState = new Map();

  let records = {};
  let activeRecordId = '';
  let activeAnchor = null;
  let pinnedRecordId = '';
  let hideTimer = 0;
  let cardHover = false;

  function compact(value, max = 320) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function headerKey(value) {
    return compact(value, 80).toLowerCase().replace(/[^a-z0-9_#]+/g, '');
  }

  function phoneOf(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    return digits.length >= 6 && digits.length <= 15 ? digits : '';
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

  function installPageStyle() {
    if (document.getElementById(PAGE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    style.textContent = `
      .wb-pbx-manual-tools{all:initial!important;display:inline-flex!important;align-items:center!important;gap:4px!important;margin-left:6px!important;vertical-align:middle!important;white-space:nowrap!important;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif!important}
      .wb-pbx-manual-run,.wb-pbx-manual-result{all:unset!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:24px!important;height:24px!important;box-sizing:border-box!important;border:1px solid #d8e0e8!important;border-radius:7px!important;background:#fff!important;color:#344256!important;box-shadow:0 1px 2px rgba(15,23,42,.05)!important;font:800 11px/1 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif!important;cursor:pointer!important;user-select:none!important}
      .wb-pbx-manual-run:hover,.wb-pbx-manual-result:hover{border-color:#b7c2ce!important;box-shadow:0 2px 6px rgba(15,23,42,.10)!important}
      .wb-pbx-manual-run{color:#a50046!important}
      .wb-pbx-manual-run[data-mode="cancel"]{background:#fff5f5!important;border-color:#efb7b7!important;color:#a33232!important}
      .wb-pbx-manual-result[data-state="idle"]{visibility:hidden!important;pointer-events:none!important}
      .wb-pbx-manual-result[data-state="processing"]{background:#fff8e6!important;border-color:#ead18a!important;color:#805d00!important;cursor:progress!important}
      .wb-pbx-manual-result[data-state="ready"]{background:#ecfdf3!important;border-color:#a8d7b7!important;color:#23723b!important}
      .wb-pbx-manual-result[data-state="partial"]{background:#eef7fb!important;border-color:#b8d4e0!important;color:#376477!important}
      .wb-pbx-manual-result[data-state="stopped"]{background:#f4f6f8!important;border-color:#d7dde4!important;color:#5f6c7b!important}
      .wb-pbx-manual-result[data-state="error"]{background:#fff1f1!important;border-color:#efb7b7!important;color:#a33232!important}
    `;
    document.documentElement.appendChild(style);
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) return host;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}
      *{box-sizing:border-box}
      [hidden]{display:none!important}
      .card{position:fixed;pointer-events:auto;width:min(640px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 24px));overflow:auto;background:#fff;color:#14213d;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 18px 48px rgba(15,23,42,.20);font:13px/1.48 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;scrollbar-width:thin}
      .head{padding:16px 18px 12px;border-bottom:1px solid #eef2f6;background:rgba(255,255,255,.98);position:sticky;top:0;z-index:2}
      .titleRow{display:flex;align-items:center;gap:10px}
      .title{font-size:19px;font-weight:800;line-height:1.15;color:#14213d;letter-spacing:-.01em}
      .status{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;background:#f2f4f7;color:#667085;font-size:11px;font-weight:750;white-space:nowrap}
      .status::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.85}
      .status[data-tone="ready"]{background:#eaf8ef;color:#24864a}
      .status[data-tone="busy"]{background:#fff7e8;color:#8a6700}
      .status[data-tone="partial"]{background:#edf7fb;color:#376477}
      .status[data-tone="error"]{background:#fff0f0;color:#a33232}
      .tools{margin-left:auto;display:flex;align-items:center;gap:3px}
      .iconBtn{appearance:none;border:0;background:transparent;color:#344256;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font:700 16px/1 Inter,system-ui;cursor:pointer}
      .iconBtn:hover{background:#f3f6f9}
      .iconBtn[data-active="1"]{background:#fceef4;color:#a50046}
      .meta{display:flex;flex-wrap:wrap;align-items:center;gap:0;margin-top:8px;color:#718096;font-size:11px}
      .meta span+span::before{content:'·';display:inline-block;margin:0 7px;color:#b7c0cb}
      .body{padding:14px 18px 16px}
      .topic{margin:0 0 14px;padding:13px 15px;border-left:4px solid #a50046;border-radius:10px;background:linear-gradient(90deg,#fff2f7 0%,#fbf6f9 100%);color:#16213b;font-size:14px;font-weight:700;line-height:1.48}
      .fact{display:grid;grid-template-columns:155px minmax(0,1fr);gap:16px;padding:11px 0;border-bottom:1px solid #eef2f6}
      .fact:last-of-type{border-bottom:0}
      .factLabel{color:#344256;font-size:12px;font-weight:750}
      .factText{color:#526178;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
      .notice{padding:10px 0;color:#526178;font-size:13px}
      .notice[data-tone="error"]{color:#a33232}
      .qa{margin-top:14px;padding-top:14px;border-top:1px solid #e9eef3}
      .qaLabel{margin-bottom:7px;color:#243247;font-size:12px;font-weight:750}
      .qaRow{display:flex;align-items:center;gap:7px}
      .qaInput{min-width:0;flex:1;height:38px;padding:8px 11px;border:1px solid #d7e0e8;border-radius:10px;background:#fff;color:#263648;outline:none;font:13px/1.3 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      .qaInput::placeholder{color:#98a2b3}
      .qaInput:focus{border-color:#a7b3c1;box-shadow:0 0 0 3px rgba(148,163,184,.13)}
      .qaSend{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:10px;background:#a50046;color:#fff;font:800 18px/1 Inter,system-ui;cursor:pointer;box-shadow:0 2px 6px rgba(165,0,70,.18)}
      .qaSend:hover{background:#8f003d}
      .qaSend:disabled{opacity:.55;cursor:wait}
      .answer{margin-top:9px;padding:11px 13px;border-radius:10px;background:#f6f8fb;color:#344256;font-size:13px;line-height:1.48;white-space:pre-wrap;overflow-wrap:anywhere}
      .answer[data-tone="error"]{background:#fff5f5;color:#9b2c2c}
      details.tech{margin-top:13px;padding-top:11px;border-top:1px solid #eef2f6;color:#7a8594}
      details.tech summary{cursor:pointer;list-style:none;font-size:10.5px;font-weight:650;user-select:none}
      details.tech summary::-webkit-details-marker{display:none}
      details.tech summary::after{content:'›';float:right;color:#a3acb8}
      details.tech[open] summary::after{transform:rotate(90deg)}
      .techBody{padding-top:8px;color:#8993a1;font-size:10px;line-height:1.45;overflow-wrap:anywhere}
      @media(max-width:620px){.card{width:calc(100vw - 16px);border-radius:13px}.head{padding:13px 14px 10px}.body{padding:12px 14px 14px}.fact{grid-template-columns:1fr;gap:3px}.title{font-size:17px}}
    `;

    const card = document.createElement('section');
    card.className = 'card';
    card.hidden = true;
    card.addEventListener('mouseenter', () => {
      cardHover = true;
      clearTimeout(hideTimer);
    });
    card.addEventListener('mouseleave', () => {
      cardHover = false;
      scheduleHide();
    });

    shadow.append(style, card);
    document.documentElement.appendChild(host);
    return host;
  }

  function cardNode() {
    return ensureHost().shadowRoot.querySelector('.card');
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
    if (!chrome?.runtime?.id) throw new Error('Extension context invalidated');
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function viewState(record) {
    if (!record || record.status === 'idle') return { state: 'idle', badge: '', busy: false };
    if (ACTIVE_STATUSES.has(record.status)) return { state: 'processing', badge: '…', busy: true };
    if (record.status === 'ready') return { state: 'ready', badge: '✓', busy: false };
    if (record.status === 'transcribed') return { state: 'partial', badge: 'TXT', busy: false };
    if (['cancelled', 'interrupted'].includes(record.status)) return { state: 'stopped', badge: '■', busy: false };
    if (record.status === 'error') return { state: 'error', badge: '!', busy: false };
    return { state: 'idle', badge: '', busy: false };
  }

  function setText(node, value) {
    const next = String(value == null ? '' : value);
    if (node && node.textContent !== next) node.textContent = next;
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
    view.run.title = state.busy ? 'Отменить текущую обработку' : record ? 'Повторить разбор этого звонка' : 'Разобрать этот звонок';
    setData(view.result, 'state', state.state);
    setText(view.result, state.badge);
    view.result.title = state.state === 'ready' ? 'Разбор готов' : state.state === 'error' ? 'Ошибка разбора' : 'Состояние разбора';
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
        if (activeRecordId === recordId) renderCard(recordId, activeAnchor);
      } else {
        records = data && typeof data === 'object' ? data : {};
        refreshAll();
        if (activeRecordId) renderCard(activeRecordId, activeAnchor);
      }
      return data;
    } catch (error) {
      if (!/Extension context invalidated/i.test(String(error?.message || error))) {
        console.warn('[SIMNET Workbench][PBX MANUAL ANALYSIS] status unavailable', error);
      }
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
    if (activeRecordId === call.recordId) renderCard(call.recordId, activeAnchor);
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
    if (activeRecordId === call.recordId) renderCard(call.recordId, activeAnchor);
  }

  function statusPresentation(record = {}) {
    const status = String(record.status || 'idle');
    if (status === 'ready') return { text: 'Готово', tone: 'ready' };
    if (status === 'transcribed') return { text: 'Текст готов', tone: 'partial' };
    if (status === 'downloading') return { text: 'Загрузка записи…', tone: 'busy' };
    if (status === 'transcribing') return { text: 'Расшифровка…', tone: 'busy' };
    if (status === 'analyzing') return { text: 'Разбор…', tone: 'busy' };
    if (status === 'queued') return { text: 'В очереди', tone: 'busy' };
    if (status === 'cancelling') return { text: 'Остановка…', tone: 'busy' };
    if (status === 'error') return { text: 'Ошибка', tone: 'error' };
    return { text: 'Остановлено', tone: 'stopped' };
  }

  function formatTokens(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.max(0, Number(value || 0) || 0));
  }

  function technicalText(record = {}) {
    const analysis = record.analysis || {};
    const usage = analysis.usage || {};
    const parts = [];
    if (analysis.model) parts.push(`Модель: ${analysis.model}`);
    if (usage.totalTokens || usage.promptTokens || usage.completionTokens) {
      parts.push(`Токены: ${formatTokens(usage.totalTokens || (Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0)))}`);
      parts.push(`вход ${formatTokens(usage.promptTokens)}`);
      parts.push(`ответ ${formatTokens(usage.completionTokens)}`);
    }
    return parts.join(' · ');
  }

  function appendMeta(meta, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const span = document.createElement('span');
    span.textContent = text;
    meta.appendChild(span);
  }

  function addFact(body, label, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const row = document.createElement('div');
    row.className = 'fact';
    const left = document.createElement('div');
    left.className = 'factLabel';
    left.textContent = label;
    const right = document.createElement('div');
    right.className = 'factText';
    right.textContent = text;
    row.append(left, right);
    body.appendChild(row);
  }

  function cleanAnswer(value) {
    let text = String(value || '').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
    text = text.replace(/^\s*(?:ОТВЕТ|ANSWER)\s*:\s*/i, '').trim();
    if (/^(?:here'?s? (?:a )?thinking process|analy[sz]e user input|scan transcript)/i.test(text)) return '';
    return text.slice(0, 1800);
  }

  function positionCard(anchor) {
    const card = cardNode();
    if (!card || card.hidden || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + box.width > innerWidth - 10) left = rect.left - box.width - 8;
    left = Math.max(10, Math.min(left, innerWidth - box.width - 10));
    let top = Math.max(10, rect.top - 10);
    if (top + box.height > innerHeight - 10) top = Math.max(10, innerHeight - box.height - 10);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  function closeCard() {
    clearTimeout(hideTimer);
    const card = cardNode();
    card.hidden = true;
    pinnedRecordId = '';
    activeRecordId = '';
    activeAnchor = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (pinnedRecordId) return;
    hideTimer = setTimeout(() => {
      if (cardHover || pinnedRecordId) return;
      const card = cardNode();
      card.hidden = true;
      activeRecordId = '';
      activeAnchor = null;
    }, 180);
  }

  function renderCard(recordId, anchor) {
    const record = records[recordId];
    if (!record) return;
    activeRecordId = recordId;
    if (anchor) activeAnchor = anchor;

    const host = ensureHost();
    const shadow = host.shadowRoot;
    const card = shadow.querySelector('.card');
    card.replaceChildren();
    card.hidden = false;

    const head = document.createElement('div');
    head.className = 'head';
    const titleRow = document.createElement('div');
    titleRow.className = 'titleRow';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Разбор звонка';
    const state = statusPresentation(record);
    const status = document.createElement('span');
    status.className = 'status';
    status.dataset.tone = state.tone;
    status.textContent = state.text;
    const tools = document.createElement('div');
    tools.className = 'tools';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'iconBtn';
    pin.dataset.active = pinnedRecordId === recordId ? '1' : '0';
    pin.title = pinnedRecordId === recordId ? 'Открепить окно' : 'Закрепить окно';
    pin.textContent = '⌖';
    pin.addEventListener('click', event => {
      event.stopPropagation();
      pinnedRecordId = pinnedRecordId === recordId ? '' : recordId;
      renderCard(recordId, activeAnchor);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'iconBtn';
    close.title = 'Закрыть';
    close.textContent = '×';
    close.addEventListener('click', event => {
      event.stopPropagation();
      closeCard();
    });
    tools.append(pin, close);
    titleRow.append(title, status, tools);

    const meta = document.createElement('div');
    meta.className = 'meta';
    appendMeta(meta, record.call?.date);
    appendMeta(meta, record.call?.time);
    appendMeta(meta, record.call?.duration);
    appendMeta(meta, record.call?.callerId);
    appendMeta(meta, record.call?.agent);
    if (record.call?.contract) appendMeta(meta, `Договор ${record.call.contract}`);
    head.append(titleRow, meta);

    const body = document.createElement('div');
    body.className = 'body';

    if (record.status === 'error') {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.dataset.tone = 'error';
      notice.textContent = record.error || 'Не удалось выполнить разбор.';
      body.appendChild(notice);
    } else if (ACTIVE_STATUSES.has(record.status)) {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = state.text;
      body.appendChild(notice);
    } else {
      const summary = String(record.analysis?.summary || '').trim();
      if (summary) {
        const topic = document.createElement('div');
        topic.className = 'topic';
        topic.textContent = summary;
        body.appendChild(topic);
      }
      addFact(body, 'Причина обращения', record.analysis?.issue);
      addFact(body, 'Действия оператора', record.analysis?.actions);
      addFact(body, 'Результат', record.analysis?.result);

      const qa = document.createElement('form');
      qa.className = 'qa';
      const qaLabel = document.createElement('div');
      qaLabel.className = 'qaLabel';
      qaLabel.textContent = 'Спросить по разговору';
      const qaRow = document.createElement('div');
      qaRow.className = 'qaRow';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 600;
      input.autocomplete = 'off';
      input.className = 'qaInput';
      input.placeholder = 'Задайте любой вопрос по этому звонку…';
      const saved = qaState.get(recordId) || { question: '', answer: '', error: '', loading: false };
      input.value = saved.question || '';
      const send = document.createElement('button');
      send.type = 'submit';
      send.className = 'qaSend';
      send.textContent = '↑';
      send.disabled = Boolean(saved.loading);
      qaRow.append(input, send);
      qa.append(qaLabel, qaRow);

      const answer = document.createElement('div');
      answer.className = 'answer';
      const paintAnswer = current => {
        if (!current || (!current.loading && !current.answer && !current.error)) {
          answer.hidden = true;
          answer.textContent = '';
          return;
        }
        answer.hidden = false;
        answer.dataset.tone = current.error ? 'error' : '';
        answer.textContent = current.loading ? 'Ищу ответ в разговоре…' : (current.error || cleanAnswer(current.answer) || 'Краткий ответ не получен.');
      };
      paintAnswer(saved);
      qa.appendChild(answer);

      qa.addEventListener('submit', event => {
        event.preventDefault();
        event.stopPropagation();
        const question = String(input.value || '').trim();
        if (!question || send.disabled) return;
        const pending = { question, answer: '', error: '', loading: true };
        qaState.set(recordId, pending);
        send.disabled = true;
        paintAnswer(pending);
        void runtimeRequest(ASK, { recordId, question })
          .then(result => {
            const done = { question, answer: cleanAnswer(result?.answer || ''), error: '', loading: false };
            qaState.set(recordId, done);
            send.disabled = false;
            paintAnswer(done);
          })
          .catch(error => {
            const failed = { question, answer: '', error: compact(error?.message || error || 'Не удалось получить ответ', 500), loading: false };
            qaState.set(recordId, failed);
            send.disabled = false;
            paintAnswer(failed);
          });
      });
      body.appendChild(qa);

      const tech = technicalText(record);
      if (tech) {
        const details = document.createElement('details');
        details.className = 'tech';
        const summaryNode = document.createElement('summary');
        summaryNode.textContent = 'Технические данные';
        const techBody = document.createElement('div');
        techBody.className = 'techBody';
        techBody.textContent = tech;
        details.append(summaryNode, techBody);
        body.appendChild(details);
      }
    }

    card.append(head, body);
    requestAnimationFrame(() => positionCard(activeAnchor));
  }

  function openCard(recordId, anchor, pin = false) {
    clearTimeout(hideTimer);
    if (pinnedRecordId && pinnedRecordId !== recordId && !pin) return;
    if (pin) pinnedRecordId = recordId;
    renderCard(recordId, anchor);
    void refreshStatus(recordId);
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

    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'wb-pbx-manual-result';
    result.dataset.state = 'idle';
    result.addEventListener('mouseenter', () => openCard(call.recordId, result, false));
    result.addEventListener('mouseleave', scheduleHide);
    result.addEventListener('focus', () => openCard(call.recordId, result, false));
    result.addEventListener('blur', scheduleHide);
    result.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (pinnedRecordId === call.recordId) {
        pinnedRecordId = '';
        openCard(call.recordId, result, false);
      } else {
        openCard(call.recordId, result, true);
      }
    });

    root.append(run, result);
    call.callCell.appendChild(root);
    mounted.set(call.recordId, { root, run, result, call });
    refreshOne(call.recordId);
  }

  function mountCurrentPage() {
    installPageStyle();
    ensureHost();
    for (const call of parseCalls()) mount(call);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    const recordId = String(message?.payload?.recordId || '');
    if (recordId) void refreshStatus(recordId);
    else void refreshStatus();
    return false;
  });

  window.addEventListener('resize', () => {
    if (activeRecordId && activeAnchor) requestAnimationFrame(() => positionCard(activeAnchor));
  }, { passive: true });

  installPageStyle();
  ensureHost();
  mountCurrentPage();
  void refreshStatus();
})();
