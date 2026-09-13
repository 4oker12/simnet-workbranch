export const PERFORMANCE_SESSION_SCHEMA = 'simnet-workbench-performance-session-v1';
export const PERFORMANCE_SESSION_STORAGE_KEY = 'simnet_workbench_performance_session_v1';
export const PERFORMANCE_CONTROL_STORAGE_KEY = 'simnet_workbench_performance_control_v1';
export const DEFAULT_PERFORMANCE_SESSION_MS = 30 * 60 * 1000;

const MAX_SAMPLES = 480;
const MAX_ROUTES_PER_SAMPLE = 12;
const MAX_METRICS_PER_SAMPLE = 18;
const MAX_ROUTE_REPORT = 8;
const MIB = 1024 * 1024;

const finite = value => Number.isFinite(Number(value));
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const boundedNumber = (value, max = 1e15) => (
  finite(value) ? Math.max(0, Math.min(max, Number(value))) : null
);
const compact = (value, max = 180) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const clone = value => (value == null ? value : JSON.parse(JSON.stringify(value)));
const isoAt = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
const epoch = value => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

function safeRoute(value) {
  return compact(value, 220)
    .replace(/[?#].*$/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\d{3,}/g, ':id');
}

function sanitizeRouteAggregate(raw = {}) {
  const route = safeRoute(raw.route);
  if (!route) return null;
  const count = Math.max(0, Math.floor(boundedNumber(raw.count, 100000) || 0));
  if (!count) return null;
  return {
    route,
    count,
    totalDurationMs: round(boundedNumber(raw.totalDurationMs, 1e9) || 0),
    maxDurationMs: round(boundedNumber(raw.maxDurationMs, 1e8) || 0),
    slowCount: Math.max(0, Math.floor(boundedNumber(raw.slowCount, count) || 0)),
    errorCount: Math.max(0, Math.floor(boundedNumber(raw.errorCount, count) || 0)),
    transferBytes: Math.max(0, Math.floor(boundedNumber(raw.transferBytes, 1e12) || 0))
  };
}

function sanitizeMetricAggregate(raw = {}) {
  const metric = compact(raw.metric, 80);
  const count = Math.max(0, Math.floor(boundedNumber(raw.count, 100000) || 0));
  if (!metric || !count) return null;
  return {
    metric,
    count,
    totalDurationMs: round(boundedNumber(raw.totalDurationMs, 1e9) || 0),
    maxDurationMs: round(boundedNumber(raw.maxDurationMs, 1e8) || 0)
  };
}

export function sanitizePerformanceSample(raw = {}, nowMs = Date.now()) {
  const resources = raw.resources && typeof raw.resources === 'object' ? raw.resources : {};
  const navigation = raw.navigation && typeof raw.navigation === 'object' ? raw.navigation : null;
  const memory = raw.memory && typeof raw.memory === 'object' ? raw.memory : null;
  const longTasks = raw.longTasks && typeof raw.longTasks === 'object' ? raw.longTasks : {};
  const page = raw.page && typeof raw.page === 'object' ? raw.page : {};
  const sampleAt = isoAt(raw.at ?? nowMs);

  return {
    id: compact(raw.id, 100) || `perf_sample_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: sampleAt,
    reason: compact(raw.reason || 'interval', 40),
    documentId: compact(raw.documentId, 120),
    tabId: finite(raw.tabId) ? Number(raw.tabId) : null,
    page: {
      system: compact(page.system, 32),
      route: safeRoute(page.route),
      visibility: ['visible', 'hidden', 'prerender'].includes(String(page.visibility))
        ? String(page.visibility)
        : 'unknown'
    },
    navigation: navigation ? {
      type: compact(navigation.type, 24),
      ttfbMs: boundedNumber(navigation.ttfbMs, 1e8),
      responseEndMs: boundedNumber(navigation.responseEndMs, 1e8),
      domInteractiveMs: boundedNumber(navigation.domInteractiveMs, 1e8),
      domContentLoadedMs: boundedNumber(navigation.domContentLoadedMs, 1e8),
      loadMs: boundedNumber(navigation.loadMs, 1e8),
      transferBytes: boundedNumber(navigation.transferBytes, 1e12),
      startedBeforeSession: Boolean(navigation.startedBeforeSession)
    } : null,
    resources: {
      windowMs: boundedNumber(resources.windowMs, 24 * 60 * 60 * 1000) || 0,
      count: Math.max(0, Math.floor(boundedNumber(resources.count, 100000) || 0)),
      totalDurationMs: round(boundedNumber(resources.totalDurationMs, 1e9) || 0),
      maxDurationMs: round(boundedNumber(resources.maxDurationMs, 1e8) || 0),
      slowCount: Math.max(0, Math.floor(boundedNumber(resources.slowCount, 100000) || 0)),
      errorCount: Math.max(0, Math.floor(boundedNumber(resources.errorCount, 100000) || 0)),
      transferBytes: Math.max(0, Math.floor(boundedNumber(resources.transferBytes, 1e12) || 0)),
      cachedCount: Math.max(0, Math.floor(boundedNumber(resources.cachedCount, 100000) || 0)),
      routes: (Array.isArray(resources.routes) ? resources.routes : [])
        .map(sanitizeRouteAggregate)
        .filter(Boolean)
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
        .slice(0, MAX_ROUTES_PER_SAMPLE)
    },
    longTasks: {
      count: Math.max(0, Math.floor(boundedNumber(longTasks.count, 100000) || 0)),
      totalDurationMs: round(boundedNumber(longTasks.totalDurationMs, 1e9) || 0),
      maxDurationMs: round(boundedNumber(longTasks.maxDurationMs, 1e8) || 0)
    },
    eventLoopDelayMs: boundedNumber(raw.eventLoopDelayMs, 1e8),
    domNodes: boundedNumber(raw.domNodes, 1e8),
    storageBytes: boundedNumber(raw.storageBytes, 1e12),
    memory: memory ? {
      usedJsHeapBytes: boundedNumber(memory.usedJsHeapBytes, 1e12),
      totalJsHeapBytes: boundedNumber(memory.totalJsHeapBytes, 1e12),
      jsHeapLimitBytes: boundedNumber(memory.jsHeapLimitBytes, 1e13)
    } : null,
    metrics: (Array.isArray(raw.metrics) ? raw.metrics : [])
      .map(sanitizeMetricAggregate)
      .filter(Boolean)
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
      .slice(0, MAX_METRICS_PER_SAMPLE)
  };
}

function makeSessionId(nowMs) {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `perf_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createPerformanceSession(options = {}) {
  const nowMs = finite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const targetDurationMs = Math.max(
    60 * 1000,
    Math.min(2 * 60 * 60 * 1000, Number(options.durationMs) || DEFAULT_PERFORMANCE_SESSION_MS)
  );
  return {
    schema: PERFORMANCE_SESSION_SCHEMA,
    schemaVersion: 1,
    id: makeSessionId(nowMs),
    status: 'active',
    version: compact(options.version, 40),
    startedAt: new Date(nowMs).toISOString(),
    plannedEndAt: new Date(nowMs + targetDurationMs).toISOString(),
    completedAt: '',
    completionReason: '',
    targetDurationMs,
    sampleCount: 0,
    samples: [],
    report: null,
    updatedAt: new Date(nowMs).toISOString()
  };
}

function chronological(samples = []) {
  return samples.slice().sort((a, b) => epoch(a.at) - epoch(b.at));
}

function edgeSets(items = [], maxEdge = 5) {
  const sorted = chronological(items);
  if (sorted.length < 2) return { early: [], late: [], total: sorted.length };
  const edgeSize = Math.max(1, Math.min(maxEdge, Math.floor(sorted.length / 2)));
  return {
    early: sorted.slice(0, edgeSize),
    late: sorted.slice(-edgeSize),
    total: sorted.length
  };
}

function average(items = [], getter = value => value) {
  const values = items.map(getter).filter(finite).map(Number);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedResourceAverage(items = []) {
  let count = 0;
  let total = 0;
  for (const sample of items) {
    const itemCount = Number(sample?.resources?.count || 0);
    if (!itemCount) continue;
    count += itemCount;
    total += Number(sample?.resources?.totalDurationMs || 0);
  }
  return count ? { value: total / count, count } : { value: null, count: 0 };
}

function metricAggregate(items = [], metricName = '') {
  let count = 0;
  let total = 0;
  for (const sample of items) {
    for (const metric of sample?.metrics || []) {
      if (metric.metric !== metricName) continue;
      count += Number(metric.count || 0);
      total += Number(metric.totalDurationMs || 0);
    }
  }
  return count ? { value: total / count, count } : { value: null, count: 0 };
}

function longTaskRate(items = []) {
  let count = 0;
  let windowMs = 0;
  for (const sample of items) {
    count += Number(sample?.longTasks?.count || 0);
    windowMs += Number(sample?.resources?.windowMs || 0);
  }
  return windowMs > 0 ? { value: count / (windowMs / 60000), count: items.length } : { value: null, count: 0 };
}

function comparison(spec, baseline, current, counts = {}) {
  const baselineValue = finite(baseline) ? Number(baseline) : null;
  const currentValue = finite(current) ? Number(current) : null;
  if (baselineValue == null || currentValue == null) {
    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      baseline: baselineValue,
      current: currentValue,
      delta: null,
      deltaPercent: null,
      state: 'unknown',
      baselineCount: Number(counts.baseline || 0),
      currentCount: Number(counts.current || 0)
    };
  }

  const delta = currentValue - baselineValue;
  const deltaPercent = baselineValue > 0 ? (delta / baselineValue) * 100 : (delta > 0 ? null : 0);
  const percentForThreshold = deltaPercent == null ? Infinity : deltaPercent;
  let state = 'stable';
  if (delta >= spec.badAbs && percentForThreshold >= spec.badPercent) state = 'bad';
  else if (delta >= spec.warnAbs && percentForThreshold >= spec.warnPercent) state = 'warn';
  else if (delta <= -Math.max(spec.warnAbs * 0.5, 0.1) && (deltaPercent == null || deltaPercent <= -20)) state = 'better';

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    baseline: round(baselineValue, spec.unit === 'bytes' ? 0 : 1),
    current: round(currentValue, spec.unit === 'bytes' ? 0 : 1),
    delta: round(delta, spec.unit === 'bytes' ? 0 : 1),
    deltaPercent: deltaPercent == null ? null : round(deltaPercent, 1),
    state,
    baselineCount: Number(counts.baseline || 0),
    currentCount: Number(counts.current || 0)
  };
}

const SPECS = Object.freeze({
  pageLoad: { key: 'navigation.load', label: 'Загрузка страницы', unit: 'ms', warnAbs: 400, warnPercent: 25, badAbs: 1000, badPercent: 60 },
  ttfb: { key: 'navigation.ttfb', label: 'Ответ сервера (TTFB)', unit: 'ms', warnAbs: 150, warnPercent: 30, badAbs: 400, badPercent: 75 },
  requests: { key: 'resource.average', label: 'Запросы страницы', unit: 'ms', warnAbs: 100, warnPercent: 30, badAbs: 300, badPercent: 75 },
  workbench: { key: 'workbench.ready', label: 'Готовность Workbench', unit: 'ms', warnAbs: 250, warnPercent: 30, badAbs: 700, badPercent: 75 },
  memory: { key: 'memory.used', label: 'JS-память', unit: 'bytes', warnAbs: 32 * MIB, warnPercent: 25, badAbs: 96 * MIB, badPercent: 60 },
  storage: { key: 'storage.used', label: 'Хранилище Workbench', unit: 'bytes', warnAbs: 1 * MIB, warnPercent: 35, badAbs: 5 * MIB, badPercent: 100 },
  dom: { key: 'dom.nodes', label: 'DOM-узлы', unit: 'count', warnAbs: 500, warnPercent: 25, badAbs: 1500, badPercent: 60 },
  eventLoop: { key: 'runtime.event_loop_delay', label: 'Задержка главного потока', unit: 'ms', warnAbs: 20, warnPercent: 50, badAbs: 60, badPercent: 150 },
  longTasks: { key: 'runtime.long_tasks', label: 'Длинные задачи', unit: 'per_min', warnAbs: 1, warnPercent: 50, badAbs: 4, badPercent: 150 }
});

function aggregateRoutes(samples = [], midpointMs = 0, side = 'early') {
  const map = new Map();
  for (const sample of samples) {
    const sampleAt = epoch(sample.at);
    if (side === 'early' ? sampleAt >= midpointMs : sampleAt < midpointMs) continue;
    for (const route of sample?.resources?.routes || []) {
      const current = map.get(route.route) || { route: route.route, count: 0, totalDurationMs: 0, maxDurationMs: 0, errorCount: 0 };
      current.count += Number(route.count || 0);
      current.totalDurationMs += Number(route.totalDurationMs || 0);
      current.maxDurationMs = Math.max(current.maxDurationMs, Number(route.maxDurationMs || 0));
      current.errorCount += Number(route.errorCount || 0);
      map.set(route.route, current);
    }
  }
  return map;
}

function routeReport(samples = [], startedAtMs = 0, endedAtMs = 0) {
  const midpoint = startedAtMs + Math.max(0, endedAtMs - startedAtMs) / 2;
  const early = aggregateRoutes(samples, midpoint, 'early');
  const late = aggregateRoutes(samples, midpoint, 'late');
  const names = new Set([...early.keys(), ...late.keys()]);
  return Array.from(names).map(route => {
    const before = early.get(route) || null;
    const after = late.get(route) || null;
    const baselineAvgMs = before?.count ? before.totalDurationMs / before.count : null;
    const currentAvgMs = after?.count ? after.totalDurationMs / after.count : null;
    const deltaPercent = baselineAvgMs > 0 && currentAvgMs != null
      ? ((currentAvgMs - baselineAvgMs) / baselineAvgMs) * 100
      : null;
    return {
      route,
      baselineCount: Number(before?.count || 0),
      currentCount: Number(after?.count || 0),
      baselineAvgMs: baselineAvgMs == null ? null : round(baselineAvgMs),
      currentAvgMs: currentAvgMs == null ? null : round(currentAvgMs),
      deltaPercent: deltaPercent == null ? null : round(deltaPercent),
      maxMs: round(Math.max(Number(before?.maxDurationMs || 0), Number(after?.maxDurationMs || 0))),
      errorCount: Number(before?.errorCount || 0) + Number(after?.errorCount || 0)
    };
  }).filter(item => item.currentCount || item.baselineCount)
    .sort((a, b) => {
      const aGrowth = a.deltaPercent == null ? 0 : Math.max(0, a.deltaPercent);
      const bGrowth = b.deltaPercent == null ? 0 : Math.max(0, b.deltaPercent);
      return (bGrowth * Math.log2(b.currentCount + 2) + Number(b.currentAvgMs || 0) / 10)
        - (aGrowth * Math.log2(a.currentCount + 2) + Number(a.currentAvgMs || 0) / 10);
    })
    .slice(0, MAX_ROUTE_REPORT);
}

function operationReport(samples = []) {
  const edges = edgeSets(samples);
  const names = new Set();
  for (const sample of [...edges.early, ...edges.late]) {
    for (const metric of sample?.metrics || []) {
      if (!['runtime.long_task', 'runtime.workbench_ready', 'runtime.probe_ready'].includes(metric.metric)) names.add(metric.metric);
    }
  }
  return Array.from(names).map(metric => {
    const before = metricAggregate(edges.early, metric);
    const after = metricAggregate(edges.late, metric);
    const deltaPercent = before.value > 0 && after.value != null
      ? ((after.value - before.value) / before.value) * 100
      : null;
    return {
      metric,
      baselineCount: before.count,
      currentCount: after.count,
      baselineAvgMs: before.value == null ? null : round(before.value),
      currentAvgMs: after.value == null ? null : round(after.value),
      deltaPercent: deltaPercent == null ? null : round(deltaPercent)
    };
  }).filter(item => item.baselineCount || item.currentCount)
    .sort((a, b) => {
      const aScore = Math.max(0, Number(a.deltaPercent || 0)) + Number(a.currentAvgMs || 0) / 10;
      const bScore = Math.max(0, Number(b.deltaPercent || 0)) + Number(b.currentAvgMs || 0) / 10;
      return bScore - aScore;
    })
    .slice(0, 8);
}

function navigationRouteReport(samples = [], startedAtMs = 0, endedAtMs = 0) {
  const midpoint = startedAtMs + Math.max(0, endedAtMs - startedAtMs) / 2;
  const halves = [new Map(), new Map()];
  for (const sample of samples) {
    if (!finite(sample?.navigation?.loadMs) || sample.navigation.startedBeforeSession) continue;
    const route = safeRoute(sample?.page?.route);
    if (!route) continue;
    const side = epoch(sample.at) < midpoint ? 0 : 1;
    const current = halves[side].get(route) || { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += Number(sample.navigation.loadMs || 0);
    current.maxMs = Math.max(current.maxMs, Number(sample.navigation.loadMs || 0));
    halves[side].set(route, current);
  }
  const names = new Set([...halves[0].keys(), ...halves[1].keys()]);
  return Array.from(names).map(route => {
    const before = halves[0].get(route) || null;
    const after = halves[1].get(route) || null;
    const baselineAvgMs = before?.count ? before.totalMs / before.count : null;
    const currentAvgMs = after?.count ? after.totalMs / after.count : null;
    const deltaPercent = baselineAvgMs > 0 && currentAvgMs != null
      ? ((currentAvgMs - baselineAvgMs) / baselineAvgMs) * 100
      : null;
    return {
      route,
      baselineCount: Number(before?.count || 0),
      currentCount: Number(after?.count || 0),
      baselineAvgMs: baselineAvgMs == null ? null : round(baselineAvgMs),
      currentAvgMs: currentAvgMs == null ? null : round(currentAvgMs),
      deltaPercent: deltaPercent == null ? null : round(deltaPercent),
      maxMs: round(Math.max(Number(before?.maxMs || 0), Number(after?.maxMs || 0)))
    };
  }).sort((a, b) => {
    const aScore = Math.max(0, Number(a.deltaPercent || 0)) + Number(a.currentAvgMs || a.maxMs || 0) / 10;
    const bScore = Math.max(0, Number(b.deltaPercent || 0)) + Number(b.currentAvgMs || b.maxMs || 0) / 10;
    return bScore - aScore;
  }).slice(0, MAX_ROUTE_REPORT);
}

export function buildPerformanceReport(session = {}, nowMs = Date.now()) {
  const samples = chronological(Array.isArray(session.samples) ? session.samples : []);
  const parsedStartedAt = new Date(session.startedAt).getTime();
  const parsedCompletedAt = new Date(session.completedAt).getTime();
  const startedAtMs = Number.isFinite(parsedStartedAt) ? parsedStartedAt : nowMs;
  const endedAtMs = Number.isFinite(parsedCompletedAt) ? parsedCompletedAt : nowMs;
  const pointEdges = edgeSets(samples);
  const navigationEdges = edgeSets(samples.filter(sample => finite(sample?.navigation?.loadMs) && !sample.navigation.startedBeforeSession));
  const resourceEdges = edgeSets(samples.filter(sample => Number(sample?.resources?.count || 0) > 0));
  const workbenchEdges = edgeSets(samples.filter(sample => (sample?.metrics || []).some(metric => metric.metric === 'runtime.workbench_ready')));

  const earlyResources = weightedResourceAverage(resourceEdges.early);
  const lateResources = weightedResourceAverage(resourceEdges.late);
  const earlyWorkbench = metricAggregate(workbenchEdges.early, 'runtime.workbench_ready');
  const lateWorkbench = metricAggregate(workbenchEdges.late, 'runtime.workbench_ready');
  const earlyLongTasks = longTaskRate(pointEdges.early);
  const lateLongTasks = longTaskRate(pointEdges.late);

  const metrics = [
    comparison(SPECS.pageLoad, average(navigationEdges.early, item => item.navigation.loadMs), average(navigationEdges.late, item => item.navigation.loadMs), { baseline: navigationEdges.early.length, current: navigationEdges.late.length }),
    comparison(SPECS.ttfb, average(navigationEdges.early, item => item.navigation.ttfbMs), average(navigationEdges.late, item => item.navigation.ttfbMs), { baseline: navigationEdges.early.length, current: navigationEdges.late.length }),
    comparison(SPECS.requests, earlyResources.value, lateResources.value, { baseline: earlyResources.count, current: lateResources.count }),
    comparison(SPECS.workbench, earlyWorkbench.value, lateWorkbench.value, { baseline: earlyWorkbench.count, current: lateWorkbench.count }),
    comparison(SPECS.memory, average(pointEdges.early, item => item.memory?.usedJsHeapBytes), average(pointEdges.late, item => item.memory?.usedJsHeapBytes), { baseline: pointEdges.early.filter(item => finite(item.memory?.usedJsHeapBytes)).length, current: pointEdges.late.filter(item => finite(item.memory?.usedJsHeapBytes)).length }),
    comparison(SPECS.storage, average(pointEdges.early, item => item.storageBytes), average(pointEdges.late, item => item.storageBytes), { baseline: pointEdges.early.filter(item => finite(item.storageBytes)).length, current: pointEdges.late.filter(item => finite(item.storageBytes)).length }),
    comparison(SPECS.dom, average(pointEdges.early, item => item.domNodes), average(pointEdges.late, item => item.domNodes), { baseline: pointEdges.early.filter(item => finite(item.domNodes)).length, current: pointEdges.late.filter(item => finite(item.domNodes)).length }),
    comparison(SPECS.eventLoop, average(pointEdges.early, item => item.eventLoopDelayMs), average(pointEdges.late, item => item.eventLoopDelayMs), { baseline: pointEdges.early.filter(item => finite(item.eventLoopDelayMs)).length, current: pointEdges.late.filter(item => finite(item.eventLoopDelayMs)).length }),
    comparison(SPECS.longTasks, earlyLongTasks.value, lateLongTasks.value, { baseline: earlyLongTasks.count, current: lateLongTasks.count })
  ];

  const comparable = metrics.filter(metric => metric.state !== 'unknown');
  const badCount = comparable.filter(metric => metric.state === 'bad').length;
  const warnCount = comparable.filter(metric => metric.state === 'warn').length;
  const durationMs = Math.max(0, endedAtMs - startedAtMs);
  const confidence = durationMs >= 20 * 60 * 1000 && samples.length >= 15
    ? 'high'
    : durationMs >= 5 * 60 * 1000 && samples.length >= 5
      ? 'medium'
      : 'low';
  let verdict = 'stable';
  if (!comparable.length) verdict = 'insufficient';
  else if (badCount || warnCount >= 2) verdict = 'degraded';
  else if (warnCount) verdict = 'watch';

  return {
    schema: 'simnet-workbench-performance-report-v1',
    sessionId: compact(session.id, 100),
    generatedAt: new Date(nowMs).toISOString(),
    startedAt: session.startedAt || '',
    completedAt: session.completedAt || new Date(nowMs).toISOString(),
    durationMs,
    targetDurationMs: Number(session.targetDurationMs || DEFAULT_PERFORMANCE_SESSION_MS),
    completionReason: compact(session.completionReason || '', 40),
    confidence,
    verdict,
    sampleCount: samples.length,
    pageLoadCount: samples.filter(sample => finite(sample?.navigation?.loadMs) && !sample.navigation.startedBeforeSession).length,
    resourceRequestCount: samples.reduce((sum, sample) => sum + Number(sample?.resources?.count || 0), 0),
    longTaskCount: samples.reduce((sum, sample) => sum + Number(sample?.longTasks?.count || 0), 0),
    metrics,
    routes: routeReport(samples, startedAtMs, endedAtMs),
    pageRoutes: navigationRouteReport(samples, startedAtMs, endedAtMs),
    operations: operationReport(samples)
  };
}

export function finalizePerformanceSession(session = {}, options = {}) {
  const nowMs = finite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const next = clone(session);
  if (!next?.id) return null;
  if (next.status !== 'completed') {
    next.status = 'completed';
    next.completedAt = new Date(Math.max(epoch(next.startedAt), nowMs)).toISOString();
    next.completionReason = compact(options.reason || 'operator', 40);
  }
  next.updatedAt = new Date(nowMs).toISOString();
  next.sampleCount = Array.isArray(next.samples) ? next.samples.length : 0;
  next.report = buildPerformanceReport(next, nowMs);
  return next;
}

export function appendPerformanceSample(session = {}, rawSample = {}, options = {}) {
  const nowMs = finite(options.nowMs) ? Number(options.nowMs) : Date.now();
  if (!session?.id || session.status !== 'active') return clone(session);
  const next = clone(session);
  next.samples = Array.isArray(next.samples) ? next.samples : [];
  const sample = sanitizePerformanceSample(rawSample, nowMs);
  if (!next.samples.some(item => item.id === sample.id)) next.samples.push(sample);
  next.samples = chronological(next.samples);
  while (next.samples.length > MAX_SAMPLES) {
    next.samples.splice(Math.min(60, next.samples.length - 1), 1);
  }
  next.sampleCount = next.samples.length;
  next.updatedAt = new Date(nowMs).toISOString();
  if (nowMs >= epoch(next.plannedEndAt)) {
    return finalizePerformanceSession(next, { nowMs, reason: 'deadline' });
  }
  return next;
}

export function performanceSessionControl(session = {}) {
  if (!session?.id) return null;
  return {
    schema: PERFORMANCE_SESSION_SCHEMA,
    sessionId: compact(session.id, 100),
    status: session.status === 'completed' ? 'completed' : 'active',
    startedAt: session.startedAt || '',
    plannedEndAt: session.plannedEndAt || '',
    completedAt: session.completedAt || '',
    targetDurationMs: Number(session.targetDurationMs || DEFAULT_PERFORMANCE_SESSION_MS),
    updatedAt: session.updatedAt || ''
  };
}

export function performanceSessionOverview(session = null, nowMs = Date.now()) {
  if (!session?.id) return { exists: false, status: 'idle' };
  const startedAtMs = epoch(session.startedAt);
  const endAtMs = session.status === 'completed' ? epoch(session.completedAt) : nowMs;
  return {
    exists: true,
    sessionId: session.id,
    status: session.status,
    version: session.version || '',
    startedAt: session.startedAt,
    plannedEndAt: session.plannedEndAt,
    completedAt: session.completedAt || '',
    completionReason: session.completionReason || '',
    targetDurationMs: Number(session.targetDurationMs || DEFAULT_PERFORMANCE_SESSION_MS),
    elapsedMs: Math.max(0, endAtMs - startedAtMs),
    remainingMs: session.status === 'active' ? Math.max(0, epoch(session.plannedEndAt) - nowMs) : 0,
    sampleCount: Number(session.sampleCount || session.samples?.length || 0),
    report: session.report || null
  };
}
