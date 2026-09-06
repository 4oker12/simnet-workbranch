'use strict';

const LOG_KEY = 'simnet_workbench_debug_log_v1';
const MAX_LOG_ENTRIES = 400;
const SENSITIVE_KEY_RE = /(?:csrf|token|password|passwd|secret|cookie|authorization|api[_-]?key)/i;

const originalConsole = Object.freeze({
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
});

let writeQueue = Promise.resolve();
let installed = false;

function clean(value, max = 1600) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitize(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 1600);
  if (value instanceof Error) {
    return {
      name: clean(value.name, 120),
      message: clean(value.message, 1200),
      stack: String(value.stack || '').slice(0, 2400)
    };
  }
  if (depth >= 4) return '[max-depth]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return out;
  }
  return clean(value);
}

function storeShape(raw = {}) {
  return {
    schemaVersion: 1,
    updatedAt: String(raw.updatedAt || ''),
    entries: Array.isArray(raw.entries) ? raw.entries : []
  };
}

async function persist(entry) {
  writeQueue = writeQueue.then(async () => {
    try {
      const raw = (await chrome.storage.local.get(LOG_KEY))?.[LOG_KEY] || {};
      const store = storeShape(raw);
      store.entries.unshift(entry);
      store.entries = store.entries.slice(0, MAX_LOG_ENTRIES);
      store.updatedAt = entry.at;
      await chrome.storage.local.set({ [LOG_KEY]: store });
    } catch (error) {
      originalConsole.warn('[SIMNET WB][RUNTIME LOG] persistent write failed', error);
    }
  });
  return writeQueue;
}

function makeEntry(level, scope, event, details = null) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `swlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    level: ['info', 'warn', 'error'].includes(String(level)) ? String(level) : 'info',
    scope: clean(scope || 'SERVICE WORKER', 48).toUpperCase(),
    event: clean(event || 'event', 240),
    details: sanitize(details),
    page: 'service-worker'
  };
}

function persistOnly(level, scope, event, details = null) {
  const entry = makeEntry(level, scope, event, details);
  void persist(entry);
  return entry;
}

export function runtimeLog(level, scope, event, details = null) {
  const entry = makeEntry(level, scope, event, details);
  const prefix = `[SIMNET WB][${entry.scope}] ${entry.event}`;
  const fn = entry.level === 'error' ? originalConsole.error : entry.level === 'warn' ? originalConsole.warn : originalConsole.info;
  if (entry.details && typeof entry.details === 'object' && Object.keys(entry.details).length) fn(prefix, entry.details);
  else fn(prefix);
  void persist(entry);
  return entry;
}

export const runtimeInfo = (scope, event, details = null) => runtimeLog('info', scope, event, details);
export const runtimeWarn = (scope, event, details = null) => runtimeLog('warn', scope, event, details);
export const runtimeError = (scope, event, details = null) => runtimeLog('error', scope, event, details);

function mirrorWorkbenchConsole(level) {
  const original = level === 'error' ? originalConsole.error : originalConsole.warn;
  console[level] = (...args) => {
    original(...args);
    const first = String(args[0] == null ? '' : args[0]);
    const match = first.match(/^\[SIMNET WB\]\[([^\]]+)\]\s*(.*)$/i);
    if (!match) return;
    const details = args.length <= 2 ? args[1] : args.slice(1);
    persistOnly(level, match[1] || 'SERVICE WORKER', match[2] || 'console event', details ?? null);
  };
}

export function installRuntimeDiagnostics() {
  if (installed) return;
  installed = true;

  mirrorWorkbenchConsole('warn');
  mirrorWorkbenchConsole('error');

  globalThis.addEventListener?.('error', event => {
    runtimeError('SERVICE WORKER', 'Unhandled worker error', {
      message: clean(event?.error?.message || event?.message || 'worker error', 1200),
      source: clean(event?.filename || '', 500),
      line: Number(event?.lineno || 0),
      column: Number(event?.colno || 0),
      stack: String(event?.error?.stack || '').slice(0, 2400)
    });
  });

  globalThis.addEventListener?.('unhandledrejection', event => {
    const reason = event?.reason;
    runtimeError('SERVICE WORKER', 'Unhandled Promise rejection', {
      message: clean(reason?.message || reason || 'unknown rejection', 1200),
      stack: String(reason?.stack || '').slice(0, 2400)
    });
  });

  runtimeInfo('SERVICE WORKER', 'Runtime diagnostics initialized');
}

installRuntimeDiagnostics();

export const RUNTIME_LOG_KEY = LOG_KEY;
