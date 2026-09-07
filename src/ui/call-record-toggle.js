(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callRecordToggle) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const PREF_KEY = 'simnet_workbench_call_record_preferences_v1';
  const MAX_PREFS = 120;
  let observer = null;
  let stopped = false;

  const clean = (value, max = 180) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);

  function preferenceStore(raw = {}) {
    return {
      schemaVersion: 1,
      updatedAt: String(raw.updatedAt || ''),
      entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
    };
  }

  function currentLink(form) {
    const registration = WB.callRegistration && WB.callRegistration.__lazy !== true
      ? WB.callRegistration
      : null;
    const callKey = clean(form?.elements?.pbx_call_key?.value || registration?.focusCall?.callKey, 160);
    const usersideCallId = digits(registration?.focusCall?.usersideCallId || callKey.match(/^call:(\d+)$/)?.[1], 24);
    const binding = registration?.pbxBinding || registration?.focusCall?.binding || {};
    const customerId = digits(
      registration?.caseSnapshot?.customerId
      || binding?.customerId
      || binding?.identity?.customerId,
      14
    );
    const pbxRecordId = clean(
      registration?.focusCall?.pbxRecordId
      || registration?.focusCall?.recordId
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

  async function writePreference(link, enabled, source = 'registration-form') {
    if (!link?.callKey) return null;
    const raw = (await chrome.storage.local.get(PREF_KEY))?.[PREF_KEY] || {};
    const store = preferenceStore(raw);
    const at = new Date().toISOString();
    const previous = store.entries[link.callKey] || {};
    const entry = {
      ...previous,
      schemaVersion: 1,
      callKey: link.callKey,
      usersideCallId: link.usersideCallId || previous.usersideCallId || '',
      customerId: link.customerId || previous.customerId || '',
      pbxRecordId: link.pbxRecordId || previous.pbxRecordId || '',
      enabled: enabled !== false,
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

  function markup(enabled) {
    return `<div class="wb-record-control" data-wb-record-control="1">
      <div class="wb-record-copy">
        <strong>Record</strong>
        <span>${enabled ? 'ON · транскрипция и разбор после регистрации' : 'OFF · только регистрация, без транскрипции'}</span>
      </div>
      <label class="wb-record-switch" title="Включить/выключить транскрипцию этого звонка">
        <input type="checkbox" data-wb-record-toggle="1" ${enabled ? 'checked' : ''}>
        <span class="wb-record-slider"></span>
      </label>
    </div>`;
  }

  function ensureStyle(shadow) {
    if (shadow.querySelector('style[data-wb-record-style]')) return;
    const style = document.createElement('style');
    style.dataset.wbRecordStyle = '1';
    style.textContent = `
      .wb-record-control{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border:1px solid #E4E7EC;border-radius:11px;background:#F9FAFB}
      .wb-record-copy{display:grid;gap:2px;min-width:0}.wb-record-copy strong{color:#344054;font-size:12px}.wb-record-copy span{color:#667085;font-size:10px;line-height:1.35}
      .wb-record-switch{position:relative;display:block;flex:0 0 42px;width:42px;height:24px;cursor:pointer}.wb-record-switch input{position:absolute;opacity:0;width:1px;height:1px;padding:0;border:0}
      .wb-record-slider{position:absolute;inset:0;border-radius:999px;background:#D0D5DD;transition:.15s ease}.wb-record-slider:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.25);transition:.15s ease}
      .wb-record-switch input:checked + .wb-record-slider{background:#A50046}.wb-record-switch input:checked + .wb-record-slider:before{transform:translateX(18px)}
      .wb-record-switch input:focus-visible + .wb-record-slider{outline:3px solid rgba(165,0,70,.18);outline-offset:2px}
    `;
    shadow.appendChild(style);
  }

  async function installIntoForm(form, shadow) {
    if (!form || form.querySelector('[data-wb-record-control="1"]')) return;
    const link = currentLink(form);
    if (!link.callKey) return;
    let pref = null;
    try { pref = await readPreference(link.callKey); } catch {}
    if (!form.isConnected || form.querySelector('[data-wb-record-control="1"]')) return;
    const enabled = pref?.enabled !== false;
    ensureStyle(shadow);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = markup(enabled);
    const control = wrapper.firstElementChild;
    const actions = form.querySelector('.actions');
    if (actions) form.insertBefore(control, actions);
    else form.appendChild(control);

    let pendingSave = writePreference(link, enabled, pref ? 'restored' : 'registration-form-default')
      .catch(error => {
        WB.log?.warn?.('CALL', 'Не удалось сохранить Record policy', {
          callKey: link.callKey,
          reason: String(error?.message || error || '')
        });
        return null;
      });

    const checkbox = control.querySelector('[data-wb-record-toggle="1"]');
    checkbox?.addEventListener('change', event => {
      const nextEnabled = Boolean(event.currentTarget.checked);
      const freshLink = currentLink(form);
      const copy = control.querySelector('.wb-record-copy span');
      if (copy) copy.textContent = nextEnabled
        ? 'ON · транскрипция и разбор после регистрации'
        : 'OFF · только регистрация, без транскрипции';
      pendingSave = writePreference(freshLink, nextEnabled, 'operator-toggle')
        .then(saved => {
          WB.log?.info?.('CALL', `Record ${nextEnabled ? 'ON' : 'OFF'} для регистрации`, saved);
          return saved;
        })
        .catch(error => {
          WB.log?.warn?.('CALL', 'Не удалось сохранить Record policy', {
            callKey: freshLink.callKey,
            reason: String(error?.message || error || '')
          });
          return null;
        });
    });

    let replayingSubmit = false;
    form.addEventListener('submit', event => {
      if (replayingSubmit) return;
      // The native registration handler lives on the ShadowRoot. Stop this submit
      // until the per-call policy/linkage is durable, then replay exactly once.
      event.preventDefault();
      event.stopImmediatePropagation();
      const submitter = event.submitter || form.querySelector('button[type="submit"]');
      const finalEnabled = Boolean(checkbox?.checked);
      const finalLink = currentLink(form);
      pendingSave = Promise.resolve(pendingSave)
        .then(() => writePreference(finalLink, finalEnabled, 'registration-submit'))
        .then(saved => {
          WB.log?.info?.('CALL', 'Record policy зафиксирована перед регистрацией', saved);
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
        WB.log?.error?.('CALL', 'Регистрация остановлена: Record policy не сохранилась', {
          callKey: finalLink.callKey,
          reason: String(error?.message || error || '')
        });
      });
    }, true);
  }

  function scan() {
    if (stopped) return;
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot;
    if (!shadow) return;
    const form = shadow.querySelector('form[data-call-form]');
    if (form) void installIntoForm(form, shadow);
  }

  observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(scan);

  WB.callRecordToggle = Object.freeze({
    key: PREF_KEY,
    read: readPreference,
    scan,
    destroy() {
      stopped = true;
      observer?.disconnect();
      observer = null;
    }
  });
})();
