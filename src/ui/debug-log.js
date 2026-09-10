(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.debugLogUi) return;

  const LOG_KEY = WB.log?.key || 'simnet_workbench_debug_log_v1';
  const SUBMIT_DEBUG_KEY = 'simnet_workbench_call_submit_debug_v1';
  const HOST_ID = 'simnet-workbench-debug-log-host';
  const MAX_VISIBLE = 400;

  let open = false;
  let unreadWarnings = 0;
  let refreshTimer = 0;
  let stopped = false;
  let cachedEntries = [];
  let visibleEntries = [];
  let levelFilter = 'all';
  let scopeFilter = 'all';
  let sortMode = 'newest';
  let searchQuery = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function compact(value, max = 900) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function normalizeSearch(value) {
    return String(value == null ? '' : value).toLocaleLowerCase('ru-RU');
  }

  function isContextInvalidated(error) {
    if (WB.log?.isContextInvalidated?.(error)) return true;
    return /Extension context invalidated|context invalidated/i.test(String(error?.message || error || ''));
  }

  function stopForInvalidatedContext() {
    if (stopped) return;
    stopped = true;
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    const node = document.getElementById(HOST_ID);
    const shadow = node?.shadowRoot;
    const toggle = shadow?.querySelector('.toggle');
    const panel = shadow?.querySelector('.panel');
    if (toggle) {
      toggle.className = 'toggle warn';
      toggle.textContent = 'WB LOG · F5';
      toggle.title = 'Расширение было Reload. Обнови эту вкладку (F5).';
    }
    if (panel) {
      panel.classList.add('open');
      const list = shadow.querySelector('.list');
      const meta = shadow.querySelector('.meta');
      if (meta) meta.textContent = 'Контекст расширения этой вкладки устарел после Reload.';
      if (list) list.innerHTML = '<div class="empty">Расширение обновлено. Обнови текущую вкладку (F5), чтобы подключить новый Service Worker и восстановить кнопки Workbench.</div>';
    }
  }

  function host() {
    let node = document.getElementById(HOST_ID);
    if (node) return node;
    node = document.createElement('div');
    node.id = HOST_ID;
    node.dataset.simnetWbOwned = '1';
    node.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483645;font:12px/1.35 Arial,sans-serif;color:#344054';
    const shadow = node.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial}.toggle{border:1px solid #98A2B3;background:#fff;color:#344054;border-radius:8px;padding:6px 9px;font:800 11px/1 Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(16,24,40,.15)}
        .toggle.warn{border-color:#F79009;color:#B54708}.toggle.error{border-color:#D92D20;color:#B42318}
        .panel{display:none;margin-top:7px;width:min(760px,calc(100vw - 24px));max-height:72vh;background:#fff;border:1px solid #D0D5DD;border-radius:12px;box-shadow:0 18px 50px rgba(16,24,40,.22);overflow:hidden;font:12px/1.35 Arial,sans-serif}.panel.open{display:block}
        .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:#F9FAFB;border-bottom:1px solid #EAECF0}.title{font-weight:900;color:#101828}.actions{display:flex;gap:6px}.btn{border:1px solid #D0D5DD;background:#fff;color:#475467;border-radius:7px;padding:4px 7px;font:700 10px/1 Arial,sans-serif;cursor:pointer}.btn:hover{background:#F2F4F7}.btn.active{border-color:#D92D20;background:#FEF3F2;color:#B42318}
        .controls{display:grid;grid-template-columns:minmax(150px,1fr) repeat(3,minmax(112px,auto));gap:6px;padding:8px 10px;background:#fff;border-bottom:1px solid #EAECF0}.control{min-width:0;border:1px solid #D0D5DD;background:#fff;color:#344054;border-radius:7px;padding:5px 7px;font:700 10px/1.2 Arial,sans-serif}.search{font-weight:500}.control:focus{outline:2px solid rgba(165,0,70,.15);border-color:#A50046}
        .meta{padding:6px 10px;color:#667085;border-bottom:1px solid #EAECF0;font-size:10px}.list{max-height:56vh;overflow:auto}.row{padding:7px 10px;border-bottom:1px solid #F2F4F7}.row:last-child{border-bottom:0}.top{display:flex;align-items:center;gap:7px;min-width:0}.time{color:#98A2B3;font-variant-numeric:tabular-nums}.level{font-weight:900;text-transform:uppercase;font-size:9px}.scope{font-weight:850;color:#475467}.event{font-weight:700;color:#101828;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.info .level{color:#175CD3}.warn .level{color:#B54708}.error .level{color:#B42318}.details{margin-top:3px;color:#667085;font:10px/1.35 Consolas,monospace;white-space:pre-wrap;word-break:break-word}.page{margin-top:2px;color:#98A2B3;font-size:9px}.empty{padding:18px;color:#98A2B3;text-align:center}
        @media (max-width:700px){.controls{grid-template-columns:1fr 1fr}.search{grid-column:1/-1}}
      </style>
      <button class="toggle" type="button" title="Открыть журнал Workbench">WB LOG</button>
      <div class="panel">
        <div class="head"><div class="title">Workbench LOG</div><div class="actions"><button class="btn" data-action="errors" type="button">Только ошибки</button><button class="btn" data-action="copy" type="button">Копировать</button><button class="btn" data-action="clear" type="button">Очистить</button><button class="btn" data-action="close" type="button">×</button></div></div>
        <div class="controls">
          <input class="control search" data-filter="search" type="search" placeholder="Поиск: callKey, HTTP 429, PBX, Whisper…" autocomplete="off">
          <select class="control" data-filter="level" title="Уровень">
            <option value="all">Все уровни</option>
            <option value="error">ERROR</option>
            <option value="warn">WARN</option>
            <option value="info">INFO</option>
          </select>
          <select class="control" data-filter="scope" title="Подсистема"><option value="all">Все подсистемы</option></select>
          <select class="control" data-filter="sort" title="Сортировка">
            <option value="newest">Новые сверху</option>
            <option value="oldest">Старые сверху</option>
            <option value="errors">Ошибки сверху</option>
            <option value="scope">По подсистеме</option>
          </select>
        </div>
        <div class="meta">Технический журнал Workbench. Глобальные CALL-статусы показываются в колокольчике и не дублируются каждой вкладкой.</div>
        <div class="list"></div>
      </div>`;
    document.documentElement.appendChild(node);

    const toggle = shadow.querySelector('.toggle');
    toggle.addEventListener('click', () => {
      if (stopped) {
        stopForInvalidatedContext();
        return;
      }
      open = !open;
      if (open) unreadWarnings = 0;
      void refresh();
    });
    shadow.querySelector('[data-action="close"]').addEventListener('click', () => {
      open = false;
      if (!stopped) void refresh();
    });
    shadow.querySelector('[data-action="clear"]').addEventListener('click', async () => {
      if (stopped) return;
      try {
        await WB.log?.clear?.();
        unreadWarnings = 0;
        cachedEntries = [];
        visibleEntries = [];
        await refresh();
      } catch (error) {
        if (isContextInvalidated(error)) stopForInvalidatedContext();
        else throw error;
      }
    });
    shadow.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      if (stopped) return;
      try {
        if (!cachedEntries.length) cachedEntries = await WB.log?.recent?.(MAX_VISIBLE) || [];
        visibleEntries = applyFilters(cachedEntries);
        const text = JSON.stringify(visibleEntries, null, 2);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          console.log('[SIMNET WB][LOG EXPORT]', text);
        }
      } catch (error) {
        if (isContextInvalidated(error)) stopForInvalidatedContext();
        else throw error;
      }
    });
    shadow.querySelector('[data-action="errors"]').addEventListener('click', () => {
      levelFilter = levelFilter === 'error' ? 'all' : 'error';
      shadow.querySelector('[data-filter="level"]').value = levelFilter;
      renderEntries();
    });
    shadow.querySelector('[data-filter="search"]').addEventListener('input', event => {
      searchQuery = String(event.target.value || '');
      renderEntries();
    });
    shadow.querySelector('[data-filter="level"]').addEventListener('change', event => {
      levelFilter = String(event.target.value || 'all');
      renderEntries();
    });
    shadow.querySelector('[data-filter="scope"]').addEventListener('change', event => {
      scopeFilter = String(event.target.value || 'all');
      renderEntries();
    });
    shadow.querySelector('[data-filter="sort"]').addEventListener('change', event => {
      sortMode = String(event.target.value || 'newest');
      renderEntries();
    });
    return node;
  }

  function formatDetails(details) {
    if (details == null || details === '') return '';
    try {
      return compact(JSON.stringify(details, null, 2), 1600);
    } catch {
      return compact(details, 1600);
    }
  }

  function entrySearchText(entry = {}) {
    let details = '';
    try {
      details = JSON.stringify(entry.details == null ? '' : entry.details);
    } catch {
      details = String(entry.details || '');
    }
    return normalizeSearch([
      entry.at,
      entry.level,
      entry.scope,
      entry.event,
      entry.page,
      details
    ].join(' '));
  }

  function levelRank(level) {
    if (level === 'error') return 0;
    if (level === 'warn') return 1;
    return 2;
  }

  function entryTime(entry = {}) {
    const parsed = Date.parse(entry.at || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function applyFilters(entries = []) {
    const query = normalizeSearch(searchQuery).trim();
    const filtered = entries.filter(entry => {
      const level = String(entry?.level || 'info').toLowerCase();
      const scope = String(entry?.scope || 'APP').toUpperCase();
      if (levelFilter !== 'all' && level !== levelFilter) return false;
      if (scopeFilter !== 'all' && scope !== scopeFilter) return false;
      if (query && !entrySearchText(entry).includes(query)) return false;
      return true;
    });

    filtered.sort((left, right) => {
      if (sortMode === 'oldest') return entryTime(left) - entryTime(right);
      if (sortMode === 'errors') {
        const byLevel = levelRank(left?.level) - levelRank(right?.level);
        return byLevel || entryTime(right) - entryTime(left);
      }
      if (sortMode === 'scope') {
        const leftScope = String(left?.scope || 'APP').toUpperCase();
        const rightScope = String(right?.scope || 'APP').toUpperCase();
        return leftScope.localeCompare(rightScope, 'ru-RU') || entryTime(right) - entryTime(left);
      }
      return entryTime(right) - entryTime(left);
    });
    return filtered;
  }

  function syncScopeOptions(shadow, entries = []) {
    const select = shadow.querySelector('[data-filter="scope"]');
    if (!select) return;
    const scopes = [...new Set(entries.map(entry => String(entry?.scope || 'APP').toUpperCase()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'ru-RU'));
    select.innerHTML = '<option value="all">Все подсистемы</option>'
      + scopes.map(scope => `<option value="${esc(scope)}">${esc(scope)}</option>`).join('');
    if (scopeFilter !== 'all' && !scopes.includes(scopeFilter)) scopeFilter = 'all';
    select.value = scopeFilter;
  }

  function renderEntries() {
    const node = document.getElementById(HOST_ID);
    const shadow = node?.shadowRoot;
    if (!shadow || stopped) return;

    visibleEntries = applyFilters(cachedEntries);
    const list = shadow.querySelector('.list');
    const meta = shadow.querySelector('.meta');
    const errorsButton = shadow.querySelector('[data-action="errors"]');
    const levelSelect = shadow.querySelector('[data-filter="level"]');
    const sortSelect = shadow.querySelector('[data-filter="sort"]');
    const searchInput = shadow.querySelector('[data-filter="search"]');

    if (errorsButton) errorsButton.classList.toggle('active', levelFilter === 'error');
    if (levelSelect && levelSelect.value !== levelFilter) levelSelect.value = levelFilter;
    if (sortSelect && sortSelect.value !== sortMode) sortSelect.value = sortMode;
    if (searchInput && searchInput.value !== searchQuery) searchInput.value = searchQuery;
    if (meta) meta.textContent = `Показано ${visibleEntries.length} из ${cachedEntries.length} · хранится максимум ${MAX_VISIBLE}. Копирование берёт текущую выборку.`;

    if (!visibleEntries.length) {
      list.innerHTML = cachedEntries.length
        ? '<div class="empty">По текущим фильтрам событий нет.</div>'
        : '<div class="empty">Лог пока пуст.</div>';
      return;
    }

    list.innerHTML = visibleEntries.map(entry => {
      const time = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      const level = ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
      const details = formatDetails(entry.details);
      return `<div class="row ${esc(level)}"><div class="top"><span class="time">${esc(time)}</span><span class="level">${esc(level)}</span><span class="scope">${esc(entry.scope || 'APP')}</span><span class="event" title="${esc(entry.event || '')}">${esc(entry.event || '')}</span></div>${details ? `<div class="details">${esc(details)}</div>` : ''}${entry.page ? `<div class="page">${esc(entry.page)}</div>` : ''}</div>`;
    }).join('');
  }

  async function refresh() {
    if (stopped) return;
    clearTimeout(refreshTimer);
    const node = host();
    const shadow = node.shadowRoot;
    const panel = shadow.querySelector('.panel');
    const toggle = shadow.querySelector('.toggle');
    panel.classList.toggle('open', open);

    let entries = [];
    try {
      entries = await WB.log?.recent?.(MAX_VISIBLE) || [];
      if (WB.log?.contextInvalidated) {
        stopForInvalidatedContext();
        return;
      }
    } catch (error) {
      if (isContextInvalidated(error)) {
        stopForInvalidatedContext();
        return;
      }
      throw error;
    }

    cachedEntries = entries;
    const worst = entries.find(entry => entry.level === 'error') ? 'error'
      : entries.find(entry => entry.level === 'warn') ? 'warn' : '';
    toggle.className = `toggle${worst ? ` ${worst}` : ''}`;
    toggle.textContent = unreadWarnings ? `WB LOG · ${unreadWarnings}` : 'WB LOG';
    if (!open) return;
    syncScopeOptions(shadow, entries);
    renderEntries();
  }

  function scheduleRefresh() {
    if (stopped) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void refresh().catch(error => {
        if (isContextInvalidated(error)) stopForInvalidatedContext();
        else console.warn('[SIMNET WB][LOG UI] refresh failed', error);
      });
    }, 50);
  }

  function logSubmitCapture(snapshot = {}) {
    if (stopped || !snapshot?.capturedAt) return;
    const details = {
      method: snapshot?.request?.method || '',
      path: snapshot?.request?.path || '',
      durationMs: Number(snapshot?.durationMs || 0),
      ok: Boolean(snapshot?.response?.ok),
      status: Number(snapshot?.response?.status || 0),
      redirected: Boolean(snapshot?.response?.redirected),
      responseUrl: compact(snapshot?.response?.url || '', 300),
      contentType: snapshot?.response?.contentType || '',
      bodyChars: Number(snapshot?.response?.bodyChars || 0),
      error: snapshot?.error || snapshot?.response?.bodyReadError || ''
    };
    if (snapshot?.error || (snapshot?.response && !snapshot.response.ok)) WB.log?.error?.('CALL SAVE', 'Ответ /message/save_call', details);
    else WB.log?.info?.('CALL SAVE', 'Ответ /message/save_call', details);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (stopped || areaName !== 'local') return;
    if (changes?.[SUBMIT_DEBUG_KEY]?.newValue) logSubmitCapture(changes[SUBMIT_DEBUG_KEY].newValue);
    if (changes?.[LOG_KEY]) scheduleRefresh();
  });

  window.addEventListener('simnet-workbench-log', event => {
    if (stopped) return;
    if (!open && ['warn', 'error'].includes(String(event?.detail?.level || ''))) unreadWarnings += 1;
    scheduleRefresh();
  });

  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || 'window error');
    if (/ResizeObserver loop/i.test(message)) return;
    if (isContextInvalidated(event?.error || message)) {
      event.preventDefault?.();
      stopForInvalidatedContext();
      return;
    }
    if (stopped) return;
    WB.log?.error?.('PAGE', 'Необработанная ошибка страницы Workbench', {
      message,
      source: event?.filename || '',
      line: Number(event?.lineno || 0),
      column: Number(event?.colno || 0),
      stack: String(event?.error?.stack || '').slice(0, 1800)
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason;
    if (isContextInvalidated(reason)) {
      event.preventDefault?.();
      stopForInvalidatedContext();
      return;
    }
    if (stopped) return;
    WB.log?.error?.('PAGE', 'Unhandled Promise rejection', {
      message: String(reason?.message || reason || 'unknown rejection').slice(0, 1200),
      stack: String(reason?.stack || '').slice(0, 1800)
    });
  });

  host();
  void refresh().catch(error => {
    if (isContextInvalidated(error)) stopForInvalidatedContext();
    else console.warn('[SIMNET WB][LOG UI] initial refresh failed', error);
  });
  WB.debugLogUi = Object.freeze({
    open: () => {
      open = true;
      unreadWarnings = 0;
      if (stopped) {
        stopForInvalidatedContext();
        return Promise.resolve();
      }
      return refresh();
    },
    refresh
  });
})();
