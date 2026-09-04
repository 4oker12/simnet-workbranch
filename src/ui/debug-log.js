(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.debugLogUi) return;

  const LOG_KEY = WB.log?.key || 'simnet_workbench_debug_log_v1';
  const STATE_KEY = WB.stateKey || 'simnet_workbench_state_v5';
  const JOB_KEY = 'simnet_workbench_transcription_jobs_v1';
  const SUBMIT_DEBUG_KEY = 'simnet_workbench_call_submit_debug_v1';
  const HOST_ID = 'simnet-workbench-debug-log-host';
  const MAX_VISIBLE = 100;

  let open = false;
  let unreadWarnings = 0;
  let refreshTimer = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function compact(value, max = 900) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function statusOf(binding = {}) {
    const raw = binding?.registrationStatus;
    return raw && typeof raw === 'object' ? String(raw.state || '') : String(raw || '');
  }

  function jobMap(raw = {}) {
    return raw?.jobs && typeof raw.jobs === 'object' ? raw.jobs : {};
  }

  function bindingMap(raw = {}) {
    return raw?.callModule?.bindings?.bindings && typeof raw.callModule.bindings.bindings === 'object'
      ? raw.callModule.bindings.bindings
      : {};
  }

  function host() {
    let node = document.getElementById(HOST_ID);
    if (node) return node;
    node = document.createElement('div');
    node.id = HOST_ID;
    node.dataset.simnetWbOwned = '1';
    node.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483645;font:12px/1.35 Arial,sans-serif;color:#344054';
    const shadow = node.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial}.toggle{border:1px solid #98A2B3;background:#fff;color:#344054;border-radius:8px;padding:6px 9px;font:800 11px/1 Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(16,24,40,.15)}
        .toggle.warn{border-color:#F79009;color:#B54708}.toggle.error{border-color:#D92D20;color:#B42318}
        .panel{display:none;margin-top:7px;width:min(620px,calc(100vw - 24px));max-height:68vh;background:#fff;border:1px solid #D0D5DD;border-radius:12px;box-shadow:0 18px 50px rgba(16,24,40,.22);overflow:hidden;font:12px/1.35 Arial,sans-serif}.panel.open{display:block}
        .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:#F9FAFB;border-bottom:1px solid #EAECF0}.title{font-weight:900;color:#101828}.actions{display:flex;gap:6px}.btn{border:1px solid #D0D5DD;background:#fff;color:#475467;border-radius:7px;padding:4px 7px;font:700 10px/1 Arial,sans-serif;cursor:pointer}.btn:hover{background:#F2F4F7}
        .meta{padding:6px 10px;color:#667085;border-bottom:1px solid #EAECF0;font-size:10px}.list{max-height:58vh;overflow:auto}.row{padding:7px 10px;border-bottom:1px solid #F2F4F7}.row:last-child{border-bottom:0}.top{display:flex;align-items:center;gap:7px;min-width:0}.time{color:#98A2B3;font-variant-numeric:tabular-nums}.level{font-weight:900;text-transform:uppercase;font-size:9px}.scope{font-weight:850;color:#475467}.event{font-weight:700;color:#101828;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.info .level{color:#175CD3}.warn .level{color:#B54708}.error .level{color:#B42318}.details{margin-top:3px;color:#667085;font:10px/1.35 Consolas,monospace;white-space:pre-wrap;word-break:break-word}.page{margin-top:2px;color:#98A2B3;font-size:9px}.empty{padding:18px;color:#98A2B3;text-align:center}
      </style>
      <button class="toggle" type="button" title="Открыть журнал Workbench">WB LOG</button>
      <div class="panel">
        <div class="head"><div class="title">Workbench LOG</div><div class="actions"><button class="btn" data-action="copy" type="button">Копировать</button><button class="btn" data-action="clear" type="button">Очистить</button><button class="btn" data-action="close" type="button">×</button></div></div>
        <div class="meta">Важные события CALL / UserSide / транскрипции. Секреты и CSRF не логируются.</div>
        <div class="list"></div>
      </div>`;
    document.documentElement.appendChild(node);

    const toggle = shadow.querySelector('.toggle');
    toggle.addEventListener('click', () => {
      open = !open;
      if (open) unreadWarnings = 0;
      void refresh();
    });
    shadow.querySelector('[data-action="close"]').addEventListener('click', () => {
      open = false;
      void refresh();
    });
    shadow.querySelector('[data-action="clear"]').addEventListener('click', async () => {
      await WB.log?.clear?.();
      unreadWarnings = 0;
      await refresh();
    });
    shadow.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      const entries = await WB.log?.recent?.(MAX_VISIBLE) || [];
      const text = JSON.stringify(entries, null, 2);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        console.log('[SIMNET WB][LOG EXPORT]', text);
      }
    });
    return node;
  }

  function formatDetails(details) {
    if (details == null || details === '') return '';
    try {
      return compact(JSON.stringify(details, null, 2), 1600);
    } catch {
      return compact(details, 1600);
    }
  }

  async function refresh() {
    clearTimeout(refreshTimer);
    const node = host();
    const shadow = node.shadowRoot;
    const panel = shadow.querySelector('.panel');
    const toggle = shadow.querySelector('.toggle');
    panel.classList.toggle('open', open);
    const entries = await WB.log?.recent?.(MAX_VISIBLE) || [];
    const worst = entries.find(entry => entry.level === 'error') ? 'error'
      : entries.find(entry => entry.level === 'warn') ? 'warn' : '';
    toggle.className = `toggle${worst ? ` ${worst}` : ''}`;
    toggle.textContent = unreadWarnings ? `WB LOG · ${unreadWarnings}` : 'WB LOG';
    if (!open) return;
    const list = shadow.querySelector('.list');
    if (!entries.length) {
      list.innerHTML = '<div class="empty">Лог пока пуст.</div>';
      return;
    }
    list.innerHTML = entries.map(entry => {
      const time = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      const level = ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
      const details = formatDetails(entry.details);
      return `<div class="row ${esc(level)}"><div class="top"><span class="time">${esc(time)}</span><span class="level">${esc(level)}</span><span class="scope">${esc(entry.scope || 'APP')}</span><span class="event" title="${esc(entry.event || '')}">${esc(entry.event || '')}</span></div>${details ? `<div class="details">${esc(details)}</div>` : ''}${entry.page ? `<div class="page">${esc(entry.page)}</div>` : ''}</div>`;
    }).join('');
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 50);
  }

  function logBindingTransitions(oldState = {}, newState = {}) {
    const before = bindingMap(oldState);
    const after = bindingMap(newState);
    for (const [callKey, binding] of Object.entries(after)) {
      const prev = statusOf(before[callKey]);
      const next = statusOf(binding);
      if (!next || prev === next) continue;
      const details = {
        callKey,
        customerId: binding?.customerId || binding?.identity?.customerId || '',
        from: prev || 'none',
        to: next,
        mode: binding?.mode || '',
        registeredAt: binding?.registeredAt || ''
      };
      if (next === 'registered') WB.log?.info?.('CALL', 'Регистрация подтверждена UserSide', details);
      else if (next === 'submitting') WB.log?.info?.('CALL', 'Сохранение звонка отправлено в UserSide', details);
      else if (next === 'review_required') WB.log?.warn?.('CALL', 'Результат сохранения не подтверждён', details);
      else WB.log?.warn?.('CALL', `Статус регистрации изменён: ${next}`, details);
    }
  }

  function logJobTransitions(oldRaw = {}, newRaw = {}) {
    const before = jobMap(oldRaw);
    const after = jobMap(newRaw);
    for (const [jobId, job] of Object.entries(after)) {
      const prev = String(before[jobId]?.status || '');
      const next = String(job?.status || '');
      if (!next || prev === next) continue;
      const details = {
        jobId,
        callKey: job?.callKey || '',
        customerId: job?.customerId || '',
        pbxRecordId: job?.pbxRecordId || '',
        from: prev || 'none',
        to: next,
        attempts: Number(job?.attempts || 0),
        error: job?.error || ''
      };
      if (next === 'ERROR' || next === 'PBX_ERROR') WB.log?.error?.('CALL JOB', `Job ${next}`, details);
      else if (next === 'WAIT_TRANSCRIBER' || next === 'WAIT_PBX') WB.log?.warn?.('CALL JOB', `Job ${next}`, details);
      else WB.log?.info?.('CALL JOB', `Job ${next}`, details);
    }
  }

  function logSubmitCapture(snapshot = {}) {
    if (!snapshot?.capturedAt) return;
    const details = {
      method: snapshot?.request?.method || '',
      path: snapshot?.request?.path || '',
      durationMs: Number(snapshot?.durationMs || 0),
      ok: Boolean(snapshot?.response?.ok),
      status: Number(snapshot?.response?.status || 0),
      redirected: Boolean(snapshot?.response?.redirected),
      responseUrl: compact(snapshot?.response?.url || '', 300),
      contentType: snapshot?.response?.contentType || '',
      bodyChars: Number(snapshot?.response?.bodyChars || 0),
      error: snapshot?.error || snapshot?.response?.bodyReadError || ''
    };
    if (snapshot?.error || (snapshot?.response && !snapshot.response.ok)) WB.log?.error?.('CALL SAVE', 'Ответ /message/save_call', details);
    else WB.log?.info?.('CALL SAVE', 'Ответ /message/save_call', details);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes?.[STATE_KEY]) logBindingTransitions(changes[STATE_KEY].oldValue || {}, changes[STATE_KEY].newValue || {});
    if (changes?.[JOB_KEY]) logJobTransitions(changes[JOB_KEY].oldValue || {}, changes[JOB_KEY].newValue || {});
    if (changes?.[SUBMIT_DEBUG_KEY]?.newValue) logSubmitCapture(changes[SUBMIT_DEBUG_KEY].newValue);
    if (changes?.[LOG_KEY]) scheduleRefresh();
  });

  window.addEventListener('simnet-workbench-log', event => {
    if (!open && ['warn', 'error'].includes(String(event?.detail?.level || ''))) unreadWarnings += 1;
    scheduleRefresh();
  });

  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || 'window error');
    if (/ResizeObserver loop/i.test(message)) return;
    WB.log?.error?.('PAGE', 'Необработанная ошибка страницы Workbench', {
      message,
      source: event?.filename || '',
      line: Number(event?.lineno || 0),
      column: Number(event?.colno || 0),
      stack: String(event?.error?.stack || '').slice(0, 1800)
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason;
    WB.log?.error?.('PAGE', 'Unhandled Promise rejection', {
      message: String(reason?.message || reason || 'unknown rejection').slice(0, 1200),
      stack: String(reason?.stack || '').slice(0, 1800)
    });
  });

  host();
  void refresh();
  WB.debugLogUi = Object.freeze({ open: () => { open = true; unreadWarnings = 0; return refresh(); }, refresh });
})();
