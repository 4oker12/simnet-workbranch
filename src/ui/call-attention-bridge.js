(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  if (!WB || !rail || window.top !== window.self || WB.callAttentionBridge) return;

  const LIST = 'CALL_TRANSCRIPTION_JOB_LIST';
  const RETRY = 'CALL_TRANSCRIPTION_JOB_RETRY';
  const CANCEL = 'CALL_TRANSCRIPTION_JOB_CANCEL';
  const DISMISS = 'CALL_TRANSCRIPTION_JOB_DISMISS';
  const CHANGED = 'CALL_TRANSCRIPTION_JOB_CHANGED';

  const STEP_LABELS = [
    ['lock', 'CALL закреплён'],
    ['pbx', 'PBX'],
    ['audio', 'MP3'],
    ['gpu', 'Whisper'],
    ['transcript', 'Текст'],
    ['userside', 'UserSide']
  ];

  const baseAttentionItems = rail.attentionItems.bind(rail);
  let jobs = [];
  let refreshPromise = null;
  let waitTimer = 0;

  const bridgeStyle = document.createElement('style');
  bridgeStyle.textContent = `
    .attention-popup{width:min(390px,calc(100vw - 24px))!important;max-height:min(72vh,680px);overflow:auto!important}
    .attention-popup .attention-head{position:sticky;top:0;z-index:2;background:#fff}
    .attention-popup details.attention-issue>summary::-webkit-details-marker{display:none}
  `;
  rail.shadow?.appendChild(bridgeStyle);

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function statusLabel(job = {}) {
    const status = String(job.status || '');
    return ({
      WAIT_PBX: 'ожидается PBX',
      QUEUED: 'в очереди',
      FETCH_AUDIO: 'скачивается MP3',
      AUDIO_READY: 'MP3 получен',
      TRANSCRIBING: 'транскрибация',
      TRANSCRIPT_READY: 'текст получен',
      WRITING_USERSIDE: 'запись в UserSide',
      WAIT_TRANSCRIBER: 'транскрибер недоступен',
      WAIT_TASK_ID: 'ожидается обращение UserSide',
      USERSIDE_REVIEW: 'нужна проверка UserSide',
      USERSIDE_ERROR: 'ошибка UserSide',
      PBX_ERROR: 'ошибка PBX',
      ERROR: 'ошибка обработки',
      STALE: 'операция прервана',
      CANCELLED: 'остановлено',
      DONE: 'готово'
    })[status] || status || 'неизвестно';
  }

  function statusMark(job = {}) {
    if (job.needsAttention) return ['!', '#b42318'];
    if (job.status === 'DONE') return ['✓', '#067647'];
    if (job.status === 'CANCELLED') return ['×', '#667085'];
    if (job.active || job.status === 'WAIT_PBX') return ['…', '#175cd3'];
    return ['•', '#667085'];
  }

  function title(job = {}) {
    return [
      job.time || '',
      job.phone || '',
      job.customerLabel || (job.customerId ? `customer ${job.customerId}` : '')
    ].filter(Boolean).join(' · ') || job.callKey || 'Звонок';
  }

  function stepLine(job, key, label) {
    const state = job?.steps?.[key] || {};
    const mark = state.status === 'done' ? '✓'
      : state.status === 'running' ? '◉'
        : state.status === 'error' ? '×'
          : state.status === 'waiting' ? '…' : '○';
    const detail = state.detail ? ` · ${state.detail}` : '';
    return `<div style="margin:2px 0;color:#667085"><b>${esc(mark)}</b> ${esc(label)}${esc(detail)}</div>`;
  }

  function callRow(job = {}) {
    const [mark, color] = statusMark(job);
    const retry = job.canRetry
      ? `<button type="button" data-call-action="retry" data-call-job="${esc(job.jobId)}" style="border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font:700 10px Arial">↻ Повторить</button>`
      : '';
    const cancel = job.canCancel
      ? `<button type="button" data-call-action="cancel" data-call-job="${esc(job.jobId)}" style="border:1px solid #f1b4b0;background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font:700 10px Arial;color:#b42318">× Остановить</button>`
      : '';
    const dismiss = job.needsAttention && !job.active
      ? `<button type="button" data-call-action="dismiss" data-call-job="${esc(job.jobId)}" style="border:0;background:transparent;padding:3px 5px;cursor:pointer;font:700 10px Arial;color:#667085">Убрать</button>`
      : '';
    const meta = [
      job.usersideCallId ? `CALL #${job.usersideCallId}` : '',
      job.pbxRecordId ? `PBX ${job.pbxRecordId}` : '',
      job.taskId ? `task #${job.taskId}` : '',
      statusLabel(job)
    ].filter(Boolean).join(' · ');
    const error = job.error ? `<div style="margin-top:5px;color:#b42318">${esc(job.error)}</div>` : '';
    const steps = STEP_LABELS.map(([key, label]) => stepLine(job, key, label)).join('');
    return `
      <details class="attention-issue" ${job.needsAttention ? 'open' : ''} style="display:block;padding:8px 10px">
        <summary style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;list-style:none">
          <span style="display:grid;place-items:center;min-width:20px;height:20px;border-radius:50%;background:#fff;color:${color};font-weight:900">${esc(mark)}</span>
          <div style="min-width:0;flex:1"><b style="display:block">${esc(title(job))}</b><small style="display:block;color:#667085;margin-top:2px">${esc(meta)}</small></div>
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

  function visibleJobs() {
    const attention = jobs.filter(job => job.needsAttention);
    const active = jobs.filter(job => !job.needsAttention && (job.active || job.status === 'WAIT_PBX'));
    const history = jobs.filter(job => !job.needsAttention && !job.active && job.status !== 'WAIT_PBX');
    return [...attention, ...active, ...history].slice(0, 8);
  }

  function scheduleWaitRefresh() {
    clearTimeout(waitTimer);
    waitTimer = 0;
    const waits = jobs.filter(job => job.status === 'WAIT_PBX' && !job.needsAttention);
    if (!waits.length) return;
    const nearest = Math.min(...waits.map(job => Math.max(1, 90 - Number(job.waitSeconds || 0))));
    waitTimer = setTimeout(() => {
      waitTimer = 0;
      void refresh();
    }, Math.min(90_000, nearest * 1000 + 150));
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = request(LIST)
      .then(result => {
        jobs = Array.isArray(result) ? result : [];
        scheduleWaitRefresh();
        rail.syncAttention();
        return jobs;
      })
      .catch(error => {
        console.warn('[SIMNET WB][CALL ATTENTION] refresh failed', error);
        return jobs;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  rail.syncAttention = function syncAttentionWithCalls() {
    if (!this.shadow) return;
    const baseItems = baseAttentionItems();
    const callAttention = jobs.filter(job => job.needsAttention);
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

    const recent = visibleJobs();
    const diagnostic = baseItems.map(diagnosticRow).join('');
    const calls = recent.map(callRow).join('');
    popup.innerHTML = `
      <div class="attention-head">
        <b>${count ? `Требует внимания · ${count}` : 'События Workbench'}</b>
        <button type="button" class="attention-x" data-action="close-attention" aria-label="Закрыть">×</button>
      </div>
      ${diagnostic ? `<div style="border-bottom:1px solid #eaecf0">${diagnostic}</div>` : ''}
      ${calls ? `<div><div style="padding:7px 10px 3px;color:#667085;font-size:10px;font-weight:800;text-transform:uppercase">Звонки · последние ${recent.length}</div>${calls}</div>` : '<div style="padding:14px;color:#667085">Ошибок и недавних CALL-задач нет.</div>'}`;
    popup.hidden = false;
  };

  rail.shadow?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-call-action][data-call-job]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = String(button.dataset.callAction || '');
    const jobId = String(button.dataset.callJob || '');
    if (!jobId) return;
    button.disabled = true;
    const type = action === 'retry' ? RETRY : action === 'cancel' ? CANCEL : DISMISS;
    void request(type, { jobId })
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
    get jobs() { return jobs.slice(); }
  });

  void refresh();
})();
