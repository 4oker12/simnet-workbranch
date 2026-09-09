(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (location.hostname !== 'pbx.simnet.kiev.ua') return;

  const JOBS_KEY = 'simnet_pbx_manual_analysis_jobs_v1';
  const STYLE_ID = 'simnet-wb-pbx-ai-style';
  const POPOVER_ID = 'simnet-wb-pbx-ai-popover';
  const mounted = new Map();
  let jobs = {};
  let scanTimer = 0;
  let hideTimer = 0;

  const compact = (value, max = 320) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const headerKey = value => compact(value, 80).toLowerCase().replace(/[^a-z0-9_#]+/g, '');

  function recordIdOf(cell) {
    if (!cell) return '';
    const values = [
      ...Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick]') || []).flatMap(node => [
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
      .wb-pbx-ai-tools{display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle;white-space:nowrap}
      .wb-pbx-ai-run,.wb-pbx-ai-result{height:22px;min-width:24px;box-sizing:border-box;padding:0 5px;border:1px solid #8798a3;border-radius:4px;background:#fff;color:#17384d;font:700 11px/20px Arial,sans-serif;text-align:center;cursor:pointer}
      .wb-pbx-ai-run:disabled{cursor:wait;opacity:.6}
      .wb-pbx-ai-result[data-state="idle"]{display:none}
      .wb-pbx-ai-result[data-state="processing"]{background:#fff7dc;border-color:#bf9b35;color:#6a5200;cursor:progress}
      .wb-pbx-ai-result[data-state="ready"]{background:#e9f6ec;border-color:#4f9461;color:#245d31}
      .wb-pbx-ai-result[data-state="partial"]{background:#edf4f8;border-color:#6e91a5;color:#36586b}
      .wb-pbx-ai-result[data-state="error"]{background:#fff0f0;border-color:#b85c5c;color:#8a2424}
      #${POPOVER_ID}{position:fixed;z-index:2147483645;display:none;width:min(430px,calc(100vw - 24px));max-height:min(520px,calc(100vh - 24px));overflow:auto;box-sizing:border-box;padding:12px;border:1px solid #7e8f9a;border-radius:7px;background:#fff;color:#152630;box-shadow:0 10px 30px rgba(0,0,0,.22);font:13px/1.42 Arial,sans-serif}
      #${POPOVER_ID}[data-open="1"]{display:block}
      #${POPOVER_ID} .h{font-weight:700;font-size:14px;margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #d8e0e5}
      #${POPOVER_ID} .m{color:#63717a;font-size:11px;margin-bottom:8px}
      #${POPOVER_ID} .s{margin-top:8px}
      #${POPOVER_ID} .l{font-weight:700;color:#3a5261;margin-bottom:2px}
      #${POPOVER_ID} ul{margin:3px 0 0 18px;padding:0}
      #${POPOVER_ID} li{margin:2px 0}
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

  function jobState(job) {
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
    if (!view?.root?.isConnected) return mounted.delete(recordId);
    const job = jobs[recordId] || null;
    const state = jobState(job);
    view.run.disabled = state.busy;
    view.run.textContent = state.busy ? '…' : (job ? '↻' : '✦');
    view.run.title = job ? 'Повторить/дозавершить разбор' : 'Разобрать этот звонок';
    view.result.dataset.state = state.state;
    view.result.textContent = state.badge;
    view.result.title = state.state === 'ready' ? 'AI-разбор готов' : state.state === 'error' ? 'Ошибка разбора' : 'Состояние разбора';
  }

  async function requestAnalysis(call) {
    const view = mounted.get(call.recordId);
    if (view) {
      view.run.disabled = true;
      view.run.textContent = '…';
      view.result.dataset.state = 'processing';
      view.result.textContent = '…';
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PBX_MANUAL_ANALYSIS_START',
        payload: {
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
          force: Boolean(jobs[call.recordId]),
          forceTranscribe: false
        }
      });
      if (!response?.success) throw new Error(response?.error || 'analysis failed');
      jobs = { ...jobs, [call.recordId]: response.data };
    } catch (error) {
      console.error('[SIMNET Workbench][PBX AI]', error);
    }
    refreshOne(call.recordId);
  }

  function addText(parent, label, value) {
    const text = compact(value, 2500);
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

  function addList(parent, label, values) {
    const items = Array.isArray(values) ? values.filter(Boolean).slice(0, 6) : [];
    if (!items.length) return;
    const section = document.createElement('div');
    section.className = 's';
    const title = document.createElement('div');
    title.className = 'l';
    title.textContent = label;
    const ul = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = compact(item, 1000);
      ul.appendChild(li);
    }
    section.append(title, ul);
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
    head.textContent = job.analysis?.topic || 'Разбор звонка';
    const meta = document.createElement('div');
    meta.className = 'm';
    meta.textContent = [job.call?.date, job.call?.time, job.call?.duration, job.call?.callerId].filter(Boolean).join(' · ');
    popover.append(head, meta);

    if (job.status === 'error') {
      addText(popover, 'Ошибка', job.error?.message || 'Неизвестная ошибка');
    } else if (['queued', 'downloading', 'transcribing', 'analyzing'].includes(job.status)) {
      addText(popover, 'Статус', job.status === 'downloading' ? 'Загружается запись из PBX.' : job.status === 'transcribing' ? 'Whisper распознаёт аудио.' : job.status === 'analyzing' ? 'Транскрипт готов; идёт AI-анализ.' : 'Задание поставлено в очередь.');
    } else {
      addText(popover, 'Кратко', job.analysis?.summary || compact(job.transcript?.text, 700));
      addText(popover, 'Что сообщил абонент', job.analysis?.customerProblem);
      addList(popover, 'Факты', job.analysis?.facts);
      addList(popover, 'Действия оператора', job.analysis?.operatorActions);
      addText(popover, 'Вывод', job.analysis?.diagnosis);
      addList(popover, 'Что проверить дальше', job.analysis?.recommendations);
      if (job.ai?.reason) addText(popover, 'AI', job.ai.reason);
    }

    if (job.transcript?.text) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Транскрипт';
      const pre = document.createElement('pre');
      pre.textContent = job.transcript.text;
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
    const selector = `.wb-pbx-ai-tools[data-record-id="${call.recordId.replace(/[^0-9.]/g, '')}"]`;
    const existing = call.callCell.querySelector(selector);
    if (existing) return;

    const root = document.createElement('span');
    root.className = 'wb-pbx-ai-tools';
    root.dataset.recordId = call.recordId;

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'wb-pbx-ai-run';
    run.textContent = '✦';
    run.title = 'Разобрать этот звонок';
    run.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void requestAnalysis(call);
    });

    const result = document.createElement('span');
    result.className = 'wb-pbx-ai-result';
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
    scanTimer = 0;
    installStyle();
    for (const call of parseCalls()) mount(call);
    for (const [recordId, view] of mounted) if (!view.root.isConnected) mounted.delete(recordId);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }

  async function loadJobs() {
    const stored = await chrome.storage.local.get(JOBS_KEY).catch(() => ({}));
    jobs = stored?.[JOBS_KEY] && typeof stored[JOBS_KEY] === 'object' ? stored[JOBS_KEY] : {};
    scan();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[JOBS_KEY]) return;
    jobs = changes[JOBS_KEY].newValue && typeof changes[JOBS_KEY].newValue === 'object' ? changes[JOBS_KEY].newValue : {};
    for (const recordId of mounted.keys()) refreshOne(recordId);
  });

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => (mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement)?.closest?.('table'))) scheduleScan();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => {
    clearTimeout(scanTimer);
    clearTimeout(hideTimer);
    observer.disconnect();
  });
  window.addEventListener('pageshow', () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    void loadJobs();
  });

  globalThis.__SIMNET_WB_PBX_ANALYSIS_UI_TEST_API__ = Object.freeze({ recordIdOf, callFromRow, parseCalls, jobState });

  void loadJobs();
})();
