(() => {
  'use strict';
  if (window.top !== window.self) return;

  const existing = globalThis.SIMNET_WB;
  if (existing?.version === '1.7.36.108') return;

  const pageInstanceStartedAt = Date.now();
  const LOG_KEY = 'simnet_workbench_debug_log_v1';
  const MAX_LOG_ENTRIES = 400;
  const SENSITIVE_KEY_RE = /(?:csrf|token|password|passwd|secret|cookie|authorization|api[_-]?key)/i;
  let logWriteQueue = Promise.resolve();

  function sanitize(value, depth = 0) {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.slice(0, 1600);
    if (depth >= 4) return '[max-depth]';
    if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value).slice(0, 60)) {
        out[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitize(item, depth + 1);
      }
      return out;
    }
    return String(value).slice(0, 1600);
  }

  function pageRef() {
    return `${location.hostname}${location.pathname}`.slice(0, 280);
  }

  function logStoreShape(raw = {}) {
    return {
      schemaVersion: 1,
      updatedAt: String(raw.updatedAt || ''),
      entries: Array.isArray(raw.entries) ? raw.entries : []
    };
  }

  async function appendPersistentLog(entry) {
    logWriteQueue = logWriteQueue.then(async () => {
      try {
        const raw = (await chrome.storage.local.get(LOG_KEY))?.[LOG_KEY] || {};
        const store = logStoreShape(raw);
        store.entries.unshift(entry);
        store.entries = store.entries.slice(0, MAX_LOG_ENTRIES);
        store.updatedAt = entry.at;
        await chrome.storage.local.set({ [LOG_KEY]: store });
      } catch (error) {
        console.warn('[SIMNET WB][LOG] persistent write failed', error);
      }
    });
    return logWriteQueue;
  }

  function emitLog(level, scope, event, details = null) {
    const normalizedLevel = ['info', 'warn', 'error'].includes(String(level)) ? String(level) : 'info';
    const normalizedScope = String(scope || 'APP').toUpperCase().slice(0, 48);
    const normalizedEvent = String(event || 'event').replace(/\s+/g, ' ').trim().slice(0, 240);
    const safeDetails = sanitize(details);
    const prefix = `[SIMNET WB][${normalizedScope}] ${normalizedEvent}`;
    const consoleFn = normalizedLevel === 'error' ? console.error : normalizedLevel === 'warn' ? console.warn : console.info;
    if (safeDetails && typeof safeDetails === 'object' && Object.keys(safeDetails).length) consoleFn(prefix, safeDetails);
    else consoleFn(prefix);

    const entry = {
      id: globalThis.crypto?.randomUUID?.() || `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      level: normalizedLevel,
      scope: normalizedScope,
      event: normalizedEvent,
      details: safeDetails,
      page: pageRef()
    };
    void appendPersistentLog(entry);
    try {
      window.dispatchEvent(new CustomEvent('simnet-workbench-log', { detail: entry }));
    } catch {}
    return entry;
  }

  const writeError = (scope, event, details = null) => emitLog('error', scope, event, details);

  const showFatal = (error, context = '') => {
    const message = String(error?.message || error || 'Неизвестная ошибка Workbench');
    writeError('FATAL', context || 'Ошибка выполнения', { message, stack: error?.stack || '' });
    if (!document?.documentElement) return;
    let host = document.getElementById('simnet-wb-fatal-error');
    if (!host) {
      host = document.createElement('div');
      host.id = 'simnet-wb-fatal-error';
      host.dataset.simnetWbOwned = '1';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(55,0,15,.96);color:#fff;display:flex;align-items:center;justify-content:center;padding:32px;font-family:Arial,sans-serif';
      document.documentElement.appendChild(host);
    }
    host.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:820px;width:100%;background:#fff;color:#2b0a15;border-radius:12px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.35)';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:700;margin-bottom:12px;color:#a50046';
    title.textContent = 'Workbench остановлен: ошибка';
    const body = document.createElement('div');
    body.style.cssText = 'font-size:15px;line-height:1.45;white-space:pre-wrap;word-break:break-word';
    body.textContent = `${context ? context + '\n\n' : ''}${message}`;
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:16px;font-size:13px;color:#6b4452';
    note.textContent = 'Обнови текущую вкладку. Если расширение только что было Reload — обновить Billing/UserSide обязательно.';
    card.append(title, body, note);
    host.appendChild(card);
  };

  const runtime = {
    booted: false,
    destroyed: false,
    lastContext: null,
    handoffClaim: null,
    pageInstanceId: (
      globalThis.crypto?.randomUUID?.()
      || `page_${pageInstanceStartedAt.toString(36)}_${Math.random().toString(36).slice(2)}`
    ),
    pageInstanceStartedAt,
    documentId: (
      globalThis.crypto?.randomUUID?.()
      || `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    )
  };

  globalThis.SIMNET_WB = {
    version: '1.7.36.108',
    stateKey: 'simnet_workbench_state_v5',
    utils: {},
    log: {
      key: LOG_KEY,
      info(scope, event, details) { return emitLog('info', scope, event, details); },
      warn(scope, event, details) { return emitLog('warn', scope, event, details); },
      error(scope, event, details) { return emitLog('error', scope, event, details); },
      async recent(limit = 120) {
        const raw = (await chrome.storage.local.get(LOG_KEY))?.[LOG_KEY] || {};
        return logStoreShape(raw).entries.slice(0, Math.max(1, Math.min(400, Number(limit) || 120)));
      },
      async clear() {
        await chrome.storage.local.remove(LOG_KEY);
        return true;
      }
    },
    fail: showFatal,
    runtime
  };

  queueMicrotask(() => {
    emitLog('info', 'BOOT', 'Workbench page context initialized', {
      version: '1.7.36.108',
      documentId: runtime.documentId
    });
  });
})();
