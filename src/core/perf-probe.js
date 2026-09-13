(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__perfProbeLoaded) return;
  WB.__perfProbeLoaded = true;

  const MAX_SAMPLES = 240;
  const MAX_PENDING_PER_METRIC = 12;
  const PENDING_TTL_MS = 15000;
  const LONG_TASK_CAPTURE_MS = 120;
  const LONG_TASK_PERSIST_MS = 250;
  const LONG_TASK_LOG_COOLDOWN_MS = 3000;
  const PERFORMANCE_CONTROL_KEY = 'simnet_workbench_performance_control_v1';
  const PERFORMANCE_SAMPLE_MESSAGE = 'PERF_SESSION_SAMPLE';
  const PERFORMANCE_FLUSH_MESSAGE = 'PERF_SESSION_FLUSH';
  const SESSION_FLUSH_MS = 60 * 1000;
  const SESSION_SLOW_RESOURCE_MS = 1000;
  const SESSION_MAX_ROUTES = 12;

  const samples = [];
  const pending = new Map();
  let longTaskObserver = null;
  let lastLongTaskLogAt = 0;
  let destroyed = false;
  let performanceSession = null;
  let sessionInterval = null;
  let sessionInitialTimer = null;
  let sessionDeadlineTimer = null;
  let sessionResourceObserver = null;
  let sessionFlushInFlight = null;
  let sessionNavigationSent = false;
  let sessionResources = emptyResourceBucket();
  let sessionMetrics = new Map();
  let lastStorageBytes = null;
  let lastSessionFlushAt = 0;

  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const roundMs = value => Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
  const compact = (value, max = 180) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const THRESHOLDS = Object.freeze({
    'call.module_load': 500,
    'call.registration_open': 500,
    'call.route_open': 700,
    'task.save_guard': 300,
    'task.address_resolve': 400,
    'runtime.workbench_ready': 1500,
    'runtime.long_task': LONG_TASK_CAPTURE_MS
  });

  const ALWAYS_PERSIST = new Set([
    'call.module_load',
    'call.registration_open',
    'call.route_open',
    'task.save_guard'
  ]);

  function thresholdFor(metric) {
    return Number(THRESHOLDS[String(metric || '')] || 500);
  }

  function safeMeta(meta = {}) {
    if (!meta || typeof meta !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(meta).slice(0, 20)) {
      if (value == null || typeof value === 'boolean' || typeof value === 'number') out[key] = value;
      else if (typeof value === 'string') out[key] = compact(value, 220);
    }
    return out;
  }

  function persist(metric, sample, force = false, persistSlow = true) {
    if (!WB.log || destroyed) return;
    const shouldPersist = force || ALWAYS_PERSIST.has(metric) || (persistSlow && sample.slow);
    if (!shouldPersist) return;
    const method = sample.slow ? WB.log.warn : WB.log.info;
    if (typeof method !== 'function') return;
    method.call(WB.log, 'PERF', metric, {
      durationMs: sample.durationMs,
      thresholdMs: sample.thresholdMs,
      slow: sample.slow,
      status: sample.status,
      ...safeMeta(sample.meta)
    });
  }

  function record(metric, durationMs, meta = {}, options = {}) {
    const name = compact(metric, 80);
    if (!name) return null;
    const duration = roundMs(durationMs);
    const thresholdMs = Number(options.thresholdMs || thresholdFor(name));
    const sample = {
      metric: name,
      durationMs: duration,
      thresholdMs,
      slow: duration >= thresholdMs,
      status: compact(options.status || meta.status || 'ok', 40) || 'ok',
      at: new Date().toISOString(),
      meta: safeMeta(meta)
    };
    samples.unshift(sample);
    if (samples.length > MAX_SAMPLES) samples.length = MAX_SAMPLES;
    captureSessionMetric(sample);
    persist(name, sample, Boolean(options.persist), options.persistSlow !== false);
    return sample;
  }

  function queueFor(metric) {
    const name = String(metric || '');
    if (!pending.has(name)) pending.set(name, []);
    return pending.get(name);
  }

  function pruneQueue(queue, current = now()) {
    while (queue.length && current - Number(queue[0]?.startedAt || 0) > PENDING_TTL_MS) queue.shift();
    while (queue.length > MAX_PENDING_PER_METRIC) queue.shift();
  }

  function start(metric, meta = {}) {
    if (destroyed) return null;
    const queue = queueFor(metric);
    const current = now();
    pruneQueue(queue, current);
    const token = {
      id: globalThis.crypto?.randomUUID?.() || `perf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
      metric: String(metric || ''),
      startedAt: current,
      meta: safeMeta(meta),
      queueDepth: queue.length + 1
    };
    queue.push(token);
    pruneQueue(queue, current);
    return token;
  }

  function takePending(metric, token = null) {
    const queue = queueFor(metric);
    pruneQueue(queue);
    if (!queue.length) return null;
    if (!token?.id) return queue.shift() || null;
    const index = queue.findIndex(item => item.id === token.id);
    if (index < 0) return null;
    return queue.splice(index, 1)[0] || null;
  }

  function end(metricOrToken, meta = {}, options = {}) {
    if (destroyed) return null;
    const token = metricOrToken && typeof metricOrToken === 'object' ? metricOrToken : null;
    const metric = token?.metric || String(metricOrToken || '');
    const started = takePending(metric, token);
    if (!started) return null;
    return record(metric, now() - started.startedAt, {
      ...started.meta,
      queueDepth: started.queueDepth,
      ...safeMeta(meta)
    }, options);
  }

  async function measure(metric, fn, meta = {}, options = {}) {
    const token = start(metric, meta);
    try {
      const result = await fn();
      end(token, { status: 'ok' }, options);
      return result;
    } catch (error) {
      end(token, {
        status: 'error',
        error: compact(error?.message || error || 'unknown error', 220)
      }, { ...options, persist: true });
      throw error;
    }
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  }

  function summary() {
    const groups = new Map();
    for (const sample of samples) {
      if (!groups.has(sample.metric)) groups.set(sample.metric, []);
      groups.get(sample.metric).push(sample.durationMs);
    }
    return Array.from(groups.entries()).map(([metric, values]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      return {
        metric,
        count: sorted.length,
        avgMs: roundMs(total / sorted.length),
        p95Ms: roundMs(percentile(sorted, 95)),
        maxMs: roundMs(sorted[sorted.length - 1] || 0)
      };
    }).sort((a, b) => b.maxMs - a.maxMs);
  }

  function eventName(entry = {}) {
    return String(entry?.event || '').trim();
  }

  function eventScope(entry = {}) {
    return String(entry?.scope || entry?.source || '').trim().toUpperCase();
  }

  function eventMeta(entry = {}) {
    const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
    return {
      page: compact(entry?.page || location.pathname, 180),
      reason: compact(details.reason || '', 80),
      caseId: compact(details.caseId || '', 80),
      customerId: compact(details.customerId || '', 40),
      taskTypeUuid: compact(details.taskTypeUuid || '', 80),
      buildingUuid: compact(details.buildingUuid || details.resolvedBuildingUuid || '', 80)
    };
  }

  function finishIfPending(metric, entry, status = 'ok', extra = {}, options = {}) {
    const forcePersist = options.persist ?? (ALWAYS_PERSIST.has(metric) || status === 'error' || status === 'fallback' || status === 'blocked');
    return end(metric, {
      ...eventMeta(entry),
      status,
      event: compact(eventName(entry), 120),
      ...extra
    }, {
      persist: forcePersist,
      persistSlow: options.persistSlow !== false
    });
  }

  function onWorkbenchLog(event) {
    if (destroyed) return;
    const entry = event?.detail || {};
    const scope = eventScope(entry);
    if (!scope || scope === 'PERF') return;
    const name = eventName(entry);
    const lower = name.toLowerCase();
    const meta = eventMeta(entry);

    if (scope === 'CALL') {
      if (name === 'Загрузка модуля регистрации') {
        start('call.module_load', meta);
        return;
      }
      if (name === 'Модуль регистрации загружен') {
        finishIfPending('call.module_load', entry, 'ok');
        return;
      }
      if (lower.startsWith('модуль регистрации не загрузился')) {
        finishIfPending('call.module_load', entry, 'error');
        return;
      }
      if (name === 'Запрошено окно регистрации звонка') {
        start('call.registration_open', meta);
        return;
      }
      if (name === 'Окно регистрации отработало') {
        finishIfPending('call.registration_open', entry, 'ok');
        return;
      }
      if (name === 'Окно регистрации вернуло ошибочный результат' || lower.startsWith('ошибка при открытии окна регистрации')) {
        finishIfPending('call.registration_open', entry, 'error');
        return;
      }
      if (name === 'Открытие регистрации по target-маршруту') {
        start('call.route_open', meta);
        return;
      }
      if (name === 'Окно регистрации открыто по target-маршруту') {
        finishIfPending('call.route_open', entry, 'ok');
        return;
      }
      if (lower.startsWith('не удалось открыть регистрацию по target-маршруту') || lower.startsWith('routed registration did not open')) {
        finishIfPending('call.route_open', entry, 'error');
        return;
      }
    }

    if (scope !== 'TASK_FLOW') return;

    if (name === 'task_save_decision') {
      start('task.save_guard', meta);
      return;
    }
    if (
      name === 'task_save_passed_no_special_info'
      || name === 'special_policy_v3_shown'
      || name === 'special_policy_v3_fallback'
    ) {
      finishIfPending('task.save_guard', entry, name === 'special_policy_v3_fallback' ? 'fallback' : 'ok');
      return;
    }
    if (name === 'Current UserSide field visit validation blocked save' || name === 'final_field_visit_gate_blocked') {
      finishIfPending('task.save_guard', entry, 'blocked');
      return;
    }

    if (name === 'address_context_resolve_start') {
      start('task.address_resolve', meta);
      return;
    }
    if (
      name === 'address_context_resolve_result'
      || name === 'address_context_resolve_discarded'
      || name === 'address_context_waiting_for_building'
    ) {
      finishIfPending(
        'task.address_resolve',
        entry,
        name === 'address_context_resolve_result' ? 'ok' : 'cancelled',
        {},
        { persist: false }
      );
    }
  }

  function systemForPage() {
    const host = String(location.hostname || '').toLowerCase();
    if (host === 'userside.simnet.kiev.ua') return 'userside';
    if (host === 'admin.looknet.kiev.ua') return 'looknet-billing';
    if (host === 'admin.simnet.kiev.ua') return 'billing';
    return 'other';
  }

  function safeRoute(rawUrl = '') {
    try {
      const url = new URL(rawUrl || location.href, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const path = String(url.pathname || '/')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\d{3,}/g, ':id');
      const labels = [];
      for (const key of ['a', 'section', 'tab']) {
        const value = String(url.searchParams.get(key) || '');
        if (/^[a-z0-9_-]{1,32}$/i.test(value)) labels.push(`${key}=${value}`);
      }
      return compact(`${url.hostname}${path}${labels.length ? ` · ${labels.join(' · ')}` : ''}`, 220);
    } catch {
      return compact((String(location.hostname || '') + String(location.pathname || ''))
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\d{3,}/g, ':id'), 220);
    }
  }

  function emptyResourceBucket(startedAt = Date.now()) {
    return {
      startedAt,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      slowCount: 0,
      errorCount: 0,
      transferBytes: 0,
      cachedCount: 0,
      routes: new Map()
    };
  }

  function activePerformanceSession() {
    return performanceSession?.status === 'active' && Boolean(performanceSession.sessionId);
  }

  function captureSessionMetric(sample = {}) {
    if (!activePerformanceSession() || document.hidden || destroyed) return;
    const metric = compact(sample.metric, 80);
    if (!metric) return;
    const current = sessionMetrics.get(metric) || {
      metric,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0
    };
    current.count += 1;
    current.totalDurationMs += Number(sample.durationMs || 0);
    current.maxDurationMs = Math.max(current.maxDurationMs, Number(sample.durationMs || 0));
    sessionMetrics.set(metric, current);
  }

  function captureSessionResource(entry = {}) {
    if (!activePerformanceSession() || document.hidden || destroyed) return;
    const absoluteStart = Number(globalThis.performance?.timeOrigin || 0) + Number(entry.startTime || 0);
    const sessionStartedAt = new Date(performanceSession.startedAt).getTime();
    if (Number.isFinite(sessionStartedAt) && absoluteStart + 1000 < sessionStartedAt) return;
    const route = safeRoute(entry.name);
    if (!route) return;

    const durationMs = roundMs(entry.duration);
    const responseStatus = Number(entry.responseStatus || 0);
    const transferBytes = Math.max(0, Number(entry.transferSize || 0));
    const cached = transferBytes === 0 && Number(entry.decodedBodySize || 0) > 0;
    sessionResources.count += 1;
    sessionResources.totalDurationMs += durationMs;
    sessionResources.maxDurationMs = Math.max(sessionResources.maxDurationMs, durationMs);
    if (durationMs >= SESSION_SLOW_RESOURCE_MS) sessionResources.slowCount += 1;
    if (responseStatus >= 400) sessionResources.errorCount += 1;
    sessionResources.transferBytes += transferBytes;
    if (cached) sessionResources.cachedCount += 1;

    const aggregate = sessionResources.routes.get(route) || {
      route,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      slowCount: 0,
      errorCount: 0,
      transferBytes: 0
    };
    aggregate.count += 1;
    aggregate.totalDurationMs += durationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, durationMs);
    if (durationMs >= SESSION_SLOW_RESOURCE_MS) aggregate.slowCount += 1;
    if (responseStatus >= 400) aggregate.errorCount += 1;
    aggregate.transferBytes += transferBytes;
    sessionResources.routes.set(route, aggregate);
  }

  function installSessionResourceObserver() {
    if (sessionResourceObserver || typeof PerformanceObserver !== 'function') return;
    try {
      sessionResourceObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) captureSessionResource(entry);
      });
      sessionResourceObserver.observe({ type: 'resource', buffered: true });
    } catch {
      sessionResourceObserver = null;
    }
  }

  function navigationSnapshot() {
    if (sessionNavigationSent || typeof performance?.getEntriesByType !== 'function') return null;
    const navigation = performance.getEntriesByType('navigation')?.[0];
    if (!navigation) return null;
    const loadMs = Number(navigation.loadEventEnd || 0);
    if (!(loadMs > 0)) return null;
    sessionNavigationSent = true;
    return {
      type: compact(navigation.type || 'navigate', 24),
      ttfbMs: roundMs(navigation.responseStart || 0),
      responseEndMs: roundMs(navigation.responseEnd || 0),
      domInteractiveMs: roundMs(navigation.domInteractive || 0),
      domContentLoadedMs: roundMs(navigation.domContentLoadedEventEnd || 0),
      loadMs: roundMs(loadMs),
      transferBytes: Math.max(0, Number(navigation.transferSize || 0)),
      startedBeforeSession: Number(performance.timeOrigin || 0) < new Date(performanceSession.startedAt).getTime() - 5000
    };
  }

  function memorySnapshot() {
    const memory = performance?.memory;
    if (!memory || !Number.isFinite(Number(memory.usedJSHeapSize))) return null;
    return {
      usedJsHeapBytes: Math.max(0, Number(memory.usedJSHeapSize || 0)),
      totalJsHeapBytes: Math.max(0, Number(memory.totalJSHeapSize || 0)),
      jsHeapLimitBytes: Math.max(0, Number(memory.jsHeapSizeLimit || 0))
    };
  }

  async function storageBytesSnapshot() {
    try {
      if (typeof chrome.storage?.local?.getBytesInUse !== 'function') return null;
      return Math.max(0, Number(await chrome.storage.local.getBytesInUse(null)) || 0);
    } catch {
      return null;
    }
  }

  async function eventLoopDelay(skipDelay = false) {
    if (skipDelay) return null;
    const startedAt = now();
    await new Promise(resolve => setTimeout(resolve, 0));
    return roundMs(now() - startedAt);
  }

  function rotateSessionBuckets(capturedAt = Date.now()) {
    const resources = sessionResources;
    const metrics = sessionMetrics;
    sessionResources = emptyResourceBucket(capturedAt);
    sessionMetrics = new Map();
    return { resources, metrics };
  }

  function mergeResourceBucket(source) {
    if (!source) return;
    sessionResources.startedAt = Math.min(sessionResources.startedAt, Number(source.startedAt || Date.now()));
    for (const key of ['count', 'totalDurationMs', 'slowCount', 'errorCount', 'transferBytes', 'cachedCount']) {
      sessionResources[key] += Number(source[key] || 0);
    }
    sessionResources.maxDurationMs = Math.max(sessionResources.maxDurationMs, Number(source.maxDurationMs || 0));
    for (const [route, item] of source.routes || []) {
      const current = sessionResources.routes.get(route) || { route, count: 0, totalDurationMs: 0, maxDurationMs: 0, slowCount: 0, errorCount: 0, transferBytes: 0 };
      current.count += Number(item.count || 0);
      current.totalDurationMs += Number(item.totalDurationMs || 0);
      current.maxDurationMs = Math.max(current.maxDurationMs, Number(item.maxDurationMs || 0));
      current.slowCount += Number(item.slowCount || 0);
      current.errorCount += Number(item.errorCount || 0);
      current.transferBytes += Number(item.transferBytes || 0);
      sessionResources.routes.set(route, current);
    }
  }

  function mergeMetricBucket(source) {
    for (const [metric, item] of source || []) {
      const current = sessionMetrics.get(metric) || { metric, count: 0, totalDurationMs: 0, maxDurationMs: 0 };
      current.count += Number(item.count || 0);
      current.totalDurationMs += Number(item.totalDurationMs || 0);
      current.maxDurationMs = Math.max(current.maxDurationMs, Number(item.maxDurationMs || 0));
      sessionMetrics.set(metric, current);
    }
  }

  function serializeResources(bucket, capturedAt) {
    return {
      windowMs: Math.max(0, capturedAt - Number(bucket.startedAt || capturedAt)),
      count: bucket.count,
      totalDurationMs: roundMs(bucket.totalDurationMs),
      maxDurationMs: roundMs(bucket.maxDurationMs),
      slowCount: bucket.slowCount,
      errorCount: bucket.errorCount,
      transferBytes: Math.round(bucket.transferBytes),
      cachedCount: bucket.cachedCount,
      routes: Array.from(bucket.routes.values())
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
        .slice(0, SESSION_MAX_ROUTES)
        .map(item => ({ ...item, totalDurationMs: roundMs(item.totalDurationMs), maxDurationMs: roundMs(item.maxDurationMs) }))
    };
  }

  async function flushPerformanceSession(reason = 'interval', options = {}) {
    if (sessionFlushInFlight) return sessionFlushInFlight;
    if (!activePerformanceSession() || destroyed || (document.hidden && !options.force)) return null;

    const sessionId = performanceSession.sessionId;
    const navigation = navigationSnapshot();
    const navigationIncluded = Boolean(navigation);
    const capturedAt = Date.now();
    const rotated = rotateSessionBuckets(capturedAt);
    const task = (async () => {
      try {
        let delayMs = null;
        let storageBytes = lastStorageBytes;
        if (!options.skipDelay) {
          [delayMs, storageBytes] = await Promise.all([
            eventLoopDelay(false),
            storageBytesSnapshot()
          ]);
          if (Number.isFinite(Number(storageBytes))) lastStorageBytes = Number(storageBytes);
        }
        const longTaskMetric = rotated.metrics.get('runtime.long_task');
        const sample = {
          id: globalThis.crypto?.randomUUID?.() || `perf_sample_${capturedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date(capturedAt).toISOString(),
          reason,
          documentId: String(WB.runtime?.documentId || ''),
          page: {
            system: systemForPage(),
            route: safeRoute(location.href),
            visibility: document.visibilityState
          },
          navigation,
          resources: serializeResources(rotated.resources, capturedAt),
          longTasks: {
            count: Number(longTaskMetric?.count || 0),
            totalDurationMs: roundMs(longTaskMetric?.totalDurationMs || 0),
            maxDurationMs: roundMs(longTaskMetric?.maxDurationMs || 0)
          },
          eventLoopDelayMs: delayMs,
          domNodes: document.getElementsByTagName('*').length,
          storageBytes,
          memory: memorySnapshot(),
          metrics: Array.from(rotated.metrics.values())
        };
        const response = await chrome.runtime.sendMessage({
          type: PERFORMANCE_SAMPLE_MESSAGE,
          payload: { sessionId, sample }
        });
        if (!response?.success) throw new Error(response?.error || 'Performance sample rejected');
        lastSessionFlushAt = capturedAt;
        if (response.data?.status !== 'active') stopPerformanceSessionCapture();
        return response.data;
      } catch (error) {
        if (performanceSession?.sessionId === sessionId) {
          if (navigationIncluded) sessionNavigationSent = false;
          mergeResourceBucket(rotated.resources);
          mergeMetricBucket(rotated.metrics);
        }
        if (!WB.log?.isContextInvalidated?.(error)) {
          console.warn('[SIMNET WB][PERF] session sample failed', error?.message || error);
        }
        return null;
      } finally {
        sessionFlushInFlight = null;
      }
    })();
    sessionFlushInFlight = task;
    return task;
  }

  function stopPerformanceSessionCapture() {
    clearTimeout(sessionInterval);
    clearTimeout(sessionInitialTimer);
    clearTimeout(sessionDeadlineTimer);
    sessionInterval = null;
    sessionInitialTimer = null;
    sessionDeadlineTimer = null;
    try { sessionResourceObserver?.disconnect?.(); } catch {}
    sessionResourceObserver = null;
    performanceSession = null;
    sessionResources = emptyResourceBucket();
    sessionMetrics = new Map();
  }

  function schedulePerformanceSessionTick() {
    clearTimeout(sessionInterval);
    sessionInterval = null;
    if (!activePerformanceSession() || destroyed) return;
    sessionInterval = setTimeout(() => {
      sessionInterval = null;
      void Promise.resolve(flushPerformanceSession('interval')).finally(() => {
        schedulePerformanceSessionTick();
      });
    }, SESSION_FLUSH_MS);
  }

  function startPerformanceSessionCapture(control = {}) {
    if (destroyed || control?.status !== 'active' || !control?.sessionId) {
      stopPerformanceSessionCapture();
      return;
    }
    if (performanceSession?.sessionId === control.sessionId) return;
    stopPerformanceSessionCapture();
    performanceSession = { ...control };
    sessionNavigationSent = false;
    const startedAt = new Date(control.startedAt).getTime();
    sessionResources = emptyResourceBucket(Math.max(Number(performance.timeOrigin || Date.now()), startedAt || 0));
    sessionMetrics = new Map();
    if (Number(WB.runtime?.bootCompletedAt || 0) > 0) {
      captureSessionMetric({
        metric: 'runtime.workbench_ready',
        durationMs: Math.max(0, Number(WB.runtime.bootCompletedAt) - Number(WB.runtime.pageInstanceStartedAt || WB.runtime.bootCompletedAt))
      });
    }
    installSessionResourceObserver();

    const deadlineMs = new Date(control.plannedEndAt).getTime() - Date.now();
    sessionInitialTimer = setTimeout(() => {
      void flushPerformanceSession(deadlineMs <= 0 ? 'deadline' : 'page-entry', { force: deadlineMs <= 0 });
    }, deadlineMs <= 0 ? 0 : 1200);
    schedulePerformanceSessionTick();
    if (Number.isFinite(deadlineMs)) {
      sessionDeadlineTimer = setTimeout(() => {
        void flushPerformanceSession('deadline', { force: true });
      }, Math.max(0, Math.min(0x7fffffff, deadlineMs + 250)));
    }
  }

  function onPerformanceStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes?.[PERFORMANCE_CONTROL_KEY]) return;
    const control = changes[PERFORMANCE_CONTROL_KEY].newValue;
    if (control?.status === 'active') startPerformanceSessionCapture(control);
    else stopPerformanceSessionCapture();
  }

  function onPerformanceVisibilityChange() {
    if (!activePerformanceSession()) return;
    if (document.hidden) {
      void flushPerformanceSession('visibility-hidden', { force: true, skipDelay: true });
      return;
    }
    if (Date.now() - lastSessionFlushAt >= 15_000) {
      setTimeout(() => { void flushPerformanceSession('visible'); }, 750);
    }
  }

  function onPerformanceRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type !== PERFORMANCE_FLUSH_MESSAGE) return false;
    Promise.resolve(flushPerformanceSession('operator-snapshot', { force: true })).then(
      data => sendResponse({ success: true, data }),
      error => sendResponse({ success: false, error: error?.message || String(error) })
    );
    return true;
  }

  async function initializePerformanceSessionCapture() {
    try {
      const stored = await chrome.storage.local.get(PERFORMANCE_CONTROL_KEY);
      const control = stored?.[PERFORMANCE_CONTROL_KEY];
      if (control?.status === 'active') startPerformanceSessionCapture(control);
    } catch (error) {
      if (!WB.log?.isContextInvalidated?.(error)) {
        console.warn('[SIMNET WB][PERF] session state unavailable', error?.message || error);
      }
    }
  }

  function installLongTaskObserver() {
    if (typeof PerformanceObserver !== 'function') return;
    try {
      longTaskObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        for (const entry of entries) {
          const durationMs = Number(entry?.duration || 0);
          if (durationMs < LONG_TASK_CAPTURE_MS) continue;
          const shouldPersist = durationMs >= LONG_TASK_PERSIST_MS && Date.now() - lastLongTaskLogAt >= LONG_TASK_LOG_COOLDOWN_MS;
          if (shouldPersist) lastLongTaskLogAt = Date.now();
          record('runtime.long_task', durationMs, {
            startTimeMs: roundMs(entry?.startTime || 0),
            visibility: document.visibilityState,
            page: compact(location.pathname, 180)
          }, {
            thresholdMs: LONG_TASK_CAPTURE_MS,
            persist: shouldPersist,
            persistSlow: false
          });
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      longTaskObserver = null;
    }
  }

  function clear() {
    samples.length = 0;
    pending.clear();
    sessionMetrics.clear();
    return true;
  }

  function destroy() {
    if (destroyed) return;
    if (activePerformanceSession()) {
      void flushPerformanceSession('pagehide', { force: true, skipDelay: true });
    }
    destroyed = true;
    window.removeEventListener('simnet-workbench-log', onWorkbenchLog);
    window.removeEventListener('pagehide', destroy);
    document.removeEventListener('visibilitychange', onPerformanceVisibilityChange);
    try { chrome.storage.onChanged.removeListener(onPerformanceStorageChanged); } catch {}
    try { chrome.runtime.onMessage.removeListener(onPerformanceRuntimeMessage); } catch {}
    try { longTaskObserver?.disconnect?.(); } catch {}
    longTaskObserver = null;
    stopPerformanceSessionCapture();
    pending.clear();
  }

  WB.perf = Object.freeze({
    start,
    end,
    measure,
    record,
    recent(limit = 50) {
      return samples.slice(0, Math.max(1, Math.min(MAX_SAMPLES, Number(limit) || 50)));
    },
    summary,
    clear,
    thresholds: THRESHOLDS
  });

  window.addEventListener('simnet-workbench-log', onWorkbenchLog);
  window.addEventListener('pagehide', destroy, { once: true });
  document.addEventListener('visibilitychange', onPerformanceVisibilityChange);
  chrome.storage.onChanged.addListener(onPerformanceStorageChanged);
  chrome.runtime.onMessage.addListener(onPerformanceRuntimeMessage);
  installLongTaskObserver();
  void initializePerformanceSessionCapture();

  const bootAgeMs = Date.now() - Number(WB.runtime?.pageInstanceStartedAt || Date.now());
  record('runtime.probe_ready', bootAgeMs, {
    version: compact(WB.version || '', 40),
    page: compact(location.pathname, 180)
  }, { thresholdMs: 1000, persist: false, persistSlow: false });
})();
