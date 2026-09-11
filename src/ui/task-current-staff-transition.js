(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskCurrentStaffTransitionLoaded) return;
  WB.__taskCurrentStaffTransitionLoaded = true;

  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const STAFF_DIALOG_PATH = '/task/dialog_change_staff';
  const STAFF_SAVE_PATH = '/task/staff_save';
  const L1_DIVISION_UUID = '76fce89d-3304-4d26-a4cf-86dd78a9d89e';
  const L1_DIVISION_LABEL = 'Техподдержка L1';
  const BYPASS_ATTR = 'data-simnet-wb-current-staff-bypass';
  const BUSY_ATTR = 'data-simnet-wb-current-staff-busy';
  const PANEL_ATTR = 'data-simnet-wb-current-staff-transition';
  const STYLE_ID = 'simnet-wb-current-staff-transition-style';
  const BRIGADE_RE = /^\s*бр\.\s*/iu;
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
  let destroyed = false;

  const compact = (value, max = 220) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

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

  function baselineHasL1(form) {
    if (parseDummyDivisionUuids(form).includes(L1_DIVISION_UUID)) return true;
    const performers = Array.from(form.querySelectorAll('.erp-object-props__value, .item, .table_block'));
    return performers.some(node => /техподдержка\s*l1/iu.test(compact(node.textContent || '', 600)));
  }

  function ensureState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    const type = taskType(form);
    state = {
      sourceTypeUuid: type.uuid,
      sourceWasL1: L1_TYPE_UUIDS.has(type.uuid),
      sourceHadL1Division: baselineHasL1(form),
      l1Removed: false,
      lastTypeUuid: type.uuid
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

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${PANEL_ATTR}]{box-sizing:border-box;max-width:640px;margin:8px 0 10px;padding:9px 11px;border:1px solid #dcc8d1;border-left:5px solid #a50046;border-radius:8px;background:#fff8fb;color:#3e1d2b;font:12px/1.4 Arial,sans-serif}
      [${PANEL_ATTR}][hidden]{display:none!important}
      [${PANEL_ATTR}] .wb-cst-title{font-weight:800;color:#8f1746;margin-bottom:5px}
      [${PANEL_ATTR}] .wb-cst-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0}
      [${PANEL_ATTR}] .wb-cst-assignment{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid #d7c6cd;border-radius:999px;background:#fff}
      [${PANEL_ATTR}] .wb-cst-assignment[data-removed="1"]{opacity:.55;text-decoration:line-through}
      [${PANEL_ATTR}] button{cursor:pointer;border:1px solid #b99daa;border-radius:6px;background:#fff;color:#6f173a;padding:3px 7px;font:700 11px/1.2 Arial,sans-serif}
      [${PANEL_ATTR}] button:hover{background:#f7edf1}
      [${PANEL_ATTR}] .wb-cst-status{font-weight:700}
      [${PANEL_ATTR}] .wb-cst-ok{color:#256b36}.wb-cst-bad{color:#9b173f}
      [${PANEL_ATTR}] .wb-cst-note{margin-top:5px;color:#6d5260}
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
      render(form);
    });
    return panel;
  }

  function render(form) {
    if (!isCurrentTaskForm(form)) return;
    const state = ensureState(form);
    const panel = ensurePanel(form);
    const applies = transitionApplies(form, state);
    panel.hidden = !applies;
    if (!applies) {
      state.l1Removed = false;
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
        ? `Бригада выбрана: ${crews.length}`
        : 'Бригада ещё не выбрана';
    }
  }

  function showBlockingMessage(form, messages) {
    let box = form.querySelector('[data-simnet-wb-current-staff-error="1"]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.simnetWbCurrentStaffError = '1';
      box.dataset.simnetWbOwned = '1';
      box.style.cssText = 'position:fixed;z-index:2147483647;top:18px;left:50%;transform:translateX(-50%);width:min(650px,calc(100vw - 36px));box-sizing:border-box;padding:12px 16px;border:1px solid #a50046;border-left:6px solid #a50046;border-radius:10px;background:#fff;color:#351522;box-shadow:0 12px 34px rgba(45,0,18,.24);font:13px/1.4 Arial,sans-serif';
      (document.body || document.documentElement).appendChild(box);
    }
    box.innerHTML = '';
    const title = document.createElement('b');
    title.textContent = 'Заявка не сохранена — проверь исполнителей';
    const list = document.createElement('ul');
    list.style.margin = '6px 0 0';
    list.style.paddingLeft = '20px';
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

    const dialogUrl = sameOriginTaskUrl(`${STAFF_DIALOG_PATH}?id=${encodeURIComponent(taskId)}`, STAFF_DIALOG_PATH);
    const response = await fetch(dialogUrl.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Не удалось открыть форму исполнителей (HTTP ${response.status})`);

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dialogForm = doc.querySelector('form[action*="/task/staff_save"]') || doc.querySelector('form');
    if (!dialogForm) throw new Error('UserSide не вернул форму исполнителей');

    const action = sameOriginTaskUrl(dialogForm.getAttribute('action') || STAFF_SAVE_PATH, STAFF_SAVE_PATH);
    const namespace = dialogStaffNamespace(dialogForm);
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

    const preferred = divisionUuids.find(uuid => uuid !== L1_DIVISION_UUID) || divisionUuids[0] || '';
    setDialogHidden(dialogForm, 'dummy_pers_id', preferred ? `*division_${preferred}*` : '', doc);

    const saveResponse = await fetch(action.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: new FormData(dialogForm)
    });
    if (!saveResponse.ok) throw new Error(`Не удалось сохранить исполнителей (HTTP ${saveResponse.status})`);
    return { ok: true, taskId, namespace, divisionUuids };
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
    if (!transitionApplies(form, state)) return;

    const messages = [];
    const crews = selectedCrewUuids(form);
    if (!state.l1Removed) messages.push('Открепи «Техподдержка L1» — выездная заявка не должна оставаться на L1.');
    if (!crews.length) messages.push('Выбери выездную бригаду «Бр. …».');
    if (messages.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showBlockingMessage(form, messages);
      render(form);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.hasAttribute(BUSY_ATTR)) return;
    form.setAttribute(BUSY_ATTR, '1');
    try {
      const divisionUuids = finalDivisionUuids(form, state);
      if (divisionUuids.includes(L1_DIVISION_UUID)) throw new Error('L1 остался в итоговом составе исполнителей');
      await applyStaffViaNativeDialog(form, divisionUuids);
      syncMainFormStaff(form, divisionUuids);
      resumeNativeSubmit(form, event.submitter || null);
    } catch (error) {
      console.error('[SIMNET WB][TASK STAFF UUID] transition save failed', error);
      showBlockingMessage(form, [`Не удалось применить исполнителей: ${compact(error?.message || error, 180)}`]);
    } finally {
      form.removeAttribute(BUSY_ATTR);
    }
  }

  function enhance(form) {
    if (!isCurrentTaskForm(form)) return false;
    ensureState(form);
    render(form);
    if (!observerByForm.has(form)) {
      let queued = false;
      const observer = new MutationObserver(records => {
        if (queued || destroyed) return;
        const external = records.some(record => !(record.target instanceof Element) || !record.target.closest?.(`[${PANEL_ATTR}]`));
        if (!external) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!destroyed && form.isConnected) render(form);
        });
      });
      observer.observe(form, { childList: true, subtree: true });
      observerByForm.set(form, observer);
      activeObservers.add(observer);
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
      const current = taskType(form);
      if (L1_TYPE_UUIDS.has(current.uuid)) state.l1Removed = false;
      state.lastTypeUuid = current.uuid;
    }
    render(form);
  }

  function init() {
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onChange, true);
    document.addEventListener('focusin', event => {
      const form = formFromTarget(event.target instanceof Element ? event.target : null);
      if (form) enhance(form);
    }, true);
    document.querySelectorAll('form').forEach(form => { if (isCurrentTaskForm(form)) enhance(form); });
  }

  function destroy() {
    destroyed = true;
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('input', onChange, true);
    activeObservers.forEach(observer => observer.disconnect());
    activeObservers.clear();
    document.querySelectorAll(`[${PANEL_ATTR}], [data-simnet-wb-current-staff-error="1"]`).forEach(node => node.remove());
    document.getElementById(STYLE_ID)?.remove();
  }

  WB.taskCurrentStaffTransition = Object.freeze({
    destroy,
    refresh() {
      document.querySelectorAll('form').forEach(form => { if (isCurrentTaskForm(form)) enhance(form); });
    }
  });

  init();
})();