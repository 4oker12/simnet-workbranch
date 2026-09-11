(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskCurrentContractGuardLoaded) return;
  WB.__taskCurrentContractGuardLoaded = true;

  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const FIELD_MIN_LEAD_MS = 3 * 60 * 60 * 1000;
  const PAST_GRACE_MS = 60 * 1000;
  const VALIDATION_HOST_ID = 'simnet-wb-current-task-validation';
  const MODAL_HOST_ID = 'simnet-wb-current-task-special-info';
  const STYLE_ID = 'simnet-wb-current-task-guard-style';
  const AUDIT_KEY = 'simnet_crm_constraint_ack_v1';
  const AUDIT_SCHEMA = 'simnet-crm-constraint-ack-v1';
  const MAX_AUDIT = 500;
  const APPROVAL_TTL_MS = 2 * 60 * 1000;

  // Current UserSide UUID contract recovered from live forms/endpoint recordings.
  // Structural fallback below keeps the guard working for field types not yet mapped explicitly.
  const FIELD_VISIT_UUIDS = new Set([
    // B2C
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
    // B2B field work visible in the current task type catalog
    'c8dd5618-41ea-457d-a23d-dd018d21e77f', // Підключення бізнес
    'd5051f38-a8c6-47ab-a6d6-414a8a7acf0a', // Перегляд бізнес
    '614fef14-b1a1-419c-b336-21fc723dd406', // Ремонт бізнес
    'cc56250e-7c49-4012-a023-f693ee9ace9c'  // Тендер підключення
  ]);

  const TYPE_LABELS = Object.freeze({
    '1b34ce66-cd14-4893-a2ec-59c19bcf16dc': 'B2C - Подкл. ЖК',
    '3496276b-010a-46ed-a2c5-534c32e8f9e2': 'B2C - Ремонт',
    '378b0972-13b7-4df5-94f0-98ce6a37e9c0': 'B2C - Подкл. Частный сектор',
    'c15aa787-6989-425a-88db-67b902c4ed2c': 'B2C - Gig переключение',
    '759de9b3-3b42-4afd-a37f-d3d7f4ea5b55': 'B2C - Доподключение',
    '947410ef-e06a-4e15-8107-cfd2b648b235': 'B2C - Подкл. Льготное',
    'd283b923-d58b-48d8-b31f-e440f32858ca': 'B2C - PON переключение',
    'f04549e5-5ae3-406b-84f2-069c52ad88e8': 'B2C - Подключение СРОЧНОЕ',
    '1ff17c41-e4a2-4938-b68d-d9576aac8066': 'B2C - Перегляд В2С',
    '0a7c59e7-a6de-44a3-977f-d90c84e87e5f': 'B2C - 2,5 Гбіт/с',
    'c8dd5618-41ea-457d-a23d-dd018d21e77f': 'B2B - Підключення бізнес',
    'd5051f38-a8c6-47ab-a6d6-414a8a7acf0a': 'B2B - Перегляд бізнес',
    '614fef14-b1a1-419c-b336-21fc723dd406': 'B2B - Ремонт бізнес',
    'cc56250e-7c49-4012-a023-f693ee9ace9c': 'B2B - Тендер підключення'
  });

  const baselineByForm = new WeakMap();
  const approvedByForm = new WeakMap();
  const replayBypass = new WeakSet();
  let validationTimer = 0;

  const compact = (value, max = 420) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 4000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9]+/giu, ' ').trim();

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

  function hashText(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function actionPath(form) {
    try { return new URL(String(form?.action || location.href), location.href).pathname; }
    catch { return ''; }
  }

  function typeContext(form) {
    const select = form.querySelector('select[name="task_type_uuid"]');
    const named = form.querySelector('input[name="task_type_uuid"]');
    const hidden = form.querySelector('#taskTypeId');
    let id = String(select?.value || named?.value || hidden?.value || '').trim();
    if (!id) {
      try { id = String(new URL(location.href).searchParams.get('task_type_uuid') || '').trim(); } catch {}
    }
    let label = '';
    if (select instanceof HTMLSelectElement) label = compact(select.selectedOptions?.[0]?.textContent || '', 120);
    if (!label) label = TYPE_LABELS[id] || '';
    return { id, label, field: select || named || hidden || null };
  }

  function isCurrentTaskForm(form) {
    if (!(form instanceof HTMLFormElement) || !FORM_ACTION_RE.test(actionPath(form))) return false;
    const type = typeContext(form);
    return Boolean(UUID_RE.test(type.id) || form.querySelector('[name="task_type_uuid"]'));
  }

  function formMode() {
    return /\/task\/dialog_add\/?$/i.test(location.pathname) ? 'create'
      : /\/task\/[^/]+\/dialog_edit\/?$/i.test(location.pathname) ? 'edit'
        : /\/task\/dialog_add/i.test(location.pathname) ? 'create' : 'edit';
  }

  function scheduleFields(form) {
    return {
      date: form.querySelector('#datedo_id, input[name="datedo"], input[name="date"]'),
      hour: form.querySelector('#timedo_id, select[name="timedo"], input[name="timedo"], input[name="time"]'),
      minute: form.querySelector('#timedo_id2, select[name="timedo2"], input[name="timedo2"]')
    };
  }

  function staffInputs(form) {
    return Array.from(form.querySelectorAll([
      'input[name="division_auto_task_staffuuids[]"]',
      'input[name="division_task_staffuuids[]"]',
      'input[name^="division_auto_task_staffuuids"]',
      'input[name^="division_task_staffuuids"]'
    ].join(','))).filter(input => input instanceof HTMLInputElement);
  }

  function inputLabel(input) {
    return compact(input?.closest?.('.div_space2, label, .item, .erp-object-props__value')?.textContent || input?.parentElement?.textContent || '', 180);
  }

  function selectedCrews(form) {
    return staffInputs(form).filter(input => input.checked && BRIGADE_RE.test(inputLabel(input)));
  }

  function selectedCrewLabels(form) {
    return selectedCrews(form).map(input => inputLabel(input)).filter(Boolean).slice(0, 8);
  }

  function fieldVisitApplies(form, type = typeContext(form)) {
    if (FIELD_VISIT_UUIDS.has(type.id)) return true;
    const fields = scheduleFields(form);
    const staff = staffInputs(form);
    const scheduleLooksRequired = Boolean(fields.date && fields.hour && (
      fields.date.required || fields.hour.required || fields.minute?.required || staff.length
    ));
    return scheduleLooksRequired && staff.some(input => BRIGADE_RE.test(inputLabel(input)));
  }

  function parseDate(value) {
    const raw = compact(value, 30);
    let match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) };
    return null;
  }

  function scheduleState(form) {
    const fields = scheduleFields(form);
    const dateText = compact(fields.date?.value || '', 30);
    const hourText = compact(fields.hour?.value || '', 10);
    const minuteText = compact(fields.minute?.value || '0', 10);
    const date = parseDate(dateText);
    const hour = /^\d{1,2}$/.test(hourText) ? Number(hourText) : NaN;
    const minute = /^\d{1,2}$/.test(minuteText) ? Number(minuteText) : 0;
    let at = null;
    if (date && Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      at = new Date(date.year, date.month - 1, date.day, hour, minute, 0, 0);
      if (at.getFullYear() !== date.year || at.getMonth() !== date.month - 1 || at.getDate() !== date.day) at = null;
    }
    return { fields, dateText, hourText, minuteText, date, hour, minute, at };
  }

  function baselineSnapshot(form) {
    const type = typeContext(form);
    const schedule = scheduleState(form);
    return {
      typeUuid: type.id,
      typeLabel: type.label,
      dateText: schedule.dateText,
      hourText: schedule.hourText,
      minuteText: schedule.minuteText,
      fieldVisit: fieldVisitApplies(form, type)
    };
  }

  function rememberBaseline(form) {
    if (!isCurrentTaskForm(form) || baselineByForm.has(form)) return;
    const baseline = baselineSnapshot(form);
    baselineByForm.set(form, baseline);
    taskLog('info', 'task_form_baseline_captured', {
      mode: formMode(),
      ...baseline,
      buildingUuid: buildingUuid(form),
      addressUnitUuid: selectedAddressUnitUuid(form)
    });
  }

  function parseWorkWindow() {
    const node = document.querySelector('#buildingTimeIntervalId');
    const text = compact(node?.textContent || '', 160);
    const match = text.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (![start, end].every(Number.isFinite) || start < 0 || end > 24 * 60 || start >= end) return null;
    return { start, end, text: `${match[1].padStart(2, '0')}:${match[2]}–${match[3].padStart(2, '0')}:${match[4]}` };
  }

  function validateFieldVisit(form) {
    const type = typeContext(form);
    if (!fieldVisitApplies(form, type)) return [];

    const mode = formMode();
    const baseline = baselineByForm.get(form) || baselineSnapshot(form);
    const schedule = scheduleState(form);
    const issues = [];

    if (!schedule.dateText) issues.push({ code: 'field-date-required', message: 'Не указана дата выезда.', node: schedule.fields.date });
    else if (!schedule.date) issues.push({ code: 'field-date-invalid', message: 'Дата выезда указана некорректно.', node: schedule.fields.date });

    if (!schedule.hourText) issues.push({ code: 'field-time-required', message: 'Не указано время выезда.', node: schedule.fields.hour });
    else if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 || !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) {
      issues.push({ code: 'field-time-invalid', message: 'Время выезда указано некорректно.', node: schedule.fields.hour });
    }

    const currentStaff = staffInputs(form);
    if (mode === 'create') {
      if (!currentStaff.length) {
        issues.push({ code: 'field-crew-unavailable', message: 'Бригада не загружена/не выбрана. Проверь адрес и исполнителя перед сохранением.', node: null });
      } else if (!selectedCrews(form).length) {
        issues.push({ code: 'field-crew-required', message: 'Не выбрана выездная бригада (Бр. …).', node: currentStaff[0] });
      }
    } else if (currentStaff.length && !selectedCrews(form).length) {
      issues.push({ code: 'field-crew-required', message: 'Не выбрана выездная бригада (Бр. …).', node: currentStaff[0] });
    }

    if (schedule.at) {
      const now = Date.now();
      const changedSchedule = baseline.dateText !== schedule.dateText
        || baseline.hourText !== schedule.hourText
        || baseline.minuteText !== schedule.minuteText;
      const enteredFieldVisit = !baseline.fieldVisit && fieldVisitApplies(form, type);
      const strictLead = mode === 'create' || changedSchedule || enteredFieldVisit || baseline.typeUuid !== type.id;

      if (schedule.at.getTime() < now - PAST_GRACE_MS) {
        issues.push({ code: 'field-time-past', message: 'Время выезда уже прошло.', node: schedule.fields.hour });
      } else if (strictLead && schedule.at.getTime() < now + FIELD_MIN_LEAD_MS) {
        issues.push({ code: 'field-time-min-lead', message: 'Выезд нужно ставить минимум через 3 часа от текущего времени.', node: schedule.fields.hour });
      }

      const workWindow = parseWorkWindow();
      if (workWindow) {
        const minutes = schedule.hour * 60 + schedule.minute;
        if (minutes < workWindow.start || minutes > workWindow.end) {
          issues.push({
            code: 'field-building-hours',
            message: `Время ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} вне рабочего интервала дома ${workWindow.text}.`,
            node: schedule.fields.hour
          });
        }
      }
    }

    return issues;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      #${VALIDATION_HOST_ID}{position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(650px,calc(100vw - 36px));padding:10px 13px;border:1px solid #c6d2dc;border-left:4px solid #c18b3b;border-radius:3px;background:#fff;color:#40505e;box-shadow:0 6px 18px rgba(40,55,70,.18);font:12px/1.4 Arial,sans-serif}
      #${VALIDATION_HOST_ID} b{color:#6b552d} #${VALIDATION_HOST_ID} ul{margin:5px 0 0;padding-left:18px} #${VALIDATION_HOST_ID} li{margin:2px 0}
      #${MODAL_HOST_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:18px;background:rgba(38,49,59,.34);font-family:Arial,sans-serif}
      #${MODAL_HOST_ID} .wb-tcg-card{box-sizing:border-box;width:min(700px,calc(100vw - 32px));max-height:min(740px,calc(100vh - 36px));overflow:auto;background:#fff;border:1px solid #c6d2dc;border-radius:3px;box-shadow:0 10px 30px rgba(40,55,70,.24);color:#40505e}
      #${MODAL_HOST_ID} .wb-tcg-head{padding:11px 13px 9px;border-bottom:1px solid #d8e1e8;background:#f3f6f8}.wb-tcg-title{font-size:14px;font-weight:700;color:#3f607a}.wb-tcg-address{margin-top:3px;font-size:11px;color:#687783}
      #${MODAL_HOST_ID} .wb-tcg-body{padding:11px 13px}.wb-tcg-note{margin-bottom:9px;font-size:11px;line-height:1.4;color:#65737e}.wb-tcg-list{display:grid;gap:6px}.wb-tcg-item{padding:7px 8px;border:1px solid #d8e1e8;border-radius:3px;background:#fff}.wb-tcg-item[data-severity="blocker"]{border-left:4px solid #b75c5c;background:#fffafa}.wb-tcg-item[data-severity="warning"]{border-left:4px solid #c18b3b;background:#fffdf7}.wb-tcg-item[data-severity="info"]{border-left:4px solid #7d95a8;background:#f9fbfc}.wb-tcg-item-title{font-size:12px;font-weight:700;color:#465764}.wb-tcg-evidence{margin-top:3px;font-size:11px;line-height:1.4;color:#46525c}.wb-tcg-action{margin-top:4px;font-size:10.5px;color:#687783}
      #${MODAL_HOST_ID} .wb-tcg-checks{display:grid;gap:7px;margin-top:11px;padding:9px;border:1px solid #d8e1e8;border-radius:3px;background:#f7f9fb}.wb-tcg-checks label{display:flex;gap:7px;align-items:flex-start;font-size:11px;line-height:1.35;cursor:pointer}.wb-tcg-checks input{margin-top:1px}.wb-tcg-foot{display:flex;gap:7px;justify-content:flex-end;padding:9px 13px 11px;border-top:1px solid #d8e1e8;background:#f8fafb}
      #${MODAL_HOST_ID} button{appearance:none;border-radius:3px;padding:5px 9px;font:600 11px/1.2 Arial,sans-serif;cursor:pointer}.wb-tcg-cancel{border:1px solid #aebdca;background:#fff;color:#405a70}.wb-tcg-cancel:hover{background:#eef4f8}.wb-tcg-confirm{border:1px solid #3f6f93;background:#4c7da1;color:#fff}.wb-tcg-confirm:hover{background:#406f91}.wb-tcg-confirm[disabled]{opacity:.45;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function showValidation(issues) {
    ensureStyles();
    window.clearTimeout(validationTimer);
    document.getElementById(VALIDATION_HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = VALIDATION_HOST_ID;
    host.dataset.simnetWbOwned = '1';
    const title = document.createElement('b');
    title.textContent = 'Заявка не сохранена — проверь выезд';
    const list = document.createElement('ul');
    for (const issue of issues) {
      const li = document.createElement('li');
      li.textContent = issue.message;
      list.appendChild(li);
    }
    host.append(title, list);
    (document.body || document.documentElement).appendChild(host);
    const target = issues.find(item => item.node instanceof HTMLElement)?.node;
    try { target?.focus?.(); target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch {}
    validationTimer = window.setTimeout(() => host.remove(), 7000);
  }

  function selectedAddressUnitUuid(form) {
    const selects = Array.from(form.querySelectorAll('select[name="address_unit_selectortask_address[]"]'));
    for (let i = selects.length - 1; i >= 0; i -= 1) {
      const value = String(selects[i]?.value || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    return '';
  }

  function buildingUuid(form) {
    const direct = [
      form.querySelector('#buildingUuidtask_address'),
      form.querySelector('input[name="building_uuidtask_address"]'),
      form.querySelector('input[name="building_uuid"]'),
      form.querySelector('[id*="buildingUuid"]')
    ];
    for (const field of direct) {
      const value = String(field?.value || field?.dataset?.buildingUuid || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    const customer = form.querySelector('select[name="customer_uuid"]');
    const dataUuid = String(customer?.selectedOptions?.[0]?.dataset?.buildingUuid || '').trim();
    return UUID_RE.test(dataUuid) ? dataUuid : '';
  }

  function currentAddress(form) {
    const direct = compact(form.querySelector('#fastSearchInputtask_address')?.value || '', 320);
    if (direct) return direct;
    const customer = form.querySelector('select[name="customer_uuid"]');
    const customerTitle = compact(customer?.selectedOptions?.[0]?.getAttribute('title') || '', 420);
    const parenthesized = customerTitle.match(/\(([^()]*(?:вул\.|ул\.|просп\.|пров\.|шосе|street)[^()]*)\)/iu)?.[1];
    if (parenthesized) return compact(parenthesized, 320);
    const parts = Array.from(form.querySelectorAll('select[name="address_unit_selectortask_address[]"]'))
      .map(select => compact(select.selectedOptions?.[0]?.textContent || '', 120))
      .filter(Boolean)
      .filter(text => !/^\s*[-—]?\s*$/.test(text));
    return parts.length ? compact(parts.join(' → '), 320) : 'Текущий адрес заявки';
  }

  function liveNoteRows() {
    const selectors = [
      ['#buildingTaskCommentId', 'Рабочая заметка дома'],
      ['#buildingTaskInfoId', 'Заметки дома'],
      ['#buildingWorkDescriptionId', 'Информация по дому']
    ];
    const rows = [];
    const seen = new Set();
    for (const [selector, label] of selectors) {
      const node = document.querySelector(selector);
      const text = compact(node?.textContent || '', 5000);
      if (!text || seen.has(fold(text))) continue;
      seen.add(fold(text));
      rows.push({ key: selector.slice(1), label, text });
    }
    return rows;
  }

  function liveConstraint(type, meta, identity, address, evidence, sourceField = 'userside_live') {
    return {
      id: `${identity || 'live'}:${type}:${hashText(`${sourceField}|${fold(evidence)}`)}`,
      type,
      label: meta.label,
      severity: meta.severity,
      address,
      buildingId: identity,
      url: location.pathname,
      sourceField,
      sourceLabel: 'UserSide LIVE',
      evidence: compact(evidence, 320),
      action: meta.action,
      appliesTo: meta.appliesTo,
      requireAck: meta.requireAck,
      confidence: meta.confidence || 0.9,
      source: 'userside-live'
    };
  }

  function extractLiveConstraints(form) {
    const rows = liveNoteRows();
    if (!rows.length) return [];
    const identity = buildingUuid(form) || selectedAddressUnitUuid(form) || 'live';
    const address = currentAddress(form);
    const synthetic = { id: identity, address, url: location.pathname, fields: rows };
    let constraints = [];
    try {
      constraints = Array.isArray(WB.crmConstraints?.extractBuildingConstraints?.(synthetic))
        ? WB.crmConstraints.extractBuildingConstraints(synthetic)
        : [];
    } catch (error) {
      taskLog('warn', 'live_constraint_extractor_failed', { message: compact(error?.message || error, 180) });
    }
    constraints = constraints.map(item => ({ ...item, source: 'userside-live' }));

    const manual = [];
    for (const row of rows) {
      const text = compact(row.text, 5000);
      const normalized = fold(text);
      if (/ключ|доступ|тамбур|щитк|техэтаж|техповерх/iu.test(normalized)
        && /ключи?\s+у|заранее|завчасно|наперед|предвар|договар|договор|домов|согласов|узгод/iu.test(normalized)) {
        manual.push(liveConstraint('access_coordination', {
          label: 'Нужно заранее согласовать доступ', severity: 'warning',
          action: 'Созвонись/согласуй доступ до выезда и предупреди абонента, если это ещё не сделано.',
          appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true, confidence: 0.93
        }, identity, address, text, row.key));
      }
      if (/(?:ключ|доступ|звон|дзвон)[^.!?]{0,120}(?:с|з)\s*\d{1,2}(?::\d{2})?\s*(?:-|–|—|до|по)\s*\d{1,2}(?::\d{2})?/iu.test(text)) {
        manual.push(liveConstraint('access_window', {
          label: 'Ограничение по времени доступа', severity: 'warning',
          action: 'Согласуй дату/время так, чтобы мастер реально получил доступ.',
          appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true, confidence: 0.94
        }, identity, address, text, row.key));
      }
    }

    const out = [];
    const seen = new Set();
    for (const item of [...constraints, ...manual]) {
      if (!item?.evidence) continue;
      const key = `${item.type}|${fold(item.evidence)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function taskPurpose(type) {
    const label = fold(type?.label || TYPE_LABELS[type?.id] || '');
    if (/ремонт/.test(label)) return 'repair';
    if (/потенц|перегляд|осмотр|огляд/.test(label)) return 'preconnection';
    if (/подкл|пидключ|підключ|переключ|gig|2 5|доподключ|тендер/.test(label)) return 'connection';
    return 'other';
  }

  function applicableLiveConstraints(form, type) {
    const purpose = taskPurpose(type);
    if (purpose === 'other') return [];
    return extractLiveConstraints(form).filter(item => {
      const applies = Array.isArray(item.appliesTo) ? item.appliesTo : [];
      return !applies.length || applies.includes(purpose);
    });
  }

  function constraintSignature(form, type, constraints) {
    const identity = buildingUuid(form) || selectedAddressUnitUuid(form) || currentAddress(form);
    return hashText(`${type.id}|${identity}|${constraints.map(item => item.id || `${item.type}:${item.evidence}`).join('|')}`);
  }

  function approvalValid(form, signature) {
    const row = approvedByForm.get(form);
    return Boolean(row && row.signature === signature && Number(row.expiresAt || 0) > Date.now());
  }

  function decisionContext(form, issues = null, constraints = null) {
    const type = typeContext(form);
    const schedule = scheduleState(form);
    const staff = staffInputs(form);
    const workWindow = parseWorkWindow();
    const rows = liveNoteRows();
    return {
      mode: formMode(),
      taskTypeUuid: type.id,
      taskTypeLabel: type.label || TYPE_LABELS[type.id] || '',
      fieldVisit: fieldVisitApplies(form, type),
      date: schedule.dateText,
      hour: schedule.hourText,
      minute: schedule.minuteText,
      scheduledAt: schedule.at?.toISOString?.() || '',
      workWindow: workWindow?.text || '',
      staffInputCount: staff.length,
      selectedCrewCount: selectedCrews(form).length,
      selectedCrewLabels: selectedCrewLabels(form),
      buildingUuid: buildingUuid(form),
      addressUnitUuid: selectedAddressUnitUuid(form),
      address: currentAddress(form),
      liveNoteSources: rows.map(row => row.key),
      liveNoteCount: rows.length,
      issueCodes: Array.isArray(issues) ? issues.map(item => item.code) : [],
      constraintTypes: Array.isArray(constraints) ? constraints.map(item => item.type) : [],
      constraintCount: Array.isArray(constraints) ? constraints.length : 0
    };
  }

  function writeAudit(entry) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(AUDIT_KEY, stored => {
          const current = stored?.[AUDIT_KEY];
          const store = current && typeof current === 'object'
            ? { ...current, schema: AUDIT_SCHEMA, entries: Array.isArray(current.entries) ? current.entries : [] }
            : { schema: AUDIT_SCHEMA, entries: [] };
          store.entries.unshift(entry);
          store.entries = store.entries.slice(0, MAX_AUDIT);
          store.updatedAt = entry.at;
          chrome.storage.local.set({ [AUDIT_KEY]: store }, () => resolve());
        });
      } catch { resolve(); }
    });
  }

  function closeSpecialModal() {
    document.getElementById(MODAL_HOST_ID)?.remove();
  }

  function resubmit(form, submitter) {
    taskLog('info', 'task_save_replay_requested', decisionContext(form));
    replayBypass.add(form);
    queueMicrotask(() => {
      try {
        if (submitter instanceof HTMLElement && submitter.isConnected) form.requestSubmit(submitter);
        else form.requestSubmit();
      } catch (error) {
        replayBypass.delete(form);
        taskLog('warn', 'task_save_replay_requestsubmit_failed', { message: compact(error?.message || error, 180) });
        try { form.submit(); } catch {}
      }
    });
  }

  function renderSpecialModal({ form, submitter, type, constraints, signature }) {
    closeSpecialModal();
    ensureStyles();
    const host = document.createElement('div');
    host.id = MODAL_HOST_ID;
    host.dataset.simnetWbOwned = '1';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    const blocker = constraints.some(item => item.severity === 'blocker');
    const visible = constraints.slice(0, 7);

    host.innerHTML = `
      <section class="wb-tcg-card">
        <div class="wb-tcg-head">
          <div class="wb-tcg-title">${blocker ? 'Особое условие по адресу' : 'Особенности по адресу'}</div>
          <div class="wb-tcg-address"></div>
        </div>
        <div class="wb-tcg-body">
          <div class="wb-tcg-note">Проверь актуальные условия по дому перед сохранением заявки.</div>
          <div class="wb-tcg-list"></div>
          <div class="wb-tcg-checks">
            <label><input type="checkbox" data-role="customer-warned"> <span>Абонент предупреждён / условия с ним уже оговорены</span></label>
            <label><input type="checkbox" data-role="ack"> <span><b>Ознакомлен.</b> Если ещё не согласовано — учту это до выполнения заявки.</span></label>
          </div>
        </div>
        <div class="wb-tcg-foot">
          <button type="button" class="wb-tcg-cancel" data-action="cancel">Вернуться</button>
          <button type="button" class="wb-tcg-confirm" data-action="confirm" disabled>Подтвердить и сохранить</button>
        </div>
      </section>`;

    host.querySelector('.wb-tcg-address').textContent = currentAddress(form);
    const list = host.querySelector('.wb-tcg-list');
    for (const item of visible) {
      const node = document.createElement('div');
      node.className = 'wb-tcg-item';
      node.dataset.severity = item.severity || 'info';
      const title = document.createElement('div');
      title.className = 'wb-tcg-item-title';
      title.textContent = item.label || item.type || 'Особенность';
      const evidence = document.createElement('div');
      evidence.className = 'wb-tcg-evidence';
      evidence.textContent = item.evidence || '';
      const action = document.createElement('div');
      action.className = 'wb-tcg-action';
      action.textContent = item.action || '';
      node.append(title, evidence, action);
      list.appendChild(node);
    }

    taskLog('info', 'special_info_guard_shown', {
      ...decisionContext(form, null, constraints),
      blocker,
      signature
    });

    const ack = host.querySelector('[data-role="ack"]');
    const customerWarned = host.querySelector('[data-role="customer-warned"]');
    const confirm = host.querySelector('[data-action="confirm"]');
    ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });

    host.addEventListener('click', async event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
      if (action === 'cancel') {
        taskLog('info', 'special_info_guard_cancelled', decisionContext(form, null, constraints));
        closeSpecialModal();
        return;
      }
      if (action !== 'confirm' || !ack.checked || confirm.disabled) return;
      confirm.disabled = true;
      const at = new Date().toISOString();
      const bUuid = buildingUuid(form);
      const addressUnitUuid = selectedAddressUnitUuid(form);
      approvedByForm.set(form, { signature, expiresAt: Date.now() + APPROVAL_TTL_MS });
      await writeAudit({
        id: `ack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        at,
        source: 'userside-live',
        buildingUuid: bUuid,
        addressUnitUuid,
        address: currentAddress(form),
        taskTypeUuid: type.id,
        taskTypeLabel: type.label || TYPE_LABELS[type.id] || '',
        customerWarned: Boolean(customerWarned.checked),
        acknowledged: true,
        constraintIds: constraints.map(item => item.id).filter(Boolean),
        constraintTypes: [...new Set(constraints.map(item => item.type).filter(Boolean))],
        blocker
      });
      taskLog('info', 'UserSide LIVE special conditions acknowledged', {
        ...decisionContext(form, null, constraints),
        customerWarned: Boolean(customerWarned.checked),
        acknowledged: true,
        blocker
      });
      closeSpecialModal();
      resubmit(form, submitter);
    });

    (document.body || document.documentElement).appendChild(host);
    queueMicrotask(() => host.querySelector('[data-role="ack"]')?.focus());
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!isCurrentTaskForm(form)) return;
    if (replayBypass.has(form)) {
      replayBypass.delete(form);
      taskLog('info', 'task_save_replay_passed', decisionContext(form));
      return;
    }
    if (event.defaultPrevented) {
      taskLog('info', 'task_save_skipped_prior_guard', decisionContext(form));
      return;
    }
    rememberBaseline(form);

    const issues = validateFieldVisit(form);
    taskLog('info', 'task_save_decision', decisionContext(form, issues));
    if (issues.length) {
      event.preventDefault();
      event.stopPropagation();
      showValidation(issues);
      taskLog('warn', 'Current UserSide field visit validation blocked save', decisionContext(form, issues));
      return;
    }

    const type = typeContext(form);
    const constraints = applicableLiveConstraints(form, type);
    taskLog('info', 'special_info_evaluated', decisionContext(form, null, constraints));
    if (!constraints.length) {
      taskLog('info', 'task_save_passed_no_special_info', decisionContext(form));
      return;
    }
    const signature = constraintSignature(form, type, constraints);
    if (approvalValid(form, signature)) {
      taskLog('info', 'special_info_approval_reused', { ...decisionContext(form, null, constraints), signature });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    renderSpecialModal({ form, submitter: event.submitter || null, type, constraints, signature });
  }

  function preInteraction(event) {
    const form = event.target?.closest?.('form');
    if (form) rememberBaseline(form);
  }

  document.querySelectorAll('form').forEach(rememberBaseline);
  document.addEventListener('pointerdown', preInteraction, true);
  document.addEventListener('focusin', preInteraction, true);
  document.addEventListener('submit', handleSubmit, true);

  WB.taskCurrentContractGuard = Object.freeze({
    fieldVisitUuids: Object.freeze([...FIELD_VISIT_UUIDS]),
    extractLiveConstraints,
    validateFieldVisit,
    debugDecision(form = null) {
      const target = isCurrentTaskForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isCurrentTaskForm) || null;
      if (!target) return null;
      return decisionContext(target, validateFieldVisit(target), applicableLiveConstraints(target, typeContext(target)));
    },
    close() {
      document.getElementById(VALIDATION_HOST_ID)?.remove();
      closeSpecialModal();
    },
    destroy() {
      document.removeEventListener('pointerdown', preInteraction, true);
      document.removeEventListener('focusin', preInteraction, true);
      document.removeEventListener('submit', handleSubmit, true);
      window.clearTimeout(validationTimer);
      document.getElementById(VALIDATION_HOST_ID)?.remove();
      closeSpecialModal();
      document.getElementById(STYLE_ID)?.remove();
      taskLog('info', 'task_current_contract_guard_destroyed', {});
    }
  });
})();