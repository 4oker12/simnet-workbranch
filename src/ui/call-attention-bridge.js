(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  if (!WB || !rail || window.top !== window.self || WB.callAttentionBridge) return;

  const LIST = 'CALL_PROCESSING_LIST';
  const RETRY = 'CALL_PROCESSING_RETRY';
  const CANCEL = 'CALL_PROCESSING_CANCEL';
  const DISMISS = 'CALL_PROCESSING_DISMISS';
  const CHANGED = 'CALL_PROCESSING_CHANGED';

  const STEP_LABELS = [
    ['lock', 'CALL закреплён'],
    ['pbx', 'PBX'],
    ['audio', 'MP3'],
    ['gpu', 'Whisper'],
    ['transcript', 'Текст'],
    ['ai', 'AI'],
    ['userside', 'UserSide']
  ];

  const baseAttentionItems = rail.attentionItems.bind(rail);
  let calls = [];
  let refreshPromise = null;
  let waitTimer = 0;

  const bridgeStyle = document.createElement('style');
  bridgeStyle.textContent = `
    .attention-popup{width:min(410px,calc(100vw - 24px))!important;max-height:min(74vh,700px);overflow:auto!important}
    .attention-popup .attention-head{position:sticky;top:0;z-index:2;background:#fff}
    .attention-popup details.attention-issue>summary::-webkit-details-marker{display:none}
    .call-processing-tabs{display:flex;gap:4px;padding:7px 9px;border-bottom:1px solid #eaecf0;background:#fafafa;position:sticky;top:36px;z-index:1}
    .call-processing-tab{border:1px solid #d0d5dd;background:#fff;border-radius:999px;padding:4px 8px;font:700 10px Arial;color:#475467;cursor:pointer}
    .call-processing-tab.active{border-color:#a50046;color:#a50046;background:#fff5f8}
  `;
  rail.shadow?.appendChild(bridgeStyle);

  let filter = 'attention';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function statusLabel(call = {}) {
    const status = String(call.status || '');
    return ({
      WAIT_PBX: 'ожидается PBX',
      QUEUED: 'в очереди',
      FETCH_AUDIO: 'скачивается MP3',
      TRANSCRIBING: 'транскрибация',
      TRANSCRIPT_READY: 'текст получен',
      ANALYZING: 'AI-разбор',
      WRITING_USERSIDE: 'запись в UserSide',
      WAIT_TRANSCRIBER: 'транскрибер недоступен',
      WAIT_TASK_ID: 'ожидается обращение UserSide',
      USERSIDE_REVIEW: 'нужна проверка UserSide',
      USERSIDE_ERROR: 'ошибка UserSide',
      PBX_ERROR: 'ошибка PBX',
      ERROR: 'ошибка обработки',
      STALE: 'операция прервана',
      CANCELLED: 'остановлено',
      DONE: 'готово',
      IDLE: 'без обработки'
    })[status] || status || 'неизвестно';
  }

  function statusMark(call = {}) {
    if (call.needsAttention) return ['!', '#b42318'];
    if (call.status === 'DONE') return ['✓', '#067647'];
    if (call.status === 'CANCELLED') return ['×', '#667085'];
    if (call.active || call.status === 'WAIT_PBX') return ['…', '#175cd3'];
    return ['•', '#667085'];
  }

  function title(call = {}) {
    return [
      call.time || '',
      call.phone || '',
      call.customerLabel || (call.customerId ? `customer ${call.customerId}` : '')
    ].filter(Boolean).join(' · ') || call.callKey || 'Звонок';
  }

  function stepLine(call, key, label) {
    const state = call?.steps?.[key] || {};
    const mark = state.status === 'done' ? '✓'
      : state.status === 'running' ? '◉'
        : state.status === 'error' ? '×'
          : state.status === 'waiting' ? '…' : '○';
    const detail = state.detail ? ` · ${state.detail}` : '';
    return `<div style="margin:2px 0;color:#667085"><b>${esc(mark)}</b> ${esc(label)}${esc(detail)}</div>`;
  }

  function callRow(call = {}) {
    const [mark, color] = statusMark(call);
    const retry = call.canRetry
      ? `<button type="button" data-call-action="retry" data-call-key="${esc(call.callKey)}" style="border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font:700 10px Arial">↻ Повторить</button>`
      : '';
    const cancel = call.canCancel
      ? `<button type="button" data-call-action="cancel" data-call-key="${esc(call.callKey)}" style="border:1px solid #f1b4b0;background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font:700 10px Arial;color:#b42318">× Остановить</button>`
      : '';
    const dismiss = call.needsAttention && !call.active
      ? `<button type="button" data-call-action="dismiss" data-call-key="${esc(call.callKey)}" style="border:0;background:transparent;padding:3px 5px;cursor:pointer;font:700 10px Arial;color:#667085">Убрать уведомление</button>`
      : '';
    const meta = [
      call.usersideCallId ? `CALL #${call.usersideCallId}` : '',
      call.pbxRecordId ? `PBX ${call.pbxRecordId}` : '',
      call.taskId ? `task #${call.taskId}` : '',
      statusLabel(call)
    ].filter(Boolean).join(' · ');
    const error = call.error ? `<div style="margin-top:5px;color:#b42318">${esc(call.error)}</div>` : '';
    const steps = STEP_LABELS
      .filter(([key]) => key !== 'ai' || call.steps?.ai?.status || call.processing?.stage === 'ai')
      .map(([key, label]) => stepLine(call, key, label)).join('');
    return `
      <details class="attention-issue" ${call.needsAttention ? 'open' : ''} style="display:block;padding:8px 10px">
        <summary style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;list-style:none">
          <span style="display:grid;place-items:center;min-width:20px;height:20px;border-radius:50%;background:#fff;color:${color};font-weight:900">${esc(mark)}</span>
          <div style="min-width:0;flex:1"><b style="display:block">${esc(title(call))}</b><small style="display:block;color:#667085;margin-top:2px">${esc(meta)}</small></div>
        </summary>
        <div style="margin:7px 0 0 28px">${steps}${error}</div>
        ${(retry || cancel || dismiss) ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin:7px 0 0 28px">${retry}${cancel}${dismiss}</div>` : ''}
      </details>`;
  }

  function diagnosticRow(item = {}) {
    const mark = item.level === 'warn' ? '!' : '?';
    const cls = item.level === 'warn' ? 'warn' : 'unk';
    return `<div class="attention-issue"><span class="${cls}">${mark}</span><div><b>${esc(item.title)}</b>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</div></div>`;
  }

  function visibleCalls() {
    if (filter === 'attention') return calls.filter(call => call.needsAttention).slice(0, 12);
    if (filter === 'active') return calls.filter(call => call.active || call.status === 'WAIT_PBX').slice(0, 12);
    return calls.slice(0, 16);
  }

  function scheduleWaitRefresh() {
    clearTimeout(waitTimer);
    waitTimer = 0;
    const waits = calls.filter(call => call.status === 'WAIT_PBX' && !call.needsAttention);
    if (!waits.length) return;
    const nearest = Math.min(...waits.map(call => Math.max(1, 90 - Number(call.waitSeconds || 0))));
    waitTimer = setTimeout(() => {
      waitTimer = 0;
      void refresh();
    }, Math.min(90_000, nearest * 1000 + 150));
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = request(LIST)
      .then(result => {
        calls = Array.isArray(result) ? result : [];
        scheduleWaitRefresh();
        rail.syncAttention();
        return calls;
      })
      .catch(error => {
        console.warn('[SIMNET WB][CALL ATTENTION] refresh failed', error);
        return calls;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  rail.syncAttention = function syncAttentionWithCalls() {
    if (!this.shadow) return;
    const baseItems = baseAttentionItems();
    const callAttention = calls.filter(call => call.needsAttention);
    const badge = this.shadow.querySelector('.attention-badge');
    const popup = this.shadow.querySelector('.attention-popup');
    const bell = this.shadow.querySelector('.attention-bell');
    const count = baseItems.length + callAttention.length;

    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
      if (bell) bell.classList.toggle('has-items', count > 0);
    }
    if (!popup) return;
    if (!this.attentionOpen) {
      popup.hidden = true;
      popup.innerHTML = '';
      return;
    }

    const recent = visibleCalls();
    const diagnostic = baseItems.map(diagnosticRow).join('');
    const rows = recent.map(callRow).join('');
    const tabs = [
      ['attention', `Требует внимания${callAttention.length ? ` · ${callAttention.length}` : ''}`],
      ['active', 'В работе'],
      ['history', 'История']
    ].map(([id, label]) => `<button type="button" class="call-processing-tab ${filter === id ? 'active' : ''}" data-call-filter="${id}">${esc(label)}</button>`).join('');

    popup.innerHTML = `
      <div class="attention-head">
        <b>${count ? `Workbench · ${count} требует внимания` : 'Workbench · события'}</b>
        <button type="button" class="attention-x" data-action="close-attention" aria-label="Закрыть">×</button>
      </div>
      <div class="call-processing-tabs">${tabs}</div>
      ${diagnostic && filter === 'attention' ? `<div style="border-bottom:1px solid #eaecf0">${diagnostic}</div>` : ''}
      ${rows || `<div style="padding:14px;color:#667085">${filter === 'attention' ? 'Ошибок нет.' : filter === 'active' ? 'Активной обработки сейчас нет.' : 'История звонков пока пуста.'}</div>`}`;
    popup.hidden = false;
  };

  rail.shadow?.addEventListener('click', event => {
    const filterButton = event.target.closest?.('[data-call-filter]');
    if (filterButton) {
      filter = String(filterButton.dataset.callFilter || 'attention');
      rail.syncAttention();
      return;
    }

    const button = event.target.closest?.('[data-call-action][data-call-key]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = String(button.dataset.callAction || '');
    const callKey = String(button.dataset.callKey || '');
    if (!callKey) return;
    button.disabled = true;
    const type = action === 'retry' ? RETRY : action === 'cancel' ? CANCEL : DISMISS;
    void request(type, { callKey })
      .then(() => refresh())
      .catch(error => rail.toast?.(`CALL: ${String(error?.message || error)}`, 3500, 'error'))
      .finally(() => { button.disabled = false; });
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED) return false;
    void refresh();
    return false;
  });

  const originalDestroy = rail.destroy.bind(rail);
  rail.destroy = function destroyWithCallAttention() {
    clearTimeout(waitTimer);
    bridgeStyle.remove();
    return originalDestroy();
  };

  WB.callAttentionBridge = Object.freeze({
    refresh,
    get calls() { return calls.slice(); }
  });

  void refresh();
})();
