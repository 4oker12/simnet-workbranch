(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callTranscriptionJobs) return;

  const LIST_MESSAGE = 'CALL_TRANSCRIPTION_JOB_LIST';
  const RETRY_MESSAGE = 'CALL_TRANSCRIPTION_JOB_RETRY';
  const CHANGED_MESSAGE = 'CALL_TRANSCRIPTION_JOB_CHANGED';
  const HOST_ID = 'simnet-workbench-call-job-status';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
    return response.data;
  }

  function host() {
    let node = document.getElementById(HOST_ID);
    if (node) return node;
    node = document.createElement('div');
    node.id = HOST_ID;
    node.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:2147483600',
      'width:330px',
      'max-height:58vh',
      'overflow:auto',
      'background:#fff',
      'border:1px solid #d0d5dd',
      'border-radius:12px',
      'box-shadow:0 12px 32px rgba(16,24,40,.18)',
      'font:12px/1.35 Arial,sans-serif',
      'color:#344054',
      'display:none'
    ].join(';');
    document.documentElement.appendChild(node);
    return node;
  }

  function stepIcon(status) {
    if (status === 'done') return '✓';
    if (status === 'running') return '◉';
    if (status === 'error') return '×';
    if (status === 'waiting') return '…';
    return '○';
  }

  function stepColor(status) {
    if (status === 'done') return '#067647';
    if (status === 'running') return '#175cd3';
    if (status === 'error') return '#b42318';
    if (status === 'waiting') return '#b54708';
    return '#667085';
  }

  const STEP_LABELS = [
    ['lock', 'CALL закреплён'],
    ['pbx', 'PBX найден'],
    ['audio', 'MP3 получен'],
    ['gpu', 'Транскрибация'],
    ['transcript', 'Текст получен'],
    ['userside', 'Запись в UserSide']
  ];

  function renderJob(job) {
    const retry = [
      'WAIT_TRANSCRIBER',
      'PBX_ERROR',
      'ERROR',
      'WAIT_TASK_ID',
      'USERSIDE_ERROR',
      'USERSIDE_REVIEW'
    ].includes(String(job.status || ''))
      ? `<button type="button" data-job-retry="${esc(job.jobId)}" style="border:1px solid #d0d5dd;background:#fff;border-radius:7px;padding:4px 8px;cursor:pointer;font-size:11px">Повторить</button>`
      : '';
    const title = [job.time || '', job.phone || '', job.customerLabel || `customer ${job.customerId || ''}`]
      .filter(Boolean).join(' · ');
    const steps = STEP_LABELS.map(([key, label]) => {
      const state = job.steps?.[key] || {};
      const detail = state.detail ? `<span style="color:#667085"> · ${esc(state.detail)}</span>` : '';
      return `<div style="margin:2px 0;color:${stepColor(state.status)}"><b>${stepIcon(state.status)}</b> ${esc(label)}${detail}</div>`;
    }).join('');
    const error = job.error ? `<div style="margin-top:5px;color:#b42318">${esc(job.error)}</div>` : '';
    return `
      <div style="padding:9px 10px;border-top:1px solid #eaecf0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
          <div style="font-weight:700;color:#101828">${esc(title || job.callKey)}</div>
          ${retry}
        </div>
        <div style="margin:3px 0 6px;color:#667085">CALL #${esc(job.usersideCallId)}${job.pbxRecordId ? ` · PBX ${esc(job.pbxRecordId)}` : ''}${job.taskId ? ` · task #${esc(job.taskId)}` : ''} · ${esc(job.status || '')}</div>
        ${steps}
        ${error}
      </div>`;
  }

  function bindRetries(node) {
    node.querySelectorAll('[data-job-retry]').forEach(button => {
      button.addEventListener('click', async () => {
        const jobId = button.getAttribute('data-job-retry') || '';
        button.disabled = true;
        button.textContent = '...';
        try {
          await request(RETRY_MESSAGE, { jobId });
          await refresh();
        } catch (error) {
          console.error('[SIMNET WB][CALL JOBS] retry failed', error);
        } finally {
          button.disabled = false;
          button.textContent = 'Повторить';
        }
      });
    });
  }

  async function refresh() {
    const jobs = await request(LIST_MESSAGE).catch(() => []);
    const recent = Array.isArray(jobs) ? jobs.slice(0, 3) : [];
    const node = host();
    if (!recent.length) {
      node.style.display = 'none';
      node.innerHTML = '';
      return;
    }
    node.style.display = 'block';
    node.innerHTML = `
      <div style="padding:9px 10px;display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border-radius:12px 12px 0 0">
        <b style="color:#101828">CALL jobs</b>
        <span style="color:#667085">последние ${recent.length}</span>
      </div>
      ${recent.map(renderJob).join('')}`;
    bindRetries(node);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== CHANGED_MESSAGE) return false;
    void refresh();
    return false;
  });

  void refresh();

  WB.callTranscriptionJobs = Object.freeze({ refresh });
})();
