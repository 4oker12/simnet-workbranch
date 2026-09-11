(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskConstraintGuardLoaded) return;
  WB.__taskConstraintGuardLoaded = true;

  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const STYLE_ID = 'simnet-wb-task-constraint-guard-style';
  const HOST_ID = 'simnet-wb-task-constraint-guard';
  const AUDIT_KEY = 'simnet_crm_constraint_ack_v1';
  const AUDIT_SCHEMA = 'simnet-crm-constraint-ack-v1';
  const MAX_AUDIT = 500;
  const APPROVAL_TTL_MS = 2 * 60 * 1000;

  const replayBypass = new WeakSet();
  const approvedByForm = new WeakMap();
  const busyForms = new WeakSet();

  const compact = (value, max = 300) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function actionPath(form) {
    try { return new URL(String(form?.action || location.href), location.href).pathname; }
    catch { return ''; }
  }

  function isTaskSaveForm(form) {
    return form instanceof HTMLFormElement && /^\/task\/save\/?$/i.test(actionPath(form));
  }

  function buildingId(form) {
    const candidates = [
      form.querySelector('#buildingIdtask_address'),
      form.querySelector('input[name="building_idtask_address"]'),
      form.querySelector('select[name="building_idtask_address"]'),
      form.querySelector('[id^="buildingId"]')
    ];
    for (const field of candidates) {
      const value = String(field?.value || '').replace(/\D+/g, '');
      if (value && value !== '0') return value;
    }
    return '';
  }

  function taskType(form) {
    const field = form.querySelector('select[name="typer"], #taskTypeId, input[name="typer"]');
    const id = String(field?.value || '').replace(/\D+/g, '');
    let label = '';
    if (field instanceof HTMLSelectElement) label = compact(field.selectedOptions?.[0]?.textContent || '', 120);
    if (!label) {
      const nearby = field?.closest?.('.item, .table_block')?.textContent || '';
      label = compact(nearby, 120);
    }
    return { id, label };
  }

  function approvalValid(form, id) {
    const row = approvedByForm.get(form);
    return Boolean(row && row.buildingId === id && Number(row.expiresAt || 0) > Date.now());
  }

  function severityWeight(value) {
    return ({ blocker: 0, warning: 1, info: 2 })[String(value || '')] ?? 9;
  }

  function dedupeConstraints(items) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const key = `${item?.type || ''}|${compact(item?.evidence || '', 220).toLowerCase()}`;
      if (!item?.evidence || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      #${HOST_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:18px;background:rgba(30,12,20,.52);font-family:Inter,Arial,sans-serif}
      #${HOST_ID}[hidden]{display:none!important}
      #${HOST_ID} .wb-cg-card{box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 36px));overflow:auto;background:#fff;border:1px solid rgba(123,20,62,.24);border-radius:14px;box-shadow:0 24px 70px rgba(41,5,22,.3);color:#2f1721}
      #${HOST_ID} .wb-cg-head{padding:15px 17px 11px;border-bottom:1px solid #eee1e7;background:#fff9fb}
      #${HOST_ID} .wb-cg-title{font-size:17px;font-weight:800;color:#8f1746}
      #${HOST_ID} .wb-cg-address{margin-top:4px;font-size:12px;color:#70515f}
      #${HOST_ID} .wb-cg-body{padding:13px 17px}
      #${HOST_ID} .wb-cg-note{margin-bottom:10px;font-size:12px;line-height:1.4;color:#5f4751}
      #${HOST_ID} .wb-cg-list{display:grid;gap:8px}
      #${HOST_ID} .wb-cg-item{padding:9px 10px;border:1px solid #e7d9df;border-radius:9px;background:#fff}
      #${HOST_ID} .wb-cg-item[data-severity="blocker"]{border-left:5px solid #a50046;background:#fff8fb}
      #${HOST_ID} .wb-cg-item[data-severity="warning"]{border-left:5px solid #b77900;background:#fffdf5}
      #${HOST_ID} .wb-cg-item[data-severity="info"]{border-left:5px solid #777;background:#fafafa}
      #${HOST_ID} .wb-cg-item-title{font-size:12px;font-weight:800;color:#4a1d31}
      #${HOST_ID} .wb-cg-evidence{margin-top:4px;font-size:12px;line-height:1.42;color:#3d3036}
      #${HOST_ID} .wb-cg-action{margin-top:5px;font-size:10.5px;color:#7b5968}
      #${HOST_ID} .wb-cg-more{margin-top:7px;font-size:11px;color:#826575}
      #${HOST_ID} .wb-cg-checks{display:grid;gap:8px;margin-top:14px;padding:11px;border-radius:9px;background:#f8f4f6}
      #${HOST_ID} .wb-cg-checks label{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.35;cursor:pointer}
      #${HOST_ID} .wb-cg-checks input{margin-top:2px}
      #${HOST_ID} .wb-cg-foot{display:flex;gap:8px;justify-content:flex-end;padding:11px 17px 15px;border-top:1px solid #eee1e7}
      #${HOST_ID} button{appearance:none;border-radius:9px;padding:8px 11px;font:600 12px/1 Inter,Arial,sans-serif;cursor:pointer}
      #${HOST_ID} .wb-cg-cancel{border:1px solid #d9cbd1;background:#fff;color:#5d4650}
      #${HOST_ID} .wb-cg-confirm{border:1px solid #8f1746;background:#8f1746;color:#fff}
      #${HOST_ID} .wb-cg-confirm[disabled]{opacity:.42;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeModal() {
    document.getElementById(HOST_ID)?.remove();
  }

  function writeAudit(entry) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(AUDIT_KEY, stored => {
          const current = stored?.[AUDIT_KEY];
          const store = current && typeof current === 'object'
            ? { schema: AUDIT_SCHEMA, entries: Array.isArray(current.entries) ? current.entries : [] }
            : { schema: AUDIT_SCHEMA, entries: [] };
          store.entries.unshift(entry);
          store.entries = store.entries.slice(0, MAX_AUDIT);
          store.updatedAt = entry.at;
          chrome.storage.local.set({ [AUDIT_KEY]: store }, () => resolve());
        });
      } catch { resolve(); }
    });
  }

  function resubmit(form, submitter) {
    replayBypass.add(form);
    queueMicrotask(() => {
      try {
        if (submitter instanceof HTMLElement && submitter.isConnected) form.requestSubmit(submitter);
        else form.requestSubmit();
      } catch {
        replayBypass.delete(form);
        try { form.submit(); } catch {}
      }
    });
  }

  function renderModal({ form, submitter, row, constraints, task }) {
    closeModal();
    ensureStyles();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.dataset.simnetWbOwned = '1';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');

    const visible = constraints.slice(0, 6);
    const more = Math.max(0, constraints.length - visible.length);
    const blocker = constraints.some(item => item.severity === 'blocker');

    host.innerHTML = `
      <section class="wb-cg-card">
        <div class="wb-cg-head">
          <div class="wb-cg-title">${blocker ? '⚠ Проверь перед сохранением' : 'Особенности по адресу'}</div>
          <div class="wb-cg-address"></div>
        </div>
        <div class="wb-cg-body">
          <div class="wb-cg-note">Workbench нашёл в карточке дома условия, которые могут повлиять на выезд, подключение или доступ. Источник — сохранённый CRM-индекс.</div>
          <div class="wb-cg-list"></div>
          ${more ? `<div class="wb-cg-more">Ещё условий: ${more}</div>` : ''}
          <div class="wb-cg-checks">
            <label><input type="checkbox" data-role="customer-warned"> <span>Абонент уже предупреждён / условия с ним оговорены</span></label>
            <label><input type="checkbox" data-role="ack"> <span><b>Ознакомлен.</b> Если ещё не согласовано — учту это до выполнения заявки.</span></label>
          </div>
        </div>
        <div class="wb-cg-foot">
          <button type="button" class="wb-cg-cancel" data-action="cancel">Вернуться</button>
          <button type="button" class="wb-cg-confirm" data-action="confirm" disabled>Подтвердить и сохранить</button>
        </div>
      </section>`;

    host.querySelector('.wb-cg-address').textContent = row.address || `Building #${row.id}`;
    const list = host.querySelector('.wb-cg-list');
    for (const item of visible) {
      const node = document.createElement('div');
      node.className = 'wb-cg-item';
      node.dataset.severity = item.severity || 'info';
      const title = document.createElement('div');
      title.className = 'wb-cg-item-title';
      title.textContent = item.label || item.type || 'Особенность';
      const evidence = document.createElement('div');
      evidence.className = 'wb-cg-evidence';
      evidence.textContent = item.evidence || '';
      const action = document.createElement('div');
      action.className = 'wb-cg-action';
      action.textContent = item.action || '';
      node.append(title, evidence, action);
      list.appendChild(node);
    }

    const ack = host.querySelector('[data-role="ack"]');
    const customerWarned = host.querySelector('[data-role="customer-warned"]');
    const confirm = host.querySelector('[data-action="confirm"]');
    ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });

    host.addEventListener('click', async event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
      if (action === 'cancel') {
        closeModal();
        return;
      }
      if (action !== 'confirm' || !ack.checked || confirm.disabled) return;
      confirm.disabled = true;
      const id = String(row.id || buildingId(form));
      const at = new Date().toISOString();
      approvedByForm.set(form, { buildingId: id, expiresAt: Date.now() + APPROVAL_TTL_MS });
      await writeAudit({
        id: `ack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        at,
        buildingId: id,
        address: row.address || '',
        taskTypeId: task.id || '',
        taskTypeLabel: task.label || '',
        customerWarned: Boolean(customerWarned.checked),
        acknowledged: true,
        constraintIds: constraints.map(item => item.id).filter(Boolean),
        constraintTypes: [...new Set(constraints.map(item => item.type).filter(Boolean))],
        blocker: constraints.some(item => item.severity === 'blocker')
      });
      WB.log?.info?.('TASK', 'CRM constraint guard acknowledged', {
        buildingId: id,
        taskTypeId: task.id || '',
        customerWarned: Boolean(customerWarned.checked),
        constraints: constraints.map(item => item.type)
      });
      closeModal();
      resubmit(form, submitter);
    });

    (document.body || document.documentElement).appendChild(host);
    queueMicrotask(() => host.querySelector('[data-role="ack"]')?.focus());
  }

  async function preflight(form, submitter) {
    const id = buildingId(form);
    if (!id || !WB.crmConstraints?.getByBuildingId) {
      resubmit(form, submitter);
      return;
    }

    try {
      const row = await WB.crmConstraints.getByBuildingId(id);
      const constraints = dedupeConstraints(row?.constraints).filter(item => item.requireAck !== false || item.severity === 'info');
      if (!row || !constraints.length) {
        resubmit(form, submitter);
        return;
      }
      renderModal({ form, submitter, row, constraints, task: taskType(form) });
    } catch (error) {
      WB.log?.warn?.('TASK', 'CRM constraint preflight unavailable', { buildingId: id, message: error?.message || String(error) });
      // Guard failure must not silently make UserSide unusable. Native validation still runs.
      resubmit(form, submitter);
    } finally {
      busyForms.delete(form);
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!isTaskSaveForm(form)) return;
    if (replayBypass.has(form)) {
      replayBypass.delete(form);
      return;
    }
    const id = buildingId(form);
    if (!id || approvalValid(form, id)) return;
    if (event.defaultPrevented || busyForms.has(form)) return;

    event.preventDefault();
    event.stopPropagation();
    busyForms.add(form);
    void preflight(form, event.submitter || null);
  }

  document.addEventListener('submit', handleSubmit, true);

  WB.taskConstraintGuard = Object.freeze({
    storageKey: AUDIT_KEY,
    close: closeModal,
    destroy() {
      document.removeEventListener('submit', handleSubmit, true);
      closeModal();
      document.getElementById(STYLE_ID)?.remove();
    }
  });
})();
