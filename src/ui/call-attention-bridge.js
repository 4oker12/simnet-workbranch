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
    ['gpu', 'Транскрибация'],
    ['transcript', 'Текст получен'],
    ['ai', 'AI'],
    ['userside', 'Запись в UserSide']
  ];

  const baseAttentionItems = rail.attentionItems.bind(rail);
  let calls = [];
  let refreshPromise = null;
  let waitTimer = 0;
  let filter = 'attention';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const bridgeStyle = document.createElement('style');
  bridgeStyle.dataset.wbCallEventCenter = '1';
  bridgeStyle.textContent = `
    .attention-popup{
      width:min(390px,calc(100vw - 24px))!important;
      max-height:min(76vh,720px)!important;
      overflow:auto!important;
      color:#172033!important;
      color-scheme:light!important;
      background:#fff!important;
      border:1px solid #d9dee7!important;
      border-radius:12px!important;
      box-shadow:0 16px 38px rgba(16,24,40,.22)!important;
      scrollbar-width:thin
    }
    .attention-popup .attention-head{
      position:sticky;
      top:0;
      z-index:4;
      display:flex;
      align-items:center;
      min-height:44px;
      padding:0 12px;
      color:#172033;
      background:#fff!important;
      border-bottom:1px solid #eaecf0
    }
    .attention-popup .attention-head b{font:800 13px/1.2 Arial,sans-serif}
    .attention-popup .attention-x{
      margin-left:auto;
      width:28px;
      height:28px;
      border:0;
      border-radius:7px;
      color:#667085;
      background:transparent;
      cursor:pointer;
      font:400 20px/1 Arial,sans-serif
    }
    .attention-popup .attention-x:hover{background:#f2f4f7;color:#101828}
    .call-processing-tabs{
      position:sticky;
      top:44px;
      z-index:3;
      display:grid;
      grid-template-columns:1.25fr .85fr .8fr;
      gap:0;
      padding:0 10px;
      background:#fff;
      border-bottom:1px solid #eaecf0
    }
    .call-processing-tab{
      position:relative;
      min-height:38px;
      padding:0 5px;
      border:0;
      color:#667085;
      background:transparent;
      cursor:pointer;
      font:700 10.5px/1.15 Arial,sans-serif;
      white-space:nowrap
    }
    .call-processing-tab:hover{color:#344054}
    .call-processing-tab.active{color:#a50046}
    .call-processing-tab.active:after{
      content:"";
      position:absolute;
      left:5px;
      right:5px;
      bottom:-1px;
      height:2px;
      border-radius:2px 2px 0 0;
      background:#a50046
    }
    .call-event-list{padding:7px;background:#f8fafc}
    .call-event-card{
      display:block;
      margin:0 0 6px;
      border:1px solid #e4e7ec;
      border-radius:9px;
      color:#172033;
      background:#fff;
      overflow:hidden
    }
    .call-event-card:last-child{margin-bottom:0}
    .call-event-summary{
      display:flex;
      gap:9px;
      align-items:flex-start;
      padding:9px 9px 8px;
      cursor:pointer;
      list-style:none
    }
    .call-event-summary::-webkit-details-marker{display:none}
    .call-event-state{
      display:grid;
      place-items:center;
      flex:0 0 22px;
      width:22px;
      height:22px;
      margin-top:1px;
      border-radius:50%;
      font:900 13px/1 Arial,sans-serif
    }
    .call-event-state.attention{color:#fff;background:#f04438}
    .call-event-state.done{color:#fff;background:#12b76a}
    .call-event-state.active{color:#175cd3;background:#eff8ff}
    .call-event-state.neutral{color:#667085;background:#f2f4f7}
    .call-event-main{min-width:0;flex:1}
    .call-event-top{display:flex;gap:8px;align-items:baseline}
    .call-event-title{
      min-width:0;
      flex:1;
      color:#101828;
      font:800 11px/1.25 Arial,sans-serif;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap
    }
    .call-event-time{flex:0 0 auto;color:#98a2b3;font:600 9.5px/1 Arial,sans-serif}
    .call-event-person{
      margin-top:3px;
      color:#667085;
      font:500 10px/1.25 Arial,sans-serif;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap
    }
    .call-event-detail{
      margin-top:2px;
      color:#667085;
      font:500 10px/1.3 Arial,sans-serif
    }
    .call-event-detail.error{color:#b42318}
    .call-event-meta{
      margin-top:5px;
      color:#98a2b3;
      font:600 9px/1.25 Arial,sans-serif
    }
    .call-event-expanded{
      margin:0 9px 8px 40px;
      padding:7px 8px;
      border:1px solid #eaecf0;
      border-radius:7px;
      background:#fcfcfd
    }
    .call-event-step{
      display:grid;
      grid-template-columns:15px minmax(0,1fr);
      gap:4px;
      margin:2px 0;
      color:#667085;
      font:500 9.5px/1.35 Arial,sans-serif
    }
    .call-event-step strong{color:#344054}
    .call-event-actions{
      display:flex;
      gap:6px;
      flex-wrap:wrap;
      margin:0 9px 9px 40px
    }
    .call-event-action{
      min-height:27px;
      padding:0 10px;
      border:1px solid #d0d5dd;
      border-radius:6px;
      color:#344054;
      background:#fff;
      cursor:pointer;
      font:700 9.5px/1 Arial,sans-serif
    }
    .call-event-action:hover{background:#f9fafb}
    .call-event-action.primary{border-color:#a50046;color:#fff;background:#a50046}
    .call-event-action.primary:hover{background:#8e003c}
    .call-event-action.danger{border-color:#f1b4b0;color:#b42318}
    .call-event-action.quiet{border-color:transparent;color:#667085;background:transparent}
    .call-event-action:disabled{opacity:.5;cursor:default}
    .call-event-empty{padding:18px 14px;color:#667085;background:#fff;font:500 10.5px/1.4 Arial,sans-serif}
    .call-diagnostic-list{padding:7px 7px 0;background:#f8fafc}
    .call-diagnostic-row{
      display:flex;
      gap:8px;
      padding:8px 9px;
      margin-bottom:6px;
      border:1px solid #fecdca;
      border-radius:8px;
      background:#fff
    }
    .call-diagnostic-mark{color:#b42318;font-weight:900}
    .call-diagnostic-row b{display:block;color:#101828;font:800 10px/1.25 Arial,sans-serif}
    .call-diagnostic-row small{display:block;margin-top:2px;color:#667085;font:500 9.5px/1.3 Arial,sans-serif}
    .attention-badge{
      min-width:15px!important;
      height:15px!important;
      padding:0 4px!important;
      border:2px solid #202630!important;
      border-radius:999px!important;
      color:#fff!important;
      background:#a50046!important;
      font:800 8px/11px Arial,sans-serif!important
    }
    .attention-bell.has-items{color:#fff!important}
  `;

  function ensureStyles() {
    if (!rail.shadow) return;
    if (!bridgeStyle.isConnected) rail.shadow.appendChild(bridgeStyle);
  }

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function statusLabel(call = {}) {
    const status = String(call.status || '');
    return ({
      WAIT_PBX: 'Ожидание PBX',
      QUEUED: 'В очереди',
      FETCH_AUDIO: 'Получение MP3',
      TRANSCRIBING: 'Транскрибация',
      TRANSCRIPT_READY: 'Текст получен',
      ANALYZING: 'AI-анализ',
      WRITING_USERSIDE: 'Запись в UserSide',
      WAIT_TRANSCRIBER: 'Транскрибер недоступен',
      WAIT_TASK_ID: 'Ожидается обращение UserSide',
      USERSIDE_REVIEW: 'Нужна проверка UserSide',
      USERSIDE_ERROR: 'Ошибка записи в UserSide',
      PBX_ERROR: 'Ошибка PBX',
      ERROR: 'Ошибка обработки',
      STALE: 'Операция прервана',
      CANCELLED: 'Остановлено',
      DONE: 'Готово',
      IDLE: 'Без обработки'
    })[status] || status || 'Неизвестно';
  }

  function eventTitle(call = {}) {
    const status = String(call.status || '');
    const stage = String(call.processing?.stage || '');
    if (status === 'WAIT_PBX' && call.needsAttention) return 'PBX не найдена';
    if (status === 'WAIT_TRANSCRIBER') return 'Транскрибер недоступен';
    if (status === 'USERSIDE_ERROR') return 'Ошибка записи в UserSide';
    if (status === 'USERSIDE_REVIEW') return 'Нужна проверка UserSide';
    if (status === 'WAIT_TASK_ID') return 'Не найдено обращение UserSide';
    if (status === 'PBX_ERROR') return 'PBX не вернула запись';
    if (status === 'STALE') return 'Операция прервана';
    if (status === 'ERROR' && stage === 'ai') return 'AI не ответил';
    if (status === 'ERROR' && stage === 'whisper') return 'Ошибка транскрибации';
    return statusLabel(call);
  }

  function personLabel(call = {}) {
    return [call.customerLabel || '', call.phone || ''].filter(Boolean).join(' · ') || call.callKey || 'Звонок';
  }

  function shortDetail(call = {}) {
    const status = String(call.status || '');
    if (call.error) return String(call.error);
    if (status === 'WAIT_PBX') {
      return call.needsAttention
        ? `PBX recordId не появился за ${Math.max(1, Number(call.waitSeconds || 0))} сек.`
        : 'Ожидается связывание звонка с записью PBX.';
    }
    if (status === 'DONE') return 'Транскрипция и запись звонка завершены.';
    if (status === 'CANCELLED') return 'Обработка остановлена оператором.';
    if (call.active) return `${statusLabel(call)} выполняется.`;
    return statusLabel(call);
  }

  function displayTime(call = {}) {
    if (call.time) return String(call.time).slice(0, 5);
    const value = call.updatedAt || call.registeredAt || call.createdAt || '';
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return '';
    try {
      return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(parsed));
    } catch {
      return '';
    }
  }

  function stateView(call = {}) {
    if (call.needsAttention) return { mark: '!', cls: 'attention' };
    if (call.status === 'DONE') return { mark: '✓', cls: 'done' };
    if (call.active || call.status === 'WAIT_PBX') return { mark: '…', cls: 'active' };
    if (call.status === 'CANCELLED') return { mark: '×', cls: 'neutral' };
    return { mark: '•', cls: 'neutral' };
  }

  function stepLine(call, key, label) {
    const state = call?.steps?.[key] || {};
    if (!state.status || state.status === 'pending') return '';
    const mark = state.status === 'done' ? '✓'
      : state.status === 'running' ? '◉'
        : state.status === 'error' ? '×'
          : state.status === 'waiting' ? '…' : '○';
    const detail = state.detail ? ` · ${state.detail}` : '';
    return `<div class="call-event-step"><span>${esc(mark)}</span><span><strong>${esc(label)}</strong>${esc(detail)}</span></div>`;
  }

  function callRow(call = {}) {
    const state = stateView(call);
    const retry = call.canRetry
      ? `<button type="button" class="call-event-action primary" data-call-action="retry" data-call-key="${esc(call.callKey)}">Повторить</button>`
      : '';
    const cancel = call.canCancel
      ? `<button type="button" class="call-event-action danger" data-call-action="cancel" data-call-key="${esc(call.callKey)}">Отменить</button>`
      : '';
    const dismiss = call.needsAttention && !call.active
      ? `<button type="button" class="call-event-action quiet" data-call-action="dismiss" data-call-key="${esc(call.callKey)}">Скрыть</button>`
      : '';
    const meta = [
      call.usersideCallId ? `CALL #${call.usersideCallId}` : '',
      call.pbxRecordId ? `PBX ${call.pbxRecordId}` : '',
      call.taskId ? `task #${call.taskId}` : ''
    ].filter(Boolean).join(' · ');
    const steps = STEP_LABELS
      .filter(([key]) => key !== 'ai' || call.steps?.ai?.status || call.processing?.stage === 'ai')
      .map(([key, label]) => stepLine(call, key, label))
      .filter(Boolean)
      .join('');
    const detail = shortDetail(call);
    const detailClass = call.needsAttention || call.error ? ' error' : '';

    return `
      <details class="call-event-card" ${call.needsAttention ? 'open' : ''}>
        <summary class="call-event-summary">
          <span class="call-event-state ${state.cls}">${esc(state.mark)}</span>
          <div class="call-event-main">
            <div class="call-event-top">
              <span class="call-event-title">${esc(eventTitle(call))}</span>
              <span class="call-event-time">${esc(displayTime(call))}</span>
            </div>
            <div class="call-event-person">${esc(personLabel(call))}</div>
            <div class="call-event-detail${detailClass}">${esc(detail)}</div>
            ${meta ? `<div class="call-event-meta">${esc(meta)}</div>` : ''}
          </div>
        </summary>
        ${steps ? `<div class="call-event-expanded">${steps}</div>` : ''}
        ${(retry || cancel || dismiss) ? `<div class="call-event-actions">${retry}${cancel}${dismiss}</div>` : ''}
      </details>`;
  }

  function diagnosticRow(item = {}) {
    return `
      <div class="call-diagnostic-row">
        <span class="call-diagnostic-mark">!</span>
        <div><b>${esc(item.title)}</b>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</div>
      </div>`;
  }

  function sortCalls(list = []) {
    const timeOf = call => Date.parse(String(call.updatedAt || call.registeredAt || call.createdAt || '')) || Number(call.createdAtMs || 0);
    return [...list].sort((a, b) => timeOf(b) - timeOf(a));
  }

  function visibleCalls() {
    const ordered = sortCalls(calls);
    if (filter === 'attention') return ordered.filter(call => call.needsAttention).slice(0, 12);
    if (filter === 'active') return ordered.filter(call => call.active || (call.status === 'WAIT_PBX' && !call.needsAttention)).slice(0, 12);
    return ordered.slice(0, 20);
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
    ensureStyles();

    const baseItems = baseAttentionItems();
    const callAttention = calls.filter(call => call.needsAttention);
    const badge = this.shadow.querySelector('.attention-badge');
    const popup = this.shadow.querySelector('.attention-popup');
    const bell = this.shadow.querySelector('.attention-bell');
    const count = baseItems.length + callAttention.length;

    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    if (bell) {
      bell.classList.toggle('has-items', count > 0);
      bell.title = count ? `Требуют внимания: ${count}` : 'Центр событий';
      bell.setAttribute('aria-label', bell.title);
    }

    if (!popup) return;
    if (!this.attentionOpen) {
      popup.hidden = true;
      popup.innerHTML = '';
      return;
    }

    const recent = visibleCalls();
    const diagnostic = filter === 'attention' ? baseItems.map(diagnosticRow).join('') : '';
    const rows = recent.map(callRow).join('');
    const tabs = [
      ['attention', `Требуют внимания${callAttention.length ? ` (${callAttention.length})` : ''}`],
      ['active', `В работе${calls.some(call => call.active || (call.status === 'WAIT_PBX' && !call.needsAttention)) ? '' : ''}`],
      ['history', 'История']
    ].map(([id, label]) => `<button type="button" class="call-processing-tab ${filter === id ? 'active' : ''}" data-call-filter="${id}">${esc(label)}</button>`).join('');

    const emptyText = filter === 'attention'
      ? 'Ошибок и событий, требующих внимания, нет.'
      : filter === 'active'
        ? 'Активной обработки сейчас нет.'
        : 'История звонков пока пуста.';

    popup.innerHTML = `
      <div class="attention-head">
        <b>Центр событий</b>
        <button type="button" class="attention-x" data-action="close-attention" aria-label="Закрыть">×</button>
      </div>
      <div class="call-processing-tabs">${tabs}</div>
      ${diagnostic ? `<div class="call-diagnostic-list">${diagnostic}</div>` : ''}
      ${rows ? `<div class="call-event-list">${rows}</div>` : `<div class="call-event-empty">${emptyText}</div>`}`;
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

  ensureStyles();
  void refresh();
})();
