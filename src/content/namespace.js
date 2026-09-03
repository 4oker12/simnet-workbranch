(() => {
  'use strict';
  if (window.top !== window.self) return;

  const existing = globalThis.SIMNET_WB;
  if (existing?.version === '1.7.36.108') return;

  const pageInstanceStartedAt = Date.now();

  const writeError = (scope, event, details = null) => {
    const prefix = `[SIMNET WB][${String(scope || 'APP').toUpperCase()}] ${event}`;
    if (details && typeof details === 'object' && Object.keys(details).length) console.error(prefix, details);
    else console.error(prefix);
  };

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

  globalThis.SIMNET_WB = {
    version: '1.7.36.108',
    stateKey: 'simnet_workbench_state_v5',
    utils: {},
    log: {
      info() { return false; },
      warn() { return false; },
      error(scope, event, details) { writeError(scope, event, details); }
    },
    fail: showFatal,
    runtime: {
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
    }
  };
})();
