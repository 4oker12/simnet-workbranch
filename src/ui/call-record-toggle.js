(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callRecordToggle) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const PREF_KEY = 'simnet_workbench_call_record_preferences_v1';
  const MAX_PREFS = 120;
  let documentObserver = null;
  let shadowObserver = null;
  let observedShadow = null;
  let stopped = false;
  let scanQueued = false;

  const clean = (value, max = 180) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
  const normalizeAnalysisMode = value => String(value || '').toLowerCase() === 'deep' ? 'deep' : 'brief';

  function actualRegistration() {
    const registration = WB.callRegistration;
    return registration && registration.__lazy !== true ? registration : null;
  }

  function preferenceStore(raw = {}) {
    return {
      schemaVersion: 1,
      updatedAt: String(raw.updatedAt || ''),
      entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
    };
  }

  function currentLink(form) {
    const registration = actualRegistration();
    const focusCall = registration?.focusCall || {};
    const binding = registration?.pbxBinding || focusCall?.binding || {};
    const target = typeof registration?.targetCandidate === 'function'
      ? registration.targetCandidate()
      : null;
    const callKey = clean(form?.elements?.pbx_call_key?.value || focusCall?.callKey, 160);
    const usersideCallId = digits(focusCall?.usersideCallId || callKey.match(/^call:(\d+)$/)?.[1], 24);
    const customerId = digits(
      target?.customerId
      || binding?.customerId
      || binding?.identity?.customerId
      || focusCall?.customerId
      || (target?.isCurrentCase === true ? registration?.caseSnapshot?.customerId : ''),
      14
    );
    const pbxRecordId = clean(
      focusCall?.pbxRecordId
      || focusCall?.recordId
      || binding?.pbxRecordId
      || binding?.recordId,
      80
    );
    return { callKey, usersideCallId, customerId, pbxRecordId };
  }

  async function readPreference(callKey) {
    if (!callKey) return null;
    const raw = (await chrome.storage.local.get(PREF_KEY))?.[PREF_KEY] || {};
    return preferenceStore(raw).entries[callKey] || null;
  }

  async function writePreference(link, enabled, source = 'registration-form', analysisMode = 'brief') {
    if (!link?.callKey) return null;
    const raw = (await chrome.storage.local.get(PREF_KEY))?.[PREF_KEY] || {};
    const store = preferenceStore(raw);
    const at = new Date().toISOString();
    const previous = store.entries[link.callKey] || {};
    const normalizedMode = normalizeAnalysisMode(analysisMode || previous.analysisMode);
    const entry = {
      ...previous,
      schemaVersion: 1,
      callKey: link.callKey,
      usersideCallId: link.usersideCallId || previous.usersideCallId || '',
      customerId: link.customerId || previous.customerId || '',
      pbxRecordId: link.pbxRecordId || previous.pbxRecordId || '',
      enabled: enabled !== false,
      mode: enabled !== false ? 'REC' : 'NOREC',
      analysisMode: normalizedMode,
      source: clean(source, 80),
      updatedAt: at
    };
    const rows = Object.values({ ...store.entries, [link.callKey]: entry })
      .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .slice(0, MAX_PREFS);
    store.entries = Object.fromEntries(rows.filter(row => row?.callKey).map(row => [row.callKey, row]));
    store.updatedAt = at;
    await chrome.storage.local.set({ [PREF_KEY]: store });
    return entry;
  }

  function markup(enabled, analysisMode = 'brief') {
    const mode = normalizeAnalysisMode(analysisMode);
    return `<div class="wb-record-control" data-wb-record-control="1">
      <div class="wb-record-main">
        <div class="wb-record-mode" role="group" aria-label="Режим регистрации звонка">
          <button type="button" class="wb-record-choice ${enabled ? '' : 'active'}" data-wb-record-choice="off" title="NOREC: сохранить только обычный комментарий, без записи/Whisper/AI">NOREC</button>
          <button type="button" class="wb-record-choice ${enabled ? 'active' : ''}" data-wb-record-choice="on" title="REC: после регистрации найти PBX-запись, транскрибировать и выполнить AI-разбор">REC</button>
          <input type="checkbox" data-wb-record-toggle="1" ${enabled ? 'checked' : ''} hidden>
        </div>
        <div class="wb-record-copy">
          <strong data-wb-record-title>${enabled ? 'REC' : 'NOREC'}</strong>
          <span data-wb-record-copy>${enabled ? 'после регистрации: PBX → Whisper → AI → комментарий' : 'только твой комментарий, без транскрипции'}</span>
        </div>
      </div>
      <div class="wb-analysis-modes" data-wb-analysis-modes ${enabled ? '' : 'hidden'} role="group" aria-label="Глубина AI-разбора">
        <button type="button" class="wb-analysis-choice ${mode === 'brief' ? 'active' : ''}" data-wb-analysis-mode="brief" title="Короткий: компактная CRM-сводка по фактам разговора">Короткий разбор</button>
        <button type="button" class="wb-analysis-choice ${mode === 'deep' ? 'active' : ''}" data-wb-analysis-mode="deep" title="Глубокий: более подробный разбор причин, действий, результата и следующего шага">Глубокий разбор</button>
        <input type="hidden" data-wb-analysis-value value="${mode}">
      </div>
    </div>`;
  }

  function ensureStyle(shadow) {
    if (shadow.querySelector('style[data-wb-record-style]')) return;
    const style = document.createElement('style');
    style.dataset.wbRecordStyle = '1';
    style.textContent = `
      .wb-record-control{display:grid;gap:7px;padding:9px 10px;border:1px solid #E4E7EC;border-radius:11px;background:#F9FAFB}
      .wb-record-main{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px}
      .wb-record-mode{display:inline-flex;padding:2px;border:1px solid #D0D5DD;border-radius:9px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04)}
      .wb-record-choice{min-width:54px;height:26px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:#667085;font:800 9px/1 inherit;letter-spacing:.04em;cursor:pointer}
      .wb-record-choice:hover{background:#F2F4F7;color:#344054}.wb-record-choice.active{background:#A50046;color:#fff;box-shadow:0 1px 2px rgba(16,24,40,.16)}
      .wb-record-copy{display:grid;gap:1px;min-width:0}.wb-record-copy strong{color:#344054;font-size:11px}.wb-record-copy span{color:#667085;font-size:9px;line-height:1.3;overflow:hidden;text-overflow:ellipsis}
      .wb-analysis-modes{display:flex;gap:5px;padding-left:2px}.wb-analysis-modes[hidden]{display:none!important}
      .wb-analysis-choice{min-height:24px;padding:0 9px;border:1px solid #D0D5DD;border-radius:7px;background:#fff;color:#667085;font:700 9px/1 inherit;cursor:pointer}
      .wb-analysis-choice:hover{border-color:#B8C0CC;color:#344054}.wb-analysis-choice.active{border-color:#A50046;background:#FFF5F8;color:#A50046}
    `;
    shadow.appendChild(style);
  }

  function selectedAnalysisMode(control) {
    return normalizeAnalysisMode(control.querySelector('[data-wb-analysis-value]')?.value);
  }

  function paint(control, enabled, analysisMode = selectedAnalysisMode(control)) {
    const checkbox = control.querySelector('[data-wb-record-toggle="1"]');
    if (checkbox) checkbox.checked = Boolean(enabled);
    control.querySelectorAll('[data-wb-record-choice]').forEach(button => {
      const active = (button.dataset.wbRecordChoice === 'on') === Boolean(enabled);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const title = control.querySelector('[data-wb-record-title]');
    const copy = control.querySelector('[data-wb-record-copy]');
    if (title) title.textContent = enabled ? 'REC' : 'NOREC';
    if (copy) copy.textContent = enabled
      ? 'после регистрации: PBX → Whisper → AI → комментарий'
      : 'только твой комментарий, без транскрипции';
    const modes = control.querySelector('[data-wb-analysis-modes]');
    if (modes) modes.hidden = !enabled;
    const normalizedMode = normalizeAnalysisMode(analysisMode);
    const hidden = control.querySelector('[data-wb-analysis-value]');
    if (hidden) hidden.value = normalizedMode;
    control.querySelectorAll('[data-wb-analysis-mode]').forEach(button => {
      const active = button.dataset.wbAnalysisMode === normalizedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  async function installIntoForm(form, shadow) {
    if (!form || form.querySelector('[data-wb-record-control="1"]')) return;
    const link = currentLink(form);
    if (!link.callKey) return;
    let pref = null;
    try { pref = await readPreference(link.callKey); } catch {}
    if (!form.isConnected || form.querySelector('[data-wb-record-control="1"]')) return;
    const enabled = pref?.enabled !== false;
    const analysisMode = normalizeAnalysisMode(pref?.analysisMode);
    ensureStyle(shadow);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = markup(enabled, analysisMode);
    const control = wrapper.firstElementChild;
    const actions = form.querySelector('.actions');
    if (actions) form.insertBefore(control, actions);
    else form.appendChild(control);

    let pendingSave = writePreference(link, enabled, pref ? 'restored' : 'registration-form-default', analysisMode)
      .catch(error => {
        WB.log?.warn?.('CALL', 'Не удалось сохранить REC/NOREC policy', {
          callKey: link.callKey,
          reason: String(error?.message || error || '')
        });
        return null;
      });

    const checkbox = control.querySelector('[data-wb-record-toggle="1"]');
    control.querySelectorAll('[data-wb-record-choice]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextEnabled = event.currentTarget.dataset.wbRecordChoice === 'on';
        const nextAnalysisMode = selectedAnalysisMode(control);
        paint(control, nextEnabled, nextAnalysisMode);
        const freshLink = currentLink(form);
        pendingSave = writePreference(freshLink, nextEnabled, 'operator-toggle', nextAnalysisMode)
          .then(saved => {
            WB.log?.info?.('CALL', `${nextEnabled ? 'REC' : 'NOREC'} для регистрации`, saved);
            return saved;
          })
          .catch(error => {
            WB.log?.warn?.('CALL', 'Не удалось сохранить REC/NOREC policy', {
              callKey: freshLink.callKey,
              reason: String(error?.message || error || '')
            });
            return null;
          });
      });
    });

    control.querySelectorAll('[data-wb-analysis-mode]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextAnalysisMode = normalizeAnalysisMode(event.currentTarget.dataset.wbAnalysisMode);
        paint(control, true, nextAnalysisMode);
        const freshLink = currentLink(form);
        pendingSave = writePreference(freshLink, true, 'operator-analysis-mode', nextAnalysisMode)
          .then(saved => {
            WB.log?.info?.('CALL', `REC · ${nextAnalysisMode === 'deep' ? 'глубокий' : 'короткий'} разбор`, saved);
            return saved;
          })
          .catch(error => {
            WB.log?.warn?.('CALL', 'Не удалось сохранить режим AI-разбора', {
              callKey: freshLink.callKey,
              reason: String(error?.message || error || '')
            });
            return null;
          });
      });
    });

    let replayingSubmit = false;
    form.addEventListener('submit', event => {
      if (replayingSubmit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const submitter = event.submitter || form.querySelector('button[type="submit"]');
      const finalEnabled = Boolean(checkbox?.checked);
      const finalAnalysisMode = selectedAnalysisMode(control);
      const finalLink = currentLink(form);
      pendingSave = Promise.resolve(pendingSave)
        .then(() => writePreference(finalLink, finalEnabled, 'registration-submit', finalAnalysisMode))
        .then(saved => {
          WB.log?.info?.('CALL', 'REC/NOREC policy зафиксирована перед регистрацией', saved);
          return saved;
        });
      void pendingSave.then(() => {
        if (!form.isConnected) return;
        replayingSubmit = true;
        try {
          if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
          else submitter?.click?.();
        } finally {
          queueMicrotask(() => { replayingSubmit = false; });
        }
      }).catch(error => {
        WB.log?.error?.('CALL', 'Регистрация остановлена: REC/NOREC policy не сохранилась', {
          callKey: finalLink.callKey,
          reason: String(error?.message || error || '')
        });
      });
    }, true);
  }

  function queueScan() {
    if (scanQueued || stopped) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  }

  function hookShadow(shadow) {
    if (!shadow || observedShadow === shadow) return;
    shadowObserver?.disconnect();
    observedShadow = shadow;
    shadowObserver = new MutationObserver(queueScan);
    shadowObserver.observe(shadow, { childList: true, subtree: true });
  }

  function scan() {
    if (stopped) return;
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot;
    if (!shadow) return;
    hookShadow(shadow);
    const form = shadow.querySelector('form[data-call-form]');
    if (form) void installIntoForm(form, shadow);
  }

  documentObserver = new MutationObserver(queueScan);
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  queueScan();

  WB.callRecordToggle = Object.freeze({
    key: PREF_KEY,
    read: readPreference,
    scan: queueScan,
    destroy() {
      stopped = true;
      documentObserver?.disconnect();
      shadowObserver?.disconnect();
      documentObserver = null;
      shadowObserver = null;
      observedShadow = null;
    }
  });
})();