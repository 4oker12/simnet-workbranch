(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const JOBS_KEY = 'simnet_workbench_pbx_manual_analysis_jobs_v1';
  const START = 'PBX_MANUAL_ANALYSIS_START';
  const STATUS = 'PBX_MANUAL_ANALYSIS_STATUS';
  const STYLE_ID = 'simnet-wb-pbx-manual-analysis-style';
  const POPOVER_ID = 'simnet-wb-pbx-manual-analysis-popover';
  const mounted = new Map();
  let jobs = {};
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
      .wb-pbx-manual-tools{display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle;white-space:nowrap}
      .wb-pbx-manual-run,.wb-pbx-manual-result{height:22px;min-width:24px;box-sizing:border-box;padding:0 5px;border:1px solid #8798a3;border-radius:4px;background:#fff;color:#17384d;font:700 11px/20px Arial,sans-serif;text-align:center;cursor:pointer}
      .wb-pbx-manual-run:disabled{cursor:wait;opacity:.6}
      .wb-pbx-manual-result[data-state="idle"]{display:none}
      .wb-pbx-manual-result[data-state="processing"]{background:#fff7dc;border-color:#bf9b35;color:#6a5200;cursor:progress}
      .wb-pbx-manual-result[data-state="ready"]{background:#e9f6ec;border-color:#4f9461;color:#245d31}
      .wb-pbx-manual-result[data-state="partial"]{background:#edf4f8;border-color:#6e91a5;color:#36586b}
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

  function viewState(job) {
    if (!job) return { state: 'idle', badge: '', busy: false };
    if (['queued', 'downloading', 'transcribing', 'analyzing'].includes(job.status)) {
      const badge = job.status === 'downloading' ? 'DL' : job.status === 'transcribing' ? 'TXT' : job.status === 'analyzing' ? 'AI…' : '…';
      return { state: 'processing', badge, busy: true };
    }
    if (job.status === 'ready') return { state: 'ready', badge: 'AI', busy: false };
    if (job.status === 'transcribed') return { state: 'partial', badge: 'TXT', busy: false };
    if (job.status === 'error') return { state: 'error', badge: '!', busy: false };
    return { state: 'partial', badge: 'TXT', busy: false };
  }

  function refreshOne(recordId) {
    const view = mounted.get(recordId);
    if (!view?.root?.isConnected) {
      mounted.delete(recordId);
      return;
    }
    const job = jobs[recordId] || null;
    const state = viewState(job);
    view.run.disabled = state.busy;
    view.run.textContent = state.busy ? '…' : (job ? '↻' : '✦');
    view.run.title = job ? 'Повторить разбор этого звонка' : 'Разобрать этот звонок';
    view.result.dataset.state = state.state;
    view.result.textContent = state.badge;
    view.result.title = state.state === 'ready' ? 'AI-разбор готов' : state.state === 'error' ? 'Ошибка разбора' : 'Состояние разбора';
  }

  function refreshAll() {
    for (const recordId of mounted.keys()) refreshOne(recordId);
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  async function requestAnalysis(call) {
    const old = jobs[call.recordId] || null;
    jobs = {
      ...jobs,
      [call.recordId]: {
        ...(old || {}),
        recordId: call.recordId,
        call,
        status: 'queued'
      }
    };
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
      jobs = { ...jobs, [call.recordId]: result };
    } catch (error) {
      jobs = {
        ...jobs,
        [call.recordId]: {
          ...(jobs[call.recordId] || {}),
          status: 'error',
          error: compact(error?.message || error || 'Не удалось запустить разбор', 700)
        }
      };
      console.error('[SIMNET Workbench][PBX MANUAL ANALYSIS]', error);
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
    const job = jobs[recordId];
    if (!job) return;

    const popover = ensurePopover();
    popover.replaceChildren();

    const head = document.createElement('div');
    head.className = 'h';
    head.textContent = job.analysis?.summary || 'Разбор звонка';
    const meta = document.createElement('div');
    meta.className = 'm';
    meta.textContent = [job.call?.date, job.call?.time, job.call?.duration, job.call?.callerId, job.call?.agent].filter(Boolean).join(' · ');
    popover.append(head, meta);

    if (job.status === 'error') {
      addText(popover, 'Ошибка', job.error || 'Неизвестная ошибка');
    } else if (['queued', 'downloading', 'transcribing', 'analyzing'].includes(job.status)) {
      const text = job.status === 'downloading'
        ? 'Загружается запись из PBX.'
        : job.status === 'transcribing'
          ? 'Whisper распознаёт аудио.'
          : job.status === 'analyzing'
            ? 'Транскрипт готов; идёт AI-разбор.'
            : 'Задание поставлено в обработку.';
      addText(popover, 'Статус', text);
    } else {
      addText(popover, 'Суть', job.analysis?.summary);
      addText(popover, 'Причина обращения', job.analysis?.issue);
      addText(popover, 'Действия оператора', job.analysis?.actions);
      addText(popover, 'Результат', job.analysis?.result);
      addText(popover, 'Следующий шаг', job.analysis?.nextStep);
      if (job.aiError) addText(popover, 'AI', `${job.aiError} Транскрипт при этом сохранён.`);
    }

    const transcript = job.analysis?.cleanText || job.transcript?.text || '';
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
      void requestAnalysis(call);
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

  function scan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      installStyle();
      for (const call of parseCalls()) mount(call);
      refreshAll();
    }, 80);
  }

  async function loadJobs() {
    try {
      const data = await runtimeRequest(STATUS);
      jobs = data && typeof data === 'object' ? data : {};
      refreshAll();
    } catch (error) {
      console.warn('[SIMNET Workbench][PBX MANUAL ANALYSIS] status unavailable', error);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[JOBS_KEY]) return;
    const value = changes[JOBS_KEY].newValue;
    jobs = value && typeof value === 'object' ? value : {};
    refreshAll();
  });

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  installStyle();
  void loadJobs();
  scan();
})();
