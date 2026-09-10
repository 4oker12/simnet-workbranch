(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__unifiedJournalLoaded) return;
  WB.__unifiedJournalLoaded = true;

  const HOST_ID = 'simnet-workbench-rail-host';
  const LEGACY_LOG_HOST_ID = 'simnet-workbench-debug-log-host';
  const VIEW_ID = 'wb-unified-journal';
  const STYLE_ID = 'wb-unified-journal-style';
  const MAX_GLOBAL = 400;
  const MAX_CASE_EVENTS = 800;
  const MAX_RENDERED = 300;

  let attachedRoot = null;
  let rootObserver = null;
  let documentObserver = null;
  let refreshQueued = false;
  let refreshRevision = 0;
  let rows = [];
  const filters = {
    caseScope: 'all',
    source: 'all',
    level: 'all',
    search: ''
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const valueOf = value => value && typeof value === 'object' && 'value' in value ? value.value : value;
  const clean = (value, max = 1200) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  function hideLegacyLogUi() {
    const legacy = document.getElementById(LEGACY_LOG_HOST_ID);
    if (legacy) legacy.style.setProperty('display', 'none', 'important');
  }

  function currentCaseId() {
    return String(WB.store?.activeCase?.()?.id || WB.store?.state?.activeCaseId || '');
  }

  function caseLabel(caseData = {}) {
    return clean(
      valueOf(caseData?.identity?.contract)
      || valueOf(caseData?.identity?.login)
      || valueOf(caseData?.profile?.fullName)
      || caseData?.id
      || 'Case',
      90
    );
  }

  function inferCaseLevel(event = {}) {
    const type = String(event?.type || '').toLowerCase();
    const message = String(event?.message || '').toLowerCase();
    if (/error|failed|fatal|critical/.test(type) || /ошиб|failed|fatal/.test(message)) return 'error';
    if (/warning|guard|conflict|mismatch|attention/.test(type) || /конфликт|предупреж|заблок/.test(message)) return 'warn';
    return 'info';
  }

  function detailCaseId(details = {}) {
    if (!details || typeof details !== 'object') return '';
    return String(
      details.caseId
      || details.activeCaseId
      || details.case?.id
      || details.context?.caseId
      || ''
    );
  }

  function normalizeGlobal(entry = {}) {
    return {
      id: `global:${String(entry.id || `${entry.at || ''}:${entry.scope || ''}:${entry.event || ''}`)}`,
      at: String(entry.at || ''),
      timeMs: Date.parse(entry.at || '') || 0,
      source: 'system',
      sourceLabel: String(entry.scope || 'APP').toUpperCase(),
      caseId: detailCaseId(entry.details),
      caseLabel: '',
      level: ['info', 'warn', 'error'].includes(String(entry.level || '').toLowerCase()) ? String(entry.level).toLowerCase() : 'info',
      event: clean(entry.event || 'event', 180),
      message: clean(entry.event || 'event', 320),
      details: entry.details ?? null,
      page: clean(entry.page || '', 240)
    };
  }

  function normalizeCaseEvents(state = {}) {
    const result = [];
    for (const [caseId, caseData] of Object.entries(state?.cases || {})) {
      const label = caseLabel(caseData);
      for (const event of Array.isArray(caseData?.journal) ? caseData.journal : []) {
        result.push({
          id: `case:${caseId}:${String(event?.id || event?.signature || `${event?.at || ''}:${event?.type || ''}`)}`,
          at: String(event?.at || ''),
          timeMs: Date.parse(event?.at || '') || 0,
          source: 'case',
          sourceLabel: 'CASE',
          caseId,
          caseLabel: label,
          level: inferCaseLevel(event),
          event: clean(event?.type || 'case_event', 160),
          message: clean(event?.message || event?.type || 'Событие Case', 360),
          details: event?.details ?? null,
          page: clean(caseData?.currentContext?.pageKind || '', 120)
        });
      }
    }
    return result
      .sort((left, right) => right.timeMs - left.timeMs)
      .slice(0, MAX_CASE_EVENTS);
  }

  function searchable(row = {}) {
    let details = '';
    try { details = JSON.stringify(row.details ?? ''); } catch { details = String(row.details || ''); }
    return [row.at, row.level, row.sourceLabel, row.caseLabel, row.caseId, row.event, row.message, row.page, details]
      .join(' ')
      .toLocaleLowerCase('ru-RU');
  }

  function filteredRows() {
    const activeCaseId = currentCaseId();
    const query = String(filters.search || '').trim().toLocaleLowerCase('ru-RU');
    return rows.filter(row => {
      if (filters.caseScope === 'current' && (!activeCaseId || row.caseId !== activeCaseId)) return false;
      if (filters.source !== 'all' && row.source !== filters.source) return false;
      if (filters.level !== 'all' && row.level !== filters.level) return false;
      if (query && !searchable(row).includes(query)) return false;
      return true;
    }).slice(0, MAX_RENDERED);
  }

  function formatTime(iso) {
    const parsed = Date.parse(iso || '');
    if (!Number.isFinite(parsed)) return '—';
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(new Date(parsed));
    } catch {
      return String(iso || '').slice(0, 19);
    }
  }

  function detailsText(details) {
    if (details == null || details === '') return '';
    try { return clean(JSON.stringify(details, null, 2), 1600); } catch { return clean(details, 1600); }
  }

  function installStyle(root) {
    if (root.querySelector?.(`#${STYLE_ID}`)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${VIEW_ID}{display:grid;gap:8px}
      #${VIEW_ID} .uj-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid #e4e7ec;border-radius:9px;background:#fff}
      #${VIEW_ID} .uj-title{font-size:11px;font-weight:850;color:#1d2939}
      #${VIEW_ID} .uj-sub{margin-top:2px;color:#98a2b3;font-size:8.7px;line-height:1.3}
      #${VIEW_ID} .uj-copy{height:26px;padding:0 8px;border:1px solid #d0d5dd;border-radius:7px;background:#fff;color:#475467;font:750 9px/26px Arial,sans-serif;cursor:pointer;white-space:nowrap}
      #${VIEW_ID} .uj-copy:hover{border-color:#a50046;color:#a50046;background:#fff8fb}
      #${VIEW_ID} .uj-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
      #${VIEW_ID} .uj-search,#${VIEW_ID} .uj-select{min-width:0;height:30px;border:1px solid #d0d5dd;border-radius:7px;background:#fff;color:#344054;padding:0 8px;font:500 9.5px/1 Arial,sans-serif;outline:none}
      #${VIEW_ID} .uj-search:focus,#${VIEW_ID} .uj-select:focus{border-color:#a50046;box-shadow:0 0 0 2px rgba(165,0,70,.08)}
      #${VIEW_ID} .uj-filter-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      #${VIEW_ID} .uj-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#98a2b3;font-size:8.5px;padding:0 2px}
      #${VIEW_ID} .uj-list{display:grid;gap:5px}
      #${VIEW_ID} .uj-row{padding:7px 8px;border:1px solid #e4e7ec;border-left:3px solid #98a2b3;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.02)}
      #${VIEW_ID} .uj-row.warn{border-left-color:#f79009}
      #${VIEW_ID} .uj-row.error{border-left-color:#d92d20;background:#fffafa}
      #${VIEW_ID} .uj-row.case{border-left-color:#a50046}
      #${VIEW_ID} .uj-top{display:flex;align-items:center;gap:5px;min-width:0;color:#98a2b3;font-size:8.2px}
      #${VIEW_ID} .uj-level{font-weight:850;text-transform:uppercase}
      #${VIEW_ID} .uj-row.warn .uj-level{color:#b54708}
      #${VIEW_ID} .uj-row.error .uj-level{color:#b42318}
      #${VIEW_ID} .uj-source{max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#667085;font-weight:800}
      #${VIEW_ID} .uj-case{margin-left:auto;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7a123d;font-weight:800}
      #${VIEW_ID} .uj-message{margin-top:3px;color:#344054;font-size:10px;line-height:1.35;overflow-wrap:anywhere}
      #${VIEW_ID} .uj-event{margin-top:2px;color:#98a2b3;font:500 8.2px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
      #${VIEW_ID} details{margin-top:4px}
      #${VIEW_ID} details summary{cursor:pointer;color:#8a6677;font-size:8.2px;list-style:none}
      #${VIEW_ID} details summary::-webkit-details-marker{display:none}
      #${VIEW_ID} .uj-details{margin-top:4px;padding-top:4px;border-top:1px dashed #eaecf0;color:#667085;font:8.2px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
      #${VIEW_ID} .uj-empty{padding:18px 10px;border:1px dashed #d0d5dd;border-radius:9px;color:#98a2b3;text-align:center;font-size:9.5px;background:#fff}
    `;
    root.appendChild(style);
  }

  function isJournalOpen(root = attachedRoot) {
    return Boolean(root?.querySelector?.('.full-nav button.active[data-section="journal"]'));
  }

  function ensureView(root) {
    if (!isJournalOpen(root)) return null;
    const body = root.querySelector('.panel .body');
    if (!body) return null;
    let view = body.querySelector(`#${VIEW_ID}`);
    if (view) return view;
    const nav = body.querySelector('.full-nav');
    const navHtml = nav?.outerHTML || '';
    body.innerHTML = `${navHtml}<div id="${VIEW_ID}"></div>`;
    return body.querySelector(`#${VIEW_ID}`);
  }

  function render(root = attachedRoot) {
    if (!root || !isJournalOpen(root)) return;
    installStyle(root);
    const view = ensureView(root);
    if (!view) return;

    const selected = filteredRows();
    const activeId = currentCaseId();
    const activeLabel = activeId ? caseLabel(WB.store?.state?.cases?.[activeId] || {}) : '';
    view.innerHTML = `
      <div class="uj-head">
        <div><div class="uj-title">Журнал Workbench</div><div class="uj-sub">Системные события и журналы абонентов в одной ленте. Данные не дублируются — это общий просмотр.</div></div>
        <button class="uj-copy" data-uj-copy type="button">Копировать</button>
      </div>
      <div class="uj-controls">
        <input class="uj-search" data-uj-search type="search" placeholder="Поиск по событиям…" value="${esc(filters.search)}">
        <select class="uj-select" data-uj-case title="Абонент">
          <option value="all" ${filters.caseScope === 'all' ? 'selected' : ''}>Все события</option>
          <option value="current" ${filters.caseScope === 'current' ? 'selected' : ''} ${activeId ? '' : 'disabled'}>${activeId ? `Этот абонент · ${esc(activeLabel || activeId)}` : 'Нет активного абонента'}</option>
        </select>
      </div>
      <div class="uj-filter-row">
        <select class="uj-select" data-uj-source title="Источник">
          <option value="all" ${filters.source === 'all' ? 'selected' : ''}>Все источники</option>
          <option value="case" ${filters.source === 'case' ? 'selected' : ''}>Case</option>
          <option value="system" ${filters.source === 'system' ? 'selected' : ''}>Система</option>
        </select>
        <select class="uj-select" data-uj-level title="Уровень">
          <option value="all" ${filters.level === 'all' ? 'selected' : ''}>Все уровни</option>
          <option value="error" ${filters.level === 'error' ? 'selected' : ''}>Ошибки</option>
          <option value="warn" ${filters.level === 'warn' ? 'selected' : ''}>Предупреждения</option>
          <option value="info" ${filters.level === 'info' ? 'selected' : ''}>Инфо</option>
        </select>
      </div>
      <div class="uj-meta"><span>Показано ${selected.length}${filteredRows().length >= MAX_RENDERED ? '+' : ''}</span><span>в ленте ${rows.length}</span></div>
      <div class="uj-list">${selected.length ? selected.map(row => {
        const details = detailsText(row.details);
        return `<div class="uj-row ${esc(row.level)} ${row.source === 'case' ? 'case' : ''}">
          <div class="uj-top"><span>${esc(formatTime(row.at))}</span><span class="uj-level">${esc(row.level)}</span><span class="uj-source">${esc(row.sourceLabel)}</span>${row.caseLabel ? `<span class="uj-case" title="${esc(row.caseId)}">${esc(row.caseLabel)}</span>` : ''}</div>
          <div class="uj-message">${esc(row.message)}</div>
          <div class="uj-event">${esc(row.event)}${row.page ? ` · ${esc(row.page)}` : ''}</div>
          ${details ? `<details><summary>детали ▾</summary><div class="uj-details">${esc(details)}</div></details>` : ''}
        </div>`;
      }).join('') : '<div class="uj-empty">По текущим фильтрам событий нет.</div>'}</div>`;

    view.querySelector('[data-uj-search]')?.addEventListener('input', event => {
      filters.search = String(event.target.value || '');
      render(root);
      const next = root.querySelector(`#${VIEW_ID} [data-uj-search]`);
      next?.focus();
      try { next?.setSelectionRange(filters.search.length, filters.search.length); } catch {}
    });
    view.querySelector('[data-uj-case]')?.addEventListener('change', event => {
      filters.caseScope = String(event.target.value || 'all');
      render(root);
    });
    view.querySelector('[data-uj-source]')?.addEventListener('change', event => {
      filters.source = String(event.target.value || 'all');
      render(root);
    });
    view.querySelector('[data-uj-level]')?.addEventListener('change', event => {
      filters.level = String(event.target.value || 'all');
      render(root);
    });
    view.querySelector('[data-uj-copy]')?.addEventListener('click', async () => {
      const current = filteredRows();
      const payload = current.map(row => ({
        at: row.at,
        level: row.level,
        source: row.sourceLabel,
        caseId: row.caseId || undefined,
        subscriber: row.caseLabel || undefined,
        event: row.event,
        message: row.message,
        page: row.page || undefined,
        details: row.details ?? undefined
      }));
      const text = JSON.stringify(payload, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        WB.rail?.toast?.(`Скопировано событий: ${current.length}`);
      } catch {
        console.log('[SIMNET WB][JOURNAL EXPORT]', text);
        WB.rail?.toast?.('Не удалось записать в буфер — выгрузка оставлена в Console');
      }
    });
  }

  async function refresh(root = attachedRoot) {
    const revision = ++refreshRevision;
    const globalEntries = await WB.log?.recent?.(MAX_GLOBAL).catch?.(() => []) || [];
    if (revision !== refreshRevision) return;
    const caseEntries = normalizeCaseEvents(WB.store?.state || {});
    const merged = [...globalEntries.map(normalizeGlobal), ...caseEntries];
    const seen = new Set();
    rows = merged
      .sort((left, right) => right.timeMs - left.timeMs)
      .filter(row => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
    render(root);
  }

  function queueRefresh(root = attachedRoot) {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!root || !isJournalOpen(root)) return;
      const view = ensureView(root);
      if (!view) return;
      void refresh(root);
    });
  }

  function attach(host) {
    const root = host?.shadowRoot;
    if (!root) return false;
    attachedRoot = root;
    installStyle(root);
    rootObserver?.disconnect();
    rootObserver = new MutationObserver(() => {
      if (isJournalOpen(root) && !root.querySelector(`#${VIEW_ID}`)) queueRefresh(root);
    });
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (isJournalOpen(root)) queueRefresh(root);
    return true;
  }

  function discover() {
    hideLegacyLogUi();
    const host = document.getElementById(HOST_ID);
    if (host?.shadowRoot && attach(host)) {
      documentObserver?.disconnect();
      documentObserver = null;
      return;
    }
    if (documentObserver) return;
    documentObserver = new MutationObserver(() => {
      hideLegacyLogUi();
      discover();
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  WB.bus?.on?.('store:state', () => queueRefresh());
  window.addEventListener('simnet-workbench-log', () => queueRefresh());
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[WB.log?.key || 'simnet_workbench_debug_log_v1']) return;
    queueRefresh();
  });

  discover();
})();
