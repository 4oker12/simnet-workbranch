(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskFormAssistantLoaded) return;
  WB.__taskFormAssistantLoaded = true;

  const STYLE_ID = 'simnet-wb-task-form-assistant-style';
  const SUMMARY_CLASS = 'simnet-wb-task-validation-summary';
  const ERROR_CLASS = 'simnet-wb-task-field-error';
  const WARN_CLASS = 'simnet-wb-task-field-warn';
  const ENHANCED_ATTR = 'data-simnet-wb-task-enhanced';
  const FILTER_ATTR = 'data-simnet-wb-task-staff-filter';
  const EDIT_CREW_ATTR = 'data-simnet-wb-edit-crew-picker';
  const EDIT_CREW_LIST_ATTR = 'data-simnet-wb-edit-crew-list';
  const EDIT_CREW_TRANSITION_ATTR = 'data-simnet-wb-edit-crew-transition';
  const EDIT_CREW_REMOVE_L1_ATTR = 'data-simnet-wb-edit-crew-remove-l1';
  const EDIT_CREW_NOTE_ATTR = 'data-simnet-wb-edit-crew-note';
  const EDIT_CREW_DIVISION_ATTR = 'data-simnet-wb-edit-crew-division';
  const NATIVE_EDIT_STAFF_CLASS = 'simnet-wb-native-edit-staff';
  const NATIVE_EDIT_STAFF_LABEL_CLASS = 'simnet-wb-native-edit-staff-label';
  const NATIVE_ASSIGNMENT_REMOVE_ATTR = 'data-simnet-wb-native-assignment-remove';
  const TASK_ACTION_RE = /^\/task\/save\/?$/i;
  const RELOAD_AUTO_STAFF_PATH = '/task/reload_auto_staff';
  const STAFF_DIALOG_PATH = '/task/dialog_change_staff';
  const STAFF_SAVE_PATH = '/task/staff_save';
  const EDIT_STAFF_PAYLOAD_ATTR = 'data-simnet-wb-edit-staff-payload';
  const STAFF_SUBMIT_BYPASS_ATTR = 'data-simnet-wb-staff-submit-bypass';
  const STAFF_SAVE_BUSY_ATTR = 'data-simnet-wb-staff-save-busy';
  const VALIDATION_BUSY_ATTR = 'data-simnet-wb-task-validation-busy';
  const NATIVE_STAFF_VALIDATION_ATTR = 'data-simnet-wb-native-staff-validation';
  const NATIVE_STAFF_REQUIRED_ATTR = 'data-simnet-wb-native-staff-required';
  const NATIVE_STAFF_ARIA_REQUIRED_ATTR = 'data-simnet-wb-native-staff-aria-required';
  const NATIVE_FORM_NOVALIDATE_ATTR = 'data-simnet-wb-native-form-novalidate';
  const CALL_TASK_HASH_PREFIX = 'simnet-wb-call=';
  const CALL_TASK_TYPES = new Set(['1', '15', '41', '70']);
  const CALL_TASK_FORM_CLASS = 'simnet-wb-call-task-compact';
  const CALL_TASK_EXTRA_CLASS = 'simnet-wb-call-task-show-extra';
  const CALL_TASK_OPTIONAL_CLASS = 'simnet-wb-call-task-optional';
  const CALL_TASK_BANNER_CLASS = 'simnet-wb-call-task-banner';
  const CALL_TASK_PENDING_KEY = 'simnet_wb_call_task_pending_v1';
  const CALL_TASK_OUTCOME_MESSAGE = 'CALL_TASK_OUTCOME_RECORDED';
  const CALL_TASK_PENDING_TTL_MS = 20 * 60 * 1000;
  const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

  // Canonical field-visit scope recovered from the proven UserSide Crew Advisor matrix.
  // The same invariant is applied regardless of entry point: blank form, customer card, calendar or EDIT.
  const FIELD_VISIT_TYPES = new Set([
    // B2B
    '10', '14', '29', '50',
    // B2C
    '1', '2', '15', '17', '60', '61', '66', '68', '126', '140',
    // Other field / technical work
    '3', '9', '11', '12', '18', '19', '26', '34', '38', '42', '43', '65', '144'
  ]);
  const FIELD_MIN_LEAD_MS = 3 * 60 * 60 * 1000;
  const FIELD_PAST_GRACE_MS = 60 * 1000;
  const CREATE_SCHEDULE_BLOCKING_CODES = new Set([
    'field-date-required', 'field-time-required', 'field-time-past', 'field-time-min-lead', 'field-crew-required'
  ]);
  const L1_TYPES = new Set(['5', '86', '87', '90', '138', '139']);
  const KNOWN_L1_DIVISION_IDS = new Set(['1']); // Техподдержка L1; допустима вместе с бригадой
  // Canonical brigade IDs recovered from the earlier proven UserSide Staff module.
  // Runtime UserSide labels remain primary; this set is a fallback when EDIT only exposes IDs.
  const KNOWN_CREW_DIVISION_IDS = new Set([
    '31', '30', '57', '43', '21', '37', '68', '44', '19',
    '69', '13', '18', '17', '45',
    '65', '3', '73',
    '39', '36', '67', '70', '71', '72',
    '29', '46', '24', '28', '14',
    '8', '60', '25'
  ]);
  const BRIGADE_LABEL_RE = /^\s*бр\.\s*/iu;
  // Proven matrix from the earlier UserSide Staff module:
  // private sector -> only 2.0-2.4; non-private/ЖК -> every known crew except 2.0-2.4.
  const PRIVATE_SECTOR_CREW_IDS = new Set(['69', '13', '18', '17', '45']);
  const NON_PRIVATE_CREW_IDS = new Set(Array.from(KNOWN_CREW_DIVISION_IDS).filter(id => !PRIVATE_SECTOR_CREW_IDS.has(id)));
  const TRANSITION_KEY_PREFIX = 'simnet-wb-task-type-transition:';
  const TRANSITION_TTL_MS = 20 * 60 * 1000;

  const baselineByForm = new WeakMap();
  const territoryByForm = new WeakMap();
  const buildingProfileCache = new Map();
  const unitBuildingCache = new Map();
  let destroyed = false;
  let lastProbeSignature = '';
  let validSubmitTaskId = '';

  const compact = (value, max = 180) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function callTaskLaunchContext() {
    const rawHash = String(location.hash || '').replace(/^#/, '');
    if (!rawHash.startsWith(CALL_TASK_HASH_PREFIX)) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(rawHash.slice(CALL_TASK_HASH_PREFIX.length)));
      const typer = String(parsed?.typer || '').replace(/\D+/g, '');
      const callKey = String(parsed?.callKey || '');
      if (!CALL_TASK_TYPES.has(typer) || !/^call:\d+$/.test(callKey)) return null;
      return {
        callKey,
        typer,
        phone: String(parsed?.phone || '').replace(/[^+\d]/g, '').slice(0, 35),
        callerMasked: compact(parsed?.callerMasked || '', 40),
        startedAtMs: Number(parsed?.startedAtMs || 0)
      };
    } catch {
      return null;
    }
  }

  function callTaskTypeLabel(typer = '') {
    return ({
      '1': 'Новое подключение · ЖК',
      '15': 'Новое подключение · частный сектор',
      '41': 'Потенциальный абонент · ЖК',
      '70': 'Потенциальный абонент · частный сектор'
    })[String(typer || '')] || 'Заявка';
  }

  function sendCallTaskOutcome(payload = {}) {
    try {
      chrome.runtime.sendMessage({ type: CALL_TASK_OUTCOME_MESSAGE, payload }, () => { void chrome.runtime.lastError; });
    } catch {}
  }

  function rememberPendingCallTask(context = {}) {
    if (!context?.callKey || !CALL_TASK_TYPES.has(String(context.typer || ''))) return false;
    const row = {
      callKey: String(context.callKey || ''),
      typer: String(context.typer || ''),
      phone: String(context.phone || ''),
      submittedAtMs: Date.now()
    };
    try { sessionStorage.setItem(CALL_TASK_PENDING_KEY, JSON.stringify(row)); } catch {}
    sendCallTaskOutcome({ ...row, stage: 'submitted' });
    return true;
  }

  function currentCreatedTaskId() {
    const path = String(location.pathname || '');
    const pathMatch = path.match(/^\/task\/(?:show\/)?(\d{1,14})(?:\/|$)/i);
    if (pathMatch) return pathMatch[1];
    try {
      const url = new URL(location.href);
      for (const key of ['task_id', 'taskId', 'id']) {
        const value = String(url.searchParams.get(key) || '').replace(/\D+/g, '');
        if (/^\d{1,14}$/.test(value) && value !== '0') return value;
      }
    } catch {}
    const domValue = String(document.querySelector?.('#taskId, input[name="task_id"]')?.value || '').replace(/\D+/g, '');
    return /^\d{1,14}$/.test(domValue) && domValue !== '0' ? domValue : '';
  }

  function confirmPendingCallTaskOutcome() {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(CALL_TASK_PENDING_KEY) || 'null'); } catch {}
    if (!pending?.callKey || !CALL_TASK_TYPES.has(String(pending.typer || ''))) return false;
    const age = Date.now() - Number(pending.submittedAtMs || 0);
    if (!Number.isFinite(age) || age < 0 || age > CALL_TASK_PENDING_TTL_MS) {
      try { sessionStorage.removeItem(CALL_TASK_PENDING_KEY); } catch {}
      return false;
    }
    const taskId = currentCreatedTaskId();
    if (!taskId) return false;
    sendCallTaskOutcome({
      callKey: String(pending.callKey),
      typer: String(pending.typer),
      phone: String(pending.phone || ''),
      taskId,
      stage: 'created'
    });
    try { sessionStorage.removeItem(CALL_TASK_PENDING_KEY); } catch {}
    return true;
  }

  function markCallTaskOptional(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const mark = node => {
      if (!node || node.querySelector?.('[required]')) return;
      node.classList?.add(CALL_TASK_OPTIONAL_CLASS);
    };
    form.querySelectorAll('.tagItem').forEach(mark);
    mark(form.querySelector('#c_attach_work_framenew_id'));
    for (const item of form.querySelectorAll('.item')) {
      if (item.querySelector('[required]')) continue;
      const label = compact(item.querySelector('.left_data')?.textContent || '', 140).toLocaleLowerCase('ru');
      if (/приоритет|время на выполнение|краткое описание|номер родительского задания/.test(label)) mark(item);
    }
    for (const heading of form.querySelectorAll('.label_h3_hr')) {
      const label = compact(heading.textContent || '', 100).toLocaleLowerCase('ru');
      if (label === 'оборудование') {
        mark(heading);
        const next = heading.nextElementSibling;
        if (next && !next.querySelector?.('[required]')) mark(next);
      }
    }
  }

  function applyCallTaskLaunch(form) {
    if (!(form instanceof HTMLFormElement)) return null;
    const context = callTaskLaunchContext();
    const task = taskContext(form);
    if (!context || task?.mode !== 'create' || String(task.typeId || '') !== context.typer) return null;

    form.classList.add(CALL_TASK_FORM_CLASS);
    form.dataset.simnetWbCallKey = context.callKey;
    form.dataset.simnetWbCallTaskType = context.typer;

    const phone = form.querySelector('input[name="dopf_13"]');
    if (phone && context.phone && !String(phone.value || '').trim()) {
      phone.value = context.phone;
      phone.dataset.simnetWbCallPrefill = '1';
      try { phone.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { phone.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    }

    markCallTaskOptional(form);
    let banner = form.querySelector(`.${CALL_TASK_BANNER_CLASS}`);
    if (!banner) {
      banner = document.createElement('div');
      banner.className = CALL_TASK_BANNER_CLASS;
      banner.dataset.simnetWbOwned = '1';
      form.insertBefore(banner, form.firstChild);
    }
    const phoneLabel = context.callerMasked || context.phone || 'номер неизвестен';
    banner.innerHTML = `<div class="simnet-wb-call-task-banner-main"><b>☎ ${callTaskTypeLabel(context.typer)}</b><span>${phoneLabel} · ${context.callKey}</span></div><button type="button" data-simnet-wb-call-task-toggle="1">Дополнительно</button>`;
    return context;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      .${SUMMARY_CLASS}{position:fixed;z-index:2147483646;top:18px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(640px,calc(100vw - 36px));padding:12px 16px 12px 18px;border:1px solid #b0003a;border-left:6px solid #b0003a;border-radius:10px;background:#fff;color:#31131f;box-shadow:0 10px 30px rgba(45,0,18,.22);font:14px/1.38 Arial,sans-serif;text-align:left}
      .${SUMMARY_CLASS}[hidden]{display:none!important}
      .${SUMMARY_CLASS} .wb-task-title{font-weight:800;color:#8f0037;margin:0 0 3px;font-size:14px}
      .${SUMMARY_CLASS} .wb-task-message{color:#31131f}
      .${SUMMARY_CLASS} .wb-task-list{margin:4px 0 0;padding-left:18px}
      .${SUMMARY_CLASS} .wb-task-list li{margin:2px 0}
      .${SUMMARY_CLASS}[data-level="warn"]{border-color:#b07a00;border-left-color:#b07a00;background:#fffdf5;color:#3f3210;box-shadow:0 10px 30px rgba(70,50,0,.16)}
      .${SUMMARY_CLASS}[data-level="warn"] .wb-task-title{color:#8a5f00}
      .${SUMMARY_CLASS}[data-level="warn"] .wb-task-message{color:#3f3210}
      .${ERROR_CLASS}{outline:2px solid #b0003a!important;outline-offset:1px!important}
      .${WARN_CLASS}{outline:2px solid #b07a00!important;outline-offset:1px!important}
      .simnet-wb-task-territory-mismatch{outline:2px solid #b0003a!important;outline-offset:1px!important;background:#fff1f5!important}
      .simnet-wb-task-staff-filter-wrap{margin:5px 0 9px;padding:7px 8px;border:1px solid #d4c5cb;border-radius:6px;background:#faf8f9;font:12px/1.35 Arial,sans-serif}
      .simnet-wb-task-staff-filter-wrap input{box-sizing:border-box;min-width:220px;max-width:100%;padding:4px 6px}
      .simnet-wb-task-staff-filter-meta{margin-left:7px;color:#72515e}
      .${NATIVE_EDIT_STAFF_LABEL_CLASS}{box-sizing:border-box;max-width:860px;margin:8px 0 3px!important;padding:0!important;border:0!important;background:transparent!important;color:inherit!important;font-weight:800!important}
      .${NATIVE_EDIT_STAFF_CLASS}{box-sizing:border-box;max-width:860px;margin:0 0 3px!important;padding:0!important;border:0!important;background:transparent!important}
      .${NATIVE_EDIT_STAFF_CLASS} .item{display:inline-block;margin:0 6px 5px 0!important;padding:0!important}
      .${NATIVE_EDIT_STAFF_CLASS} .item>div{display:inline-flex;align-items:center;gap:4px;min-height:25px;padding:2px 4px 2px 8px;border:1px solid #d8cfd3;border-radius:6px;background:#fff;box-shadow:none}
      .${NATIVE_EDIT_STAFF_CLASS} a[href*="/employee/division_show"]{font-weight:700;color:#6e1739}
      .simnet-wb-native-assignment-remove{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:2px;padding:0;border:0;border-radius:4px;background:transparent;color:#9e003f;font:800 16px/1 Arial,sans-serif;cursor:pointer}
      .simnet-wb-native-assignment-remove:hover{background:#9e003f;color:#fff}
      .simnet-wb-native-assignment-removed{display:none!important}
      .simnet-wb-edit-crew{box-sizing:border-box;width:min(620px,100%);max-width:100%;margin:2px 0 12px;padding:0;border:0;background:transparent;font:12px/1.4 Arial,sans-serif}
      .simnet-wb-edit-crew[hidden]{display:none!important}
      .simnet-wb-edit-crew-toolbar{display:flex;align-items:center;gap:7px;min-height:27px;margin:0 0 5px}
      .simnet-wb-edit-crew-territory{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:#f3edf0;color:#6e1739;font-weight:700}
      .simnet-wb-edit-crew-territory:empty{display:none}
      .simnet-wb-edit-crew-actions{display:flex;align-items:center;gap:5px}
      .simnet-wb-edit-crew button{cursor:pointer}
      .simnet-wb-edit-crew button[hidden]{display:none!important}
      .simnet-wb-edit-crew-toggle{min-height:26px;padding:3px 9px;border:1px solid #cfc3c8;border-radius:6px;background:#fff;color:#5e263d;font:700 12px/1.2 Arial,sans-serif}
      .simnet-wb-edit-crew-toggle:hover{border-color:#a98b97;background:#faf7f8}
      .simnet-wb-edit-crew-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid #cfc3c8;border-radius:6px;background:#fff;color:#6e1739;font:700 16px/1 Arial,sans-serif}
      .simnet-wb-edit-crew-icon:hover{background:#faf7f8;border-color:#a98b97}
      .simnet-wb-edit-crew-panel{box-sizing:border-box;padding:8px;border:1px solid #d8cfd3;border-radius:7px;background:#fcfbfb}
      .simnet-wb-edit-crew-panel[hidden]{display:none!important}
      .simnet-wb-edit-crew-panel-head{display:flex;align-items:center;gap:6px;margin-bottom:7px}
      .simnet-wb-edit-crew-search{box-sizing:border-box;flex:1;min-width:180px;width:auto;max-width:none;padding:4px 7px;margin:0}
      .simnet-wb-edit-crew-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px 8px;max-height:210px;overflow:auto;padding:4px 6px;border:1px solid #e3dde0;border-radius:6px;background:#fff}
      .simnet-wb-edit-crew-list .div_space2{min-width:0;padding:3px 2px}
      .simnet-wb-edit-crew-transition{margin:0 0 6px;padding:5px 8px;border-left:3px solid #9e003f;background:#fff1f5;color:#6e1739;font-weight:700}
      .simnet-wb-edit-crew-transition[hidden]{display:none!important}
      .simnet-wb-edit-crew-note{margin-top:6px;color:#72515e}
      .simnet-wb-edit-crew-note[hidden]{display:none!important}
      .simnet-wb-edit-crew-error{margin-top:6px;color:#9e003f}
      form.${CALL_TASK_FORM_CLASS}{box-sizing:border-box!important;float:none!important;width:min(860px,calc(100vw - 28px))!important;max-width:860px!important;margin:12px auto 36px!important;padding:0 14px 18px!important;border:1px solid #e2d8dc!important;border-radius:12px!important;background:#fff!important;box-shadow:0 10px 30px rgba(54,16,31,.08)!important}
      form.${CALL_TASK_FORM_CLASS}>.table_block{float:none!important;width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}
      form.${CALL_TASK_FORM_CLASS} .label_h3_hr{clear:both!important;margin:16px 0 7px!important;padding:0 0 5px!important;border-bottom:1px solid #eadfe3!important;color:#6e1739!important;font-weight:800!important}
      form.${CALL_TASK_FORM_CLASS} .table_block{box-sizing:border-box!important;max-width:100%!important}
      form.${CALL_TASK_FORM_CLASS} .item{box-sizing:border-box!important;display:grid!important;grid-template-columns:minmax(150px,190px) minmax(0,1fr)!important;gap:8px!important;align-items:start!important;margin:0 0 8px!important;padding:0!important}
      form.${CALL_TASK_FORM_CLASS} .item>.left_data{box-sizing:border-box!important;min-width:0!important;max-width:none!important;width:auto!important;padding:5px 0!important;color:#5f4a53!important;font-weight:700!important}
      form.${CALL_TASK_FORM_CLASS} input.input_box,form.${CALL_TASK_FORM_CLASS} input[type="text"],form.${CALL_TASK_FORM_CLASS} select,form.${CALL_TASK_FORM_CLASS} textarea{box-sizing:border-box!important;max-width:100%!important}
      form.${CALL_TASK_FORM_CLASS} input.find_box{width:min(440px,100%)!important}
      form.${CALL_TASK_FORM_CLASS} .jodit-container{min-height:120px!important;max-width:100%!important}
      form.${CALL_TASK_FORM_CLASS} .jodit-workplace,form.${CALL_TASK_FORM_CLASS} .jodit-wysiwyg{min-height:92px!important}
      form.${CALL_TASK_FORM_CLASS} #auto_pers_id{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:2px 10px!important;max-height:190px!important;overflow:auto!important;padding:6px!important;border:1px solid #e7dfe2!important;border-radius:8px!important}
      form.${CALL_TASK_FORM_CLASS}:not(.${CALL_TASK_EXTRA_CLASS}) .${CALL_TASK_OPTIONAL_CLASS}{display:none!important}
      form.${CALL_TASK_FORM_CLASS}.${CALL_TASK_EXTRA_CLASS} .${CALL_TASK_OPTIONAL_CLASS}{display:revert!important}
      .${CALL_TASK_BANNER_CLASS}{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 -14px 12px;padding:10px 13px;border-bottom:1px solid #e6dce0;border-radius:12px 12px 0 0;background:#fffafc;box-shadow:0 3px 10px rgba(58,12,31,.05);font:12px/1.35 Arial,sans-serif}
      .simnet-wb-call-task-banner-main{display:flex;align-items:baseline;gap:10px;min-width:0}.simnet-wb-call-task-banner-main b{color:#8f0037;font-size:13px}.simnet-wb-call-task-banner-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#72515e}
      .${CALL_TASK_BANNER_CLASS} button{flex:0 0 auto;padding:5px 9px;border:1px solid #ccb9c0;border-radius:7px;background:#fff;color:#6e1739;font:700 11px/1 Arial,sans-serif;cursor:pointer}
      form.${CALL_TASK_FORM_CLASS} .div_center{clear:both!important;position:sticky;bottom:0;z-index:15;margin:16px -14px -18px!important;padding:10px 14px!important;border-top:1px solid #eadfe3!important;border-radius:0 0 12px 12px;background:#fff!important;text-align:right!important}
      @media (max-width:760px){.simnet-wb-edit-crew-list{grid-template-columns:1fr}form.${CALL_TASK_FORM_CLASS} .item{grid-template-columns:1fr!important}form.${CALL_TASK_FORM_CLASS} #auto_pers_id{grid-template-columns:1fr!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function actionPath(form) {
    if (!(form instanceof HTMLFormElement)) return '';
    try {
      return new URL(String(form.getAttribute('action') || ''), location.href).pathname;
    } catch {
      return '';
    }
  }

  function isTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    if (!TASK_ACTION_RE.test(actionPath(form))) return false;
    return Boolean(form.querySelector('input[name="typer"], #taskTypeId, select[name="typer"]'));
  }

  function taskFormFromNode(node) {
    const form = node?.closest?.('form');
    return isTaskForm(form) ? form : null;
  }

  function visible(element) {
    if (!element || element.hidden) return false;
    if (element.type === 'hidden') return false;
    let current = element;
    for (let i = 0; current && i < 8; i += 1, current = current.parentElement) {
      if (current.hidden) return false;
      const inline = current.getAttribute?.('style') || '';
      if (/display\s*:\s*none/i.test(inline) || /visibility\s*:\s*hidden/i.test(inline)) return false;
    }
    return true;
  }

  function labelOf(element) {
    if (!element) return 'Поле формы';
    const item = element.closest?.('.item');
    const left = compact(item?.querySelector?.('.left_data')?.textContent || '', 100)
      .replace(/\(!\)\s*:?$/i, '')
      .replace(/:\s*$/, '')
      .trim();
    if (left) return left;
    const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const label = compact(explicit?.textContent || '', 100).replace(/:\s*$/, '');
    return label || compact(element.getAttribute?.('aria-label') || element.name || element.id || 'Поле формы', 100);
  }

  function parseDate(value) {
    const match = String(value || '').trim().match(DATE_RE);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
    ) return null;
    return { date, year, month, day };
  }

  function parseDateTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const parsed = parseDate(`${match[1]}.${match[2]}.${match[3]}`);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (!parsed || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const date = new Date(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0, 0);
    return { date, hour, minute };
  }

  function parseNumber(value) {
    const text = String(value || '').trim().replace(',', '.');
    if (!text) return null;
    if (!/^\d+(?:\.\d+)?$/.test(text)) return Number.NaN;
    return Number(text);
  }

  function addIssue(collection, level, code, message, elements = []) {
    if (collection.some(issue => issue.code === code)) return;
    collection.push({
      level,
      code,
      message,
      elements: Array.from(new Set(elements.filter(Boolean)))
    });
  }

  function currentTypeSelect(form) {
    return Array.from(form.querySelectorAll('select[name="typer"]')).find(select => !select.disabled) || null;
  }

  function taskContext(form) {
    if (!isTaskForm(form)) return null;
    const taskId = String(form.querySelector('#taskId, input[name="id"]')?.value || '').trim();
    const typeSelect = currentTypeSelect(form);
    const hiddenType = String(form.querySelector('#taskTypeId')?.value || '').trim();
    const hiddenNamedType = Array.from(form.querySelectorAll('input[type="hidden"][name="typer"]'))
      .map(input => String(input.value || '').trim())
      .find(Boolean) || '';
    const typeId = String(typeSelect?.value || hiddenType || hiddenNamedType || '').trim();
    const typeLabel = compact(typeSelect?.selectedOptions?.[0]?.textContent || '', 120);
    return {
      kind: 'full-task',
      mode: taskId && taskId !== '0' ? 'edit' : 'create',
      taskId,
      typeId,
      typeLabel,
      originalTypeId: hiddenType || hiddenNamedType || '',
      action: actionPath(form)
    };
  }

  function dateKnownState(form) {
    const known = form.querySelector('#date_kn_id');
    const unknown = form.querySelector('#date_unk_id');
    if (unknown && visible(unknown)) return false;
    if (known && visible(known)) return true;
    const dateInput = form.querySelector('#datedo_id, input[name="datedo"]');
    return Boolean(dateInput && visible(dateInput) && String(dateInput.value || '').trim());
  }

  function parseDummyAssignmentTokens(value) {
    const tokens = [];
    const text = String(value || '');
    const re = /\*(division|employee)_([^*]+)\*/g;
    let match;
    while ((match = re.exec(text))) {
      tokens.push({ kind: match[1], id: String(match[2] || '').trim() });
    }
    return tokens.filter(token => token.id);
  }

  function isBrigadeLabel(value) {
    return BRIGADE_LABEL_RE.test(compact(value, 160));
  }

  function isBrigadeDivision(id, label = '') {
    const key = String(id || '').trim();
    return Boolean(key && (KNOWN_CREW_DIVISION_IDS.has(key) || isBrigadeLabel(label)));
  }

  function normalizeLow(value) {
    return compact(value, 4000).toLocaleLowerCase('ru');
  }

  function classifyBuildingTypeByText(value) {
    const low = normalizeLow(value);
    if (!low) return { type: 'unknown', label: '' };
    if (/таунхаус/.test(low)) return { type: 'townhouse', label: 'таунхаус' };
    if (/частн[ыи]й\s+сектор|приватн[ийый]+\s+сектор|private\s+sector/.test(low)) {
      return { type: 'private', label: 'частный сектор' };
    }
    if (/многоквартир|багатоквартир|общежит|гуртожит|офисн|офісн|административн|адміністративн|жк\b|мкд\b/.test(low)) {
      return { type: 'non-private', label: 'ЖК/МКД' };
    }
    return { type: 'unknown', label: '' };
  }

  function explicitTerritoryForTask(context) {
    const typeId = String(context?.typeId || '');
    const label = normalizeLow(context?.typeLabel || '');
    if (typeId === '15' || typeId === '70' || /частн[ыи]й\s+сектор|приватн/.test(label)) {
      return { type: 'private', label: 'частный сектор', source: 'task-type', resolved: true };
    }
    if (typeId === '1' || typeId === '41' || /(?:^|\s)жк(?:\s|$)|многоквартир|багатоквартир/.test(label)) {
      return { type: 'non-private', label: 'ЖК/МКД', source: 'task-type', resolved: true };
    }
    return null;
  }

  function territoryAllowedCrewIds(profile) {
    if (profile?.type === 'private') return PRIVATE_SECTOR_CREW_IDS;
    if (profile?.type === 'non-private') return NON_PRIVATE_CREW_IDS;
    return null;
  }

  function territoryShortLabel(profile) {
    if (profile?.type === 'private') return 'ЧС · только Бр. 2.x';
    if (profile?.type === 'non-private') return 'ЖК/МКД · без Бр. 2.x';
    return '';
  }

  function syncTerritoryProfile(form) {
    const explicit = explicitTerritoryForTask(taskContext(form));
    if (explicit) return explicit;
    return territoryByForm.get(form)?.profile || { type: 'unknown', label: '', source: 'unresolved', resolved: false };
  }

  function evaluateCrewTerritoryPolicy(current, profile) {
    const issues = [];
    if (!current || !FIELD_VISIT_TYPES.has(String(current.typeId || ''))) {
      return { applies: false, profile, conflicts: [], issues };
    }
    const allowed = territoryAllowedCrewIds(profile);
    if (!allowed) return { applies: false, profile, conflicts: [], issues };
    const conflicts = (current.crewIds || []).map(String).filter(id => !allowed.has(id));
    if (conflicts.length) {
      const message = profile.type === 'private'
        ? 'Для частного сектора выбрана бригада не своего направления. Используйте Бр. 2.x'
        : 'Для ЖК/многоквартирного дома нельзя назначать бригаду частного сектора Бр. 2.x';
      issues.push({ level: 'error', code: 'field-crew-territory-mismatch', message, conflicts });
    }
    return { applies: true, profile, conflicts, issues };
  }

  function directBuildingId(form) {
    const candidates = [];
    form?.querySelectorAll?.('input, select, a[href*="/building/"]').forEach(element => {
      if (element.tagName === 'A') {
        candidates.push(element.getAttribute('href') || '');
        return;
      }
      const id = String(element.id || '').toLowerCase();
      const name = String(element.name || '').toLowerCase();
      if (id.includes('building') || name.includes('building')) candidates.push(element.value || '');
    });
    for (const value of candidates) {
      let match = String(value || '').match(/\/building\/(\d+)/i);
      if (match) return match[1];
      match = String(value || '').match(/(?:building_id|buildingid|building|id)["':=\s]+(\d+)/i);
      if (match) return match[1];
      if (/^\d+$/.test(String(value || '').trim()) && Number(value) > 0) return String(value).trim();
    }
    return '';
  }

  async function buildingIdFromFinalUnit(unitId) {
    const id = String(unitId || '').trim();
    if (!id || id === '0') return '';
    if (unitBuildingCache.has(id)) return unitBuildingCache.get(id);
    try {
      const response = await fetch(`/task/ajax_load_building_work_description?unit_id=${encodeURIComponent(id)}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) return '';
      const html = await response.text();
      const match = html.match(/lastBuildingSelectorValue\s*\[\s*["']task_address["']\s*\]\s*=\s*["'](\d+)["']/i);
      const buildingId = match?.[1] || '';
      if (buildingId) unitBuildingCache.set(id, buildingId);
      return buildingId;
    } catch {
      return '';
    }
  }

  async function fetchBuildingProfile(buildingId) {
    const id = String(buildingId || '').trim();
    if (!id) return { type: 'unknown', label: '', source: 'building-missing', buildingId: '', resolved: true };
    if (buildingProfileCache.has(id)) return buildingProfileCache.get(id);
    let profile = { type: 'unknown', label: '', source: 'building-fetch', buildingId: id, resolved: true };
    try {
      const response = await fetch(`/building/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        profile = { ...profile, source: `building-http-${response.status}` };
      } else {
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const text = compact(doc.body?.textContent || html, 12000);
        const low = normalizeLow(text);
        const looksLikeBuildingPage = /покрытие\s*\//.test(low) || /тип\s+здания/.test(low) || /координаты/.test(low);
        if (looksLikeBuildingPage) {
          const classified = classifyBuildingTypeByText(text);
          profile = { ...profile, ...classified, source: 'building-card' };
        } else {
          profile = { ...profile, source: 'not-building-card' };
        }
      }
    } catch {
      profile = { ...profile, source: 'building-fetch-error' };
    }
    buildingProfileCache.set(id, profile);
    return profile;
  }

  async function resolveTerritoryProfile(form, { force = false } = {}) {
    if (!form || !isTaskForm(form)) return { type: 'unknown', resolved: true };
    const explicit = explicitTerritoryForTask(taskContext(form));
    if (explicit) {
      territoryByForm.set(form, { key: `type:${taskContext(form)?.typeId || ''}`, profile: explicit, promise: null });
      refreshTerritoryPresentation(form);
      return explicit;
    }

    const address = finalAddressIds(form);
    const directId = directBuildingId(form) || (address.buildingId !== '0' ? address.buildingId : '');
    const key = `addr:${address.unitId || '0'}:${directId || '0'}`;
    const existing = territoryByForm.get(form);
    if (!force && existing?.key === key) {
      if (existing.promise) return existing.promise;
      if (existing.profile?.resolved) return existing.profile;
    }

    const holder = { key, profile: { type: 'unknown', label: '', source: 'pending', resolved: false }, promise: null };
    territoryByForm.set(form, holder);
    holder.promise = (async () => {
      let buildingId = directId;
      if (!buildingId && address.unitId && address.unitId !== '0') buildingId = await buildingIdFromFinalUnit(address.unitId);
      const profile = buildingId
        ? await fetchBuildingProfile(buildingId)
        : { type: 'unknown', label: '', source: 'address-not-resolved', buildingId: '', resolved: true };
      holder.profile = profile;
      holder.promise = null;
      if (form.isConnected !== false) refreshTerritoryPresentation(form);
      return profile;
    })();
    return holder.promise;
  }

  function divisionLabels(form) {
    const labels = new Map();

    Array.from(form.querySelectorAll('input[name^="division_auto_task_staffids"], input[name^="division_task_staffids"]'))
      .forEach(input => {
        const id = String(input.value || '').trim();
        const label = compact(input.closest?.('.div_space2')?.textContent || input.parentElement?.textContent || '', 160);
        if (id && label) labels.set(id, label);
      });

    Array.from(form.querySelectorAll(`[${EDIT_CREW_DIVISION_ATTR}]`)).forEach(input => {
      const id = String(input.getAttribute(EDIT_CREW_DIVISION_ATTR) || input.value || '').trim();
      const label = compact(input.closest?.('[data-simnet-wb-edit-crew-row]')?.textContent || input.parentElement?.textContent || '', 160);
      if (id && label) labels.set(id, label);
    });

    Array.from(form.querySelectorAll('a[href*="/employee/division_show?id="]')).forEach(link => {
      let id = '';
      try { id = new URL(String(link.getAttribute('href') || ''), location.href).searchParams.get('id') || ''; } catch {}
      const label = compact(link.textContent || '', 160);
      if (id && label) labels.set(String(id), label);
    });

    return labels;
  }

  function nativeStaffValidationElements(form) {
    if (!(form instanceof HTMLFormElement)) return [];
    return Array.from(form.querySelectorAll([
      'input[name="division_task_staffids[]"]',
      'input[name="division_auto_task_staffids[]"]',
      'select[name="division_task_staffids[]"]',
      'select[name="division_auto_task_staffids[]"]',
      '#dummy_pers_id',
      '#employeeFindInputtask_staffId'
    ].join(',')));
  }

  function restoreNativeStaffValidation(form) {
    nativeStaffValidationElements(form).forEach(element => {
      if (!element.hasAttribute(NATIVE_STAFF_VALIDATION_ATTR)) return;
      if (element.getAttribute(NATIVE_STAFF_REQUIRED_ATTR) === '1') element.setAttribute('required', '');
      else element.removeAttribute('required');
      const aria = element.getAttribute(NATIVE_STAFF_ARIA_REQUIRED_ATTR);
      if (aria && aria !== '__missing__') element.setAttribute('aria-required', aria);
      else element.removeAttribute('aria-required');
      element.removeAttribute(NATIVE_STAFF_VALIDATION_ATTR);
      element.removeAttribute(NATIVE_STAFF_REQUIRED_ATTR);
      element.removeAttribute(NATIVE_STAFF_ARIA_REQUIRED_ATTR);
    });
  }

  function normalizeNativeStaffValidation(form) {
    // v1.7.36.47/.48 temporarily neutralized UserSide's own constraint validation on staff fields.
    // That was too invasive: connection/PON forms can have native task-specific validation tied to
    // the same form lifecycle. Restore any attributes left by a previous Workbench instance and then
    // leave native UserSide controls untouched. Workbench validates the brigade invariant in parallel.
    restoreNativeStaffValidation(form);
    return nativeStaffValidationElements(form).length;
  }

  function restoreNativeConstraintGate(form) {
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute(NATIVE_FORM_NOVALIDATE_ATTR)) return;
    form.noValidate = form.getAttribute(NATIVE_FORM_NOVALIDATE_ATTR) === '1';
    form.removeAttribute(NATIVE_FORM_NOVALIDATE_ATTR);
  }

  function syncNativeConstraintGate(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    // Preserve UserSide's own browser validation. If .48 already touched this live DOM, put the
    // original state back. We no longer set noValidate for field tasks.
    restoreNativeConstraintGate(form);
    return false;
  }

  function assignmentElements(form) {
    return Array.from(form.querySelectorAll([
      'input[name^="division_auto_task_staffids"]',
      'input[name^="division_task_staffids"]',
      'input[name*="task_staff"]',
      'select[name*="task_staff"]'
    ].join(',')));
  }

  function assignmentState(form) {
    const tokens = [];
    const dummy = form.querySelector('#dummy_pers_id');
    tokens.push(...parseDummyAssignmentTokens(dummy?.value));

    Array.from(form.querySelectorAll('input[name^="division_auto_task_staffids"], input[name^="division_task_staffids"]'))
      .filter(input => input.checked && !input.disabled && String(input.value || '').trim())
      .forEach(input => tokens.push({ kind: 'division', id: String(input.value).trim() }));

    // EDIT picker inputs are UI-only and intentionally have no successful-control name. They still
    // participate in Workbench validation/state through this dedicated attribute.
    Array.from(form.querySelectorAll(`[${EDIT_CREW_DIVISION_ATTR}]`))
      .filter(input => input.checked && String(input.getAttribute(EDIT_CREW_DIVISION_ATTR) || input.value || '').trim())
      .forEach(input => tokens.push({
        kind: 'division',
        id: String(input.getAttribute(EDIT_CREW_DIVISION_ATTR) || input.value).trim()
      }));

    assignmentElements(form)
      .filter(element => (
        !String(element.name || '').startsWith('division_auto_task_staffids')
        && !String(element.name || '').startsWith('division_task_staffids')
        && element.id !== 'employeeFindInputtask_staffId'
        && !element.disabled
      ))
      .forEach(element => {
        if (element instanceof HTMLSelectElement) {
          Array.from(element.selectedOptions || []).forEach(option => {
            const id = String(option.value || '').trim();
            if (id && id !== '0') tokens.push({ kind: 'other', id });
          });
          return;
        }
        const type = String(element.type || '').toLowerCase();
        const id = String(element.value || '').trim();
        if ((type === 'checkbox' || type === 'radio') && element.checked && id && id !== '0') {
          tokens.push({ kind: 'other', id });
        } else if (type === 'hidden' && id && id !== '0') {
          tokens.push({ kind: 'other', id });
        }
      });

    const unique = [];
    const seen = new Set();
    tokens.forEach(token => {
      const key = `${token.kind}:${token.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(token);
    });

    const divisionIds = unique.filter(token => token.kind === 'division').map(token => token.id);
    const labels = divisionLabels(form);
    const crewIds = divisionIds.filter(id => isBrigadeDivision(id, labels.get(id) || ''));
    return {
      tokens: unique,
      divisionIds,
      divisionLabels: Object.fromEntries(Array.from(labels.entries())),
      crewIds,
      hasCrew: crewIds.length > 0,
      hasAssignment: unique.length > 0,
      hasKnownL1Division: divisionIds.some(id => KNOWN_L1_DIVISION_IDS.has(id))
    };
  }

  function hasAssignment(form) {
    return assignmentState(form).hasAssignment;
  }

  function assignmentRequired(form) {
    return Boolean(
      form.querySelector('#employeeMultiSelectorErrortask_staffId')
      || form.querySelector('#auto_pers_id')
      || form.querySelector('[name^="division_auto_task_staffids"]')
    );
  }

  function snapshotTaskState(form) {
    const context = taskContext(form);
    if (!context) return null;
    const dateInput = form.querySelector('#datedo_id, input[name="datedo"]');
    const hourInput = form.querySelector('#timedo_id, input[name="timedo"]');
    const minuteInput = form.querySelector('#timedo_id2, input[name="timedo2"]');
    const date = String(dateInput?.value || '').trim();
    const hour = String(hourInput?.value || '').trim();
    const minute = String(minuteInput?.value || '').trim();
    const dateKnown = dateKnownState(form);
    const parsedDate = dateKnown ? parseDate(date) : null;
    const timeComplete = Boolean(hour && minute);
    const timeValid = timeComplete
      && /^\d{1,2}$/.test(hour)
      && /^\d{1,2}$/.test(minute)
      && Number(hour) >= 0
      && Number(hour) <= 23
      && Number(minute) >= 0
      && Number(minute) <= 59;
    const plannedAt = parsedDate && timeValid
      ? new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day, Number(hour), Number(minute), 0, 0).getTime()
      : null;
    const assignment = assignmentState(form);
    return {
      mode: context.mode,
      taskId: context.taskId,
      typeId: context.typeId,
      typeLabel: context.typeLabel,
      dateKnown,
      date,
      hour,
      minute,
      dateValid: Boolean(parsedDate),
      timeComplete,
      timeValid,
      plannedAt,
      hasAssignment: assignment.hasAssignment,
      hasCrew: assignment.hasCrew,
      crewIds: assignment.crewIds,
      divisionIds: assignment.divisionIds,
      hasKnownL1Division: assignment.hasKnownL1Division
    };
  }

  function scheduleChanged(before, after) {
    if (!before || !after) return false;
    return before.dateKnown !== after.dateKnown
      || before.date !== after.date
      || before.hour !== after.hour
      || before.minute !== after.minute;
  }

  function assignmentsChanged(before, after) {
    if (!before || !after) return false;
    const a = [...(before.divisionIds || [])].sort().join(',');
    const b = [...(after.divisionIds || [])].sort().join(',');
    return before.hasAssignment !== after.hasAssignment || a !== b;
  }

  function evaluateFieldVisitPolicy(current, baseline = null, options = {}) {
    const issues = [];
    if (!current || !FIELD_VISIT_TYPES.has(String(current.typeId || ''))) {
      return { applies: false, strict: false, typeChanged: false, minLeadRequired: false, issues };
    }

    const typeChanged = Boolean(
      current.mode === 'edit'
      && baseline?.typeId
      && String(baseline.typeId) !== String(current.typeId)
    );

    // Field-visit task is valid only when the final form has a real brigade and a valid schedule.
    // This is intentionally strict for CREATE and EDIT: brigade is the key invariant.
    const strict = true;

    if (!current.dateKnown || !current.dateValid) {
      issues.push({ level: 'error', code: 'field-date-required', message: 'Для выездной заявки укажите корректную дату работ' });
    }
    if (!current.timeComplete || !current.timeValid) {
      issues.push({ level: 'error', code: 'field-time-required', message: 'Для выездной заявки укажите корректное время работ' });
    }
    if (!current.hasCrew) {
      issues.push({
        level: 'error',
        code: 'field-crew-required',
        message: 'Для выездной заявки должна быть выбрана бригада «Бр. …»'
      });
    }

    // One invariant for every entry point. A field visit always needs a future schedule.
    // New field work (CREATE, non-field -> field, or an operator-edited schedule) must be >= now + 3 hours.
    // An already scheduled field task may be edited without forcing its unchanged future appointment forward,
    // but an appointment that is already in the past can never be saved as a field visit.
    const scheduleWasChanged = Boolean(current.mode === 'edit' && baseline && scheduleChanged(baseline, current));
    const minLeadRequired = Boolean(current.mode === 'create' || typeChanged || scheduleWasChanged);
    const nowMs = options.now instanceof Date
      ? options.now.getTime()
      : Number.isFinite(Number(options.nowMs))
        ? Number(options.nowMs)
        : Date.now();
    const hasValidPlannedAt = Boolean(
      current.dateKnown
      && current.dateValid
      && current.timeComplete
      && current.timeValid
      && Number.isFinite(Number(current.plannedAt))
    );

    if (hasValidPlannedAt && Number(current.plannedAt) < nowMs - FIELD_PAST_GRACE_MS) {
      issues.push({
        level: 'error',
        code: 'field-time-past',
        message: 'Время выезда не может быть в прошлом'
      });
    } else if (minLeadRequired && hasValidPlannedAt && Number(current.plannedAt) < nowMs + FIELD_MIN_LEAD_MS) {
      const message = current.mode === 'create'
        ? 'Время выезда должно быть не раньше чем через 3 часа от момента создания заявки'
        : typeChanged
          ? 'При переоформлении в выездную время работ должно быть не раньше чем через 3 часа от текущего момента'
          : 'Новое время работ должно быть не раньше чем через 3 часа от текущего момента';
      issues.push({ level: 'error', code: 'field-time-min-lead', message });
    }

    return {
      applies: true,
      strict,
      typeChanged,
      minLeadRequired,
      sourceTypeId: baseline?.typeId || '',
      targetTypeId: current.typeId,
      issues
    };
  }

  function transitionStorageKey(taskId) {
    return `${TRANSITION_KEY_PREFIX}${String(taskId || '')}`;
  }

  function savePendingTransition(taskId, sourceSnapshot, targetTypeId) {
    if (!taskId || !sourceSnapshot?.typeId) return;
    try {
      sessionStorage.setItem(transitionStorageKey(taskId), JSON.stringify({
        savedAt: Date.now(),
        taskId: String(taskId),
        targetTypeId: String(targetTypeId || ''),
        source: sourceSnapshot
      }));
    } catch {}
  }

  function loadPendingTransition(taskId, currentTypeId) {
    if (!taskId) return null;
    try {
      const raw = sessionStorage.getItem(transitionStorageKey(taskId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > TRANSITION_TTL_MS) {
        sessionStorage.removeItem(transitionStorageKey(taskId));
        return null;
      }
      if (String(parsed.taskId || '') !== String(taskId)) return null;
      if (parsed.targetTypeId && String(parsed.targetTypeId) !== String(currentTypeId || '')) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function clearPendingTransition(taskId) {
    if (!taskId) return;
    try { sessionStorage.removeItem(transitionStorageKey(taskId)); } catch {}
  }

  function ensureBaseline(form) {
    let holder = baselineByForm.get(form);
    if (holder) return holder;
    const current = snapshotTaskState(form);
    if (!current) return null;
    const pending = current.mode === 'edit' ? loadPendingTransition(current.taskId, current.typeId) : null;
    const effective = pending?.source?.typeId && String(pending.source.typeId) !== String(current.typeId)
      ? pending.source
      : current;
    holder = { initial: current, effective, pending };
    baselineByForm.set(form, holder);
    return holder;
  }

  function handleTypeChange(form) {
    const context = taskContext(form);
    if (!context || context.mode !== 'edit') return;
    const holder = ensureBaseline(form);
    const current = snapshotTaskState(form);
    if (!holder || !current) return;
    const source = holder.effective || holder.initial;
    if (!source?.typeId) return;

    if (String(current.typeId) === String(source.typeId)) {
      holder.pending = null;
      clearPendingTransition(current.taskId);
      return;
    }

    holder.pending = {
      savedAt: Date.now(),
      taskId: current.taskId,
      targetTypeId: current.typeId,
      source
    };
    savePendingTransition(current.taskId, source, current.typeId);
  }

  function assignmentMarkTarget(form) {
    return form.querySelector('#auto_pers_id')
      || form.querySelector('#dummy_pers_id')?.closest?.('.table_block')
      || form.querySelector('#employeeMultiSelectorBodytask_staffId')
      || form.querySelector('#employeeFindInputtask_staffId');
  }

  function assignmentVisualTargets(form) {
    const targets = [
      nativeStaffLabel(form),
      nativeStaffBlock(form),
      editCrewPicker(form),
      form.querySelector('#auto_pers_id'),
      form.querySelector('#employeeMultiSelectorBodytask_staffId'),
      form.querySelector('#employeeFindInputtask_staffId')
    ].filter(Boolean);
    return Array.from(new Set(targets.filter(element => visible(element) || element === nativeStaffBlock(form) || element === editCrewPicker(form))));
  }

  function policyElements(form, code) {
    const dateInput = form.querySelector('#datedo_id, input[name="datedo"]');
    const hourInput = form.querySelector('#timedo_id, input[name="timedo"]');
    const minuteInput = form.querySelector('#timedo_id2, input[name="timedo2"]');
    if (code === 'field-date-required') return [dateInput, form.querySelector('#date_unk_id')].filter(Boolean);
    if (code === 'field-time-required' || code === 'field-time-past' || code === 'field-time-min-lead') return [dateInput, hourInput, minuteInput].filter(Boolean);
    if (code === 'field-edit-schedule-invalid') return [dateInput, hourInput, minuteInput].filter(Boolean);
    if (code === 'field-crew-required' || code === 'field-assignment-required' || code === 'field-edit-assignment-removed' || code === 'field-crew-territory-mismatch') {
      return assignmentVisualTargets(form);
    }
    return [];
  }

  function validateTaskForm(form, options = {}) {
    const issues = [];
    const now = options.now instanceof Date ? options.now : new Date();
    const holder = ensureBaseline(form);

    // 1) Native required declarations remain the primary source for native additional fields.
    Array.from(form.querySelectorAll('[required]')).forEach(element => {
      if (!visible(element) || element.disabled) return;
      let missing = false;
      if (element instanceof HTMLSelectElement) {
        missing = !String(element.value || '').trim();
      } else if (element.type === 'checkbox' || element.type === 'radio') {
        if (element.name) {
          const group = Array.from(form.elements).filter(candidate => candidate?.name === element.name);
          missing = !group.some(candidate => candidate.checked);
        } else {
          missing = !element.checked;
        }
      } else {
        missing = !String(element.value || '').trim();
      }
      if (missing) {
        addIssue(issues, 'error', `required:${element.name || element.id}`, `Заполните: ${labelOf(element)}`, [element]);
      }
    });

    // 2) Planned work date/time. Generic forms may use "date unknown"; field-visit policy below decides when that is forbidden.
    const dateInput = form.querySelector('#datedo_id, input[name="datedo"]');
    const hourInput = form.querySelector('#timedo_id, input[name="timedo"]');
    const minuteInput = form.querySelector('#timedo_id2, input[name="timedo2"]');
    const dateKnown = dateKnownState(form);
    let workDateTime = null;

    if (dateInput && dateKnown && String(dateInput.value || '').trim()) {
      const parsed = parseDate(dateInput.value);
      if (!parsed) {
        addIssue(issues, 'error', 'work-date-invalid', `Некорректная дата работ: ${compact(dateInput.value, 30)}`, [dateInput]);
      } else {
        const hourText = String(hourInput?.value || '').trim();
        const minuteText = String(minuteInput?.value || '').trim();
        if (!hourText || !minuteText) {
          addIssue(issues, 'warn', 'work-time-missing', 'Дата указана, но время работ заполнено не полностью', [hourInput, minuteInput]);
        } else if (!/^\d{1,2}$/.test(hourText) || !/^\d{1,2}$/.test(minuteText)) {
          addIssue(issues, 'error', 'work-time-format', 'Время работ должно быть в формате ЧЧ:ММ', [hourInput, minuteInput]);
        } else {
          const hour = Number(hourText);
          const minute = Number(minuteText);
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            addIssue(issues, 'error', 'work-time-range', `Некорректное время работ: ${hourText}:${minuteText}`, [hourInput, minuteInput]);
          } else {
            workDateTime = new Date(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0, 0);
            if (workDateTime.getTime() < now.getTime() - 60_000) {
              addIssue(issues, 'warn', 'work-time-past', `Плановое время уже прошло: ${dateInput.value} ${hourText.padStart(2, '0')}:${minuteText.padStart(2, '0')}`, [dateInput, hourInput, minuteInput]);
            }
          }
        }
      }
    }

    // 3) Duration/deadline: validate each native field, but do not warn merely because UserSide fills both forms of deadline.
    const deadlineHours = form.querySelector('#deadline_id, input[name="deadline"]');
    const deadlineDate = form.querySelector('#deadlineDateId, input[name="deadline_date"]');
    const timeToWork = form.querySelector('#timeToWorkId, input[name="time_to_work"]');
    const deadlineHoursValue = String(deadlineHours?.value || '').trim();
    const deadlineDateValue = String(deadlineDate?.value || '').trim();

    if (deadlineHoursValue) {
      const parsed = parseNumber(deadlineHoursValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        addIssue(issues, 'error', 'deadline-hours-invalid', '«Время на выполнение с даты принятия» должно быть положительным числом часов', [deadlineHours]);
      }
    }
    if (deadlineDateValue) {
      const parsed = parseDateTime(deadlineDateValue);
      if (!parsed) {
        addIssue(issues, 'error', 'deadline-date-invalid', 'Срок «до» должен быть в формате ДД.ММ.ГГГГ ЧЧ:ММ', [deadlineDate]);
      } else if (workDateTime && parsed.date.getTime() < workDateTime.getTime()) {
        addIssue(issues, 'warn', 'deadline-before-work', 'Срок выполнения стоит раньше запланированного начала работ', [deadlineDate, dateInput, hourInput, minuteInput]);
      }
    }
    if (timeToWork && String(timeToWork.value || '').trim()) {
      const parsed = parseNumber(timeToWork.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        addIssue(issues, 'error', 'time-to-work-invalid', '«Время на выполнение с даты начала работ» должно быть положительным числом', [timeToWork]);
      }
    }

    // 4) Native assignment requirement.
    if (assignmentRequired(form) && !hasAssignment(form)) {
      addIssue(issues, 'error', 'assignment-missing', 'Не выбрана бригада/исполнитель', [assignmentMarkTarget(form)]);
    }

    // 5) Confirmed phase-2 field-visit policies.
    const current = snapshotTaskState(form);
    const baseline = holder?.effective || holder?.initial || null;
    const policy = evaluateFieldVisitPolicy(current, baseline, { now });
    if (policy.issues.some(issue => issue.code === 'field-crew-required')) {
      const genericAssignmentIndex = issues.findIndex(issue => issue.code === 'assignment-missing');
      if (genericAssignmentIndex >= 0) issues.splice(genericAssignmentIndex, 1);
    }
    policy.issues.forEach(issue => {
      addIssue(issues, issue.level, issue.code, issue.message, policyElements(form, issue.code));
    });

    const territoryProfile = syncTerritoryProfile(form);
    const territoryPolicy = evaluateCrewTerritoryPolicy(current, territoryProfile);
    territoryPolicy.issues.forEach(issue => {
      addIssue(issues, issue.level, issue.code, issue.message, policyElements(form, issue.code));
    });

    // If field-visit policy upgrades incomplete time to a blocker, do not also show the weaker generic warning.
    if (policy.issues.some(issue => issue.code === 'field-time-required' || issue.code === 'field-time-past' || issue.code === 'field-time-min-lead' || issue.code === 'field-edit-schedule-invalid')) {
      const missingIndex = issues.findIndex(issue => issue.code === 'work-time-missing');
      if (missingIndex >= 0) issues.splice(missingIndex, 1);
      if (policy.issues.some(issue => issue.code === 'field-time-past' || issue.code === 'field-time-min-lead')) {
        const pastIndex = issues.findIndex(issue => issue.code === 'work-time-past');
        if (pastIndex >= 0) issues.splice(pastIndex, 1);
      }
    }

    const errors = issues.filter(issue => issue.level === 'error');
    const warnings = issues.filter(issue => issue.level === 'warn');
    const context = taskContext(form) || {};
    return {
      typer: context.typeId || '',
      mode: context.mode || 'create',
      valid: errors.length === 0,
      policy,
      territoryPolicy,
      errors,
      warnings,
      issues
    };
  }

  function clearMarks(form) {
    form.querySelectorAll(`.${ERROR_CLASS}, .${WARN_CLASS}`).forEach(element => {
      element.classList.remove(ERROR_CLASS, WARN_CLASS);
    });
  }

  function markIssues(form, result) {
    clearMarks(form);
    result.errors.forEach(issue => issue.elements.forEach(element => element?.classList?.add(ERROR_CLASS)));
    result.warnings.forEach(issue => issue.elements.forEach(element => {
      if (!element?.classList?.contains(ERROR_CLASS)) element?.classList?.add(WARN_CLASS);
    }));
  }

  function ensureSummary(form) {
    let summary = document.querySelector(`.${SUMMARY_CLASS}[data-simnet-wb-owned="1"]`);
    if (summary) return summary;
    summary = document.createElement('div');
    summary.className = SUMMARY_CLASS;
    summary.dataset.simnetWbOwned = '1';
    summary.hidden = true;
    summary.setAttribute('role', 'status');
    (document.body || document.documentElement).appendChild(summary);
    return summary;
  }

  function renderSummary(form, result) {
    const summary = ensureSummary(form);
    const advisoryOnly = Boolean(result?.advisoryOnly);
    const items = advisoryOnly ? (result?.warnings || []) : (result?.errors || []);
    if (!items.length) {
      summary.hidden = true;
      summary.innerHTML = '';
      summary.removeAttribute('data-level');
      return;
    }

    summary.innerHTML = '';
    summary.dataset.level = advisoryOnly ? 'warn' : 'error';
    summary.setAttribute('role', advisoryOnly ? 'status' : 'alert');
    summary.setAttribute('aria-live', advisoryOnly ? 'polite' : 'assertive');
    const title = document.createElement('div');
    title.className = 'wb-task-title';
    title.textContent = advisoryOnly ? 'Проверь выездную заявку' : 'Заявка не сохранена';
    const message = document.createElement('div');
    message.className = 'wb-task-message';
    const list = document.createElement('ul');
    list.className = 'wb-task-list';
    items.slice(0, 4).forEach(issue => {
      const item = document.createElement('li');
      item.textContent = issue.message;
      list.appendChild(item);
    });
    if (items.length > 4) {
      const item = document.createElement('li');
      item.textContent = `Ещё ${items.length - 4}`;
      list.appendChild(item);
    }
    message.appendChild(list);
    summary.append(title, message);
    summary.hidden = false;
  }

  function createFieldVisitAdvisory(form, options = {}) {
    const context = taskContext(form);
    if (!context || context.mode !== 'create' || !FIELD_VISIT_TYPES.has(String(context.typeId || ''))) return null;
    const current = snapshotTaskState(form);
    if (!current) return null;
    const now = options.now instanceof Date ? options.now : new Date();
    const policy = evaluateFieldVisitPolicy(current, null, { now });
    const errors = [];
    const warnings = [];

    // CREATE keeps UserSide's native staff controls, but Workbench owns the same hard invariant as EDIT:
    // a real brigade, a valid date/time, and a field visit no earlier than now + 3 hours.
    // This applies identically whether CREATE was opened blank, from a customer card or from calendar.
    policy.issues.forEach(issue => {
      const target = CREATE_SCHEDULE_BLOCKING_CODES.has(issue.code) ? errors : warnings;
      addIssue(
        target,
        CREATE_SCHEDULE_BLOCKING_CODES.has(issue.code) ? 'error' : 'warn',
        issue.code,
        issue.message,
        policyElements(form, issue.code)
      );
    });
    return {
      typer: context.typeId || '',
      mode: 'create',
      valid: errors.length === 0,
      advisoryOnly: errors.length === 0,
      policy,
      territoryPolicy: { applies: false, conflicts: [], issues: [] },
      errors,
      warnings,
      issues: [...errors, ...warnings]
    };
  }

  function logValidation(form, result, phase) {
    if (!result.issues.length) return;
    try {
      console.groupCollapsed?.(`[SIMNET WB][TASK FORM] typer=${result.typer || '?'} · ${result.mode} · ${phase} · errors=${result.errors.length} warnings=${result.warnings.length}`);
      if (result.policy?.applies) console.info?.('policy', result.policy);
      console.table?.(result.issues.map(issue => ({
        level: issue.level,
        code: issue.code,
        message: issue.message
      })));
      console.groupEnd?.();
    } catch {}
  }

  function sortStaffRowsCrewFirst(root, rows) {
    if (!root || !rows?.length) return rows || [];
    const ordered = [...rows].sort((a, b) => {
      const ai = a.querySelector('input[name^="division_auto_task_staffids"], input[name^="division_task_staffids"]');
      const bi = b.querySelector('input[name^="division_auto_task_staffids"], input[name^="division_task_staffids"]');
      const aCrew = isBrigadeDivision(String(ai?.value || ''), compact(a.textContent, 160));
      const bCrew = isBrigadeDivision(String(bi?.value || ''), compact(b.textContent, 160));
      return Number(bCrew) - Number(aCrew);
    });
    ordered.forEach(row => root.appendChild(row));
    return ordered;
  }

  function filterStaff(form, query) {
    const root = form.querySelector('#auto_pers_id');
    if (!root) return { total: 0, visible: 0, territory: '' };
    const needle = compact(query, 120).toLocaleLowerCase('ru');
    const fieldVisit = FIELD_VISIT_TYPES.has(String(taskContext(form)?.typeId || ''));
    const profile = fieldVisit ? syncTerritoryProfile(form) : { type: 'unknown', label: '', resolved: true };
    const allowed = fieldVisit ? territoryAllowedCrewIds(profile) : null;
    const rows = sortStaffRowsCrewFirst(root, Array.from(root.querySelectorAll('.div_space2')).filter(row => row.querySelector('input[name^="division_auto_task_staffids"]')));
    let shown = 0;
    rows.forEach(row => {
      const input = row.querySelector(`[${EDIT_CREW_DIVISION_ATTR}]`);
      const id = String(input?.getAttribute(EDIT_CREW_DIVISION_ATTR) || input?.value || '').trim();
      const checked = Boolean(input?.checked);
      const label = compact(row.textContent, 200);
      const crew = isBrigadeDivision(id, label);
      const territoryOk = !crew || !allowed || allowed.has(id);
      const match = !needle || label.toLocaleLowerCase('ru').includes(needle);
      const textVisible = checked || match;
      const show = textVisible && (checked || territoryOk);
      row.classList.toggle('simnet-wb-task-territory-mismatch', Boolean(checked && crew && !territoryOk));
      row.style.display = show ? '' : 'none';
      if (show) shown += 1;
    });
    return { total: rows.length, visible: shown, territory: territoryShortLabel(profile) };
  }

  function refreshTerritoryPresentation(form) {
    if (!form || !isTaskForm(form)) return;
    const nativeSearch = form.querySelector(`[${FILTER_ATTR}] input`);
    const nativeMeta = form.querySelector('.simnet-wb-task-staff-filter-meta');
    if (nativeSearch && nativeMeta) {
      const stats = filterStaff(form, nativeSearch.value || '');
      nativeMeta.textContent = stats.total
        ? `${stats.visible} из ${stats.total}${stats.territory ? ` · ${stats.territory}` : ''}`
        : (stats.territory || '');
    }
    const wrap = editCrewPicker(form);
    if (wrap) {
      const search = wrap.querySelector('.simnet-wb-edit-crew-search');
      filterEditCrewPicker(wrap, search?.value || '');
      const territory = wrap.querySelector('.simnet-wb-edit-crew-territory');
      if (territory) territory.textContent = territoryShortLabel(syncTerritoryProfile(form));
    }
  }

  function ensureStaffFilter(form) {
    const context = taskContext(form);
    if (context?.mode === 'create') {
      // CREATE is a native UserSide authority. The auto-staff block is reloaded by UserSide when
      // customer/date/time changes, so Workbench must not wrap, sort, hide or otherwise decorate it.
      form.querySelector(`[${FILTER_ATTR}]`)?.remove();
      return;
    }
    const root = form.querySelector('#auto_pers_id');
    if (!root || form.querySelector(`[${FILTER_ATTR}]`)) return;
    const wrap = document.createElement('div');
    wrap.className = 'simnet-wb-task-staff-filter-wrap';
    wrap.dataset.simnetWbOwned = '1';
    wrap.setAttribute(FILTER_ATTR, '1');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'input_box';
    input.placeholder = 'Фильтр бригад / отделов…';
    input.autocomplete = 'off';
    input.dataset.simnetWbOwned = '1';
    const meta = document.createElement('span');
    meta.className = 'simnet-wb-task-staff-filter-meta';
    const update = () => {
      const stats = filterStaff(form, input.value);
      meta.textContent = stats.total ? `${stats.visible} из ${stats.total}${stats.territory ? ` · ${stats.territory}` : ''}` : (stats.territory || '');
    };
    input.addEventListener('input', update);
    wrap.append(input, meta);
    root.parentNode?.insertBefore(wrap, root);
    update();
  }

  function customerIdForStaff(form) {
    const candidates = Array.from(form.querySelectorAll('select[name^="ins_customer_id_list"], input[name^="ins_customer_id_list"]'));
    for (const field of candidates) {
      const value = String(field.value || '').trim();
      if (value && value !== '0' && value !== '-100') return value;
    }
    return '';
  }

  function finalAddressIds(form) {
    const selected = Array.from(form.querySelectorAll('select[name^="address_unit_selectortask_address"]'))
      .map(select => String(select.value || '').trim())
      .filter(value => value && value !== '0');
    return {
      unitId: selected.at(-1) || '0',
      buildingId: String(form.querySelector('[id^="buildingId"]')?.value || '0').trim() || '0'
    };
  }

  function autoStaffUrl(form) {
    const current = snapshotTaskState(form);
    const { unitId, buildingId } = finalAddressIds(form);
    const params = new URLSearchParams({
      typer: String(current?.typeId || ''),
      unit_id: unitId,
      building_id: buildingId,
      node_id: '0',
      customer_id: customerIdForStaff(form) || '0',
      date: current?.dateKnown ? String(current.date || '') : '',
      time: String(current?.hour || ''),
      selected_division_id: '',
      selected_employee_id: ''
    });
    return `${RELOAD_AUTO_STAFF_PATH}?${params.toString()}`;
  }

  function editCrewPicker(form) {
    return form.querySelector(`[${EDIT_CREW_ATTR}]`);
  }

  function isFieldVisitTransition(form) {
    const context = taskContext(form);
    if (!context || context.mode !== 'edit' || !FIELD_VISIT_TYPES.has(String(context.typeId || ''))) return false;
    const holder = ensureBaseline(form);
    const baseline = holder?.effective || holder?.initial || null;
    return Boolean(baseline?.typeId && String(baseline.typeId) !== String(context.typeId));
  }

  function originalDummyValue(form) {
    const dummy = form.querySelector('#dummy_pers_id');
    if (!dummy) return '';
    if (!Object.prototype.hasOwnProperty.call(dummy.dataset, 'simnetWbOriginalValue')) {
      dummy.dataset.simnetWbOriginalValue = String(dummy.value || '');
    }
    return String(dummy.dataset.simnetWbOriginalValue || '');
  }

  function removedDivisionIds(wrap) {
    return new Set(String(wrap?.dataset?.removedDivisionIds || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean));
  }

  function setDivisionRemoved(wrap, divisionId, removed) {
    if (!wrap) return;
    const id = String(divisionId || '').trim();
    if (!id) return;
    const ids = removedDivisionIds(wrap);
    if (removed) ids.add(id);
    else ids.delete(id);
    wrap.dataset.removedDivisionIds = Array.from(ids).join(',');
  }

  function divisionIdFromNativeItem(item) {
    const link = item?.querySelector?.('a[href*="/employee/division_show?id="]');
    if (!link) return '';
    try {
      return String(new URL(String(link.getAttribute('href') || ''), location.href).searchParams.get('id') || '').trim();
    } catch {
      return '';
    }
  }

  function nativeStaffBlock(form) {
    return form?.querySelector?.('#dummy_pers_id')?.closest?.('.table_block') || null;
  }

  function nativeStaffLabel(form) {
    const block = nativeStaffBlock(form);
    const previous = block?.previousElementSibling;
    if (previous?.classList?.contains('label_h3_hr')) return previous;
    return null;
  }

  function syncNativeAssignmentChips(form, wrap) {
    const block = nativeStaffBlock(form);
    if (!block || !wrap) return;
    const selected = new Set(assignmentState(form).divisionIds.map(String));
    Array.from(block.querySelectorAll(':scope > .item')).forEach(item => {
      const id = divisionIdFromNativeItem(item);
      if (!id) return;
      const row = item.querySelector(':scope > div') || item.firstElementChild;
      if (!row) return;
      item.classList.toggle('simnet-wb-native-assignment-removed', !selected.has(id));
      let button = row.querySelector(`[${NATIVE_ASSIGNMENT_REMOVE_ATTR}]`);
      if (!button) {
        const label = compact(row.querySelector('a[href*="/employee/division_show"]')?.textContent || `division ${id}`, 100);
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'simnet-wb-native-assignment-remove';
        button.setAttribute(NATIVE_ASSIGNMENT_REMOVE_ATTR, id);
        button.setAttribute('title', `Снять назначение: ${label}`);
        button.setAttribute('aria-label', `Снять назначение: ${label}`);
        button.textContent = '×';
        button.dataset.simnetWbOwned = '1';
        button.addEventListener('click', () => {
          removeDivisionFromEditCrew(form, wrap, id);
        });
        row.appendChild(button);
      }
    });
  }

  function removeDivisionFromEditCrew(form, wrap, divisionId) {
    if (!form || !wrap) return false;
    const id = String(divisionId || '').trim();
    if (!id) return false;
    setDivisionRemoved(wrap, id, true);
    let changed = false;
    Array.from(wrap.querySelectorAll(`[${EDIT_CREW_DIVISION_ATTR}]`)).forEach(input => {
      if (String(input.value || '').trim() !== id || !input.checked) return;
      input.checked = false;
      changed = true;
    });
    syncEditCrewSelection(form, wrap);
    syncNativeAssignmentChips(form, wrap);
    validateAndRender(form, 'change');
    return changed || true;
  }

  function syncEditCrewSelection(form, wrap) {
    const dummy = form.querySelector('#dummy_pers_id');
    if (!dummy || !wrap) return;
    const originalTokens = parseDummyAssignmentTokens(originalDummyValue(form));
    const removed = removedDivisionIds(wrap);
    const represented = new Set(Array.from(wrap.querySelectorAll(`[${EDIT_CREW_DIVISION_ATTR}]`))
      .map(input => String(input.getAttribute(EDIT_CREW_DIVISION_ATTR) || input.value || '').trim()).filter(Boolean));
    const selectedDivisions = Array.from(wrap.querySelectorAll(`[${EDIT_CREW_DIVISION_ATTR}]:checked`))
      .map(input => String(input.getAttribute(EDIT_CREW_DIVISION_ATTR) || input.value || '').trim()).filter(id => id && !removed.has(id));
    const preserved = originalTokens.filter(token => token.kind !== 'division' || (!represented.has(token.id) && !removed.has(token.id)));
    const tokens = [
      ...preserved,
      ...selectedDivisions.map(id => ({ kind: 'division', id }))
    ];
    dummy.value = tokens.map(token => `*${token.kind}_${token.id}*`).join('');

    syncNativeAssignmentChips(form, wrap);
  }

  function removeL1FromEditCrew(form, wrap) {
    if (!form || !wrap) return 0;
    let changed = 0;
    Array.from(KNOWN_L1_DIVISION_IDS).forEach(id => {
      if (assignmentState(form).divisionIds.includes(id)) {
        removeDivisionFromEditCrew(form, wrap, id);
        changed += 1;
      }
    });
    return changed;
  }

  function restoreEditDummy(form) {
    const dummy = form.querySelector('#dummy_pers_id');
    if (!dummy || !Object.prototype.hasOwnProperty.call(dummy.dataset, 'simnetWbOriginalValue')) return;
    dummy.value = dummy.dataset.simnetWbOriginalValue;
  }

  function filterEditCrewPicker(wrap, query) {
    const form = wrap?.closest?.('form');
    const needle = compact(query, 120).toLocaleLowerCase('ru');
    const fieldVisit = Boolean(form && FIELD_VISIT_TYPES.has(String(taskContext(form)?.typeId || '')));
    const profile = fieldVisit && form ? syncTerritoryProfile(form) : { type: 'unknown', label: '', resolved: true };
    const allowed = fieldVisit ? territoryAllowedCrewIds(profile) : null;
    Array.from(wrap.querySelectorAll('[data-simnet-wb-edit-crew-row]')).forEach(row => {
      const input = row.querySelector(`[${EDIT_CREW_DIVISION_ATTR}]`);
      const id = String(input?.getAttribute(EDIT_CREW_DIVISION_ATTR) || input?.value || '').trim();
      const checked = Boolean(input?.checked);
      const label = compact(row.textContent, 180);
      const crew = isBrigadeDivision(id, label);
      const territoryOk = !crew || !allowed || allowed.has(id);
      const match = !needle || label.toLocaleLowerCase('ru').includes(needle);
      row.classList.toggle('simnet-wb-task-territory-mismatch', Boolean(checked && crew && !territoryOk));
      row.style.display = checked || (match && territoryOk) ? '' : 'none';
    });
    const territory = wrap.querySelector('.simnet-wb-edit-crew-territory');
    if (territory) territory.textContent = territoryShortLabel(profile);
  }

  async function loadEditCrewPicker(form, wrap) {
    if (!wrap || wrap.dataset.loading === '1') return;
    wrap.dataset.loading = '1';
    const list = wrap.querySelector(`[${EDIT_CREW_LIST_ATTR}]`);
    const error = wrap.querySelector('.simnet-wb-edit-crew-error');
    if (error) error.textContent = '';

    try {
      const before = assignmentState(form);
      originalDummyValue(form);
      const response = await fetch(autoStaffUrl(form), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const box = document.createElement('div');
      box.innerHTML = html;
      const removed = removedDivisionIds(wrap);
      const currentIds = new Set((before.divisionIds || []).map(String).filter(id => !removed.has(id)));
      const currentLabels = new Map(Object.entries(before.divisionLabels || {}));
      const representedIds = new Set();
      const rows = Array.from(box.querySelectorAll('.div_space2'))
        .filter(row => row.querySelector('input[name^="division_auto_task_staffids"]'))
        .sort((a, b) => {
          const ai = a.querySelector('input[name^="division_auto_task_staffids"]');
          const bi = b.querySelector('input[name^="division_auto_task_staffids"]');
          const aCrew = isBrigadeDivision(String(ai?.value || ''), compact(a.textContent, 160));
          const bCrew = isBrigadeDivision(String(bi?.value || ''), compact(b.textContent, 160));
          return Number(bCrew) - Number(aCrew);
        });
      list.innerHTML = '';

      const bindRow = (row, id, checked) => {
        row.dataset.simnetWbEditCrewRow = '1';
        const input = row.querySelector(`input[name^="division_auto_task_staffids"], input[name^="division_task_staffids"], [${EDIT_CREW_DIVISION_ATTR}]`);
        if (!input) return false;
        input.checked = checked;
        input.dataset.simnetWbOwned = '1';
        input.setAttribute(EDIT_CREW_DIVISION_ATTR, id);
        // Critical invariant: the Workbench picker is UI state only. A cloned checkbox must never
        // become a successful form control alongside UserSide's native staff controls.
        input.removeAttribute('name');
        input.removeAttribute('id');
        input.removeAttribute('required');
        input.removeAttribute('aria-required');
        input.addEventListener('change', () => {
          setDivisionRemoved(wrap, id, !input.checked);
          syncEditCrewSelection(form, wrap);
          syncNativeAssignmentChips(form, wrap);
          validateAndRender(form, 'change');
        });
        representedIds.add(id);
        list.appendChild(row);
        return true;
      };

      rows.forEach(sourceRow => {
        const sourceInput = sourceRow.querySelector('input[name^="division_auto_task_staffids"]');
        const id = String(sourceInput?.value || '').trim();
        const label = compact(sourceRow.textContent || '', 160);
        if (!id) return;
        // Keep the complete native UserSide division list. Brigades are sorted first,
        // but departments remain available so EDIT can be corrected in either direction.
        bindRow(sourceRow.cloneNode(true), id, currentIds.has(id));
      });

      // UserSide may omit a current division from /reload_auto_staff for the newly selected typer.
      // Mirror it from the actual EDIT DOM so it is preserved and can coexist with the selected brigade.
      currentIds.forEach(id => {
        if (representedIds.has(id)) return;
        const fallbackLabel = KNOWN_L1_DIVISION_IDS.has(id) ? 'Техподдержка L1' : '';
        const label = compact(currentLabels.get(id) || fallbackLabel, 160);
        if (!label) return;
        const row = document.createElement('div');
        row.className = 'div_space2';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = id;
        input.checked = true;
        input.dataset.simnetWbOwned = '1';
        input.setAttribute(EDIT_CREW_DIVISION_ATTR, id);
        row.append(input, document.createTextNode(` ${label}`));
        bindRow(row, id, true);
      });

      if (!list.children.length) throw new Error('UserSide не вернул список исполнителей');
      wrap.dataset.loaded = '1';
      syncEditCrewSelection(form, wrap);
      const search = wrap.querySelector('.simnet-wb-edit-crew-search');
      filterEditCrewPicker(wrap, search?.value || '');
    } catch (loadError) {
      if (error) error.textContent = `Не удалось загрузить штатный список UserSide: ${compact(loadError?.message || loadError, 120)}`;
    } finally {
      wrap.dataset.loading = '0';
    }
  }

  function setEditCrewExpanded(wrap, expanded, { user = false } = {}) {
    if (!wrap) return;
    const panel = wrap.querySelector('.simnet-wb-edit-crew-panel');
    const toggle = wrap.querySelector('[data-simnet-wb-edit-crew-toggle]');
    const open = Boolean(expanded);
    if (panel) panel.hidden = !open;
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Скрыть исполнителей' : 'Изменить исполнителей';
    }
    wrap.dataset.expanded = open ? '1' : '0';
    if (user) wrap.dataset.userExpanded = open ? '1' : '0';
  }

  function ensureEditCrewPicker(form, { refresh = false } = {}) {
    const context = taskContext(form);
    let wrap = editCrewPicker(form);
    const shouldShow = Boolean(context?.mode === 'edit');
    const nativeBlock = nativeStaffBlock(form);
    const nativeLabel = nativeStaffLabel(form);

    if (!shouldShow) {
      if (wrap) wrap.remove();
      nativeBlock?.classList?.remove(NATIVE_EDIT_STAFF_CLASS);
      nativeLabel?.classList?.remove(NATIVE_EDIT_STAFF_LABEL_CLASS);
      restoreEditDummy(form);
      return null;
    }

    nativeBlock?.classList?.add(NATIVE_EDIT_STAFF_CLASS);
    nativeLabel?.classList?.add(NATIVE_EDIT_STAFF_LABEL_CLASS);
    const fieldVisit = FIELD_VISIT_TYPES.has(String(context.typeId || ''));
    const transition = isFieldVisitTransition(form);

    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'simnet-wb-edit-crew';
      wrap.dataset.simnetWbOwned = '1';
      wrap.setAttribute(EDIT_CREW_ATTR, '1');
      wrap.innerHTML = `
        <div class="simnet-wb-edit-crew-toolbar">
          <button type="button" class="simnet-wb-edit-crew-toggle" data-simnet-wb-edit-crew-toggle aria-expanded="false">Изменить исполнителей</button>
          <span class="simnet-wb-edit-crew-territory"></span>
        </div>
        <div class="simnet-wb-edit-crew-transition" ${EDIT_CREW_TRANSITION_ATTR}="1" hidden>Для выездной заявки выберите хотя бы одну «Бр. …».</div>
        <div class="simnet-wb-edit-crew-panel" hidden>
          <div class="simnet-wb-edit-crew-panel-head">
            <input type="search" class="input_box simnet-wb-edit-crew-search" placeholder="Фильтр исполнителей…" autocomplete="off">
            <button type="button" class="simnet-wb-edit-crew-icon" data-simnet-wb-edit-crew-refresh title="Обновить список" aria-label="Обновить список">↻</button>
          </div>
          <div class="simnet-wb-edit-crew-list" ${EDIT_CREW_LIST_ATTR}="1"></div>
          <div class="simnet-wb-edit-crew-error"></div>
        </div>`;
      const target = nativeBlock || assignmentMarkTarget(form)?.closest?.('.table_block') || assignmentMarkTarget(form);
      if (target?.parentNode) target.parentNode.insertBefore(wrap, target.nextSibling);
      else {
        const center = form.querySelector('.div_center');
        if (center?.parentNode) center.parentNode.insertBefore(wrap, center);
        else form.appendChild(wrap);
      }
      wrap.querySelector('[data-simnet-wb-edit-crew-toggle]')?.addEventListener('click', () => {
        const next = wrap.dataset.expanded !== '1';
        setEditCrewExpanded(wrap, next, { user: true });
        if (next && wrap.dataset.loaded !== '1') loadEditCrewPicker(form, wrap);
      });
      wrap.querySelector('.simnet-wb-edit-crew-search')?.addEventListener('input', event => {
        filterEditCrewPicker(wrap, event.target.value);
      });
      wrap.querySelector('[data-simnet-wb-edit-crew-refresh]')?.addEventListener('click', () => {
        wrap.dataset.loaded = '';
        loadEditCrewPicker(form, wrap);
      });
      setEditCrewExpanded(wrap, false);
    }

    const transitionNote = wrap.querySelector(`[${EDIT_CREW_TRANSITION_ATTR}]`);
    if (transitionNote) transitionNote.hidden = !transition;
    const territory = wrap.querySelector('.simnet-wb-edit-crew-territory');
    if (territory && !fieldVisit) territory.textContent = '';
    wrap.dataset.targetTypeId = String(context.typeId || '');
    wrap.dataset.transition = transition ? '1' : '0';

    const current = assignmentState(form);
    const mustOpen = Boolean(fieldVisit && (transition || !current.hasCrew));
    if (mustOpen) {
      setEditCrewExpanded(wrap, true);
    } else if (!fieldVisit && wrap.dataset.userExpanded !== '1') {
      setEditCrewExpanded(wrap, false);
    }

    if (refresh) wrap.dataset.loaded = '';
    if (wrap.dataset.expanded === '1' && wrap.dataset.loaded !== '1') loadEditCrewPicker(form, wrap);
    syncNativeAssignmentChips(form, wrap);
    return wrap;
  }


  function syncEditStaffNativePayload(form, selectedDivisionIds) {
    if (!form) return { divisionIds: [], preferredDivisionId: '', dummyValue: '' };

    const selectedIds = Array.from(new Set((selectedDivisionIds || [])
      .map(value => String(value || '').trim())
      .filter(Boolean)));
    const selectedSet = new Set(selectedIds);

    // Remove the old parallel payload container created by <= .48. The real UserSide task form is
    // the single submission authority now.
    form.querySelector(`[${EDIT_STAFF_PAYLOAD_ATTR}]`)?.remove();

    // Canonicalize EDIT staff submission into UserSide's native division_task_staffids[] namespace.
    // Existing native controls are reused; only missing selected IDs receive a serialization fallback.
    const nativeSelected = Array.from(form.querySelectorAll('input[name="division_task_staffids[]"]'))
      .filter(input => !input.hasAttribute(EDIT_CREW_DIVISION_ATTR));
    const represented = new Set();
    nativeSelected.forEach(input => {
      const id = String(input.value || '').trim();
      if (!id) return;
      represented.add(id);
      if (String(input.type || '').toLowerCase() === 'checkbox' || String(input.type || '').toLowerCase() === 'radio') {
        input.checked = selectedSet.has(id);
      } else {
        input.disabled = !selectedSet.has(id);
      }
    });

    const nativeBody = form.querySelector('#employeeMultiSelectorBodytask_staffId') || form;
    selectedIds.forEach(id => {
      if (represented.has(id)) return;
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'division_task_staffids[]';
      hidden.value = id;
      hidden.dataset.simnetWbOwned = '1';
      hidden.dataset.simnetWbStaffSerialization = '1';
      nativeBody.appendChild(hidden);
      represented.add(id);
    });

    // On EDIT there must be one staff namespace in the outgoing main form. If an auto-suggestion is
    // checked as well, it is represented above as a real selected division and must not be submitted
    // a second time as division_auto_task_staffids[].
    Array.from(form.querySelectorAll('input[name="division_auto_task_staffids[]"]')).forEach(input => {
      if (input.checked) input.checked = false;
    });

    let dummy = form.querySelector('#dummy_pers_id');
    if (!dummy) {
      dummy = document.createElement('input');
      dummy.type = 'hidden';
      dummy.id = 'dummy_pers_id';
      form.appendChild(dummy);
    }

    const labels = divisionLabels(form);
    const preferred = selectedIds.find(id => isBrigadeDivision(id, labels.get(id) || ''))
      || selectedIds.find(id => !KNOWN_L1_DIVISION_IDS.has(id))
      || selectedIds[0]
      || '';
    const dummyValue = preferred ? `*division_${preferred}*` : '';
    dummy.name = 'dummy_pers_id';
    dummy.value = dummyValue;

    console.info('[SIMNET WB][TASK FORM] EDIT native staff canonicalized', {
      divisionIds: selectedIds,
      preferredDivisionId: preferred,
      dummyValue,
      submissionAuthority: 'division_task_staffids[]'
    });

    return { divisionIds: selectedIds, preferredDivisionId: preferred, dummyValue };
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

  async function applyStaffViaNativeDialog(taskId, selectedDivisionIds) {
    const id = String(taskId || '').trim();
    if (!/^\d+$/.test(id) || id === '0') throw new Error('Не удалось определить ID редактируемой заявки');

    const selectedIds = Array.from(new Set((selectedDivisionIds || [])
      .map(value => String(value || '').trim())
      .filter(Boolean)));

    const dialogUrl = sameOriginTaskUrl(`${STAFF_DIALOG_PATH}?id=${encodeURIComponent(id)}`, STAFF_DIALOG_PATH);
    const response = await fetch(dialogUrl.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Не удалось открыть штатную форму исполнителей (HTTP ${response.status})`);

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dialogForm = doc.querySelector('form[action*="/task/staff_save"]') || doc.querySelector('form');
    if (!dialogForm) throw new Error('UserSide не вернул форму сохранения исполнителей');

    const action = sameOriginTaskUrl(dialogForm.getAttribute('action') || STAFF_SAVE_PATH, STAFF_SAVE_PATH);
    const method = String(dialogForm.getAttribute('method') || 'post').toLowerCase();
    if (method !== 'post') throw new Error('Неожиданный метод штатной формы исполнителей');

    dialogForm.querySelectorAll('input[name="division_task_staffids[]"], input[name="division_auto_task_staffids[]"]')
      .forEach(input => input.remove());

    selectedIds.forEach(divisionId => {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = 'division_task_staffids[]';
      input.value = divisionId;
      dialogForm.appendChild(input);
    });

    const preferred = selectedIds.find(divisionId => KNOWN_CREW_DIVISION_IDS.has(divisionId)) || selectedIds[0] || '';
    setDialogHidden(dialogForm, 'dummy_pers_id', preferred ? `*division_${preferred}*` : '', doc);

    const saveResponse = await fetch(action.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: new FormData(dialogForm)
    });
    if (!saveResponse.ok) throw new Error(`Не удалось сохранить исполнителей (HTTP ${saveResponse.status})`);

    return { ok: true, taskId: id, divisionIds: selectedIds };
  }

  function showStaffBridgeError(form, error) {
    const summary = ensureSummary(form);
    if (!summary) return;
    const message = compact(error?.message || error || 'Не удалось применить исполнителей', 220);
    summary.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'wb-task-title';
    title.textContent = 'Заявка не сохранена';
    const body = document.createElement('div');
    body.className = 'wb-task-message';
    body.textContent = `Не удалось сохранить исполнителей: ${message}`;
    summary.append(title, body);
    summary.hidden = false;
  }

  function resumeNativeSubmit(form, submitter) {
    form.setAttribute(STAFF_SUBMIT_BYPASS_ATTR, '1');
    try {
      if (typeof form.requestSubmit === 'function') {
        if (submitter && submitter.form === form && String(submitter.type || '').toLowerCase() === 'submit') {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
      } else {
        HTMLFormElement.prototype.submit.call(form);
      }
    } finally {
      queueMicrotask(() => {
        if (form?.isConnected) form.removeAttribute(STAFF_SUBMIT_BYPASS_ATTR);
      });
    }
  }

  function probe(form) {
    if (!isTaskForm(form)) return null;
    const context = taskContext(form);
    const current = snapshotTaskState(form);
    const holder = ensureBaseline(form);
    const baseline = holder?.effective || holder?.initial || null;
    const required = Array.from(form.querySelectorAll('[required]')).filter(visible).map(element => ({
      name: String(element.name || ''),
      id: String(element.id || ''),
      label: labelOf(element),
      tag: element.tagName.toLowerCase(),
      type: String(element.type || '')
    }));
    const divisions = Array.from(form.querySelectorAll('input[name^="division_auto_task_staffids"]')).map(input => ({
      id: String(input.value || ''),
      label: compact(input.parentElement?.textContent || '', 100),
      checked: Boolean(input.checked)
    }));
    const policy = evaluateFieldVisitPolicy(current, baseline, { now: new Date() });
    return {
      kind: context.kind,
      mode: context.mode,
      taskId: context.taskId,
      typer: context.typeId,
      originalTypeId: context.originalTypeId,
      title: compact(form.closest('#div_contentplace')?.querySelector('.label_h2')?.textContent || document.title, 120),
      action: context.action,
      fieldVisit: FIELD_VISIT_TYPES.has(context.typeId),
      dateKnown: current.dateKnown,
      currentAssignments: current.divisionIds,
      currentCrewIds: current.crewIds,
      hasCrew: current.hasCrew,
      baselineTypeId: baseline?.typeId || '',
      policy,
      fields: {
        datedo: Boolean(form.querySelector('[name="datedo"]')),
        timedo: Boolean(form.querySelector('[name="timedo"]')),
        timedo2: Boolean(form.querySelector('[name="timedo2"]')),
        deadline: Boolean(form.querySelector('[name="deadline"]')),
        deadlineDate: Boolean(form.querySelector('[name="deadline_date"]')),
        timeToWork: Boolean(form.querySelector('[name="time_to_work"]')),
        comment: Boolean(form.querySelector('[name="comment"]')),
        commentShort: Boolean(form.querySelector('[name="comment_short"]')),
        parentId: Boolean(form.querySelector('[name="parent_id"]')),
        address: Boolean(form.querySelector('[name^="address_unit_selectortask_address"]')),
        apart: Boolean(form.querySelector('[name="apart"]')),
        customerSearch: Boolean(form.querySelector('#ins_user_list_fastfind_name_id')),
        assignment: assignmentRequired(form)
      },
      required,
      divisions,
      assignmentSelected: current.hasAssignment
    };
  }

  function logProbe(form) {
    const snapshot = probe(form);
    if (!snapshot) return;
    const signature = JSON.stringify({
      typer: snapshot.typer,
      mode: snapshot.mode,
      required: snapshot.required.map(field => `${field.name}:${field.id}`),
      divisions: snapshot.divisions.map(item => item.id),
      fields: snapshot.fields
    });
    if (signature === lastProbeSignature) return;
    lastProbeSignature = signature;
    try {
      console.info('[SIMNET WB][TASK FORM] detected', snapshot);
    } catch {}
  }

  function enhance(form) {
    if (!isTaskForm(form) || destroyed) return false;
    injectStyles();
    const context = taskContext(form);

    // CREATE: UserSide owns the staff controls themselves. Workbench only reads their state and
    // hard-gates the common field-visit invariant (brigade + valid schedule +3h). No replacement picker.
    if (context?.mode === 'create') {
      restoreNativeStaffValidation(form);
      restoreNativeConstraintGate(form);
      form.querySelector(`[${FILTER_ATTR}]`)?.remove();
      form.querySelector(`[${EDIT_CREW_ATTR}]`)?.remove();
      ensureBaseline(form);
      ensureSummary(form);
      applyCallTaskLaunch(form);
      if (!form.hasAttribute(ENHANCED_ATTR)) form.setAttribute(ENHANCED_ATTR, '1');
      logProbe(form);
      return true;
    }

    normalizeNativeStaffValidation(form);
    syncNativeConstraintGate(form);
    ensureBaseline(form);
    ensureSummary(form);
    ensureStaffFilter(form);
    ensureEditCrewPicker(form);
    void resolveTerritoryProfile(form);
    if (!form.hasAttribute(ENHANCED_ATTR)) form.setAttribute(ENHANCED_ATTR, '1');
    logProbe(form);
    return true;
  }

  function validateAndRender(form, phase = 'manual', options = {}) {
    if (!enhance(form)) return null;
    const result = validateTaskForm(form, options);
    markIssues(form, result);
    renderSummary(form, result);
    logValidation(form, result, phase);
    if (!result.valid) {
      const first = result.errors.flatMap(issue => issue.elements).find(Boolean);
      try { first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch {}
    }
    return result;
  }

  function renderCreateAdvisory(form, phase = 'create-advisory', options = {}) {
    if (!enhance(form)) return null;
    const result = createFieldVisitAdvisory(form, options);
    if (!result) {
      clearMarks(form);
      renderSummary(form, { advisoryOnly: true, warnings: [], errors: [] });
      return null;
    }
    markIssues(form, result);
    renderSummary(form, result);
    logValidation(form, result, phase);
    return result;
  }

  function onClick(event) {
    if (destroyed) return;
    const target = event.target instanceof Element ? event.target : null;
    const form = taskFormFromNode(target);
    if (!form) return;
    enhance(form);
    const callTaskToggle = target?.closest?.('[data-simnet-wb-call-task-toggle]');
    if (callTaskToggle) {
      event.preventDefault();
      form.classList.toggle(CALL_TASK_EXTRA_CLASS);
      callTaskToggle.textContent = form.classList.contains(CALL_TASK_EXTRA_CLASS) ? 'Скрыть дополнительное' : 'Дополнительно';
      return;
    }
    const submit = target?.closest?.('button[type="submit"], input[type="submit"]');
    if (!submit) return;
    const context = taskContext(form);
    if (context?.mode === 'create') {
      // CREATE staff controls stay native; Workbench blocks any broken field-visit invariant.
      const advisory = renderCreateAdvisory(form, 'submit-click');
      if (advisory && !advisory.valid) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      try {
        console.info('[SIMNET WB][TASK FORM] CREATE field gate', {
          typer: context.typeId,
          blocked: Boolean(advisory && !advisory.valid),
          errors: advisory?.errors?.map(issue => issue.code) || [],
          warnings: advisory?.warnings?.map(issue => issue.code) || []
        });
      } catch {}
      return;
    }
    const result = validateAndRender(form, 'submit-click');
    if (result && !result.valid) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  async function onSubmit(event) {
    if (destroyed) return;
    const form = isTaskForm(event.target) ? event.target : null;
    if (!form) return;
    const context = taskContext(form);

    // CREATE remains native-owned for staff UI. Workbench owns the same field-visit save gate
    // as every other entry point so repeated submits cannot bypass brigade/date/time/+3h.
    if (context?.mode === 'create') {
      validSubmitTaskId = '';
      const advisory = renderCreateAdvisory(form, 'submit');
      if (advisory && !advisory.valid) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      try {
        const current = snapshotTaskState(form);
        console.info('[SIMNET WB][TASK FORM] CREATE submit field gate', {
          typer: context.typeId,
          blocked: Boolean(advisory && !advisory.valid),
          hasCrew: Boolean(current?.hasCrew),
          divisionIds: current?.divisionIds || [],
          errors: advisory?.errors?.map(issue => issue.code) || [],
          warnings: advisory?.warnings?.map(issue => issue.code) || []
        });
      } catch {}
      if (!(advisory && !advisory.valid)) {
        const callContext = callTaskLaunchContext();
        if (callContext && String(callContext.typer || '') === String(context.typeId || '')) {
          rememberPendingCallTask(callContext);
        }
      }
      return;
    }

    normalizeNativeStaffValidation(form);
    syncNativeConstraintGate(form);

    if (form.hasAttribute(STAFF_SUBMIT_BYPASS_ATTR)) {
      const bypassContext = taskContext(form);
      if (bypassContext?.mode === 'edit') validSubmitTaskId = bypassContext.taskId;
      return;
    }

    validSubmitTaskId = '';
    const fieldVisit = Boolean(context && FIELD_VISIT_TYPES.has(String(context.typeId || '')));
    const holder = ensureBaseline(form);
    const baseline = holder?.effective || holder?.initial || null;
    const currentSnapshot = snapshotTaskState(form);
    const staffChanged = Boolean(context?.mode === 'edit' && baseline && currentSnapshot && assignmentsChanged(baseline, currentSnapshot));
    const needsAsyncPreflight = Boolean(context?.mode === 'edit' && (fieldVisit || staffChanged));

    // Field forms need an async territory preflight. Any EDIT whose assignments changed also goes
    // through the native UserSide staff bridge, including a field -> non-field correction.
    if (needsAsyncPreflight) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.hasAttribute(VALIDATION_BUSY_ATTR)) return;
      form.setAttribute(VALIDATION_BUSY_ATTR, '1');
      try {
        if (fieldVisit) await resolveTerritoryProfile(form, { force: false });
        const result = validateAndRender(form, 'submit');
        if (!result || !result.valid) return;

        if (context.mode === 'edit' && (fieldVisit || staffChanged)) {
          if (form.hasAttribute(STAFF_SAVE_BUSY_ATTR)) return;
          form.setAttribute(STAFF_SAVE_BUSY_ATTR, '1');
          try {
            const current = assignmentState(form);
            syncEditStaffNativePayload(form, current.divisionIds);
            await applyStaffViaNativeDialog(context.taskId, current.divisionIds);
            validSubmitTaskId = context.taskId;
            resumeNativeSubmit(form, event.submitter || null);
          } catch (error) {
            console.error('[SIMNET WB][TASK FORM] native staff bridge failed', error);
            showStaffBridgeError(form, error);
          } finally {
            form.removeAttribute(STAFF_SAVE_BUSY_ATTR);
          }
        } else {
          resumeNativeSubmit(form, event.submitter || null);
        }
      } finally {
        form.removeAttribute(VALIDATION_BUSY_ATTR);
      }
      return;
    }

    const result = validateAndRender(form, 'submit');
    if (result && !result.valid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (context?.mode === 'edit') validSubmitTaskId = context.taskId;
  }

  function onInput(event) {
    if (destroyed) return;
    const target = event.target instanceof Element ? event.target : null;
    const form = taskFormFromNode(target);
    if (!form) return;
    enhance(form);
    const context = taskContext(form);
    if (context?.mode === 'create') {
      target.classList?.remove(ERROR_CLASS, WARN_CLASS);
      const relevant = target.matches?.([
        '#datedo_id', '#timedo_id', '#timedo_id2',
        'input[name^="division_auto_task_staffids"]',
        'input[name^="division_task_staffids"]'
      ].join(','));
      const alert = document.querySelector(`.${SUMMARY_CLASS}[data-simnet-wb-owned="1"]`);
      if (relevant || (alert && !alert.hidden)) queueMicrotask(() => {
        if (!destroyed && form.isConnected) renderCreateAdvisory(form, 'change');
      });
      return;
    }
    if (target.matches?.(`[${FILTER_ATTR}] input`)) return;
    if (target.matches?.('select[name="typer"]')) {
      handleTypeChange(form);
      syncNativeConstraintGate(form);
      // Refresh the complete assignment picker immediately from the UNSAVED selected typer.
      // Re-run once after native synchronous change handlers; no polling/observer is used.
      ensureEditCrewPicker(form, { refresh: true });
      void resolveTerritoryProfile(form, { force: true });
      queueMicrotask(() => {
        if (!destroyed && form.isConnected) ensureEditCrewPicker(form);
      });
    }
    if (target.matches?.('select[name^="address_unit_selectortask_address"], [id^="buildingId"], [name*="building"]')) {
      void resolveTerritoryProfile(form, { force: true });
    }
    target.classList?.remove(ERROR_CLASS, WARN_CLASS);
    const alert = document.querySelector(`.${SUMMARY_CLASS}[data-simnet-wb-owned="1"]`);
    if (alert && !alert.hidden) queueMicrotask(() => {
      if (!destroyed && form.isConnected) validateAndRender(form, 'change');
    });
  }

  function onFocusIn(event) {
    if (destroyed) return;
    const target = event.target instanceof Element ? event.target : null;
    const form = taskFormFromNode(target);
    if (form) enhance(form);
  }

  function onPageHide() {
    if (!validSubmitTaskId) return;
    clearPendingTransition(validSubmitTaskId);
    validSubmitTaskId = '';
  }

  function init() {
    injectStyles();
    confirmPendingCallTaskOutcome();
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener?.('pagehide', onPageHide, true);
    document.querySelectorAll('form').forEach(form => { if (isTaskForm(form)) enhance(form); });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onInput, true);
    document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener?.('pagehide', onPageHide, true);
    document.querySelectorAll(`[${FILTER_ATTR}], [${EDIT_CREW_ATTR}], .${SUMMARY_CLASS}`).forEach(node => node.remove());
    document.querySelectorAll(`[${ENHANCED_ATTR}]`).forEach(form => {
      form.classList.remove(CALL_TASK_FORM_CLASS, CALL_TASK_EXTRA_CLASS);
      form.querySelectorAll(`.${CALL_TASK_OPTIONAL_CLASS}`).forEach(node => node.classList.remove(CALL_TASK_OPTIONAL_CLASS));
      form.querySelector(`.${CALL_TASK_BANNER_CLASS}[data-simnet-wb-owned="1"]`)?.remove();
      delete form.dataset.simnetWbCallKey;
      delete form.dataset.simnetWbCallTaskType;
      restoreEditDummy(form);
      restoreNativeStaffValidation(form);
      restoreNativeConstraintGate(form);
      form.removeAttribute(ENHANCED_ATTR);
      form.removeAttribute(STAFF_SUBMIT_BYPASS_ATTR);
      form.removeAttribute(STAFF_SAVE_BUSY_ATTR);
      form.removeAttribute(VALIDATION_BUSY_ATTR);
    });
    document.querySelectorAll(`.${NATIVE_EDIT_STAFF_CLASS}`).forEach(node => node.classList.remove(NATIVE_EDIT_STAFF_CLASS));
    document.querySelectorAll(`.${NATIVE_EDIT_STAFF_LABEL_CLASS}`).forEach(node => node.classList.remove(NATIVE_EDIT_STAFF_LABEL_CLASS));
    document.querySelectorAll(`[${NATIVE_ASSIGNMENT_REMOVE_ATTR}]`).forEach(node => node.remove());
    document.querySelectorAll('.simnet-wb-native-assignment-removed').forEach(node => node.classList.remove('simnet-wb-native-assignment-removed'));
    document.querySelectorAll(`.${ERROR_CLASS}, .${WARN_CLASS}, .simnet-wb-task-territory-mismatch`).forEach(node => node.classList.remove(ERROR_CLASS, WARN_CLASS, 'simnet-wb-task-territory-mismatch'));
    document.getElementById(STYLE_ID)?.remove();
  }

  WB.taskFormAssistant = Object.freeze({
    isTaskForm,
    validate: form => validateTaskForm(form || document.querySelector('form[action="/task/save"]')),
    validateAndRender: form => validateAndRender(form || document.querySelector('form[action="/task/save"]'), 'manual'),
    probe: form => probe(form || document.querySelector('form[action="/task/save"]')),
    filterStaff: (query, form) => filterStaff(form || document.querySelector('form[action="/task/save"]'), query),
    enhance: form => enhance(form || document.querySelector('form[action="/task/save"]')),
    destroy,
    _test: Object.freeze({
      parseDate,
      parseDateTime,
      parseNumber,
      callTaskLaunchContext,
      callTaskTypeLabel,
      parseDummyAssignmentTokens,
      normalizeNativeStaffValidation,
      restoreNativeStaffValidation,
      syncNativeConstraintGate,
      restoreNativeConstraintGate,
      isBrigadeLabel,
      isBrigadeDivision,
      applyStaffViaNativeDialog,
      syncEditStaffNativePayload,
      isFieldVisitTransition,
      removeL1FromEditCrew,
      removeDivisionFromEditCrew,
      scheduleChanged,
      assignmentsChanged,
      evaluateFieldVisitPolicy,
      createFieldVisitAdvisory,
      evaluateCrewTerritoryPolicy,
      classifyBuildingTypeByText,
      explicitTerritoryForTask,
      territoryAllowedCrewIds,
      privateSectorCrewIds: Object.freeze(Array.from(PRIVATE_SECTOR_CREW_IDS)),
      nonPrivateCrewIds: Object.freeze(Array.from(NON_PRIVATE_CREW_IDS)),
      fieldVisitTypes: Object.freeze(Array.from(FIELD_VISIT_TYPES)),
      fieldMinLeadMs: FIELD_MIN_LEAD_MS,
      createScheduleBlockingCodes: Object.freeze(Array.from(CREATE_SCHEDULE_BLOCKING_CODES)),
      l1Types: Object.freeze(Array.from(L1_TYPES))
    })
  });

  init();
})();
