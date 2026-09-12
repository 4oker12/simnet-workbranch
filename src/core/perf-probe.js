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

  const samples = [];
  const pending = new Map();
  let longTaskObserver = null;
  let lastLongTaskLogAt = 0;
  let destroyed = false;

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

  function persist(metric, sample, force = false) {
    if (!WB.log || destroyed) return;
    const shouldPersist = force || ALWAYS_PERSIST.has(metric) || sample.slow;
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
    persist(name, sample, Boolean(options.persist));
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

  function finishIfPending(metric, entry, status = 'ok', extra = {}) {
    return end(metric, {
      ...eventMeta(entry),
      status,
      event: compact(eventName(entry), 120),
      ...extra
    }, { persist: ALWAYS_PERSIST.has(metric) || status !== 'ok' });
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
      finishIfPending('task.address_resolve', entry, name === 'address_context_resolve_result' ? 'ok' : 'cancelled');
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
            persist: shouldPersist
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
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('simnet-workbench-log', onWorkbenchLog);
    window.removeEventListener('pagehide', destroy);
    try { longTaskObserver?.disconnect?.(); } catch {}
    longTaskObserver = null;
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
  installLongTaskObserver();

  const bootAgeMs = Date.now() - Number(WB.runtime?.pageInstanceStartedAt || Date.now());
  record('runtime.probe_ready', bootAgeMs, {
    version: compact(WB.version || '', 40),
    page: compact(location.pathname, 180)
  }, { thresholdMs: 1000, persist: false });
})();
