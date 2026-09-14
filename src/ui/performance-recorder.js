(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || globalThis.__SIMNET_PERF_RECORDER__) return;
  globalThis.__SIMNET_PERF_RECORDER__ = true;

  const STORAGE_KEY = 'simnet_workbench_performance_recorder_v1';
  const MAX_ENTRIES = 1200;
  const MAX_RENDERED = 60;
  const POLL_MS = 750;
  const STATUS_MS = 5000;
  const HOST_ID = 'simnet-workbench-performance-recorder-host';
  const RAIL_BUTTON_ID = 'simnet-perf-recorder-rail-button';
  const RAIL_STYLE_ID = 'simnet-perf-recorder-rail-style';

  const LABELS = Object.freeze({
    'call.registration_open': 'Регистрация звонка · до результата',
    'call.form_fetch': 'Рег. звонок · загрузка формы',
    'call.call_list_fetch': 'Рег. звонок · call_list',
    'call.module_load': 'Рег. звонок · загрузка модуля',
    'call.form_parse': 'Рег. звонок · разбор формы',
    'call.focus_select': 'Рег. звонок · выбор звонка',
    'call.route_open': 'Рег. звонок · переход по маршруту',
    'task.save_guard': 'Заявка · проверка перед сохранением',
    'task.address_resolve': 'Заявка · определение адреса',
    'runtime.workbench_ready': 'Workbench · готовность',
    'runtime.long_task': 'Длинная задача JS',
    'ui.interaction': 'Отклик интерфейса',
    'tab.activation_frame': 'Возврат на вкладку · кадр'
  });

  const META_LABELS = Object.freeze({
    networkMs: 'сеть',
    headersMs: 'заголовки',
    bodyMs: 'body',
    mergeMs: 'merge',
    parseMs: 'parse',
    refreshTotalMs: 'refresh',
    inputDelayMs: 'input delay',
    presentationMs: 'render',
    handlerMs: 'handler',
    bytes: 'байт',
    calls: 'звонков',
    queueDepth: 'очередь',
    resolver: 'resolver',
    event: 'event',
    action: 'action',
    surface: 'surface',
    error: 'ошибка'
  });

  const PRIMARY_METRICS = new Set([
    'call.registration_open',
    'call.route_open',
    'task.save_guard',
    'task.address_resolve',
    'runtime.workbench_ready',
    'ui.interaction',
    'tab.activation_frame'
  ]);

  let state = emptyState();
  let runtimeStatus = null;
  let host = null;
  let root = null;
  let pollTimer = null;
  let statusAt = 0;
  let captureBusy = false;
  let renderQueued = false;
  let lastStorageWriteAt = 0;
  let disposed = false;

  function emptyState() {
    return {
      schema: 'simnet-workbench-performance-recorder-v1',
      status: 'idle',
      startedAt: '',
      stoppedAt: '',
      sessionId: '',
      entries: [],
      selectedMetric: '',
      uiOpen: false,
      updatedAt: new Date().toISOString()
    };
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function compact(value, max = 140) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function safeText(value, max = 120) {
    return compact(value, max)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ':ip')
      .replace(/\b(?:abon)?\d{4,}\b/gi, ':id');
  }

  function sanitizeMeta(meta = {}) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    const out = {};
    const blocked = /(?:customer|case|uuid|login|contract|phone|address|token|secret|password|cookie|authorization|session|csrf|\bip\b)/i;
    for (const [rawKey, value] of Object.entries(meta).slice(0, 20)) {
      const key = compact(rawKey, 48);
      if (!key || blocked.test(key)) continue;
      if (value == null || typeof value === 'boolean' || typeof value === 'number') out[key] = value;
      else if (typeof value === 'string') out[key] = safeText(value);
    }
    return out;
  }

  function safeRoute() {
    try {
      const url = new URL(location.href);
      const path = String(url.pathname || '/')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\d{3,}/g, ':id');
      const tags = [];
      for (const key of ['a', 'section', 'tab']) {
        const value = String(url.searchParams.get(key) || '');
        if (/^[a-z0-9_-]{1,32}$/i.test(value)) tags.push(`${key}=${value}`);
      }
      return `${url.hostname}${path}${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
    } catch {
      return String(location.hostname || '');
    }
  }

  function currentHeapBytes() {
    const value = Number(globalThis.performance?.memory?.usedJSHeapSize || 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    const mib = bytes / (1024 * 1024);
    return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`;
  }

  function formatDuration(ms) {
    const value = Math.max(0, Number(ms || 0));
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
  }

  function formatElapsed(startedAt, stoppedAt = '') {
    const start = new Date(startedAt || 0).getTime();
    const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
    if (!Number.isFinite(start) || start <= 0) return '00:00';
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatClock(iso) {
    const date = new Date(iso || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function labelFor(metric) {
    return LABELS[String(metric || '')] || String(metric || 'Событие');
  }

  function meaningfulSample(sample = {}) {
    const metric = String(sample.metric || '');
    if (!metric || metric === 'ui.click') return false;
    if (metric === 'ui.interaction') {
      const event = String(sample?.meta?.event || '');
      if (event && event !== 'click') return false;
    }
    return true;
  }

  function entryId(sample = {}) {
    return [sample.at, sample.metric, Number(sample.durationMs || 0), sample?.meta?.event || '', sample?.meta?.action || ''].join('|');
  }

  function normalizeEntry(sample = {}, heapBytes = null) {
    return {
      id: entryId(sample),
      at: String(sample.at || new Date().toISOString()),
      metric: compact(sample.metric, 80),
      label: labelFor(sample.metric),
      durationMs: Math.round(Math.max(0, Number(sample.durationMs || 0)) * 10) / 10,
      status: compact(sample.status || 'ok', 32) || 'ok',
      slow: Boolean(sample.slow),
      meta: sanitizeMeta(sample.meta),
      heapBytes: heapBytes || null,
      route: safeRoute()
    };
  }

  function percentile(values, p = 95) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] || 0;
  }

  function metricStats(metric) {
    const rows = state.entries.filter(entry => entry.metric === metric);
    const values = rows.map(entry => Number(entry.durationMs || 0));
    if (!values.length) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      count: values.length,
      last: values.at(-1) || 0,
      avg: total / values.length,
      p95: percentile(values, 95),
      max: Math.max(...values),
      values: values.slice(-18)
    };
  }

  function primaryEntry() {
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (PRIMARY_METRICS.has(entry.metric)) return entry;
    }
    return state.entries.at(-1) || null;
  }

  function selectedMetric() {
    if (state.selectedMetric && state.entries.some(entry => entry.metric === state.selectedMetric)) return state.selectedMetric;
    const primary = primaryEntry();
    return primary?.metric || state.entries.at(-1)?.metric || '';
  }

  function durationTone(entry = {}) {
    if (String(entry.status || '') !== 'ok') return 'bad';
    if (entry.slow || Number(entry.durationMs || 0) >= 800) return 'bad';
    if (Number(entry.durationMs || 0) >= 250) return 'warn';
    return 'ok';
  }

  function sparkline(values = [], width = 324, height = 54) {
    const nums = values.map(Number).filter(Number.isFinite);
    if (nums.length < 2) return '<div class="spark-empty">Нужно минимум 2 замера для динамики</div>';
    const max = Math.max(...nums, 1);
    const min = Math.min(...nums, 0);
    const range = Math.max(1, max - min);
    const pointsList = nums.map((value, index) => {
      const x = (index / Math.max(1, nums.length - 1)) * (width - 12) + 6;
      const y = height - 7 - ((value - min) / range) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const points = pointsList.join(' ');
    const dots = pointsList.map(point => {
      const [x, y] = point.split(',');
      return `<circle cx="${x}" cy="${y}" r="2.2"></circle>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}"></polyline>${dots}</svg>`;
  }

  async function runtimeRequest(type, payload = {}) {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type, payload }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${type} timeout`)), 5000))
    ]);
    if (!response?.success) throw new Error(response?.error || `${type} failed`);
    return response.data;
  }

  async function readState() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const raw = stored?.[STORAGE_KEY];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
      return {
        ...emptyState(),
        ...raw,
        entries: Array.isArray(raw.entries) ? raw.entries.slice(-MAX_ENTRIES) : []
      };
    } catch {
      return emptyState();
    }
  }

  async function saveState() {
    state.updatedAt = new Date().toISOString();
    lastStorageWriteAt = Date.now();
    try { await chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch {}
  }

  async function startRecording() {
    try {
      const overview = await runtimeRequest('PERF_SESSION_START', { reset: true });
      WB.perf?.clear?.();
      state = {
        ...emptyState(),
        status: 'recording',
        startedAt: new Date().toISOString(),
        sessionId: String(overview?.sessionId || ''),
        uiOpen: true
      };
      await saveState();
      scheduleRender();
    } catch (error) {
      toast(`Не удалось начать REC: ${compact(error?.message || error, 100)}`, 'bad');
    }
  }

  async function stopRecording() {
    if (state.status !== 'recording') return;
    await captureLocalEntries();
    state.status = 'stopped';
    state.stoppedAt = new Date().toISOString();
    await saveState();
    scheduleRender();
  }

  async function clearRecording() {
    WB.perf?.clear?.();
    if (state.status === 'recording') {
      try {
        const overview = await runtimeRequest('PERF_SESSION_START', { reset: true });
        state = {
          ...emptyState(),
          status: 'recording',
          startedAt: new Date().toISOString(),
          sessionId: String(overview?.sessionId || ''),
          uiOpen: true
        };
      } catch {
        state.entries = [];
        state.startedAt = new Date().toISOString();
        state.stoppedAt = '';
      }
    } else {
      const open = state.uiOpen;
      state = emptyState();
      state.uiOpen = open;
    }
    await saveState();
    scheduleRender();
  }

  async function exportRecording() {
    try {
      if (state.status === 'recording') await captureLocalEntries();
      let snapshot = null;
      try { snapshot = await runtimeRequest('PERF_SESSION_EXPORT'); } catch {}
      const bundle = {
        schema: 'simnet-workbench-performance-recorder-export-v1',
        exportedAt: new Date().toISOString(),
        recorder: state,
        performanceSnapshot: snapshot
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `simnet-workbench-recorder-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      (document.body || document.documentElement).appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
    } catch (error) {
      toast(`Экспорт не выполнен: ${compact(error?.message || error, 100)}`, 'bad');
    }
  }

  async function captureLocalEntries() {
    if (captureBusy || disposed || state.status !== 'recording' || document.visibilityState !== 'visible') return;
    captureBusy = true;
    try {
      const startedMs = new Date(state.startedAt || 0).getTime();
      const existing = new Set(state.entries.map(entry => entry.id));
      const heap = currentHeapBytes();
      const recent = (WB.perf?.recent?.(120) || [])
        .filter(meaningfulSample)
        .filter(sample => new Date(sample.at || 0).getTime() >= startedMs)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const added = [];
      for (const sample of recent) {
        const id = entryId(sample);
        if (existing.has(id)) continue;
        existing.add(id);
        added.push(normalizeEntry(sample, heap));
      }
      if (!added.length) return;
      state.entries = [...state.entries, ...added].slice(-MAX_ENTRIES);
      if (!state.selectedMetric) {
        const primary = [...added].reverse().find(entry => PRIMARY_METRICS.has(entry.metric)) || added.at(-1);
        state.selectedMetric = primary?.metric || '';
      }
      await saveState();
    } finally {
      captureBusy = false;
    }
  }

  async function refreshRuntimeStatus(force = false) {
    if (!force && Date.now() - statusAt < STATUS_MS) return;
    statusAt = Date.now();
    try { runtimeStatus = await runtimeRequest('PERF_SESSION_STATUS'); } catch { runtimeStatus = null; }
  }

  function compactMeta(meta = {}) {
    const wanted = ['networkMs', 'headersMs', 'bodyMs', 'mergeMs', 'parseMs', 'refreshTotalMs', 'inputDelayMs', 'presentationMs', 'handlerMs', 'bytes', 'calls', 'queueDepth', 'resolver', 'event', 'action', 'surface', 'error'];
    return wanted.filter(key => meta[key] != null && meta[key] !== '').map(key => {
      const value = meta[key];
      const rendered = /Ms$/.test(key) && Number.isFinite(Number(value)) ? formatDuration(value) : compact(value, 48);
      return `<span><b>${esc(META_LABELS[key] || key)}:</b> ${esc(rendered)}</span>`;
    }).join('');
  }

  function renderEntry(entry) {
    const meta = compactMeta(entry.meta);
    const tone = durationTone(entry);
    return `<details class="event ${tone}" data-entry-id="${esc(entry.id)}" data-metric="${esc(entry.metric)}">
      <summary>
        <time>${esc(formatClock(entry.at))}</time>
        <span class="event-main"><b>${esc(entry.label)}</b><small>${esc(entry.route || '')}</small></span>
        <strong>${esc(formatDuration(entry.durationMs))}</strong>
      </summary>
      <div class="event-detail">
        ${meta ? `<div class="chips">${meta}</div>` : '<small>Дополнительных этапов для этого события нет.</small>'}
        <div class="event-foot"><span>JS heap ≈ ${esc(formatBytes(entry.heapBytes))}</span><button type="button" data-select-metric="${esc(entry.metric)}">Показать динамику</button></div>
      </div>
    </details>`;
  }

  function loadSummary() {
    const openRows = (runtimeStatus?.tabLoad?.tabs || []).filter(row => row.open);
    const inventory = runtimeStatus?.tabLoad?.inventory || {};
    const requests = openRows.reduce((sum, row) => sum + Number(row.requests || 0), 0);
    const hiddenRequests = openRows.reduce((sum, row) => sum + Number(row.hiddenRequests || 0), 0);
    return {
      totalTabs: Number(inventory.total || 0),
      workingTabs: Number(inventory.working || 0),
      backgroundTabs: Number(inventory.background || 0),
      requests,
      hiddenRequests,
      samples: Number(runtimeStatus?.totalSampleCount || runtimeStatus?.sampleCount || 0)
    };
  }

  function panelHtml() {
    const primary = primaryEntry();
    const metric = selectedMetric();
    const stats = metricStats(metric);
    const load = loadSummary();
    const entries = state.entries.slice(-MAX_RENDERED).reverse();
    const recording = state.status === 'recording';
    const stopped = state.status === 'stopped';
    const heap = currentHeapBytes();
    const selectedLabel = metric ? labelFor(metric) : 'Динамика действия';
    return `<section class="panel ${state.uiOpen ? 'open' : ''}">
      <header>
        <div class="title"><span class="rec-dot ${recording ? 'on' : ''}"></span><div><b>Performance Recorder</b><small>${recording ? `REC · ${formatElapsed(state.startedAt)}` : stopped ? `STOP · ${formatElapsed(state.startedAt, state.stoppedAt)}` : 'Готов к новому замеру'}</small></div></div>
        <button class="icon" data-rec-action="close" title="Закрыть">×</button>
      </header>
      <div class="controls">
        <button class="rec ${recording ? 'active' : ''}" data-rec-action="record">● REC</button>
        <button data-rec-action="stop" ${!recording ? 'disabled' : ''}>STOP</button>
        <button data-rec-action="clear">CLEAR</button>
        <button data-rec-action="export" ${!state.entries.length ? 'disabled' : ''}>JSON</button>
      </div>

      <div class="now-card ${primary ? durationTone(primary) : ''}">
        <small>Последнее действие</small>
        ${primary ? `<div><b>${esc(primary.label)}</b><strong>${esc(formatDuration(primary.durationMs))}</strong></div><span>${esc(formatClock(primary.at))}</span>` : '<div><b>Пока действий нет</b><strong>—</strong></div>'}
      </div>

      <div class="stats-grid">
        <div><small>JS heap сейчас</small><b>${esc(formatBytes(heap))}</b></div>
        <div><small>Записей</small><b>${state.entries.length}</b></div>
        <div><small>Вкладки</small><b>${load.totalTabs || '—'}</b><span>${load.workingTabs ? `${load.workingTabs} рабочих` : ''}</span></div>
        <div><small>Фон. запросы</small><b>${load.hiddenRequests || 0}</b><span>${load.requests ? `из ${load.requests}` : ''}</span></div>
      </div>

      <div class="trend">
        <div class="trend-head"><div><small>Динамика</small><b>${esc(selectedLabel)}</b></div>${stats ? `<span>${stats.count} зам.</span>` : ''}</div>
        ${stats ? sparkline(stats.values) : '<div class="spark-empty">Запусти REC и выполни действие несколько раз.</div>'}
        ${stats ? `<div class="trend-stats"><span>посл. <b>${esc(formatDuration(stats.last))}</b></span><span>сред. <b>${esc(formatDuration(stats.avg))}</b></span><span>p95 <b>${esc(formatDuration(stats.p95))}</b></span><span>max <b>${esc(formatDuration(stats.max))}</b></span></div>` : ''}
      </div>

      <div class="section-head"><b>Последние события</b><small>${recording ? 'обновляется автоматически' : stopped ? 'запись остановлена' : 'нажми REC'}</small></div>
      <div class="timeline">${entries.length ? entries.map(renderEntry).join('') : '<div class="empty">Здесь появятся регистрация звонка, отклик UI, загрузки, проверки заявки и другие измеряемые действия.</div>'}</div>
      <footer>Хранятся только компактные метрики. Лимит: ${MAX_ENTRIES} событий; старые удаляются автоматически.</footer>
    </section>`;
  }

  function styles() {
    return `<style>
      :host{all:initial}*,*:before,*:after{box-sizing:border-box}button{font:inherit}
      .panel{position:fixed;z-index:2147483646;top:12px;right:62px;width:min(450px,calc(100vw - 84px));height:calc(100vh - 24px);display:none;flex-direction:column;background:#fff;border:1px solid #e5d4dc;border-radius:14px;box-shadow:0 22px 70px rgba(15,23,42,.28);font:12px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#25232a;overflow:hidden}
      .panel.open{display:flex}.panel header{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid #eee5e9;background:linear-gradient(180deg,#fff,#fff9fb)}
      .title{display:flex;align-items:center;gap:9px}.title b{font-size:14px}.title small{display:block;color:#7d7280;margin-top:2px}.rec-dot{width:10px;height:10px;border-radius:50%;background:#aaa}.rec-dot.on{background:#d92d20;box-shadow:0 0 0 4px rgba(217,45,32,.1);animation:pulse 1.2s infinite}@keyframes pulse{50%{opacity:.55}}
      .icon{width:30px;height:30px;border:0;border-radius:8px;background:#f7f3f5;color:#6f5a64;font-size:20px;cursor:pointer}
      .controls{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:7px;padding:10px 12px;border-bottom:1px solid #f0eaed}.controls button{height:34px;border:1px solid #ddcdd4;border-radius:8px;background:#fff;color:#5a4650;font-weight:700;cursor:pointer}.controls button:hover{background:#faf5f7}.controls button:disabled{opacity:.45;cursor:default}.controls .rec.active{background:#fff0f3;border-color:#d92d20;color:#b42318}
      .now-card{margin:10px 12px 0;padding:10px 12px;border:1px solid #ebe4e7;border-left:4px solid #98a2b3;border-radius:10px;background:#fcfbfb}.now-card.warn{border-left-color:#f79009}.now-card.bad{border-left-color:#d92d20}.now-card.ok{border-left-color:#12b76a}.now-card>small{color:#857780}.now-card>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:3px}.now-card b{font-size:13px}.now-card strong{font-size:18px;white-space:nowrap}.now-card>span{display:block;margin-top:2px;color:#98a2b3}
      .stats-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;padding:9px 12px}.stats-grid>div{min-width:0;padding:8px;border:1px solid #eee8eb;border-radius:9px;background:#fff}.stats-grid small{display:block;color:#8b7e85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stats-grid b{display:block;font-size:14px;margin-top:2px}.stats-grid span{display:block;color:#98a2b3;font-size:10px;margin-top:1px}
      .trend{margin:0 12px 8px;padding:10px 11px;border:1px solid #eee7ea;border-radius:10px;background:#fff}.trend-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.trend-head small{display:block;color:#8b7e85}.trend-head b{display:block;margin-top:1px}.trend-head>span{color:#8b7e85}.spark{width:100%;height:54px;margin-top:6px;overflow:visible}.spark polyline{fill:none;stroke:#a50046;stroke-width:2;vector-effect:non-scaling-stroke}.spark circle{fill:#fff;stroke:#a50046;stroke-width:1.6;vector-effect:non-scaling-stroke}.spark-empty{height:44px;display:grid;place-items:center;color:#98a2b3;text-align:center}.trend-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:3px}.trend-stats span{padding:4px 5px;border-radius:6px;background:#faf7f8;color:#81747b;text-align:center}.trend-stats b{display:block;color:#382f34;margin-top:1px}
      .section-head{display:flex;align-items:center;justify-content:space-between;padding:6px 13px}.section-head b{font-size:12px}.section-head small{color:#98a2b3}.timeline{flex:1;min-height:100px;overflow:auto;padding:0 10px 10px}.event{border-bottom:1px solid #f0eaed}.event summary{list-style:none;display:grid;grid-template-columns:58px 1fr auto;align-items:center;gap:8px;padding:8px 3px;cursor:pointer}.event summary::-webkit-details-marker{display:none}.event time{color:#98a2b3;font-variant-numeric:tabular-nums}.event-main{min-width:0}.event-main b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event-main small{display:block;color:#98a2b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}.event strong{padding:3px 6px;border-radius:6px;background:#ecfdf3;color:#027a48;font-size:11px}.event.warn strong{background:#fffaeb;color:#b54708}.event.bad strong{background:#fef3f2;color:#b42318}.event-detail{padding:0 4px 9px 67px}.chips{display:flex;flex-wrap:wrap;gap:4px}.chips span{padding:3px 5px;border-radius:5px;background:#f8f5f6;color:#665861}.chips b{font-weight:600}.event-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;color:#98a2b3}.event-foot button{border:0;background:transparent;color:#a50046;padding:0;cursor:pointer;font-weight:600}.empty{padding:30px 18px;text-align:center;color:#98a2b3;border:1px dashed #e4d8dd;border-radius:9px;margin-top:4px}footer{padding:7px 12px;border-top:1px solid #eee8eb;color:#98a2b3;font-size:10px;background:#fcfbfb}.toast{position:absolute;right:12px;bottom:12px;max-width:300px;padding:8px 10px;border-radius:8px;background:#344054;color:#fff;box-shadow:0 10px 28px rgba(16,24,40,.25)}.toast.bad{background:#b42318}
    </style>`;
  }

  function mountHost() {
    if (host?.isConnected && root) return;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      (document.documentElement || document.body).appendChild(host);
    }
    root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `${styles()}<div id="mount"></div><div id="toast"></div>`;
    root.addEventListener('click', onPanelClick);
  }

  function ensureRailButton() {
    const railHost = document.getElementById('simnet-workbench-rail-host');
    const railRoot = railHost?.shadowRoot;
    const stack = railRoot?.querySelector?.('.rail-stack');
    if (!stack) return false;
    let button = railRoot.getElementById?.(RAIL_BUTTON_ID) || railRoot.querySelector?.(`#${RAIL_BUTTON_ID}`);
    if (!button) {
      if (!railRoot.querySelector(`#${RAIL_STYLE_ID}`)) {
        const style = document.createElement('style');
        style.id = RAIL_STYLE_ID;
        style.textContent = `.perf-rec-dot{position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;background:#98a2b3}.perf-rec-dot.on{background:#d92d20;box-shadow:0 0 0 3px rgba(217,45,32,.12)}#${RAIL_BUTTON_ID}{position:relative}`;
        railRoot.appendChild(style);
      }
      button = document.createElement('button');
      button.id = RAIL_BUTTON_ID;
      button.type = 'button';
      button.className = 'rail-btn';
      button.title = 'Performance Recorder';
      button.setAttribute('aria-label', 'Performance Recorder');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2M7 4l-2 2M17 4l2 2"></path></svg><span class="rail-label">PERF</span><i class="perf-rec-dot"></i>';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        state.uiOpen = !state.uiOpen;
        void saveState().then(scheduleRender);
      });
      stack.appendChild(button);
    }
    button.classList.toggle('active', Boolean(state.uiOpen));
    button.querySelector('.perf-rec-dot')?.classList.toggle('on', state.status === 'recording');
    return true;
  }

  function onPanelClick(event) {
    const metricButton = event.target.closest?.('[data-select-metric]');
    if (metricButton) {
      state.selectedMetric = String(metricButton.dataset.selectMetric || '');
      void saveState().then(scheduleRender);
      return;
    }
    const action = event.target.closest?.('[data-rec-action]')?.dataset.recAction;
    if (!action) return;
    if (action === 'record') void startRecording();
    if (action === 'stop') void stopRecording();
    if (action === 'clear') void clearRecording();
    if (action === 'export') void exportRecording();
    if (action === 'close') {
      state.uiOpen = false;
      void saveState().then(scheduleRender);
    }
  }

  function toast(message, tone = '') {
    if (!root) return;
    const box = root.getElementById('toast');
    if (!box) return;
    box.innerHTML = `<div class="toast ${tone}">${esc(message)}</div>`;
    setTimeout(() => { if (box) box.innerHTML = ''; }, 2800);
  }

  function scheduleRender() {
    if (renderQueued || disposed) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    mountHost();
    const mount = root?.getElementById('mount');
    if (mount) {
      const oldTimeline = mount.querySelector('.timeline');
      const scrollTop = oldTimeline?.scrollTop || 0;
      const openIds = new Set([...mount.querySelectorAll('details.event[open][data-entry-id]')].map(node => node.dataset.entryId));
      mount.innerHTML = panelHtml();
      const newTimeline = mount.querySelector('.timeline');
      if (newTimeline) newTimeline.scrollTop = scrollTop;
      for (const detail of mount.querySelectorAll('details.event[data-entry-id]')) {
        if (openIds.has(detail.dataset.entryId)) detail.open = true;
      }
    }
    ensureRailButton();
  }

  async function tick() {
    if (disposed) return;
    try {
      if (state.status === 'recording') await captureLocalEntries();
      if (state.uiOpen) {
        await refreshRuntimeStatus();
        scheduleRender();
      }
      ensureRailButton();
    } catch {}
    pollTimer = setTimeout(tick, POLL_MS);
  }

  function bindStorage() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[STORAGE_KEY]) return;
      const next = changes[STORAGE_KEY].newValue;
      if (!next || typeof next !== 'object' || Array.isArray(next)) return;
      if (Date.now() - lastStorageWriteAt < 120) {
        ensureRailButton();
        return;
      }
      state = { ...emptyState(), ...next, entries: Array.isArray(next.entries) ? next.entries.slice(-MAX_ENTRIES) : [] };
      if (state.uiOpen) scheduleRender();
      else ensureRailButton();
    });
  }

  async function init() {
    state = await readState();
    mountHost();
    bindStorage();
    render();
    if (state.uiOpen) await refreshRuntimeStatus(true);
    tick();
  }

  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(pollTimer);
  }, { once: true });

  void init();
})();
