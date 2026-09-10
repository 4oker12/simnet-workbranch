'use strict';

const DIAG_KEY = 'simnet_workbench_diagnostics_v1';
const MAX_ENTRIES = 200;
const MAX_MESSAGE = 1200;
const MAX_STACK = 4000;
const REDACT_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|csrf)/i;

const nativeConsoleError = console.error.bind(console);
let writeChain = Promise.resolve();
let consoleHookInstalled = false;

function nowIso() {
  return new Date().toISOString();
}

function compact(value, max = MAX_MESSAGE) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function redact(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return compact(value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[redacted]')
      .replace(/([?&](?:token|api[_-]?key|csrf|secret|password)=)[^&#\s]+/gi, '$1[redacted]'), MAX_STACK);
  }
  if (value instanceof Error) {
    return {
      name: compact(value.name, 120),
      message: compact(value.message, MAX_MESSAGE),
      stack: compact(value.stack, MAX_STACK)
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      result[key] = REDACT_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return result;
  }
  return compact(value, MAX_MESSAGE);
}

function errorInfo(kind, value, meta = {}) {
  const error = value instanceof Error
    ? value
    : value?.error instanceof Error
      ? value.error
      : new Error(String(value?.message || value?.reason || value || kind));
  const scope = compact(meta.scope || 'SERVICE_WORKER', 80).toUpperCase();
  const code = compact(meta.code || kind || error.name || 'SERVICE_WORKER_ERROR', 120).toUpperCase();
  const message = compact(error.message || String(value || kind), MAX_MESSAGE);
  const stack = compact(error.stack || value?.stack || '', MAX_STACK);
  const details = redact(meta.details || {});
  return { scope, code, message, stack, details };
}

function fingerprint(entry) {
  return [entry.scope, entry.code, entry.message, String(entry.stack || '').split(' at ')[0]].join('|').slice(0, 1800);
}

async function persist(entry) {
  if (!chrome?.storage?.local) return;
  const stored = await chrome.storage.local.get(DIAG_KEY);
  const current = stored?.[DIAG_KEY] && typeof stored[DIAG_KEY] === 'object'
    ? stored[DIAG_KEY]
    : { entries: [], unreadCount: 0 };
  const entries = Array.isArray(current.entries) ? current.entries.slice(0, MAX_ENTRIES) : [];
  const fp = fingerprint(entry);
  const existingIndex = entries.findIndex(item => String(item?.fingerprint || '') === fp);
  const at = nowIso();

  if (existingIndex >= 0) {
    const previous = entries.splice(existingIndex, 1)[0];
    entries.unshift({
      ...previous,
      ...entry,
      fingerprint: fp,
      count: Number(previous?.count || 1) + 1,
      firstSeenAt: previous?.firstSeenAt || at,
      lastSeenAt: at,
      timestamp: at,
      unread: true
    });
  } else {
    entries.unshift({
      id: `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...entry,
      fingerprint: fp,
      count: 1,
      firstSeenAt: at,
      lastSeenAt: at,
      timestamp: at,
      unread: true,
      source: 'service-worker'
    });
  }

  const next = entries.slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({
    [DIAG_KEY]: {
      ...current,
      entries: next,
      unreadCount: next.filter(item => item?.unread !== false).length,
      updatedAt: at
    }
  });
}

export function reportServiceWorkerError(kind, value, meta = {}) {
  const info = errorInfo(kind, value, meta);
  writeChain = writeChain
    .catch(() => {})
    .then(() => persist(info))
    .catch(error => nativeConsoleError('[SIMNET WB][SW][DIAG_WRITE_FAILED]', error));
  return writeChain;
}

function installGlobalHandlers() {
  globalThis.addEventListener?.('error', event => {
    void reportServiceWorkerError('UNHANDLED_ERROR', event?.error || event?.message || 'Unhandled Service Worker error', {
      scope: 'SERVICE_WORKER',
      details: {
        filename: event?.filename || '',
        lineno: event?.lineno || 0,
        colno: event?.colno || 0
      }
    });
  });

  globalThis.addEventListener?.('unhandledrejection', event => {
    void reportServiceWorkerError('UNHANDLED_REJECTION', event?.reason || 'Unhandled Service Worker rejection', {
      scope: 'SERVICE_WORKER'
    });
  });
}

function installConsoleHook() {
  if (consoleHookInstalled) return;
  consoleHookInstalled = true;
  console.error = (...args) => {
    nativeConsoleError(...args);
    try {
      const firstError = args.find(item => item instanceof Error);
      const label = compact(args.find(item => typeof item === 'string') || 'CONSOLE_ERROR', 180);
      const payload = firstError || args.map(item => typeof item === 'string' ? item : redact(item)).join(' ');
      void reportServiceWorkerError('CONSOLE_ERROR', payload, {
        scope: label.includes('[PBX') ? 'PBX' : label.includes('[ASR') ? 'ASR' : label.includes('[AI') ? 'AI' : label.includes('[CALL') ? 'CALL' : 'SERVICE_WORKER',
        code: label.replace(/[^A-Za-z0-9_:-]+/g, '_').slice(0, 120) || 'CONSOLE_ERROR'
      });
    } catch {}
  };
}

installGlobalHandlers();
installConsoleHook();
