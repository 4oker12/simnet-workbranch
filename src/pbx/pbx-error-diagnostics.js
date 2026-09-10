(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const HOST_ID = 'simnet-wb-pbx-shell';
  const STATE_KEY = 'simnet_workbench_state_v5';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  const STYLE_ID = 'simnet-wb-pbx-diagnostics-style';

  let boundRoot = null;
  let refreshPromise = null;
  let bindTimer = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function compact(value, max = 700) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function stageMeta(call = {}) {
    const p = call.processing || {};
    const stage = String(p.stage || '');
    const id = String(call.pbxRecordId || '');
    const table = {
      pbx: {
        fn: 'parseUsersideCallListHtml() → attachPbx()',
        request: 'GET https://userside.simnet.kiev.ua/message/call_list'
      },
      audio: {
        fn: 'processManual() → transcribeRecord()',
        request: id
          ? `GET https://pbx.simnet.kiev.ua/fop2/getrec.php?id=${id}`
          : 'GET PBX getrec.php'
      },
      whisper: {
        fn: 'transcribeRecord()',
        request: 'POST http://127.0.0.1:8090/transcribe'
      },
      ai: {
        fn: 'processManual() → postprocessTranscript()',
        request: 'POST Groq chat/completions'
      },
      userside: {
        fn: 'processUsersideWrite() → writeTranscriptToUserSide()',
        request: 'UserSide writeback'
      }
    };
    return table[stage] || {
      fn: 'CallRecord processing pipeline',
      request: 'внутренний вызов Workbench'
    };
  }

  function triggerOf(call = {}) {
    const p = call.processing || {};
    const owner = String(p.owner || '');
    const attempts = Number(p.attempts || 0);
    let trigger = owner === 'pbx-manual'
      ? 'ручной запуск ✦ возле записи PBX'
      : owner === 'registration'
        ? 'автообработка после регистрации CALL'
        : p.state === 'stale'
          ? 'восстановление после прерывания Service Worker'
          : 'обработка/повтор Workbench';
    if (attempts > 1) trigger += ` · попытка ${attempts}`;
    return trigger;
  }

  function likelyCause(error = '') {
    const text = compact(error, 700);
    if (!text) return 'Причина не записана в CallRecord.';
    if (/127\.0\.0\.1|localhost|failed to fetch|network|err_connection/i.test(text)) {
      return `Локальный transcriber/tunnel недоступен либо сетевой запрос оборвался: ${text}`;
    }
    if (/groq|api key|401|403|429|chat\/completions/i.test(text)) {
      return `AI/Groq вызов завершился ошибкой: ${text}`;
    }
    if (/pbx|getrec|audio|mp3/i.test(text)) {
      return `Не удалось получить/обработать PBX-аудио: ${text}`;
    }
    if (/task|userside|writeback|comment/i.test(text)) {
      return `Ошибка записи результата в UserSide: ${text}`;
    }
    return text;
  }

  function latestFailureEvent(call = {}) {
    const events = Array.isArray(call.timeline) ? call.timeline : [];
    return [...events].reverse().find(row => ['stage_failed', 'stale', 'stage_waiting'].includes(String(row?.type || ''))) || null;
  }

  function isDiagnostic(call = {}) {
    const p = call.processing || {};
    if (!call.pbxRecordId) return false;
    return Boolean(
      ['failed', 'stale'].includes(String(p.state || ''))
      || (p.attention && p.error)
      || (String(p.state || '') === 'waiting' && p.error)
    );
  }

  function callsFromState(state = {}) {
    const store = state?.callModule?.calls?.calls || {};
    return Object.values(store)
      .filter(isDiagnostic)
      .sort((a, b) => Date.parse(String(b?.processing?.updatedAt || b?.updatedAt || '')) - Date.parse(String(a?.processing?.updatedAt || a?.updatedAt || '')))
      .slice(0, 6);
  }

  function diagnosticItem(call = {}) {
    const p = call.processing || {};
    const meta = stageMeta(call);
    const event = latestFailureEvent(call);
    const lastOk = String(p.lastSuccessfulStage || '') || 'нет';
    const updated = String(p.updatedAt || call.updatedAt || '');
    const eventType = String(event?.type || '');
    return `
      <div class="wb-pbx-diag-item">
        <div class="wb-pbx-diag-head">
          <strong>PBX ${esc(call.pbxRecordId || '—')}</strong>
          <span>${esc(String(p.state || 'error'))}</span>
        </div>
        <div><b>Этап:</b> ${esc(p.stage || 'не определён')}</div>
        <div><b>Функция:</b> ${esc(meta.fn)}</div>
        <div><b>Сломанный вызов:</b> ${esc(meta.request)}</div>
        <div><b>Что запустило:</b> ${esc(triggerOf(call))}</div>
        <div><b>Последний успешный этап:</b> ${esc(lastOk)}</div>
        ${eventType ? `<div><b>Событие:</b> ${esc(eventType)}</div>` : ''}
        <div class="wb-pbx-diag-error"><b>Причина:</b> ${esc(likelyCause(p.error))}</div>
        ${updated ? `<small>${esc(updated)}</small>` : ''}
      </div>`;
  }

  function ensureStyle(root) {
    if (root.getElementById?.(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .wb-pbx-diagnostics{border-color:#fecaca!important;background:#fff!important}
      .wb-pbx-diag-list{display:grid;gap:7px;margin-top:9px}
      .wb-pbx-diag-item{padding:9px;border:1px solid #fee2e2;border-radius:9px;background:#fff7f7;color:#475569;font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}
      .wb-pbx-diag-item b{color:#334155}
      .wb-pbx-diag-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}
      .wb-pbx-diag-head strong{color:#991b1b;font-size:10.5px}
      .wb-pbx-diag-head span{padding:2px 6px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:8px;font-weight:800}
      .wb-pbx-diag-error{margin-top:4px;color:#991b1b}
      .wb-pbx-diag-item small{display:block;margin-top:5px;color:#94a3b8;font-size:8px}
    `;
    root.appendChild(style);
  }

  function renderDiagnostics(calls = []) {
    const host = document.getElementById(HOST_ID);
    const root = host?.shadowRoot;
    const body = root?.querySelector('.body');
    if (!root || !body) return false;

    root.querySelector('.wb-pbx-diagnostics')?.remove();
    root.getElementById?.(STYLE_ID)?.remove();

    if (!calls.length) return true;

    ensureStyle(root);
    const card = document.createElement('div');
    card.className = 'card wb-pbx-diagnostics';
    card.innerHTML = `
      <div class="title">Диагностика ошибок</div>
      <div class="sub">Где оборвалась цепочка, какой вызов выполнялся и чем он был запущен.</div>
      <div class="wb-pbx-diag-list">${calls.map(diagnosticItem).join('')}</div>
    `;

    const firstCard = body.querySelector('.card');
    if (firstCard?.nextSibling) body.insertBefore(card, firstCard.nextSibling);
    else body.appendChild(card);
    return true;
  }

  async function refreshDiagnostics() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = chrome.storage.local.get(STATE_KEY)
      .then(result => renderDiagnostics(callsFromState(result?.[STATE_KEY] || {})))
      .catch(error => {
        console.warn('[SIMNET WB][PBX DIAGNOSTICS] refresh failed', error);
        return false;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function bindShell() {
    const root = document.getElementById(HOST_ID)?.shadowRoot;
    if (!root) return false;
    if (boundRoot && boundRoot !== root) {
      boundRoot.removeEventListener('click', onShellClick, true);
    }
    if (boundRoot !== root) {
      root.addEventListener('click', onShellClick, true);
      boundRoot = root;
    }
    return true;
  }

  function onShellClick(event) {
    if (!event.target?.closest?.('[data-wb-toggle],[data-wb-refresh],[data-wb-close]')) return;
    setTimeout(() => void refreshDiagnostics(), 0);
  }

  function scheduleBind(attempt = 0) {
    clearTimeout(bindTimer);
    if (bindShell()) {
      void refreshDiagnostics();
      return;
    }
    if (attempt >= 4) return;
    bindTimer = setTimeout(() => scheduleBind(attempt + 1), [0, 80, 250, 700, 1400][attempt + 1]);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    setTimeout(() => {
      bindShell();
      void refreshDiagnostics();
    }, 0);
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[STATE_KEY]) return;
    setTimeout(() => {
      bindShell();
      void refreshDiagnostics();
    }, 0);
  });

  scheduleBind();
})();
