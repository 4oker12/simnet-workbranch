(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskCurrentLiveRecoveryLoaded) return;
  WB.__taskCurrentLiveRecoveryLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const STAFF_PANEL_ATTR = 'data-simnet-wb-current-staff-transition';
  const STAFF_BYPASS_ATTR = 'data-simnet-wb-current-staff-bypass';
  const CREW_HOST_ATTR = 'data-simnet-wb-live-crew-recovery';
  const CREW_INPUT_ATTR = 'data-simnet-wb-recovery-crew-input';
  const MODAL_ID = 'simnet-wb-live-special-recovery';
  const STYLE_ID = 'simnet-wb-live-recovery-style';
  const AUDIT_KEY = 'simnet_crm_constraint_ack_v1';
  const MAX_AUDIT = 500;

  const stateByForm = new WeakMap();
  const replayBypass = new WeakSet();
  let documentObserver = null;

  const compact = (value, max = 4000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 5000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9]+/giu, ' ').trim();

  function log(level, event, details = {}) {
    try {
      const method = WB.log?.[level];
      if (typeof method === 'function') return method.call(WB.log, 'TASK_FLOW', event, details);
    } catch {}
    try {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
      fn(`[SIMNET WB][TASK_FLOW] ${event}`, details);
    } catch {}
    return null;
  }

  function actionPath(form) {
    try { return new URL(String(form?.action || location.href), location.href).pathname; }
    catch { return ''; }
  }

  function isTaskForm(form) {
    return form instanceof HTMLFormElement && FORM_ACTION_RE.test(actionPath(form));
  }

  function getState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    state = {
      infoSignature: '',
      infoRows: [],
      infoPromise: null,
      crewSignature: '',
      crewPromise: null,
      approvedSignature: ''
    };
    stateByForm.set(form, state);
    return state;
  }

  function taskTypeUuid(form) {
    return String(
      form.querySelector('select[name="task_type_uuid"]')?.value
      || form.querySelector('input[name="task_type_uuid"]')?.value
      || form.querySelector('#taskTypeId')?.value
      || ''
    ).trim();
  }

  function buildingUuid(form) {
    const fields = [
      form.querySelector('input[name="building_uuidtask_address"]'),
      form.querySelector('#buildingUuidtask_addressHidden'),
      form.querySelector('#buildingUuidtask_address'),
      form.querySelector('input[name="building_uuid"]'),
      form.querySelector('[id*="buildingUuid"]')
    ];
    for (const field of fields) {
      const value = String(field?.value || field?.dataset?.buildingUuid || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    const customer = form.querySelector('select[name="customer_uuid"]');
    const fromCustomer = String(customer?.selectedOptions?.[0]?.dataset?.buildingUuid || '').trim();
    return UUID_RE.test(fromCustomer) ? fromCustomer : '';
  }

  function customerUuid(form) {
    const value = String(form.querySelector('select[name="customer_uuid"]')?.value || form.querySelector('input[name="customer_uuid"]')?.value || '').trim();
    return UUID_RE.test(value) ? value : '';
  }

  function dateValue(form) {
    return compact(form.querySelector('#datedo_id, input[name="datedo"], input[name="date"]')?.value || '', 32);
  }

  function hourValue(form) {
    return compact(form.querySelector('#timedo_id, select[name="timedo"], input[name="timedo"], input[name="time"]')?.value || '', 8);
  }

  function currentAddress(form) {
    const direct = compact(form.querySelector('#fastSearchInputtask_address')?.value || '', 320);
    if (direct) return direct;
    const building = form.querySelector('#buildingUuidtask_address');
    const buildingText = compact(building?.selectedOptions?.[0]?.textContent || building?.value || '', 320);
    if (buildingText && !UUID_RE.test(buildingText)) return buildingText;
    const customer = form.querySelector('select[name="customer_uuid"]');
    const title = compact(customer?.selectedOptions?.[0]?.getAttribute('title') || '', 420);
    return title || 'Текущий адрес заявки';
  }

  function noteRowsFrom(root) {
    if (!root?.querySelector) return [];
    const specific = [
      ['#buildingTaskCommentId', 'Рабочая заметка дома'],
      ['#buildingTaskInfoId', 'Заметки дома']
    ];
    const rows = [];
    const seen = new Set();
    for (const [selector, label] of specific) {
      const node = root.querySelector(selector);
      const text = compact(node?.textContent || '', 5000);
      const normalized = fold(text);
      if (!text || normalized.length < 4 || seen.has(normalized)) continue;
      if (/^(рабочая )?заметк[аи]?$|^заметки?$/iu.test(text)) continue;
      seen.add(normalized);
      rows.push({ key: selector.slice(1), label, text });
    }
    if (!rows.length) {
      const container = root.querySelector('#buildingWorkDescriptionId');
      const clone = container?.cloneNode?.(true);
      clone?.querySelectorAll?.('#buildingTimeIntervalId,script,style').forEach(node => node.remove());
      const text = compact(clone?.textContent || '', 5000);
      const normalized = fold(text);
      if (text && normalized.length >= 4 && !/^(информация|информация по дому|нет|немає|отсутствует)$/iu.test(normalized)) {
        rows.push({ key: 'buildingWorkDescriptionId', label: 'Информация по дому', text });
      }
    }
    return rows;
  }

  function mergeRows(...groups) {
    const out = [];
    const seen = new Set();
    for (const rows of groups) {
      for (const row of rows || []) {
        const key = fold(row?.text || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }

  function infoSignature(form) {
    return `${taskTypeUuid(form)}|${buildingUuid(form)}`;
  }

  async function refreshBuildingInfo(form, reason = 'refresh') {
    if (!isTaskForm(form)) return [];
    const state = getState(form);
    const typeUuid = taskTypeUuid(form);
    const bUuid = buildingUuid(form);
    const signature = `${typeUuid}|${bUuid}`;
    const domRows = noteRowsFrom(document);

    if (!UUID_RE.test(typeUuid) || !UUID_RE.test(bUuid)) {
      state.infoSignature = signature;
      state.infoRows = domRows;
      return domRows;
    }
    if (state.infoPromise && state.infoSignature === signature) return state.infoPromise;
    if (state.infoSignature === signature && state.infoRows.length) return mergeRows(domRows, state.infoRows);

    state.infoSignature = signature;
    log('info', 'live_info_prefetch_start', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, address: currentAddress(form), domNoteCount: domRows.length });
    state.infoPromise = (async () => {
      try {
        const url = new URL('/task/load_building_work_description', location.origin);
        url.searchParams.set('building_uuid', bUuid);
        url.searchParams.set('task_type_uuid', typeUuid);
        const response = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const remoteRows = noteRowsFrom(doc);
        state.infoRows = mergeRows(domRows, remoteRows);
        log('info', 'live_info_prefetch_result', {
          reason,
          taskTypeUuid: typeUuid,
          buildingUuid: bUuid,
          domNoteCount: domRows.length,
          remoteNoteCount: remoteRows.length,
          noteCount: state.infoRows.length,
          noteSources: state.infoRows.map(row => row.key)
        });
        return state.infoRows;
      } catch (error) {
        state.infoRows = domRows;
        log('warn', 'live_info_prefetch_failed', {
          reason,
          taskTypeUuid: typeUuid,
          buildingUuid: bUuid,
          domNoteCount: domRows.length,
          message: compact(error?.message || error, 180)
        });
        return state.infoRows;
      } finally {
        state.infoPromise = null;
      }
    })();
    return state.infoPromise;
  }

  function nativeBrigadeInputs(form) {
    return Array.from(form.querySelectorAll('input[name^="division_auto_task_staffuuid"], input[name^="division_task_staffuuid"]'))
      .filter(input => !input.hasAttribute(CREW_INPUT_ATTR))
      .filter(input => BRIGADE_RE.test(compact(input.closest('.div_space2,label,.item,.erp-object-props__value')?.textContent || input.parentElement?.textContent || '', 180)));
  }

  function crewSignature(form) {
    return [taskTypeUuid(form), buildingUuid(form), customerUuid(form), dateValue(form), hourValue(form)].join('|');
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${CREW_HOST_ATTR}]{margin-top:7px;padding-top:7px;border-top:1px solid #d8e1e8;color:#40505e;font:12px/1.35 Arial,sans-serif}
      [${CREW_HOST_ATTR}] .wb-live-crew-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      [${CREW_HOST_ATTR}] label{font-weight:600;color:#4a6070}
      [${CREW_HOST_ATTR}] select{min-width:260px;max-width:100%;height:26px;border:1px solid #aebdca;border-radius:3px;background:#fff;color:#40505e;padding:2px 24px 2px 6px;font:12px Arial,sans-serif}
      [${CREW_HOST_ATTR}] .wb-live-crew-hint{margin-top:4px;color:#687783;font-size:11px}
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:18px;background:rgba(38,49,59,.34);font-family:Arial,sans-serif}
      #${MODAL_ID} .wb-live-card{box-sizing:border-box;width:min(700px,calc(100vw - 32px));max-height:min(740px,calc(100vh - 36px));overflow:auto;background:#fff;border:1px solid #c6d2dc;border-radius:3px;box-shadow:0 10px 30px rgba(40,55,70,.24);color:#40505e}
      #${MODAL_ID} .wb-live-head{padding:11px 13px 9px;border-bottom:1px solid #d8e1e8;background:#f3f6f8}
      #${MODAL_ID} .wb-live-title{font-size:14px;font-weight:700;color:#3f607a}
      #${MODAL_ID} .wb-live-address{margin-top:3px;font-size:11px;color:#687783}
      #${MODAL_ID} .wb-live-body{padding:11px 13px}.wb-live-note{margin-bottom:9px;font-size:11px;color:#65737e}
      #${MODAL_ID} .wb-live-item{padding:8px;margin:6px 0;border:1px solid #d8e1e8;border-left:4px solid #c18b3b;border-radius:3px;background:#fffdf7}
      #${MODAL_ID} .wb-live-item-title{font-size:12px;font-weight:700;color:#465764}.wb-live-item-text{margin-top:3px;font-size:11px;line-height:1.45;white-space:pre-wrap}
      #${MODAL_ID} .wb-live-checks{display:grid;gap:7px;margin-top:11px;padding:9px;border:1px solid #d8e1e8;border-radius:3px;background:#f7f9fb}.wb-live-checks label{display:flex;gap:7px;align-items:flex-start;font-size:11px;line-height:1.35}
      #${MODAL_ID} .wb-live-foot{display:flex;gap:7px;justify-content:flex-end;padding:9px 13px 11px;border-top:1px solid #d8e1e8;background:#f8fafb}
      #${MODAL_ID} button{border-radius:3px;padding:5px 9px;font:600 11px/1.2 Arial,sans-serif;cursor:pointer}.wb-live-cancel{border:1px solid #aebdca;background:#fff;color:#405a70}.wb-live-confirm{border:1px solid #3f6f93;background:#4c7da1;color:#fff}.wb-live-confirm[disabled]{opacity:.45;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearSyntheticCrew(form) {
    form.querySelectorAll(`[${CREW_INPUT_ATTR}]`).forEach(node => node.remove());
  }

  function setSyntheticCrew(form, uuid, label) {
    clearSyntheticCrew(form);
    if (!UUID_RE.test(uuid)) return;
    const holder = document.createElement('label');
    holder.hidden = true;
    holder.textContent = label || uuid;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'division_auto_task_staffuuids[]';
    input.value = uuid;
    input.checked = true;
    input.setAttribute(CREW_INPUT_ATTR, '1');
    holder.prepend(input);
    form.appendChild(holder);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderCrewPicker(form, crews) {
    const panel = form.querySelector(`[${STAFF_PANEL_ATTR}]`);
    if (!panel || panel.hidden || nativeBrigadeInputs(form).length) {
      panel?.querySelector?.(`[${CREW_HOST_ATTR}]`)?.remove();
      if (nativeBrigadeInputs(form).length) clearSyntheticCrew(form);
      return;
    }
    ensureStyles();
    let host = panel.querySelector(`[${CREW_HOST_ATTR}]`);
    if (!host) {
      host = document.createElement('div');
      host.setAttribute(CREW_HOST_ATTR, '1');
      host.innerHTML = '<div class="wb-live-crew-row"><label>Бригада</label><select data-wb-live-crew-select="1"><option value="">— выбрать бригаду —</option></select></div><div class="wb-live-crew-hint">Список загружен из текущего UserSide для выбранного типа, адреса, даты и времени.</div>';
      panel.appendChild(host);
      host.querySelector('select')?.addEventListener('change', event => {
        const select = event.currentTarget;
        const option = select.selectedOptions?.[0];
        setSyntheticCrew(form, String(select.value || ''), compact(option?.textContent || '', 180));
        log('info', 'crew_recovery_selected', { taskTypeUuid: taskTypeUuid(form), buildingUuid: buildingUuid(form), crewUuid: select.value, crewLabel: compact(option?.textContent || '', 180) });
      });
    }
    const select = host.querySelector('select');
    const current = String(form.querySelector(`[${CREW_INPUT_ATTR}]`)?.value || '');
    select.innerHTML = '<option value="">— выбрать бригаду —</option>';
    for (const crew of crews) {
      const option = document.createElement('option');
      option.value = crew.uuid;
      option.textContent = crew.label;
      option.selected = crew.uuid === current;
      select.appendChild(option);
    }
  }

  async function refreshCrews(form, reason = 'refresh') {
    if (!isTaskForm(form)) return [];
    const panel = form.querySelector(`[${STAFF_PANEL_ATTR}]`);
    if (!panel || panel.hidden) return [];
    if (nativeBrigadeInputs(form).length) {
      renderCrewPicker(form, []);
      return [];
    }

    const typeUuid = taskTypeUuid(form);
    const bUuid = buildingUuid(form);
    const date = dateValue(form);
    const time = hourValue(form);
    if (!UUID_RE.test(typeUuid) || !UUID_RE.test(bUuid) || !date || !time) return [];
    const state = getState(form);
    const signature = crewSignature(form);
    if (state.crewPromise && state.crewSignature === signature) return state.crewPromise;
    state.crewSignature = signature;

    log('info', 'crew_recovery_load_start', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, customerUuid: customerUuid(form), date, time });
    state.crewPromise = (async () => {
      try {
        const url = new URL('/task/reload_auto_staff', location.origin);
        url.searchParams.set('task_type_uuid', typeUuid);
        url.searchParams.set('building_uuid', bUuid);
        const customer = customerUuid(form);
        if (customer) url.searchParams.set('customer_uuid', customer);
        url.searchParams.set('date', date);
        url.searchParams.set('time', time);
        const response = await fetch(url.toString(), { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const crews = Array.from(doc.querySelectorAll('input[name="division_auto_task_staffuuids[]"], input[name="division_task_staffuuids[]"]')).map(input => {
          const label = compact(input.closest('.div_space2,label,.item,.erp-object-props__value')?.textContent || input.parentElement?.textContent || '', 180);
          return { uuid: String(input.value || '').trim(), label };
        }).filter(item => UUID_RE.test(item.uuid) && BRIGADE_RE.test(item.label));
        renderCrewPicker(form, crews);
        log('info', 'crew_recovery_load_result', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, crewCount: crews.length, crews: crews.slice(0, 12).map(item => item.label) });
        return crews;
      } catch (error) {
        log('warn', 'crew_recovery_load_failed', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, message: compact(error?.message || error, 180) });
        return [];
      } finally {
        state.crewPromise = null;
      }
    })();
    return state.crewPromise;
  }

  function specialSignature(form, rows) {
    return `${infoSignature(form)}|${rows.map(row => fold(row.text)).join('|')}`;
  }

  function writeAudit(form, rows) {
    try {
      chrome.storage.local.get(AUDIT_KEY, stored => {
        const current = stored?.[AUDIT_KEY];
        const entries = Array.isArray(current?.entries) ? current.entries : [];
        entries.unshift({
          id: `ack_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          source: 'userside-live-recovery',
          buildingUuid: buildingUuid(form),
          address: currentAddress(form),
          taskTypeUuid: taskTypeUuid(form),
          acknowledged: true,
          rawSources: rows.map(row => row.key),
          rawNotes: rows.map(row => compact(row.text, 800))
        });
        chrome.storage.local.set({ [AUDIT_KEY]: { ...(current || {}), schema: 'simnet-crm-constraint-ack-v1', updatedAt: new Date().toISOString(), entries: entries.slice(0, MAX_AUDIT) } });
      });
    } catch {}
  }

  function replay(form, submitter) {
    replayBypass.add(form);
    form.setAttribute(STAFF_BYPASS_ATTR, '1');
    queueMicrotask(() => {
      try {
        if (submitter instanceof HTMLElement && submitter.form === form) form.requestSubmit(submitter);
        else form.requestSubmit();
      } catch {
        try { HTMLFormElement.prototype.submit.call(form); } catch {}
      } finally {
        queueMicrotask(() => form.removeAttribute(STAFF_BYPASS_ATTR));
      }
    });
  }

  function showSpecialModal(form, rows, submitter) {
    document.getElementById(MODAL_ID)?.remove();
    ensureStyles();
    const state = getState(form);
    const signature = specialSignature(form, rows);
    const host = document.createElement('div');
    host.id = MODAL_ID;
    host.dataset.simnetWbOwned = '1';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML = '<section class="wb-live-card"><div class="wb-live-head"><div class="wb-live-title">Особенности по адресу</div><div class="wb-live-address"></div></div><div class="wb-live-body"><div class="wb-live-note">UserSide хранит дополнительную информацию по этому дому. Проверь её перед сохранением заявки.</div><div data-wb-live-items="1"></div><div class="wb-live-checks"><label><input type="checkbox" data-role="customer-warned"> <span>Абонент предупреждён / условия уже оговорены</span></label><label><input type="checkbox" data-role="ack"> <span><b>Ознакомлен.</b> Учту информацию при оформлении и выполнении заявки.</span></label></div></div><div class="wb-live-foot"><button type="button" class="wb-live-cancel" data-action="cancel">Вернуться</button><button type="button" class="wb-live-confirm" data-action="confirm" disabled>Подтвердить и сохранить</button></div></section>';
    host.querySelector('.wb-live-address').textContent = currentAddress(form);
    const items = host.querySelector('[data-wb-live-items="1"]');
    rows.slice(0, 6).forEach(row => {
      const item = document.createElement('div');
      item.className = 'wb-live-item';
      const title = document.createElement('div');
      title.className = 'wb-live-item-title';
      title.textContent = row.label || 'Информация по дому';
      const text = document.createElement('div');
      text.className = 'wb-live-item-text';
      text.textContent = row.text;
      item.append(title, text);
      items.appendChild(item);
    });
    const ack = host.querySelector('[data-role="ack"]');
    const confirm = host.querySelector('[data-action="confirm"]');
    ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });
    host.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
      if (action === 'cancel') {
        log('info', 'special_info_recovery_cancelled', { buildingUuid: buildingUuid(form), noteCount: rows.length });
        host.remove();
        return;
      }
      if (action !== 'confirm' || !ack.checked) return;
      state.approvedSignature = signature;
      writeAudit(form, rows);
      log('info', 'special_info_recovery_confirmed', { buildingUuid: buildingUuid(form), noteCount: rows.length, noteSources: rows.map(row => row.key) });
      host.remove();
      replay(form, submitter);
    });
    (document.body || document.documentElement).appendChild(host);
    log('warn', 'special_info_recovery_shown', { taskTypeUuid: taskTypeUuid(form), buildingUuid: buildingUuid(form), address: currentAddress(form), noteCount: rows.length, noteSources: rows.map(row => row.key) });
  }

  async function onSubmit(event) {
    const form = isTaskForm(event.target) ? event.target : null;
    if (!form) return;
    if (replayBypass.has(form)) {
      replayBypass.delete(form);
      return;
    }
    if (event.defaultPrevented || document.getElementById('simnet-wb-current-task-special-info')) return;

    const state = getState(form);
    let rows = mergeRows(noteRowsFrom(document), state.infoRows);
    const currentSig = infoSignature(form);
    if (state.infoSignature !== currentSig || (!rows.length && UUID_RE.test(buildingUuid(form)))) {
      event.preventDefault();
      event.stopPropagation();
      rows = await refreshBuildingInfo(form, 'submit-confirm');
      const signature = specialSignature(form, rows);
      log('info', 'special_info_recovery_evaluated', { taskTypeUuid: taskTypeUuid(form), buildingUuid: buildingUuid(form), noteCount: rows.length, noteSources: rows.map(row => row.key) });
      if (!rows.length || state.approvedSignature === signature) {
        replay(form, event.submitter || null);
        return;
      }
      showSpecialModal(form, rows, event.submitter || null);
      return;
    }

    const signature = specialSignature(form, rows);
    log('info', 'special_info_recovery_evaluated', { taskTypeUuid: taskTypeUuid(form), buildingUuid: buildingUuid(form), noteCount: rows.length, noteSources: rows.map(row => row.key) });
    if (!rows.length || state.approvedSignature === signature) return;
    event.preventDefault();
    event.stopPropagation();
    showSpecialModal(form, rows, event.submitter || null);
  }

  function scheduleRefresh(form, reason) {
    if (!isTaskForm(form)) return;
    queueMicrotask(() => {
      refreshBuildingInfo(form, reason);
      refreshCrews(form, reason);
    });
  }

  function enhance(form, reason = 'enhance') {
    if (!isTaskForm(form)) return;
    getState(form);
    scheduleRefresh(form, reason);
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (!isTaskForm(form)) return;
    const target = event.target;
    if (target?.matches?.('select[name="task_type_uuid"], #buildingUuidtask_address, input[name="building_uuidtask_address"], select[name="customer_uuid"], #datedo_id, #timedo_id, #timedo_id2')) {
      const state = getState(form);
      state.infoSignature = '';
      state.crewSignature = '';
      state.approvedSignature = '';
      scheduleRefresh(form, 'form-change');
    }
  }

  function scan(reason = 'scan') {
    document.querySelectorAll('form').forEach(form => enhance(form, reason));
  }

  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  scan('init');
  documentObserver = new MutationObserver(records => {
    const relevant = records.some(record => Array.from(record.addedNodes || []).some(node => node instanceof Element && (node.matches?.('form,[data-simnet-wb-current-staff-transition],#buildingWorkDescriptionId') || node.querySelector?.('form,[data-simnet-wb-current-staff-transition],#buildingWorkDescriptionId'))));
    if (relevant) queueMicrotask(() => scan('dom-mutation'));
  });
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskCurrentLiveRecovery = Object.freeze({
    refresh() { scan('manual-refresh'); },
    debug(form = null) {
      const target = isTaskForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isTaskForm) || null;
      if (!target) return null;
      const state = getState(target);
      return {
        taskTypeUuid: taskTypeUuid(target),
        buildingUuid: buildingUuid(target),
        customerUuid: customerUuid(target),
        address: currentAddress(target),
        domRows: noteRowsFrom(document),
        cachedRows: state.infoRows,
        nativeBrigadeCount: nativeBrigadeInputs(target).length,
        syntheticCrewUuid: target.querySelector(`[${CREW_INPUT_ATTR}]`)?.value || ''
      };
    },
    destroy() {
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      documentObserver?.disconnect();
      documentObserver = null;
      document.getElementById(MODAL_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll(`[${CREW_HOST_ATTR}], [${CREW_INPUT_ATTR}]`).forEach(node => node.remove());
    }
  });
})();