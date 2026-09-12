(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskFieldVisitUniversalCrewLoaded) return;
  WB.__taskFieldVisitUniversalCrewLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const HOST_ATTR = 'data-simnet-wb-universal-crew';
  const SYNTHETIC_ATTR = 'data-simnet-wb-universal-crew-input';
  const OLD_CREW_HOST_ATTR = 'data-simnet-wb-live-crew-recovery';
  const L1_PANEL_ATTR = 'data-simnet-wb-current-staff-transition';
  const STYLE_ID = 'simnet-wb-universal-crew-style';
  const APPLY_BUSY_ATTR = 'data-simnet-wb-universal-crew-busy';

  const FALLBACK_FIELD_TYPES = new Set([
    '1b34ce66-cd14-4893-a2ec-59c19bcf16dc',
    '3496276b-010a-46ed-a2c5-534c32e8f9e2',
    '378b0972-13b7-4df5-94f0-98ce6a37e9c0',
    'c15aa787-6989-425a-88db-67b902c4ed2c',
    '759de9b3-3b42-4afd-a37f-d3d7f4ea5b55',
    '947410ef-e06a-4e15-8107-cfd2b648b235',
    'd283b923-d58b-48d8-b31f-e440f32858ca',
    'f04549e5-5ae3-406b-84f2-069c52ad88e8',
    '1ff17c41-e4a2-4938-b68d-d9576aac8066',
    '0a7c59e7-a6de-44a3-977f-d90c84e87e5f',
    'c8dd5618-41ea-457d-a23d-dd018d21e77f',
    'd5051f38-a8c6-47ab-a6d6-414a8a7acf0a',
    '614fef14-b1a1-419c-b336-21fc723dd406',
    'cc56250e-7c49-4012-a023-f693ee9ace9c'
  ]);

  const stateByForm = new WeakMap();
  let documentObserver = null;

  const compact = (value, max = 320) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function log(level, event, details = {}) {
    try {
      const method = WB.log?.[level];
      if (typeof method === 'function') return method.call(WB.log, 'TASK_FLOW', event, details);
    } catch {}
    return null;
  }

  function actionPath(form) {
    try { return new URL(String(form?.action || ''), location.href).pathname; }
    catch { return ''; }
  }

  function isTaskForm(form) {
    return form instanceof HTMLFormElement && FORM_ACTION_RE.test(actionPath(form));
  }

  function taskTypeUuid(form) {
    return String(
      form.querySelector('select[name="task_type_uuid"]')?.value
      || form.querySelector('input[name="task_type_uuid"]')?.value
      || form.querySelector('#taskTypeId')?.value
      || ''
    ).trim();
  }

  function fieldVisitUuids() {
    const live = WB.taskCurrentContractGuard?.fieldVisitUuids;
    return new Set(Array.isArray(live) && live.length ? live : FALLBACK_FIELD_TYPES);
  }

  function isFieldVisit(form) {
    return fieldVisitUuids().has(taskTypeUuid(form));
  }

  function numericTaskId() {
    const match = String(location.pathname || '').match(/^\/task\/(\d+)\/dialog_edit\/?$/i);
    return match ? match[1] : '';
  }

  function isEditForm() {
    return /^\/task\/\d+\/dialog_edit\/?$/i.test(String(location.pathname || ''));
  }

  function inputLabel(input) {
    return compact(
      input?.closest?.('.div_space2,label,.item,.erp-object-props__value')?.textContent
      || input?.parentElement?.textContent
      || '',
      180
    );
  }

  function brigadeInputs(form, { includeSynthetic = true } = {}) {
    return Array.from(form.querySelectorAll('input[name^="division_auto_task_staffuuid"], input[name^="division_task_staffuuid"]'))
      .filter(input => input instanceof HTMLInputElement)
      .filter(input => includeSynthetic || !input.hasAttribute(SYNTHETIC_ATTR))
      .filter(input => BRIGADE_RE.test(inputLabel(input)));
  }

  function selectedCrew(form) {
    const input = brigadeInputs(form).find(node => node.checked && UUID_RE.test(String(node.value || '').trim()));
    return input ? { uuid: String(input.value || '').trim(), label: inputLabel(input) } : null;
  }

  function getState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    state = {
      refreshKey: '',
      loadedKey: '',
      refreshPromise: null,
      scheduleQueued: false,
      scheduleReason: '',
      currentCrew: null,
      availableCrews: [],
      selectedUuid: '',
      selectedLabel: '',
      taskUuid: ''
    };
    stateByForm.set(form, state);
    return state;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${HOST_ATTR}]{box-sizing:border-box;max-width:640px;margin:8px 0;padding:8px 10px;border:1px solid #cbd6df;border-radius:3px;background:#f7f9fb;color:#40505e;font:12px/1.35 Arial,sans-serif}
      [${HOST_ATTR}] .wb-uc-title{font-weight:700;color:#3f607a;margin-bottom:5px}
      [${HOST_ATTR}] .wb-uc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      [${HOST_ATTR}] select{min-width:280px;max-width:100%;height:27px;border:1px solid #aebdca;border-radius:3px;background:#fff;color:#40505e;padding:2px 24px 2px 6px;font:12px Arial,sans-serif}
      [${HOST_ATTR}] .wb-uc-hint{margin-top:5px;color:#687783;font-size:11px}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeSynthetic(form) {
    form.querySelectorAll(`[${SYNTHETIC_ATTR}]`).forEach(input => input.closest('label')?.remove() || input.remove());
  }

  function setSynthetic(form, uuid, label) {
    const existing = form.querySelector(`[${SYNTHETIC_ATTR}]`);
    if (UUID_RE.test(uuid) && existing instanceof HTMLInputElement
      && existing.checked && String(existing.value || '').trim() === uuid) return false;
    if (!UUID_RE.test(uuid) && !existing) return false;

    removeSynthetic(form);
    if (!UUID_RE.test(uuid)) return true;
    const holder = document.createElement('label');
    holder.hidden = true;
    holder.textContent = label || uuid;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'division_auto_task_staffuuids[]';
    input.value = uuid;
    input.checked = true;
    input.setAttribute(SYNTHETIC_ATTR, '1');
    holder.prepend(input);
    form.appendChild(holder);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function oldCrewPickerVisible(form) {
    const host = form.querySelector(`[${OLD_CREW_HOST_ATTR}]`);
    return Boolean(host && !host.hidden);
  }

  function l1TransitionVisible(form) {
    const panel = form.querySelector(`[${L1_PANEL_ATTR}]`);
    return Boolean(panel && !panel.hidden);
  }

  function nativeChoiceAvailable(form) {
    return brigadeInputs(form, { includeSynthetic: false }).length > 0;
  }

  function anchor(form) {
    const actions = form.querySelector('.erp_form_actions, .div_center');
    if (actions?.parentNode) return { parent: actions.parentNode, before: actions };
    return { parent: form, before: null };
  }

  function ensureHost(form) {
    ensureStyles();
    let host = form.querySelector(`[${HOST_ATTR}]`);
    if (host) return host;
    host = document.createElement('div');
    host.setAttribute(HOST_ATTR, '1');
    host.dataset.simnetWbOwned = '1';
    host.innerHTML = '<div class="wb-uc-title">Бригада выездной заявки</div><div class="wb-uc-row"><select data-wb-uc-select="1"><option value="">— выбрать бригаду —</option></select></div><div class="wb-uc-hint">Загружаю исполнителей…</div>';
    const place = anchor(form);
    place.parent.insertBefore(host, place.before);
    host.querySelector('select')?.addEventListener('change', event => {
      const state = getState(form);
      const select = event.currentTarget;
      const option = select.selectedOptions?.[0];
      state.selectedUuid = String(select.value || '').trim();
      state.selectedLabel = compact(option?.textContent || '', 180);
      setSynthetic(form, state.selectedUuid, state.selectedLabel);
      log('info', 'universal_crew_selected', {
        taskTypeUuid: taskTypeUuid(form), crewUuid: state.selectedUuid, crewLabel: state.selectedLabel, mode: isEditForm() ? 'edit' : 'create'
      });
    });
    return host;
  }

  function render(form, crews, hint = '') {
    if (!isTaskForm(form) || !isFieldVisit(form) || nativeChoiceAvailable(form) || oldCrewPickerVisible(form)) {
      form.querySelector(`[${HOST_ATTR}]`)?.remove();
      if (nativeChoiceAvailable(form) || oldCrewPickerVisible(form)) removeSynthetic(form);
      return;
    }

    const state = getState(form);
    const host = ensureHost(form);
    const select = host.querySelector('select');
    const merged = [];
    const seen = new Set();
    for (const crew of [state.currentCrew, ...(crews || [])].filter(Boolean)) {
      if (!UUID_RE.test(crew.uuid) || seen.has(crew.uuid)) continue;
      seen.add(crew.uuid);
      merged.push(crew);
    }

    const preferred = state.selectedUuid || state.currentCrew?.uuid || '';
    select.innerHTML = '<option value="">— выбрать бригаду —</option>';
    for (const crew of merged) {
      const option = document.createElement('option');
      option.value = crew.uuid;
      option.textContent = crew.label || crew.uuid;
      option.selected = crew.uuid === preferred;
      select.appendChild(option);
    }

    if (preferred && UUID_RE.test(preferred)) {
      const selected = merged.find(item => item.uuid === preferred) || state.currentCrew;
      state.selectedUuid = preferred;
      state.selectedLabel = selected?.label || state.selectedLabel || preferred;
      setSynthetic(form, preferred, state.selectedLabel);
    }

    host.querySelector('.wb-uc-hint').textContent = hint || (merged.length
      ? `Доступно бригад: ${merged.length}. Текущую можно оставить или заменить.`
      : 'Бригады пока не загружены.');
  }

  function taskUuidFrom(root) {
    if (!root?.querySelectorAll) return '';
    const direct = String(root.querySelector('input[name="uuid"], input#taskId')?.value || '').trim();
    if (UUID_RE.test(direct)) return direct;
    for (const link of Array.from(root.querySelectorAll('a[href*="/dialog_change_staff"], a[href*="/task/"]'))) {
      const raw = String(link.getAttribute('href') || '');
      const match = raw.match(/\/task\/([0-9a-f-]{36})(?:\/dialog_change_staff|\/|\?|$)/i);
      if (match && UUID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  async function resolveTaskUuid(form) {
    const state = getState(form);
    if (UUID_RE.test(state.taskUuid)) return state.taskUuid;
    let uuid = taskUuidFrom(form) || taskUuidFrom(document);
    if (UUID_RE.test(uuid)) {
      state.taskUuid = uuid;
      return uuid;
    }
    const taskId = numericTaskId();
    if (!/^\d+$/.test(taskId)) return '';
    const response = await fetch(`/task/${encodeURIComponent(taskId)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return '';
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    uuid = taskUuidFrom(doc);
    if (UUID_RE.test(uuid)) state.taskUuid = uuid;
    return UUID_RE.test(uuid) ? uuid : '';
  }

  function dialogStaffRows(dialogForm) {
    const map = new Map();
    const inputs = Array.from(dialogForm.querySelectorAll([
      'input[name="division_task_staffuuids[]"]',
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name="division_task_staffids[]"]',
      'input[name="division_auto_task_staffids[]"]'
    ].join(',')));
    for (const input of inputs) {
      const uuid = String(input.value || '').trim();
      if (!UUID_RE.test(uuid)) continue;
      const label = inputLabel(input) || uuid;
      const previous = map.get(uuid);
      map.set(uuid, {
        uuid,
        label: previous?.label && previous.label !== uuid ? previous.label : label,
        checked: Boolean(previous?.checked || input.checked),
        brigade: BRIGADE_RE.test(label)
      });
    }
    return [...map.values()];
  }

  async function loadNativeStaff(form) {
    if (!isEditForm()) return { taskUuid: '', rows: [], form: null, doc: null };
    const taskUuid = await resolveTaskUuid(form);
    if (!UUID_RE.test(taskUuid)) return { taskUuid: '', rows: [], form: null, doc: null };
    const response = await fetch(`/task/${taskUuid}/dialog_change_staff`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Форма исполнителей: HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dialogForm = doc.querySelector('form[action="/task/staff_save"], form[action*="/task/staff_save"]');
    if (!dialogForm) throw new Error('UserSide не вернул форму исполнителей');
    return { taskUuid, rows: dialogStaffRows(dialogForm), form: dialogForm, doc };
  }

  async function loadAvailableCrews(form, debug = null) {
    const context = debug || await WB.taskCurrentLiveRecovery?.debug?.(form);
    const buildingUuid = String(context?.resolvedBuildingUuid || context?.directBuildingUuid || '').trim();
    const typeUuid = taskTypeUuid(form);
    const date = compact(form.querySelector('#datedo_id, input[name="datedo"], input[name="date"]')?.value || '', 32);
    const time = compact(form.querySelector('#timedo_id, select[name="timedo"], input[name="timedo"], input[name="time"]')?.value || '', 8);
    if (!UUID_RE.test(typeUuid) || !UUID_RE.test(buildingUuid) || !date || !time) return [];

    const url = new URL('/task/reload_auto_staff', location.origin);
    url.searchParams.set('task_type_uuid', typeUuid);
    url.searchParams.set('building_uuid', buildingUuid);
    if (context?.customerUuid && UUID_RE.test(context.customerUuid)) url.searchParams.set('customer_uuid', context.customerUuid);
    url.searchParams.set('date', date);
    url.searchParams.set('time', time);

    const response = await fetch(url.toString(), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Список бригад: HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    return Array.from(doc.querySelectorAll('input[name="division_auto_task_staffuuids[]"], input[name="division_task_staffuuids[]"]'))
      .map(input => ({ uuid: String(input.value || '').trim(), label: inputLabel(input), checked: Boolean(input.checked) }))
      .filter(item => UUID_RE.test(item.uuid) && BRIGADE_RE.test(item.label))
      .filter(item => !seen.has(item.uuid) && seen.add(item.uuid));
  }

  async function refresh(form, reason = 'refresh') {
    if (!isTaskForm(form)) return;
    if (!isFieldVisit(form) || nativeChoiceAvailable(form) || oldCrewPickerVisible(form)) {
      render(form, []);
      return;
    }

    const state = getState(form);
    const debug = await WB.taskCurrentLiveRecovery?.debug?.(form).catch?.(() => null) || null;
    const key = [taskTypeUuid(form), debug?.resolvedBuildingUuid || debug?.directBuildingUuid || '', debug?.addressUnitUuid || '', compact(form.querySelector('#datedo_id')?.value || ''), compact(form.querySelector('#timedo_id')?.value || '')].join('|');
    if (state.refreshPromise && state.refreshKey === key) return state.refreshPromise;
    if (reason !== 'manual-refresh' && state.loadedKey === key) {
      render(form, state.availableCrews, state.availableCrews.length
        ? `Доступно бригад: ${state.availableCrews.length}. Текущую можно оставить или заменить.`
        : (state.currentCrew ? 'Текущая бригада определена. Список доступных сейчас не получен.' : 'UserSide не вернул доступных бригад.'));
      return state.availableCrews;
    }
    state.refreshKey = key;

    render(form, state.availableCrews, 'Загружаю доступные бригады…');
    state.refreshPromise = (async () => {
      try {
        if (isEditForm()) {
          const native = await loadNativeStaff(form);
          const current = native.rows.find(row => row.checked && row.brigade) || null;
          state.currentCrew = current ? { uuid: current.uuid, label: current.label } : null;
          if (!state.selectedUuid && state.currentCrew) {
            state.selectedUuid = state.currentCrew.uuid;
            state.selectedLabel = state.currentCrew.label;
          }
        }

        const crews = await loadAvailableCrews(form, debug);
        state.availableCrews = crews;
        state.loadedKey = key;
        if (!state.selectedUuid) {
          const preferred = crews.find(item => item.checked) || null;
          if (preferred) {
            state.selectedUuid = preferred.uuid;
            state.selectedLabel = preferred.label;
          }
        }
        render(form, crews, crews.length
          ? `Доступно бригад: ${crews.length}. Текущую можно оставить или заменить.`
          : (state.currentCrew ? 'Текущая бригада определена. Список доступных сейчас не получен.' : 'UserSide не вернул доступных бригад.'));
        log('info', 'universal_crew_ready', {
          reason, mode: isEditForm() ? 'edit' : 'create', currentCrew: state.currentCrew?.label || '', available: crews.length
        });
      } catch (error) {
        render(form, state.availableCrews, `Не удалось загрузить бригады: ${compact(error?.message || error, 150)}`);
        log('warn', 'universal_crew_load_failed', { reason, message: compact(error?.message || error, 180) });
      } finally {
        state.refreshPromise = null;
      }
    })();
    return state.refreshPromise;
  }

  async function applySelectedCrew(form, crew) {
    const native = await loadNativeStaff(form);
    if (!native.form || !UUID_RE.test(native.taskUuid)) throw new Error('Не удалось открыть форму исполнителей');

    const preserved = native.rows
      .filter(row => row.checked && !row.brigade)
      .map(row => row.uuid);
    const final = [...new Set([...preserved, crew.uuid])];
    const namespace = native.form.querySelector('input[name="division_task_staffuuids[]"], input[name="division_auto_task_staffuuids[]"]')
      ? 'division_task_staffuuids[]'
      : 'division_task_staffids[]';

    native.form.querySelectorAll([
      'input[name="division_task_staffuuids[]"]',
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name="division_task_staffids[]"]',
      'input[name="division_auto_task_staffids[]"]'
    ].join(',')).forEach(input => input.remove());

    let uuidInput = native.form.querySelector('input[name="uuid"]');
    if (!uuidInput) {
      uuidInput = native.doc.createElement('input');
      uuidInput.type = 'hidden';
      uuidInput.name = 'uuid';
      native.form.appendChild(uuidInput);
    }
    uuidInput.value = native.taskUuid;

    for (const uuid of final) {
      const input = native.doc.createElement('input');
      input.type = 'hidden';
      input.name = namespace;
      input.value = uuid;
      native.form.appendChild(input);
    }

    const response = await fetch('/task/staff_save', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: new FormData(native.form)
    });
    if (!response.ok) throw new Error(`Не удалось сохранить бригаду (HTTP ${response.status})`);
    log('info', 'universal_crew_native_saved', { taskUuid: native.taskUuid, crewUuid: crew.uuid, crewLabel: crew.label, preservedCount: preserved.length });
  }

  async function onSubmit(event) {
    const form = isTaskForm(event.target) ? event.target : null;
    if (!form || event.defaultPrevented || !isEditForm() || !isFieldVisit(form)) return;
    if (l1TransitionVisible(form)) return; // dedicated L1 -> field transition owns this case
    if (form.hasAttribute(APPLY_BUSY_ATTR)) return;

    const crew = selectedCrew(form);
    if (!crew) return; // capture validation will report the missing crew

    const state = getState(form);
    if (state.currentCrew?.uuid === crew.uuid) return; // no performer change requested

    event.preventDefault();
    event.stopPropagation();
    form.setAttribute(APPLY_BUSY_ATTR, '1');
    try {
      await applySelectedCrew(form, crew);
      state.currentCrew = { uuid: crew.uuid, label: crew.label };
      state.selectedUuid = crew.uuid;
      state.selectedLabel = crew.label;
      HTMLFormElement.prototype.submit.call(form);
    } catch (error) {
      log('error', 'universal_crew_apply_failed', { message: compact(error?.message || error, 200), crewUuid: crew.uuid, crewLabel: crew.label });
      const host = ensureHost(form);
      host.querySelector('.wb-uc-hint').textContent = `Бригада не применена: ${compact(error?.message || error, 160)}`;
    } finally {
      form.removeAttribute(APPLY_BUSY_ATTR);
    }
  }

  function schedule(form, reason) {
    const state = getState(form);
    state.scheduleReason = reason;
    if (state.scheduleQueued) return;
    state.scheduleQueued = true;
    queueMicrotask(() => {
      state.scheduleQueued = false;
      void refresh(form, state.scheduleReason);
    });
  }

  function scan(reason = 'scan') {
    document.querySelectorAll('form').forEach(form => {
      if (isTaskForm(form)) schedule(form, reason);
    });
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (!isTaskForm(form)) return;
    const target = event.target;
    if (target?.matches?.('select[name="task_type_uuid"], #buildingUuidtask_address, input[name="building_uuidtask_address"], select[name="address_unit_selectortask_address[]"], select[name="customer_uuid"], #datedo_id, #timedo_id, #timedo_id2')) {
      const state = getState(form);
      state.refreshKey = '';
      state.loadedKey = '';
      state.availableCrews = [];
      if (!isEditForm()) {
        state.currentCrew = null;
        state.selectedUuid = '';
        state.selectedLabel = '';
      }
      schedule(form, 'form-change');
    }
  }

  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, false);
  scan('init');

  documentObserver = new MutationObserver(records => {
    const relevant = records.some(record => Array.from(record.addedNodes || []).some(node => node instanceof Element && (node.matches?.('form') || node.querySelector?.('form'))));
    if (relevant) queueMicrotask(() => scan('form-added'));
  });
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskFieldVisitUniversalCrew = Object.freeze({
    refresh() { scan('manual-refresh'); },
    sync() { scan('context-sync'); },
    async debug(form = null) {
      const target = isTaskForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isTaskForm) || null;
      if (!target) return null;
      await refresh(target, 'debug');
      const state = getState(target);
      return {
        fieldVisit: isFieldVisit(target),
        mode: isEditForm() ? 'edit' : 'create',
        currentCrew: state.currentCrew,
        selectedCrew: selectedCrew(target),
        availableCrews: state.availableCrews.map(item => ({ uuid: item.uuid, label: item.label }))
      };
    },
    destroy() {
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, false);
      documentObserver?.disconnect();
      documentObserver = null;
      document.querySelectorAll(`[${HOST_ATTR}], [${SYNTHETIC_ATTR}]`).forEach(node => node.closest('label')?.remove() || node.remove());
      document.getElementById(STYLE_ID)?.remove();
    }
  });
})();