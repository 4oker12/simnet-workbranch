(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const guard = WB?.taskCurrentContractGuard;
  if (!WB || !guard?.validateFieldVisit || WB.__taskFieldVisitFinalSaveGateLoaded) return;
  WB.__taskFieldVisitFinalSaveGateLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_RE = /^\/task\/save\/?$/i;
  const SUMMARY_CLASS = 'simnet-wb-task-validation-summary';
  const OWNED = 'data-simnet-wb-final-field-gate';
  const STYLE_ID = 'simnet-wb-final-field-gate-style';
  let destroyed = false;

  const log = (level, event, details = {}) => {
    try { WB.log?.[level]?.('TASK_FLOW', event, details); } catch {}
  };

  function isCurrentTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try {
      const path = new URL(form.action || location.href, location.href).pathname;
      if (!FORM_RE.test(path)) return false;
    } catch { return false; }
    return Boolean(form.querySelector('[name="task_type_uuid"],#taskTypeId'));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      .${SUMMARY_CLASS}[${OWNED}="1"]{position:fixed;z-index:2147483646;top:18px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(640px,calc(100vw - 36px));padding:12px 16px 12px 18px;border:1px solid #af013c;border-left:6px solid #af013c;border-radius:9px;background:#fff;color:#263746;box-shadow:0 10px 30px rgba(17,61,88,.18);font:14px/1.38 Arial,sans-serif;text-align:left}
      .${SUMMARY_CLASS}[${OWNED}="1"] .wb-task-title{font-weight:800;color:#8f0037;margin:0 0 4px;font-size:14px}
      .${SUMMARY_CLASS}[${OWNED}="1"] .wb-task-list{margin:4px 0 0;padding-left:18px}
      .${SUMMARY_CLASS}[${OWNED}="1"] .wb-task-list li{margin:2px 0}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function summaryHost() {
    return document.querySelector(`.${SUMMARY_CLASS}[data-simnet-wb-owned="1"]`)
      || document.querySelector(`.${SUMMARY_CLASS}`)
      || null;
  }

  function renderIssues(issues = []) {
    ensureStyle();
    let box = summaryHost();
    if (!box) {
      box = document.createElement('div');
      box.className = SUMMARY_CLASS;
      box.dataset.simnetWbOwned = '1';
      (document.body || document.documentElement).appendChild(box);
    }
    box.setAttribute(OWNED, '1');
    box.hidden = false;
    box.dataset.level = 'error';
    box.setAttribute('role', 'alert');
    box.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'wb-task-title';
    title.textContent = 'Заявка не сохранена';
    const message = document.createElement('div');
    message.className = 'wb-task-message';
    const list = document.createElement('ul');
    list.className = 'wb-task-list';
    for (const issue of issues.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = String(issue?.message || 'Проверь обязательные поля выездной заявки');
      list.appendChild(li);
      try { issue?.node?.classList?.add('simnet-wb-task-field-error'); } catch {}
    }
    message.appendChild(list);
    box.append(title, message);
  }

  function clearIfOwned() {
    const box = document.querySelector(`.${SUMMARY_CLASS}[${OWNED}="1"]`);
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    box.removeAttribute(OWNED);
  }

  function validate(form, phase = 'submit') {
    let issues = [];
    try { issues = guard.validateFieldVisit(form) || []; } catch (error) {
      log('warn', 'final_field_visit_gate_validation_failed', { phase, message: String(error?.message || error || '') });
      return [];
    }
    if (issues.length) {
      log('warn', 'final_field_visit_gate_blocked', {
        phase,
        issueCodes: issues.map(issue => issue.code || ''),
        issueMessages: issues.map(issue => issue.message || '')
      });
    }
    return issues;
  }

  function onSubmit(event) {
    if (destroyed || event.defaultPrevented) return;
    const form = isCurrentTaskForm(event.target) ? event.target : null;
    if (!form) return;
    const issues = validate(form, 'submit');
    if (!issues.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    renderIssues(issues);
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (destroyed || !isCurrentTaskForm(form)) return;
    if (!event.target?.matches?.('#datedo_id,#timedo_id,#timedo_id2,[name^="division_auto_task_staff"],[name^="division_task_staff"]')) return;
    queueMicrotask(() => {
      if (!form.isConnected) return;
      const issues = validate(form, 'change');
      if (!issues.length) clearIfOwned();
      else if (document.querySelector(`.${SUMMARY_CLASS}[${OWNED}="1"]`)) renderIssues(issues);
    });
  }

  function destroy() {
    destroyed = true;
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('change', onChange, true);
    clearIfOwned();
    document.getElementById(STYLE_ID)?.remove();
  }

  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('change', onChange, true);
  WB.taskFieldVisitFinalSaveGate = Object.freeze({ validate, destroy });
})();