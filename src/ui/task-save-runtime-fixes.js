(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskSaveRuntimeFixesLoaded) return;
  WB.__taskSaveRuntimeFixesLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CREW_HOST = '[data-simnet-wb-universal-crew]';
  const CREW_SELECT = 'select[data-wb-uc-select="1"]';
  let observer = null;
  let legacyGuardDisabled = false;

  function log(level, event, details = {}) {
    try {
      const method = WB.log?.[level];
      if (typeof method === 'function') method.call(WB.log, 'TASK_FLOW', event, details);
    } catch {}
  }

  function isCurrentUuidTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    let path = '';
    try { path = new URL(String(form.action || location.href), location.href).pathname; } catch {}
    return FORM_ACTION_RE.test(path)
      && Boolean(form.querySelector('select[name="task_type_uuid"], input[name="task_type_uuid"]'));
  }

  function disableLegacyGuardForCurrentForms() {
    if (legacyGuardDisabled || !WB.taskSpecialSavePolicyV3 || !WB.taskConstraintGuard?.destroy) return;
    const hasCurrentForm = Array.from(document.querySelectorAll('form')).some(isCurrentUuidTaskForm);
    if (!hasCurrentForm) return;
    try {
      WB.taskConstraintGuard.destroy();
      legacyGuardDisabled = true;
      log('info', 'legacy_constraint_guard_disabled', { reason: 'uuid-form-owned-by-policy-v3' });
    } catch (error) {
      log('warn', 'legacy_constraint_guard_disable_failed', { message: String(error?.message || error || '') });
    }
  }

  function autoSelectSingleCrew(root = document) {
    const selects = [];
    if (root instanceof Element && root.matches(`${CREW_HOST} ${CREW_SELECT}`)) selects.push(root);
    if (root?.querySelectorAll) selects.push(...root.querySelectorAll(`${CREW_HOST} ${CREW_SELECT}`));

    for (const select of new Set(selects)) {
      if (!(select instanceof HTMLSelectElement) || UUID_RE.test(String(select.value || '').trim())) continue;
      const crews = Array.from(select.options).filter(option => UUID_RE.test(String(option.value || '').trim()));
      if (crews.length !== 1) continue;
      select.value = crews[0].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      log('info', 'universal_crew_single_autoselected', {
        crewUuid: String(crews[0].value || '').trim(),
        crewLabel: String(crews[0].textContent || '').replace(/\s+/g, ' ').trim()
      });
    }
  }

  function reconcile(root = document) {
    disableLegacyGuardForCurrentForms();
    autoSelectSingleCrew(root);
  }

  reconcile(document);
  queueMicrotask(() => reconcile(document));

  observer = new MutationObserver(records => {
    let shouldCheckForms = false;
    for (const record of records) {
      if (record.type !== 'childList') continue;
      for (const node of Array.from(record.addedNodes || [])) {
        if (!(node instanceof Element)) continue;
        if (node.matches('form') || node.querySelector?.('form')) shouldCheckForms = true;
        autoSelectSingleCrew(node);
      }
    }
    if (shouldCheckForms) disableLegacyGuardForCurrentForms();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskSaveRuntimeFixes = Object.freeze({
    reconcile() { reconcile(document); },
    destroy() {
      observer?.disconnect();
      observer = null;
    }
  });
})();