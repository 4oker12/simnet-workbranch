(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskL1AssignmentPickerLoaded) return;
  WB.__taskL1AssignmentPickerLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const L1_DIVISION_UUID = '76fce89d-3304-4d26-a4cf-86dd78a9d89e';
  const L1_DIVISION_LABEL = 'Техподдержка L1';
  const HOST_ATTR = 'data-simnet-wb-l1-assignment-picker';
  const SYNTHETIC_ATTR = 'data-simnet-wb-l1-assignment-input';
  const BUSY_ATTR = 'data-simnet-wb-l1-assignment-busy';
  const STYLE_ID = 'simnet-wb-l1-assignment-picker-style';

  const L1_TYPE_UUIDS = new Set([
    'f1b8154a-abd7-4816-bb97-d323da5ca4d5',
    '7cbb1794-176a-4b27-b4dd-e01f0c31d246',
    '9608872b-12f5-4053-81e3-34135dbf5998',
    '2beda090-b314-41df-b4b8-c5cfeb5484cb',
    'a1d1f9ae-8a7e-42fd-81bd-87a2e528bab9',
    'e95f5f84-f81e-4df4-a634-c7d1d16ff409'
  ]);

  const FIELD_VISIT_UUIDS = new Set([
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
  let observer = null;

  const compact = (value, max = 260) => {
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

  function isEditForm() {
    return /^\/task\/\d+\/dialog_edit\/?$/i.test(String(location.pathname || ''));
  }

  function numericTaskId() {
    const match = String(location.pathname || '').match(/^\/task\/(\d+)\/dialog_edit\/?$/i);
    return match ? match[1] : '';
  }

  function taskTypeUuid(form) {
    return String(
      form.querySelector('select[name="task_type_uuid"]')?.value
      || form.querySelector('input[name="task_type_uuid"]')?.value
      || form.querySelector('#taskTypeId')?.value
      || ''
    ).trim();
  }

  function inputLabel(input) {
    return compact(
      input?.closest?.('.div_space2,label,.item,.erp-object-props__value')?.textContent
      || input?.parentElement?.textContent
      || '',
      180
    );
  }

  function formStaffInputs(form) {
    return Array.from(form.querySelectorAll([
      'input[name="division_task_staffuuids[]"]',
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name^="division_task_staffuuids"]',
      'input[name^="division_auto_task_staffuuids"]'
    ].join(','))).filter(input => input instanceof HTMLInputElement);
  }

  function getState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    const sourceTypeUuid = taskTypeUuid(form);
    state = {
      sourceTypeUuid,
      sourceWasFieldVisit: FIELD_VISIT_UUIDS.has(sourceTypeUuid),
      currentAssignment: null,
      currentCrew: null,
      removeCurrentCrew: FIELD_VISIT_UUIDS.has(sourceTypeUuid),
      selectedUuid: '',
      selectedLabel: '',
      available: [],
      refreshKey: '',
      refreshPromise: null,
      taskUuid: ''
    };
    stateByForm.set(form, state);
    log('info', 'l1_assignment_source_captured', {
      taskId: numericTaskId(), sourceTypeUuid, sourceWasFieldVisit: state.sourceWasFieldVisit
    });
    return state;
  }

  function applies(form, state = getState(form)) {
    return Boolean(isEditForm() && state.sourceWasFieldVisit && L1_TYPE_UUIDS.has(taskTypeUuid(form)));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${HOST_ATTR}]{box-sizing:border-box;max-width:640px;margin:8px 0;padding:8px 10px;border:1px solid #cbd6df;border-radius:3px;background:#f7f9fb;color:#40505e;font:12px/1.35 Arial,sans-serif}
      [${HOST_ATTR}] .wb-l1a-title{font-weight:700;color:#3f607a;margin-bottom:5px}
      [${HOST_ATTR}] .wb-l1a-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      [${HOST_ATTR}] .wb-l1a-current{margin:0 0 6px;padding:5px 7px;border:1px solid #d7e0e6;border-radius:3px;background:#fff;color:#52626e}
      [${HOST_ATTR}] .wb-l1a-remove{display:flex;align-items:center;gap:6px;margin:7px 0 0;font-size:11px;color:#4f5f6a;cursor:pointer}
      [${HOST_ATTR}] select{min-width:300px;max-width:100%;height:27px;border:1px solid #aebdca;border-radius:3px;background:#fff;color:#40505e;padding:2px 24px 2px 6px;font:12px Arial,sans-serif}
      [${HOST_ATTR}] .wb-l1a-hint{margin-top:5px;color:#687783;font-size:11px}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeSynthetic(form) {
    form.querySelectorAll(`[${SYNTHETIC_ATTR}]`).forEach(input => input.closest('label')?.remove() || input.remove());
  }

  function setSynthetic(form, uuid, label) {
    removeSynthetic(form);
    if (!UUID_RE.test(uuid)) return;
    const holder = document.createElement('label');
    holder.hidden = true;
    holder.textContent = label || uuid;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'division_task_staffuuids[]';
    input.value = uuid;
    input.checked = true;
    input.setAttribute(SYNTHETIC_ATTR, '1');
    holder.prepend(input);
    form.appendChild(holder);
  }

  function previewCrewRemoval(form, state) {
    if (!state.currentCrew?.uuid) return;
    for (const input of formStaffInputs(form)) {
      const uuid = String(input.value || '').trim();
      if (uuid !== state.currentCrew.uuid || !BRIGADE_RE.test(inputLabel(input))) continue;
      input.checked = !state.removeCurrentCrew;
    }
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
    host.innerHTML = '<div class="wb-l1a-title">Исполнитель / отдел</div><div class="wb-l1a-current" data-wb-l1a-current="1" hidden></div><div class="wb-l1a-row"><select data-wb-l1a-select="1"><option value="">— выбрать исполнителя —</option></select></div><label class="wb-l1a-remove" data-wb-l1a-remove-wrap="1" hidden><input type="checkbox" data-wb-l1a-remove-crew="1"> <span>Снять текущую выездную бригаду при сохранении</span></label><div class="wb-l1a-hint">Загружаю доступные варианты…</div>';
    const place = anchor(form);
    place.parent.insertBefore(host, place.before);
    host.querySelector('select')?.addEventListener('change', event => {
      const state = getState(form);
      const select = event.currentTarget;
      state.selectedUuid = String(select.value || '').trim();
      state.selectedLabel = compact(select.selectedOptions?.[0]?.textContent || '', 180);
      setSynthetic(form, state.selectedUuid, state.selectedLabel);
      previewCrewRemoval(form, state);
      log('info', 'l1_assignment_selected', {
        taskId: numericTaskId(), taskTypeUuid: taskTypeUuid(form), assignmentUuid: state.selectedUuid, assignmentLabel: state.selectedLabel
      });
    });
    host.querySelector('[data-wb-l1a-remove-crew="1"]')?.addEventListener('change', event => {
      const state = getState(form);
      state.removeCurrentCrew = Boolean(event.currentTarget.checked);
      previewCrewRemoval(form, state);
      log('info', 'l1_assignment_crew_detach_changed', {
        taskId: numericTaskId(), removeCrew: state.removeCurrentCrew,
        crewUuid: state.currentCrew?.uuid || '', crewLabel: state.currentCrew?.label || ''
      });
    });
    return host;
  }

  function render(form, items = [], hint = '') {
    if (!isTaskForm(form)) return;
    const state = getState(form);
    if (!applies(form, state)) {
      form.querySelector(`[${HOST_ATTR}]`)?.remove();
      removeSynthetic(form);
      state.selectedUuid = '';
      state.selectedLabel = '';
      state.removeCurrentCrew = false;
      return;
    }

    const host = ensureHost(form);
    const select = host.querySelector('select');
    const merged = [];
    const seen = new Set();
    const candidates = [
      { uuid: L1_DIVISION_UUID, label: L1_DIVISION_LABEL, checked: true },
      ...(items || [])
    ];
    for (const item of candidates) {
      if (!UUID_RE.test(item?.uuid) || seen.has(item.uuid)) continue;
      seen.add(item.uuid);
      merged.push(item);
    }

    if (!state.selectedUuid) {
      state.selectedUuid = L1_DIVISION_UUID;
      state.selectedLabel = L1_DIVISION_LABEL;
    }

    select.innerHTML = '<option value="">— выбрать исполнителя —</option>';
    for (const item of merged) {
      const option = document.createElement('option');
      option.value = item.uuid;
      option.textContent = item.label || item.uuid;
      option.selected = item.uuid === state.selectedUuid;
      select.appendChild(option);
    }
    setSynthetic(form, state.selectedUuid, state.selectedLabel);

    const current = host.querySelector('[data-wb-l1a-current="1"]');
    const removeWrap = host.querySelector('[data-wb-l1a-remove-wrap="1"]');
    const remove = host.querySelector('[data-wb-l1a-remove-crew="1"]');
    if (state.currentCrew) {
      current.hidden = false;
      current.textContent = `Текущая выездная бригада: ${state.currentCrew.label || state.currentCrew.uuid}`;
      removeWrap.hidden = false;
      remove.checked = Boolean(state.removeCurrentCrew);
      previewCrewRemoval(form, state);
    } else {
      current.hidden = true;
      removeWrap.hidden = true;
    }

    host.querySelector('.wb-l1a-hint').textContent = hint || `Доступно вариантов: ${merged.length}. Для L1 по умолчанию выбрана «${L1_DIVISION_LABEL}».`;
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

  function staffRows(dialogForm) {
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
      map.set(uuid, { uuid, label: previous?.label && previous.label !== uuid ? previous.label : label, checked: Boolean(previous?.checked || input.checked) });
    }
    return [...map.values()];
  }

  async function loadNativeStaff(form) {
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
    return { taskUuid, rows: staffRows(dialogForm), form: dialogForm, doc };
  }

  async function loadAutoAssignments(form) {
    const debug = await WB.taskCurrentLiveRecovery?.debug?.(form).catch?.(() => null) || null;
    const buildingUuid = String(debug?.resolvedBuildingUuid || debug?.directBuildingUuid || '').trim();
    const typeUuid = taskTypeUuid(form);
    const date = compact(form.querySelector('#datedo_id, input[name="datedo"], input[name="date"]')?.value || '', 32);
    const time = compact(form.querySelector('#timedo_id, select[name="timedo"], input[name="timedo"], input[name="time"]')?.value || '', 8);
    if (!UUID_RE.test(typeUuid) || !UUID_RE.test(buildingUuid) || !date || !time) return [];

    const url = new URL('/task/reload_auto_staff', location.origin);
    url.searchParams.set('task_type_uuid', typeUuid);
    url.searchParams.set('building_uuid', buildingUuid);
    if (debug?.customerUuid && UUID_RE.test(debug.customerUuid)) url.searchParams.set('customer_uuid', debug.customerUuid);
    url.searchParams.set('date', date);
    url.searchParams.set('time', time);

    const response = await fetch(url.toString(), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    return Array.from(doc.querySelectorAll('input[name="division_auto_task_staffuuids[]"], input[name="division_task_staffuuids[]"]'))
      .map(input => ({ uuid: String(input.value || '').trim(), label: inputLabel(input), checked: Boolean(input.checked) }))
      .filter(item => UUID_RE.test(item.uuid) && !seen.has(item.uuid) && seen.add(item.uuid));
  }

  async function refresh(form, reason = 'refresh') {
    if (!isTaskForm(form)) return;
    const state = getState(form);
    if (!applies(form, state)) {
      render(form, []);
      return;
    }

    const key = `${taskTypeUuid(form)}|${numericTaskId()}`;
    if (state.refreshPromise && state.refreshKey === key) return state.refreshPromise;
    state.refreshKey = key;
    render(form, state.available, 'Загружаю доступные варианты…');

    state.refreshPromise = (async () => {
      try {
        const native = await loadNativeStaff(form);
        state.currentAssignment = native.rows.find(row => row.checked) || null;
        state.currentCrew = native.rows.find(row => row.checked && BRIGADE_RE.test(row.label)) || null;
        const auto = await loadAutoAssignments(form);
        const merged = [];
        const seen = new Set();
        for (const item of [state.currentAssignment, ...native.rows, ...auto].filter(Boolean)) {
          if (!UUID_RE.test(item.uuid) || seen.has(item.uuid)) continue;
          seen.add(item.uuid);
          merged.push(item);
        }
        state.available = merged;
        render(form, merged, state.currentCrew
          ? `Можно выбрать отдел или бригаду. «${state.currentCrew.label}» можно снять отдельной галочкой.`
          : `Можно выбрать отдел или бригаду. Для L1 по умолчанию — «${L1_DIVISION_LABEL}».`);
        log('info', 'l1_assignment_ready', {
          reason, taskId: numericTaskId(), currentAssignment: state.currentAssignment?.label || '',
          currentCrew: state.currentCrew?.label || '', removeCurrentCrew: state.removeCurrentCrew,
          available: merged.length + (seen.has(L1_DIVISION_UUID) ? 0 : 1)
        });
      } catch (error) {
        render(form, state.available, `Доступна «${L1_DIVISION_LABEL}». Остальные варианты сейчас не загрузились.`);
        log('warn', 'l1_assignment_load_failed', { reason, message: compact(error?.message || error, 180) });
      } finally {
        state.refreshPromise = null;
      }
    })();
    return state.refreshPromise;
  }

  async function applySelected(form, assignment, removeCurrentCrew) {
    const native = await loadNativeStaff(form);
    if (!native.form || !UUID_RE.test(native.taskUuid)) throw new Error('Не удалось открыть форму исполнителей');
    const namespace = native.form.querySelector('input[name="division_task_staffuuids[]"], input[name="division_auto_task_staffuuids[]"]')
      ? 'division_task_staffuuids[]'
      : 'division_task_staffids[]';

    const assignmentIsCrew = BRIGADE_RE.test(assignment.label || '');
    const preserved = native.rows
      .filter(row => row.checked && row.uuid !== assignment.uuid)
      .filter(row => !(BRIGADE_RE.test(row.label) && (removeCurrentCrew || assignmentIsCrew)))
      .map(row => row.uuid);
    const finalUuids = [...new Set([...preserved, assignment.uuid])];

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

    for (const uuid of finalUuids) {
      const input = native.doc.createElement('input');
      input.type = 'hidden';
      input.name = namespace;
      input.value = uuid;
      native.form.appendChild(input);
    }

    const response = await fetch('/task/staff_save', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: new FormData(native.form)
    });
    if (!response.ok) throw new Error(`Не удалось сохранить исполнителя (HTTP ${response.status})`);
    log('info', 'l1_assignment_native_saved', {
      taskUuid: native.taskUuid, assignmentUuid: assignment.uuid, assignmentLabel: assignment.label,
      removedCurrentCrew: Boolean(removeCurrentCrew), preservedCount: preserved.length, finalUuids
    });
  }

  async function onSubmit(event) {
    const form = isTaskForm(event.target) ? event.target : null;
    if (!form || event.defaultPrevented || !isEditForm()) return;
    const state = getState(form);
    if (!applies(form, state) || form.hasAttribute(BUSY_ATTR)) return;

    const assignment = UUID_RE.test(state.selectedUuid)
      ? { uuid: state.selectedUuid, label: state.selectedLabel || state.selectedUuid }
      : null;
    if (!assignment) return;
    const crewNeedsRemoval = Boolean(state.removeCurrentCrew && state.currentCrew && state.currentCrew.uuid !== assignment.uuid);
    if (state.currentAssignment?.uuid === assignment.uuid && !crewNeedsRemoval) return;

    event.preventDefault();
    event.stopPropagation();
    form.setAttribute(BUSY_ATTR, '1');
    try {
      await applySelected(form, assignment, state.removeCurrentCrew);
      state.currentAssignment = assignment;
      state.currentCrew = BRIGADE_RE.test(assignment.label || '') ? assignment : null;
      HTMLFormElement.prototype.submit.call(form);
    } catch (error) {
      log('error', 'l1_assignment_apply_failed', {
        message: compact(error?.message || error, 200), assignmentUuid: assignment.uuid, assignmentLabel: assignment.label,
        removeCurrentCrew: state.removeCurrentCrew
      });
      const host = ensureHost(form);
      host.querySelector('.wb-l1a-hint').textContent = `Исполнитель не применён: ${compact(error?.message || error, 160)}`;
    } finally {
      form.removeAttribute(BUSY_ATTR);
    }
  }

  function schedule(form, reason) {
    queueMicrotask(() => { void refresh(form, reason); });
  }

  function scan(reason = 'scan') {
    document.querySelectorAll('form').forEach(form => {
      if (isTaskForm(form)) {
        getState(form);
        schedule(form, reason);
      }
    });
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (!isTaskForm(form)) return;
    if (!event.target?.matches?.('select[name="task_type_uuid"]')) return;
    const state = getState(form);
    state.refreshKey = '';
    state.available = [];
    state.selectedUuid = L1_TYPE_UUIDS.has(taskTypeUuid(form)) ? L1_DIVISION_UUID : '';
    state.selectedLabel = L1_TYPE_UUIDS.has(taskTypeUuid(form)) ? L1_DIVISION_LABEL : '';
    state.removeCurrentCrew = L1_TYPE_UUIDS.has(taskTypeUuid(form)) && state.sourceWasFieldVisit;
    schedule(form, 'task-type-change');
  }

  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, false);
  scan('init');

  observer = new MutationObserver(records => {
    const relevant = records.some(record => Array.from(record.addedNodes || []).some(node => node instanceof Element && (node.matches?.('form') || node.querySelector?.('form'))));
    if (relevant) queueMicrotask(() => scan('form-added'));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskL1AssignmentPicker = Object.freeze({
    refresh() { scan('manual-refresh'); },
    destroy() {
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, false);
      observer?.disconnect();
      observer = null;
      document.querySelectorAll(`[${HOST_ATTR}]`).forEach(node => node.remove());
      document.querySelectorAll(`[${SYNTHETIC_ATTR}]`).forEach(node => node.closest('label')?.remove() || node.remove());
      document.getElementById(STYLE_ID)?.remove();
    }
  });
})();