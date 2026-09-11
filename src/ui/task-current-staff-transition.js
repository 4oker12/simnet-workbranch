(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskCurrentStaffTransitionLoaded) return;
  WB.__taskCurrentStaffTransitionLoaded = true;

  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const STAFF_SAVE_PATH = '/task/staff_save';
  const L1_DIVISION_UUID = '76fce89d-3304-4d26-a4cf-86dd78a9d89e';
  const L1_DIVISION_LABEL = 'Техподдержка L1';
  const BYPASS_ATTR = 'data-simnet-wb-current-staff-bypass';
  const BUSY_ATTR = 'data-simnet-wb-current-staff-busy';
  const PANEL_ATTR = 'data-simnet-wb-current-staff-transition';
  const STYLE_ID = 'simnet-wb-current-staff-transition-style';
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const L1_TYPE_UUIDS = new Set([
    'f1b8154a-abd7-4816-bb97-d323da5ca4d5', // Інше (L1)
    '7cbb1794-176a-4b27-b4dd-e01f0c31d246', // Не працює TV (L1)
    '9608872b-12f5-4053-81e3-34135dbf5998', // Не працює інтернет (L1)
    '2beda090-b314-41df-b4b8-c5cfeb5484cb', // Низька швидкість (L1)
    'a1d1f9ae-8a7e-42fd-81bd-87a2e528bab9', // Пропадає інтернет (L1)
    'e95f5f84-f81e-4df4-a634-c7d1d16ff409'  // Реєстрація звернення (вирішено)
  ]);

  const FIELD_VISIT_UUIDS = new Set([
    '1b34ce66-cd14-4893-a2ec-59c19bcf16dc', // Подкл. ЖК
    '3496276b-010a-46ed-a2c5-534c32e8f9e2', // Ремонт
    '378b0972-13b7-4df5-94f0-98ce6a37e9c0', // Подкл. Частный сектор
    'c15aa787-6989-425a-88db-67b902c4ed2c', // Gig переключение
    '759de9b3-3b42-4afd-a37f-d3d7f4ea5b55', // Доподключение
    '947410ef-e06a-4e15-8107-cfd2b648b235', // Подкл. Льготное
    'd283b923-d58b-48d8-b31f-e440f32858ca', // PON переключение
    'f04549e5-5ae3-406b-84f2-069c52ad88e8', // Подключение СРОЧНОЕ
    '1ff17c41-e4a2-4938-b68d-d9576aac8066', // Перегляд В2С
    '0a7c59e7-a6de-44a3-977f-d90c84e87e5f', // 2,5 Гбіт/с
    'c8dd5618-41ea-457d-a23d-dd018d21e77f', // Підключення бізнес
    'd5051f38-a8c6-47ab-a6d6-414a8a7acf0a', // Перегляд бізнес
    '614fef14-b1a1-419c-b336-21fc723dd406', // Ремонт бізнес
    'cc56250e-7c49-4012-a023-f693ee9ace9c'  // Тендер підключення
  ]);

  const stateByForm = new WeakMap();
  const observerByForm = new WeakMap();
  const activeObservers = new Set();
  let documentObserver = null;
  let destroyed = false;
  let pageSourceSeed = null;

  const compact = (value, max = 220) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function taskLog(level, event, details = null) {
    try {
      const method = WB.log?.[level];
      if (typeof method === 'function') return method.call(WB.log, 'TASK_FLOW', event, details || {});
    } catch {}
    try {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
      fn(`[SIMNET WB][TASK_FLOW] ${event}`, details || {});
    } catch {}
    return null;
  }

  function actionPath(form) {
    try { return new URL(String(form?.action || ''), location.href).pathname; }
    catch { return ''; }
  }

  function isCurrentTaskForm(form) {
    return form instanceof HTMLFormElement
      && FORM_ACTION_RE.test(actionPath(form))
      && Boolean(form.querySelector('select[name="task_type_uuid"], input[name="task_type_uuid"]'));
  }

  function taskType(form) {
    const select = form.querySelector('select[name="task_type_uuid"]');
    const input = form.querySelector('input[name="task_type_uuid"]');
    const uuid = String(select?.value || input?.value || '').trim();
    const label = compact(select?.selectedOptions?.[0]?.textContent || '', 140);
    return { uuid, label };
  }

  function taskNumericId(form) {
    const pathMatch = String(location.pathname || '').match(/^\/task\/(\d+)\/dialog_edit\/?$/i);
    if (pathMatch) return pathMatch[1];
    const cancel = form.querySelector('a[href^="/task/"]');
    const href = String(cancel?.getAttribute('href') || '');
    const hrefMatch = href.match(/^\/task\/(\d+)(?:\/|$)/i);
    return hrefMatch ? hrefMatch[1] : '';
  }

  function taskUuidFromStaffLink(root) {
    if (!root?.querySelectorAll) return '';
    for (const link of Array.from(root.querySelectorAll('a[href*="/dialog_change_staff"]'))) {
      const href = String(link.getAttribute('href') || '').trim();
      let pathname = '';
      try { pathname = new URL(href, location.href).pathname; } catch { continue; }
      const match = pathname.match(/^\/task\/([0-9a-f-]{36})\/dialog_change_staff\/?$/i);
      if (match && UUID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  function taskUuidFromNode(root) {
    if (!root?.querySelector) return '';
    const direct = String(
      root.querySelector('input[name="uuid"], input#taskId, [data-task-uuid]')?.value
      || root.querySelector('[data-task-uuid]')?.getAttribute?.('data-task-uuid')
      || ''
    ).trim();
    if (UUID_RE.test(direct)) return direct;
    return taskUuidFromStaffLink(root);
  }

  async function resolveTaskUuid(form, taskId) {
    const formUuid = taskUuidFromNode(form);
    if (formUuid) {
      taskLog('info', 'native_staff_task_uuid_resolved', { taskId, taskUuid: formUuid, source: 'edit-form' });
      return formUuid;
    }

    const documentUuid = taskUuidFromNode(document);
    if (documentUuid) {
      taskLog('info', 'native_staff_task_uuid_resolved', { taskId, taskUuid: documentUuid, source: 'document' });
      return documentUuid;
    }

    if (!/^\d+$/.test(taskId)) throw new Error('Не удалось определить номер редактируемой заявки');
    const taskUrl = new URL(`/task/${encodeURIComponent(taskId)}`, location.origin);
    const response = await fetch(taskUrl.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Не удалось определить UUID заявки (HTTP ${response.status})`);

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let taskUuid = taskUuidFromNode(doc);
    if (!taskUuid) {
      for (const node of Array.from(doc.querySelectorAll('[href],[action]'))) {
        const raw = String(node.getAttribute('href') || node.getAttribute('action') || '');
        const match = raw.match(/\/task\/([0-9a-f-]{36})(?:\/|\?|$)/i);
        if (match && UUID_RE.test(match[1])) {
          taskUuid = match[1];
          break;
        }
      }
    }
    if (!taskUuid) throw new Error('UserSide не отдал UUID заявки для формы исполнителей');

    taskLog('info', 'native_staff_task_uuid_resolved', { taskId, taskUuid, source: 'task-card' });
    return taskUuid;
  }

  function parseDummyDivisionUuids(form) {
    const text = String(form.querySelector('#dummy_pers_id')?.value || '');
    const values = [];
    const re = /\*division_([^*]+)\*/g;
    let match;
    while ((match = re.exec(text))) {
      const value = String(match[1] || '').trim();
      if (UUID_RE.test(value)) values.push(value);
    }
    return Array.from(new Set(values));
  }

  function staffUuidInputs(form) {
    return Array.from(form.querySelectorAll([
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name="division_task_staffuuids[]"]',
      'input[name^="division_auto_task_staffuuids"]',
      'input[name^="division_task_staffuuids"]'
    ].join(','))).filter(input => input instanceof HTMLInputElement);
  }

  function inputLabel(input) {
    return compact(
      input?.closest?.('.div_space2, label, .erp-object-props__value, .item')?.textContent
      || input?.parentElement?.textContent
      || '',
      180
    );
  }

  function checkedDivisionUuids(form) {
    return Array.from(new Set(staffUuidInputs(form)
      .filter(input => input.checked && !input.disabled)
      .map(input => String(input.value || '').trim())
      .filter(value => UUID_RE.test(value))));
  }

  function selectedCrewUuids(form) {
    return Array.from(new Set(staffUuidInputs(form)
      .filter(input => input.checked && !input.disabled && BRIGADE_RE.test(inputLabel(input)))
      .map(input => String(input.value || '').trim())
      .filter(value => UUID_RE.test(value))));
  }

  function selectedCrewLabels(form) {
    return staffUuidInputs(form)
      .filter(input => input.checked && !input.disabled && BRIGADE_RE.test(inputLabel(input)))
      .map(input => compact(inputLabel(input), 120))
      .filter(Boolean)
      .slice(0, 8);
  }

  function baselineHasL1(form) {
    if (parseDummyDivisionUuids(form).includes(L1_DIVISION_UUID)) return true;
    const performers = Array.from(form.querySelectorAll('.erp-object-props__value, .item, .table_block'));
    return performers.some(node => /техподдержка\s*l1/iu.test(compact(node.textContent || '', 600)));
  }

  function sourceSeedFromForm(form) {
    const type = taskType(form);
    return {
      sourceTypeUuid: type.uuid,
      sourceTypeLabel: type.label,
      sourceWasL1: L1_TYPE_UUIDS.has(type.uuid),
      sourceHadL1Division: baselineHasL1(form),
      taskId: taskNumericId(form)
    };
  }

  function rememberPageSource(form) {
    if (pageSourceSeed || !isCurrentTaskForm(form)) return pageSourceSeed;
    pageSourceSeed = sourceSeedFromForm(form);
    taskLog('info', 'staff_source_captured', pageSourceSeed);
    return pageSourceSeed;
  }

  function ensureState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    const live = sourceSeedFromForm(form);
    const seed = rememberPageSource(form) || live;
    state = {
      sourceTypeUuid: seed.sourceTypeUuid,
      sourceTypeLabel: seed.sourceTypeLabel,
      sourceWasL1: Boolean(seed.sourceWasL1),
      sourceHadL1Division: Boolean(seed.sourceHadL1Division),
      l1Removed: false,
      lastTypeUuid: live.sourceTypeUuid,
      lastDecisionSignature: '',
      taskId: live.taskId || seed.taskId || ''
    };
    stateByForm.set(form, state);
    return state;
  }

  function transitionApplies(form, state = ensureState(form)) {
    const type = taskType(form);
    return Boolean(
      state.sourceWasL1
      && state.sourceHadL1Division
      && FIELD_VISIT_UUIDS.has(type.uuid)
      && type.uuid !== state.sourceTypeUuid
    );
  }

  function decisionSnapshot(form, state = ensureState(form)) {
    const type = taskType(form);
    const inputs = staffUuidInputs(form);
    const crews = selectedCrewUuids(form);
    return {
      taskId: taskNumericId(form) || state.taskId || '',
      sourceTypeUuid: state.sourceTypeUuid,
      sourceWasL1: state.sourceWasL1,
      sourceHadL1Division: state.sourceHadL1Division,
      currentTypeUuid: type.uuid,
      currentTypeLabel: type.label,
      fieldVisit: FIELD_VISIT_UUIDS.has(type.uuid),
      transitionApplies: transitionApplies(form, state),
      l1Removed: state.l1Removed,
      staffInputCount: inputs.length,
      checkedDivisionUuids: checkedDivisionUuids(form),
      crewUuids: crews,
      crewLabels: selectedCrewLabels(form)
    };
  }

  function logDecisionIfChanged(form, state, reason) {
    const snapshot = decisionSnapshot(form, state);
    const signature = JSON.stringify({
      currentTypeUuid: snapshot.currentTypeUuid,
      transitionApplies: snapshot.transitionApplies,
      l1Removed: snapshot.l1Removed,
      staffInputCount: snapshot.staffInputCount,
      checkedDivisionUuids: snapshot.checkedDivisionUuids,
      crewUuids: snapshot.crewUuids
    });
    if (signature === state.lastDecisionSignature) return snapshot;
    state.lastDecisionSignature = signature;
    taskLog('info', 'staff_transition_state', { reason, ...snapshot });
    return snapshot;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${PANEL_ATTR}]{box-sizing:border-box;max-width:640px;margin:7px 0 9px;padding:8px 10px;border:1px solid #cbd6df;border-radius:3px;background:#f7f9fb;color:#40505e;font:12px/1.35 Arial,sans-serif}
      [${PANEL_ATTR}][hidden]{display:none!important}
      [${PANEL_ATTR}] .wb-cst-title{font-weight:700;color:#3f607a;margin-bottom:5px}
      [${PANEL_ATTR}] .wb-cst-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:4px 0}
      [${PANEL_ATTR}] .wb-cst-assignment{display:inline-flex;align-items:center;gap:5px;padding:2px 6px;border:1px solid #cbd6df;border-radius:3px;background:#fff;color:#465764}
      [${PANEL_ATTR}] .wb-cst-assignment[data-removed="1"]{opacity:.55;text-decoration:line-through}
      [${PANEL_ATTR}] button{cursor:pointer;border:1px solid #aebdca;border-radius:3px;background:#fff;color:#35566f;padding:3px 8px;font:600 11px/1.2 Arial,sans-serif}
      [${PANEL_ATTR}] button:hover{background:#eef4f8;border-color:#93a8b8}
      [${PANEL_ATTR}] .wb-cst-status{font-weight:600}
      [${PANEL_ATTR}] .wb-cst-ok{color:#4d6b55}.wb-cst-bad{color:#8a5c2c}
      [${PANEL_ATTR}] .wb-cst-note{margin-top:5px;color:#65737e}
      [data-simnet-wb-current-staff-error="1"]{position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);width:min(650px,calc(100vw - 36px));box-sizing:border-box;padding:10px 13px;border:1px solid #c6d2dc;border-left:4px solid #c18b3b;border-radius:3px;background:#fff;color:#40505e;box-shadow:0 6px 18px rgba(40,55,70,.18);font:12px/1.4 Arial,sans-serif}
      [data-simnet-wb-current-staff-error="1"] b{color:#6b552d}
      [data-simnet-wb-current-staff-error="1"] ul{margin:5px 0 0;padding-left:18px}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function performerAnchor(form) {
    const dummy = form.querySelector('#dummy_pers_id');
    if (dummy) {
      const block = dummy.closest('.erp-object-props, .table_block, .erp-object-props__row');
      if (block) return block;
    }
    const employee = form.querySelector('#employee');
    if (employee?.nextElementSibling) return employee.nextElementSibling;
    return form.querySelector('.erp_form_actions, .div_center') || form;
  }

  function ensurePanel(form) {
    ensureStyles();
    let panel = form.querySelector(`[${PANEL_ATTR}]`);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.setAttribute(PANEL_ATTR, '1');
    panel.dataset.simnetWbOwned = '1';
    panel.innerHTML = `
      <div class="wb-cst-title">Переоформление L1 → выездная заявка</div>
      <div class="wb-cst-row">
        <span class="wb-cst-assignment" data-wb-cst-l1-chip="1">${L1_DIVISION_LABEL}</span>
        <button type="button" data-wb-cst-remove-l1="1">Открепить L1</button>
      </div>
      <div class="wb-cst-row wb-cst-status" data-wb-cst-crew-status="1"></div>
      <div class="wb-cst-note">Перед сохранением: открепи L1 и выбери выездную бригаду «Бр. …».</div>`;
    const anchor = performerAnchor(form);
    if (anchor?.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else form.appendChild(panel);
    panel.querySelector('[data-wb-cst-remove-l1="1"]')?.addEventListener('click', () => {
      const state = ensureState(form);
      state.l1Removed = !state.l1Removed;
      taskLog('info', 'l1_detach_toggled', {
        taskId: taskNumericId(form) || state.taskId || '',
        detached: state.l1Removed,
        currentTypeUuid: taskType(form).uuid
      });
      render(form, 'l1-toggle');
    });
    return panel;
  }

  function render(form, reason = 'render') {
    if (!isCurrentTaskForm(form)) return;
    const state = ensureState(form);
    const panel = ensurePanel(form);
    const applies = transitionApplies(form, state);
    panel.hidden = !applies;
    if (!applies) {
      state.l1Removed = false;
      logDecisionIfChanged(form, state, reason);
      return;
    }

    const chip = panel.querySelector('[data-wb-cst-l1-chip="1"]');
    const button = panel.querySelector('[data-wb-cst-remove-l1="1"]');
    const crewStatus = panel.querySelector('[data-wb-cst-crew-status="1"]');
    if (chip) chip.dataset.removed = state.l1Removed ? '1' : '0';
    if (button) button.textContent = state.l1Removed ? 'Вернуть L1' : 'Открепить L1';

    const crews = selectedCrewUuids(form);
    if (crewStatus) {
      crewStatus.className = `wb-cst-row wb-cst-status ${crews.length ? 'wb-cst-ok' : 'wb-cst-bad'}`;
      crewStatus.textContent = crews.length
        ? `Бригада выбрана: ${selectedCrewLabels(form).join(', ') || crews.length}`
        : 'Бригада ещё не выбрана';
    }
    logDecisionIfChanged(form, state, reason);
  }

  function showBlockingMessage(form, messages) {
    ensureStyles();
    let box = document.querySelector('[data-simnet-wb-current-staff-error="1"]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.simnetWbCurrentStaffError = '1';
      box.dataset.simnetWbOwned = '1';
      (document.body || document.documentElement).appendChild(box);
    }
    box.innerHTML = '';
    const title = document.createElement('b');
    title.textContent = 'Заявка не сохранена — проверь исполнителей';
    const list = document.createElement('ul');
    messages.forEach(message => {
      const li = document.createElement('li');
      li.textContent = message;
      list.appendChild(li);
    });
    box.append(title, list);
    window.setTimeout(() => box.remove(), 7000);
  }

  function finalDivisionUuids(form, state) {
    const values = new Set([
      ...parseDummyDivisionUuids(form),
      ...checkedDivisionUuids(form)
    ]);
    if (state.l1Removed) values.delete(L1_DIVISION_UUID);
    return Array.from(values).filter(value => UUID_RE.test(value));
  }

  function sameOriginTaskUrl(raw, expectedPath) {
    const url = new URL(String(raw || expectedPath || ''), location.href);
    if (url.origin !== location.origin || url.pathname !== expectedPath) {
      throw new Error(`Неожиданный адрес UserSide: ${url.pathname}`);
    }
    return url;
  }

  function setDialogHidden(form, name, value, doc) {
    let input = form.querySelector(`input[name="${CSS.escape(name)}"]`);
    if (!input) {
      input = doc.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = String(value || '');
    return input;
  }

  function dialogStaffNamespace(dialogForm) {
    if (dialogForm.querySelector('input[name="division_task_staffuuids[]"], input[name="division_auto_task_staffuuids[]"]')) {
      return 'division_task_staffuuids[]';
    }
    if (dialogForm.querySelector('input[name="division_task_staffids[]"], input[name="division_auto_task_staffids[]"]')) {
      return 'division_task_staffids[]';
    }
    return 'division_task_staffuuids[]';
  }

  async function applyStaffViaNativeDialog(form, divisionUuids) {
    const taskId = taskNumericId(form);
    if (!/^\d+$/.test(taskId)) throw new Error('Не удалось определить номер редактируемой заявки');

    const taskUuid = await resolveTaskUuid(form, taskId);
    const dialogPath = `/task/${taskUuid}/dialog_change_staff`;
    taskLog('info', 'native_staff_dialog_load_start', { taskId, taskUuid, divisionUuids, dialogPath });
    const dialogUrl = sameOriginTaskUrl(dialogPath, dialogPath);
    const response = await fetch(dialogUrl.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Не удалось открыть форму исполнителей (HTTP ${response.status})`);

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dialogForm = doc.querySelector('form[action="/task/staff_save"], form[action*="/task/staff_save"]');
    if (!dialogForm) throw new Error('UserSide не вернул форму исполнителей');

    const action = sameOriginTaskUrl(dialogForm.getAttribute('action') || STAFF_SAVE_PATH, STAFF_SAVE_PATH);
    const returnedTaskUuid = String(dialogForm.querySelector('input[name="uuid"]')?.value || '').trim();
    if (returnedTaskUuid && UUID_RE.test(returnedTaskUuid) && returnedTaskUuid !== taskUuid) {
      throw new Error('UserSide вернул форму исполнителей другой заявки');
    }
    setDialogHidden(dialogForm, 'uuid', taskUuid, doc);

    const namespace = dialogStaffNamespace(dialogForm);
    taskLog('info', 'native_staff_dialog_loaded', {
      taskId,
      taskUuid,
      namespace,
      originalInputCount: dialogForm.querySelectorAll('input[name*="staffuuid"], input[name*="staffid"]').length
    });

    dialogForm.querySelectorAll([
      'input[name="division_task_staffuuids[]"]',
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name="division_task_staffids[]"]',
      'input[name="division_auto_task_staffids[]"]'
    ].join(',')).forEach(input => input.remove());

    divisionUuids.forEach(divisionUuid => {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = namespace;
      input.value = divisionUuid;
      dialogForm.appendChild(input);
    });

    taskLog('info', 'native_staff_payload_prepared', {
      taskId,
      taskUuid,
      namespace,
      divisionUuids,
      containsL1: divisionUuids.includes(L1_DIVISION_UUID)
    });

    const saveResponse = await fetch(action.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: new FormData(dialogForm)
    });
    if (!saveResponse.ok) throw new Error(`Не удалось сохранить исполнителей (HTTP ${saveResponse.status})`);

    const saveText = await saveResponse.text();
    if (/erp_empty_state[^>]*>\s*Необходимо выбрать|необходимо\s+выбрать/iu.test(saveText)) {
      throw new Error('UserSide не принял выбранную бригаду');
    }
    taskLog('info', 'native_staff_save_success', { taskId, taskUuid, namespace, divisionUuids, status: saveResponse.status });
    return { ok: true, taskId, taskUuid, namespace, divisionUuids };
  }

  function syncMainFormStaff(form, divisionUuids) {
    const selected = new Set(divisionUuids);
    staffUuidInputs(form).forEach(input => {
      const value = String(input.value || '').trim();
      if (!value) return;
      const type = String(input.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') input.checked = selected.has(value);
    });
    const dummy = form.querySelector('#dummy_pers_id');
    if (dummy) {
      const preferred = divisionUuids.find(uuid => uuid !== L1_DIVISION_UUID) || divisionUuids[0] || '';
      dummy.value = preferred ? `*division_${preferred}*` : '';
    }
  }

  function resumeNativeSubmit(form, submitter) {
    const state = ensureState(form);
    taskLog('info', 'native_task_submit_resume', decisionSnapshot(form, state));
    form.setAttribute(BYPASS_ATTR, '1');
    try {
      if (typeof form.requestSubmit === 'function') {
        if (submitter && submitter.form === form && String(submitter.type || '').toLowerCase() === 'submit') form.requestSubmit(submitter);
        else form.requestSubmit();
      } else {
        HTMLFormElement.prototype.submit.call(form);
      }
    } finally {
      queueMicrotask(() => form.removeAttribute(BYPASS_ATTR));
    }
  }

  async function onSubmit(event) {
    if (destroyed) return;
    const form = isCurrentTaskForm(event.target) ? event.target : null;
    if (!form || form.hasAttribute(BYPASS_ATTR)) return;
    const state = ensureState(form);

    // task-current-contract-guard runs before this module. If it blocked the
    // save (date/time/crew/special-info modal), this staff layer must not race it.
    if (event.defaultPrevented) {
      taskLog('info', 'staff_transition_skipped_prior_guard', decisionSnapshot(form, state));
      return;
    }
    if (!transitionApplies(form, state)) return;

    const crews = selectedCrewUuids(form);
    taskLog('info', 'staff_save_preflight', decisionSnapshot(form, state));
    const messages = [];
    if (!state.l1Removed) messages.push('Открепи «Техподдержка L1» — выездная заявка не должна оставаться на L1.');
    if (!crews.length) messages.push('Выбери выездную бригаду «Бр. …».');
    if (messages.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      taskLog('warn', 'staff_save_blocked', {
        ...decisionSnapshot(form, state),
        reasons: [
          ...(!state.l1Removed ? ['l1-still-attached'] : []),
          ...(!crews.length ? ['crew-not-selected'] : [])
        ]
      });
      showBlockingMessage(form, messages);
      render(form, 'save-blocked');
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.hasAttribute(BUSY_ATTR)) {
      taskLog('warn', 'staff_save_duplicate_ignored', decisionSnapshot(form, state));
      return;
    }
    form.setAttribute(BUSY_ATTR, '1');
    try {
      const divisionUuids = finalDivisionUuids(form, state);
      if (divisionUuids.includes(L1_DIVISION_UUID)) throw new Error('L1 остался в итоговом составе исполнителей');
      taskLog('info', 'staff_save_apply_start', { ...decisionSnapshot(form, state), divisionUuids });
      await applyStaffViaNativeDialog(form, divisionUuids);
      syncMainFormStaff(form, divisionUuids);
      taskLog('info', 'staff_save_apply_complete', { ...decisionSnapshot(form, state), divisionUuids });
      resumeNativeSubmit(form, event.submitter || null);
    } catch (error) {
      taskLog('error', 'staff_transition_failure', {
        ...decisionSnapshot(form, state),
        message: compact(error?.message || error, 220)
      });
      console.error('[SIMNET WB][TASK STAFF UUID] transition save failed', error);
      showBlockingMessage(form, [`Не удалось применить исполнителей: ${compact(error?.message || error, 180)}`]);
    } finally {
      form.removeAttribute(BUSY_ATTR);
    }
  }

  function enhance(form) {
    if (!isCurrentTaskForm(form)) return false;
    rememberPageSource(form);
    const state = ensureState(form);
    render(form, 'enhance');
    if (!observerByForm.has(form)) {
      let queued = false;
      const observer = new MutationObserver(records => {
        if (queued || destroyed) return;
        const external = records.some(record => !(record.target instanceof Element) || !record.target.closest?.(`[${PANEL_ATTR}]`));
        if (!external) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!destroyed && form.isConnected) render(form, 'form-mutation');
        });
      });
      observer.observe(form, { childList: true, subtree: true });
      observerByForm.set(form, observer);
      activeObservers.add(observer);
      taskLog('info', 'staff_form_observer_attached', {
        taskId: taskNumericId(form) || state.taskId || '',
        sourceTypeUuid: state.sourceTypeUuid
      });
    }
    return true;
  }

  function formFromTarget(target) {
    const form = target?.closest?.('form');
    return isCurrentTaskForm(form) ? form : null;
  }

  function onChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    const form = formFromTarget(target);
    if (!form) return;
    const state = ensureState(form);
    if (target.matches?.('select[name="task_type_uuid"]')) {
      const previous = state.lastTypeUuid;
      const current = taskType(form);
      if (L1_TYPE_UUIDS.has(current.uuid)) state.l1Removed = false;
      state.lastTypeUuid = current.uuid;
      taskLog('info', 'task_type_changed', {
        taskId: taskNumericId(form) || state.taskId || '',
        fromTypeUuid: previous,
        toTypeUuid: current.uuid,
        toTypeLabel: current.label,
        sourceWasL1: state.sourceWasL1,
        sourceHadL1Division: state.sourceHadL1Division,
        fieldVisit: FIELD_VISIT_UUIDS.has(current.uuid)
      });
    } else if (target.matches?.('input[name^="division_auto_task_staffuuid"], input[name^="division_task_staffuuid"]')) {
      taskLog('info', 'crew_selection_changed', decisionSnapshot(form, state));
    }
    render(form, 'input-change');
  }

  function onFocusIn(event) {
    const form = formFromTarget(event.target instanceof Element ? event.target : null);
    if (form) enhance(form);
  }

  function enhanceAllCurrentForms(reason = 'scan') {
    let count = 0;
    document.querySelectorAll('form').forEach(form => {
      if (isCurrentTaskForm(form) && enhance(form)) count += 1;
    });
    if (count) taskLog('info', 'staff_forms_discovered', { reason, count });
  }

  function init() {
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onChange, true);
    document.addEventListener('focusin', onFocusIn, true);
    enhanceAllCurrentForms('init');

    documentObserver = new MutationObserver(records => {
      if (destroyed) return;
      const mightContainForm = records.some(record => Array.from(record.addedNodes || []).some(node => (
        node instanceof Element
        && (node.matches?.('form') || node.querySelector?.('form'))
      )));
      if (!mightContainForm) return;
      queueMicrotask(() => enhanceAllCurrentForms('document-form-replaced'));
    });
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function destroy() {
    destroyed = true;
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('input', onChange, true);
    document.removeEventListener('focusin', onFocusIn, true);
    documentObserver?.disconnect();
    documentObserver = null;
    activeObservers.forEach(observer => observer.disconnect());
    activeObservers.clear();
    document.querySelectorAll(`[${PANEL_ATTR}], [data-simnet-wb-current-staff-error="1"]`).forEach(node => node.remove());
    document.getElementById(STYLE_ID)?.remove();
    taskLog('info', 'staff_transition_destroyed', {});
  }

  WB.taskCurrentStaffTransition = Object.freeze({
    destroy,
    refresh() {
      enhanceAllCurrentForms('manual-refresh');
    },
    debugSnapshot(form = null) {
      const target = isCurrentTaskForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isCurrentTaskForm) || null;
      if (!target) return null;
      return decisionSnapshot(target, ensureState(target));
    }
  });

  init();
})();