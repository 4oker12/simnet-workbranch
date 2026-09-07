(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  if (!WB || !rail || window.top !== window.self || WB.callErrorContextUi) return;

  const LIST = 'CALL_PROCESSING_LIST';
  const CHANGED = 'CALL_PROCESSING_CHANGED';
  let callsByKey = new Map();
  let refreshPromise = null;
  let boundShadow = null;
  let originalSyncAttention = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function stageMeta(call = {}) {
    const stage = String(call.processing?.stage || '');
    const id = String(call.pbxRecordId || '');
    const table = {
      pbx: {
        fn: 'parseUsersideCallListHtml() → attachPbx()',
        op: 'GET /message/call_list'
      },
      audio: {
        fn: 'transcribeRecord() → fetchPbxAudio()',
        op: id ? `GET PBX getrec.php?id=${id}` : 'GET PBX getrec.php'
      },
      whisper: {
        fn: 'transcribeRecord()',
        op: 'POST http://127.0.0.1:8090/transcribe'
      },
      ai: {
        fn: 'postprocessTranscript()',
        op: 'POST Groq chat/completions'
      },
      userside: {
        fn: 'writeTranscriptToUserSide()',
        op: 'UserSide writeback'
      }
    };
    return table[stage] || { fn: 'CallRecord processing pipeline', op: 'внутренний вызов Workbench' };
  }

  function explain(call = {}) {
    const reason = String(call.error || '').replace(/\s+/g, ' ').trim();
    const stage = String(call.processing?.stage || '');
    if (/Transcriber network:/i.test(reason)) return reason;
    if (/Transcriber POST:/i.test(reason)) return reason;
    if (stage === 'whisper' && /Failed to fetch/i.test(reason)) {
      return 'POST /transcribe оборвался до получения HTTP-ответа. Это сетевой fetch-сбой: HTTP 4xx/5xx не получен. Проверять localhost:8090, SSH-туннель и backend; после обновления WB /health будет проверяться автоматически.';
    }
    if (/таймаут/i.test(reason)) return `Запрос превысил допустимое время ожидания: ${reason}`;
    if (stage === 'audio') return `Сбой получения PBX-аудио: ${reason || 'причина не записана'}`;
    if (stage === 'ai') return `Сбой AI-этапа: ${reason || 'причина не записана'}`;
    if (stage === 'userside') return `Сбой записи результата в UserSide: ${reason || 'причина не записана'}`;
    return reason || 'Причина не записана в CallRecord.';
  }

  function isProblem(call = {}) {
    return Boolean(call.needsAttention || call.error || ['WAIT_TRANSCRIBER', 'PBX_ERROR', 'USERSIDE_ERROR', 'ERROR', 'STALE'].includes(String(call.status || '')));
  }

  function callForCard(card) {
    const key = String(card.querySelector('[data-call-key]')?.dataset?.callKey || '');
    if (key && callsByKey.has(key)) return callsByKey.get(key);

    const meta = String(card.querySelector('.call-event-meta')?.textContent || '');
    const callId = meta.match(/CALL\s*#(\d+)/i)?.[1] || '';
    const pbxId = meta.match(/PBX\s+(\d{6,12}\.\d{1,12})/i)?.[1] || '';
    for (const call of callsByKey.values()) {
      if (callId && String(call.usersideCallId || '') === callId) return call;
      if (pbxId && String(call.pbxRecordId || '') === pbxId) return call;
    }
    return null;
  }

  function ensureStyle() {
    const shadow = rail.shadow;
    if (!shadow || shadow.querySelector('style[data-wb-call-error-context]')) return;
    const style = document.createElement('style');
    style.dataset.wbCallErrorContext = '1';
    style.textContent = `
      .wb-call-error-context{margin:0 9px 8px 40px;padding:8px 9px;border:1px solid #fecdca;border-radius:8px;background:#fff7f7;color:#475467;font:500 9.5px/1.4 Arial,sans-serif;overflow-wrap:anywhere}
      .wb-call-error-context b{color:#344054}
      .wb-call-error-context .cause{margin-top:4px;color:#b42318}
      .wb-call-error-context .row{margin-top:2px}
    `;
    shadow.appendChild(style);
  }

  function inject() {
    const shadow = rail.shadow;
    if (!shadow) return;
    ensureStyle();

    shadow.querySelectorAll('.call-event-card').forEach(card => {
      card.querySelector('.wb-call-error-context')?.remove();
      const call = callForCard(card);
      if (!call || !isProblem(call)) return;

      const meta = stageMeta(call);
      const box = document.createElement('div');
      box.className = 'wb-call-error-context';
      box.innerHTML = `
        <div class="row"><b>Этап:</b> ${esc(call.processing?.stage || call.status || 'не определён')}</div>
        <div class="row"><b>Функция:</b> ${esc(meta.fn)}</div>
        <div class="row"><b>Вызов:</b> ${esc(meta.op)}</div>
        <div class="row"><b>Последний успешный этап:</b> ${esc(call.processing?.lastSuccessfulStage || 'нет')}</div>
        <div class="cause"><b>Причина:</b> ${esc(explain(call))}</div>
      `;

      const actions = card.querySelector('.call-event-actions');
      if (actions) card.insertBefore(box, actions);
      else card.appendChild(box);
    });
  }

  async function requestList() {
    const response = await chrome.runtime.sendMessage({ type: LIST, payload: {} });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return Array.isArray(response.data) ? response.data : [];
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = requestList()
      .then(calls => {
        callsByKey = new Map(calls.map(call => [String(call.callKey || ''), call]).filter(([key]) => key));
        inject();
        return calls;
      })
      .catch(error => {
        WB.log?.warn?.('CALL', 'Не удалось обновить подробности ошибок Центра событий', {
          error: String(error?.message || error)
        });
        return [];
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function bind() {
    if (!rail.shadow || boundShadow === rail.shadow) return;
    boundShadow = rail.shadow;
    ensureStyle();
  }

  function install() {
    if (typeof rail.syncAttention !== 'function') return false;
    bind();
    if (!originalSyncAttention) {
      originalSyncAttention = rail.syncAttention.bind(rail);
      rail.syncAttention = function syncAttentionWithErrorContext(...args) {
        const result = originalSyncAttention(...args);
        bind();
        queueMicrotask(inject);
        return result;
      };
    }
    void refresh();
    return true;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    queueMicrotask(() => void refresh());
    return false;
  });

  WB.callErrorContextUi = Object.freeze({ install, refresh, inject });
  install();
})();
