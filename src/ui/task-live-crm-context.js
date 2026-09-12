(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskLiveCrmContextLoaded) return;
  WB.__taskLiveCrmContextLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const STORAGE_KEY = 'simnet_crm_live_building_context_v1';
  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  let observer = null;
  let queued = false;
  let lastSignature = '';
  let lastCrewSignature = '';

  const compact = (value, max = 5000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function isTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try { return FORM_ACTION_RE.test(new URL(String(form.action || location.href), location.href).pathname); }
    catch { return false; }
  }

  function targetForm() {
    return Array.from(document.querySelectorAll('form')).find(isTaskForm) || null;
  }

  function storageSet(value) {
    return new Promise(resolve => {
      try { chrome.storage.local.set(value, () => resolve()); }
      catch { resolve(); }
    });
  }

  async function publish(reason = 'refresh') {
    queued = false;
    const form = targetForm();
    const recovery = WB.taskCurrentLiveRecovery;
    if (!form || !recovery?.debug) return;

    try {
      const debug = await recovery.debug(form);
      if (!debug) return;
      const noteRows = (Array.isArray(debug.noteRows) ? debug.noteRows : [])
        .map(row => ({ key: String(row?.key || ''), label: compact(row?.label || '', 120), text: compact(row?.text || '', 5000) }))
        .filter(row => row.text);
      const buildingUuid = String(debug.resolvedBuildingUuid || debug.directBuildingUuid || '').trim();
      const address = compact(debug.address || '', 500);
      if (!address || (!buildingUuid && !noteRows.length)) return;

      const payload = {
        schema: 'simnet-crm-live-building-context-v1',
        updatedAt: new Date().toISOString(),
        source: 'userside-task-form',
        sourceUrl: `${location.pathname}${location.search || ''}`,
        reason,
        buildingUuid,
        addressUnitUuid: String(debug.addressUnitUuid || ''),
        customerUuid: String(debug.customerUuid || ''),
        taskTypeUuid: String(debug.taskTypeUuid || ''),
        address,
        noteRows
      };
      const signature = JSON.stringify([payload.buildingUuid, payload.addressUnitUuid, payload.taskTypeUuid, payload.address, noteRows.map(row => row.text)]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      await storageSet({ [STORAGE_KEY]: payload });
      WB.log?.info?.('CRM', 'Live building context published', {
        reason, buildingUuid, address, noteCount: noteRows.length
      });

      // Crew availability depends on address/type/customer, not on note text.
      // A building-note DOM update must not reload the same crew list again.
      const crewSignature = JSON.stringify([
        payload.buildingUuid,
        payload.addressUnitUuid,
        payload.taskTypeUuid,
        payload.customerUuid
      ]);
      if (crewSignature !== lastCrewSignature) {
        lastCrewSignature = crewSignature;
        try {
          if (typeof WB.taskFieldVisitUniversalCrew?.sync === 'function') WB.taskFieldVisitUniversalCrew.sync();
          else WB.taskFieldVisitUniversalCrew?.refresh?.();
        } catch {}
      }
    } catch (error) {
      WB.log?.warn?.('CRM', 'Live building context publish failed', { reason, message: compact(error?.message || error, 180) });
    }
  }

  function schedule(reason) {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { void publish(reason); });
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (!isTaskForm(form)) return;
    if (event.target?.matches?.('select[name="task_type_uuid"], #buildingUuidtask_address, input[name="building_uuidtask_address"], select[name="address_unit_selectortask_address[]"], select[name="customer_uuid"]')) {
      schedule('form-change');
    }
  }

  document.addEventListener('change', onChange, true);
  schedule('init');

  observer = new MutationObserver(records => {
    const relevant = records.some(record => Array.from(record.addedNodes || []).some(node => node instanceof Element && (
      node.matches?.('#buildingWorkDescriptionId,#buildingTaskCommentId,#buildingTaskInfoId,form')
      || node.querySelector?.('#buildingWorkDescriptionId,#buildingTaskCommentId,#buildingTaskInfoId,form')
    )));
    if (relevant) schedule('dom-change');
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskLiveCrmContext = Object.freeze({
    storageKey: STORAGE_KEY,
    refresh() { schedule('manual-refresh'); },
    destroy() {
      document.removeEventListener('change', onChange, true);
      observer?.disconnect();
      observer = null;
    }
  });
})();