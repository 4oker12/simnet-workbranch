(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskSpecialSavePolicyV3Loaded) return;
  WB.__taskSpecialSavePolicyV3Loaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const MODAL_ID = 'simnet-wb-task-special-policy-v3';
  const STYLE_ID = 'simnet-wb-task-special-policy-v3-style';
  const LEGACY_BYPASS_ID = 'simnet-wb-current-task-special-info';
  const AUDIT_KEY = 'simnet_crm_constraint_ack_v1';
  const MAX_AUDIT = 500;
  const MAX_VISIBLE = 6;
  const APPROVAL_TTL_MS = 2 * 60 * 1000;

  const approvedByForm = new WeakMap();
  const busyForms = new WeakSet();
  const fallbackBypass = new WeakSet();

  const compact = (value, max = 1000) => {
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

  function isTaskSaveForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try { return FORM_ACTION_RE.test(new URL(String(form.action || location.href), location.href).pathname); }
    catch { return false; }
  }

  function taskTypeLabel(form) {
    const select = form.querySelector('select[name="task_type_uuid"]');
    return compact(select?.selectedOptions?.[0]?.textContent || select?.getAttribute?.('title') || '', 180);
  }

  function currentAddress(form, debug = null) {
    if (debug?.address) return compact(debug.address, 360);
    const direct = compact(form.querySelector('#fastSearchInputtask_address, #inputAddressFastFindtask_addressId')?.value || '', 360);
    if (direct) return direct;
    const building = form.querySelector('#buildingUuidtask_address');
    return compact(building?.selectedOptions?.[0]?.textContent || '', 360) || 'Текущий адрес заявки';
  }

  function entranceValue(form, address = '') {
    const controls = Array.from(form.querySelectorAll('select,input'));
    for (const field of controls) {
      const key = `${field.name || ''} ${field.id || ''} ${field.getAttribute?.('aria-label') || ''}`;
      if (!/(?:entrance|section|parad|pod.?ezd|pid.?izd|секц|подъезд|під.?їзд|парадн)/iu.test(key)) continue;
      const raw = field instanceof HTMLSelectElement
        ? `${field.value || ''} ${field.selectedOptions?.[0]?.textContent || ''}`
        : String(field.value || '');
      const match = raw.match(/\b\d{1,2}\b/);
      if (match) return String(Number(match[0]));
    }
    const fromAddress = String(address || '').match(/(?:подъезд|парадн\w*|під.?їзд|секц\w*)\D{0,8}(\d{1,2})/iu);
    return fromAddress ? String(Number(fromAddress[1])) : '';
  }

  function relevantContextSignature(form) {
    const values = [];
    for (const field of Array.from(form.querySelectorAll('select,input'))) {
      const key = `${field.name || ''}|${field.id || ''}`;
      if (!/(?:task_type_uuid|building_uuid|address_unit|customer_uuid|task_address|entrance|section|parad|tariff|service|technology|speed)/i.test(key)) continue;
      let value = String(field.value || '');
      if (field instanceof HTMLSelectElement) value += `:${field.selectedOptions?.[0]?.textContent || ''}`;
      values.push(`${key}=${compact(value, 220)}`);
    }
    return values.sort().join('|');
  }

  function approvalValid(form) {
    const row = approvedByForm.get(form);
    return Boolean(row && row.signature === relevantContextSignature(form) && Number(row.expiresAt || 0) > Date.now());
  }

  function approve(form) {
    approvedByForm.set(form, {
      signature: relevantContextSignature(form),
      expiresAt: Date.now() + APPROVAL_TTL_MS
    });
  }

  function armLegacyBypass() {
    let marker = document.getElementById(LEGACY_BYPASS_ID);
    if (!marker) {
      marker = document.createElement('span');
      marker.id = LEGACY_BYPASS_ID;
      marker.hidden = true;
      marker.dataset.simnetWbOwned = '1';
      (document.documentElement || document.body).appendChild(marker);
    }
    queueMicrotask(() => marker?.remove());
  }

  function replay(form, submitter) {
    queueMicrotask(() => {
      try {
        if (submitter instanceof HTMLElement && submitter.form === form && submitter.isConnected) form.requestSubmit(submitter);
        else form.requestSubmit();
      } catch {
        fallbackBypass.add(form);
        try { HTMLFormElement.prototype.submit.call(form); } catch {}
      }
    });
  }

  function fallbackToExistingGuard(form, submitter, reason, error = null) {
    fallbackBypass.add(form);
    log('warn', 'special_policy_v3_fallback', {
      reason,
      message: compact(error?.message || error || '', 180)
    });
    replay(form, submitter);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:18px;background:rgba(24,30,35,.48);font-family:Arial,sans-serif}
      #${MODAL_ID} .wb-sp-card{box-sizing:border-box;width:min(640px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));overflow:auto;background:#fff;border:1px solid #c9d0d5;border-top:4px solid #a50046;border-radius:7px;box-shadow:0 18px 48px rgba(20,30,38,.28);color:#15181a}
      #${MODAL_ID} .wb-sp-head{padding:14px 16px 12px;border-bottom:1px solid #dfe4e8;background:#fff}
      #${MODAL_ID} .wb-sp-kicker{font-size:10px;line-height:1.2;font-weight:800;letter-spacing:.08em;color:#a50046;text-transform:uppercase}
      #${MODAL_ID} .wb-sp-title{margin-top:4px;font-size:18px;line-height:1.25;font-weight:800;color:#111}
      #${MODAL_ID} .wb-sp-purpose{margin-top:5px;font-size:12px;line-height:1.35;color:#4e5961}
      #${MODAL_ID} .wb-sp-address{margin-top:7px;font-size:11px;font-weight:600;color:#68747d}
      #${MODAL_ID} .wb-sp-body{padding:12px 16px 6px;background:#f7f8f9}
      #${MODAL_ID} .wb-sp-item{position:relative;margin:0 0 10px;padding:11px 12px 10px;border:1px solid #d9dee2;border-left:4px solid #a50046;border-radius:5px;background:#fff}
      #${MODAL_ID} .wb-sp-item[data-severity="blocker"]{border-left-width:6px;background:#fffafb}
      #${MODAL_ID} .wb-sp-item[data-severity="review"]{border-left-width:6px;background:#fffdf7}
      #${MODAL_ID} .wb-sp-item:last-child{margin-bottom:4px}
      #${MODAL_ID} .wb-sp-item-top{display:flex;align-items:flex-start;gap:8px}
      #${MODAL_ID} .wb-sp-tag{flex:0 0 auto;margin-top:1px;padding:3px 6px;border-radius:3px;background:#f1e8ec;color:#7f0037;font-size:9px;line-height:1.15;font-weight:800;letter-spacing:.04em}
      #${MODAL_ID} .wb-sp-summary{min-width:0;font-size:15px;line-height:1.28;font-weight:800;color:#0f1113}
      #${MODAL_ID} .wb-sp-severity{margin-top:7px;font-size:10px;line-height:1.25;font-weight:800;letter-spacing:.035em;color:#7b263f}
      #${MODAL_ID} .wb-sp-impact,#${MODAL_ID} .wb-sp-action{margin-top:6px;font-size:12px;line-height:1.4;color:#252b30}
      #${MODAL_ID} .wb-sp-impact strong,#${MODAL_ID} .wb-sp-action strong{color:#111}
      #${MODAL_ID} .wb-sp-action{padding:7px 8px;background:#f4f5f6;border-radius:4px}
      #${MODAL_ID} .wb-sp-review{margin-top:7px;font-size:10.5px;color:#626d75}
      #${MODAL_ID} .wb-sp-review summary{cursor:pointer;font-weight:700}
      #${MODAL_ID} .wb-sp-evidence{margin-top:5px;padding:7px 8px;border-left:2px solid #aeb8bf;background:#f7f8f9;line-height:1.35;white-space:normal;color:#4d565d}
      #${MODAL_ID} .wb-sp-more{padding:5px 1px 8px;font-size:11px;font-weight:700;color:#65717b}
      #${MODAL_ID} .wb-sp-check{margin:0;padding:11px 16px;background:#fff;border-top:1px solid #dfe4e8;font-size:12px;color:#202428}
      #${MODAL_ID} .wb-sp-check label{display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-weight:600;line-height:1.35}
      #${MODAL_ID} .wb-sp-check input{margin-top:1px}
      #${MODAL_ID} .wb-sp-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 12px;border-top:1px solid #dfe4e8;background:#fff}
      #${MODAL_ID} button{appearance:none;border-radius:4px;padding:8px 12px;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #${MODAL_ID} .wb-sp-cancel{border:1px solid #b9c2c9;background:#fff;color:#303b43}
      #${MODAL_ID} .wb-sp-confirm{border:1px solid #526d82;background:#526d82;color:#fff}
      #${MODAL_ID} .wb-sp-confirm[disabled]{opacity:.45;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function writeAudit({ form, debug, items }) {
    try {
      chrome.storage.local.get(AUDIT_KEY, stored => {
        const current = stored?.[AUDIT_KEY];
        const entries = Array.isArray(current?.entries) ? current.entries : [];
        entries.unshift({
          id: `ack_policy_v3_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          source: 'userside-special-policy-v3',
          schema: 'simnet-crm-constraint-ack-v1',
          buildingUuid: debug?.resolvedBuildingUuid || debug?.directBuildingUuid || '',
          addressUnitUuid: debug?.addressUnitUuid || '',
          address: currentAddress(form, debug),
          taskTypeUuid: debug?.taskTypeUuid || '',
          acknowledged: true,
          policyVersion: 3,
          actionable: items.map(item => ({
            type: item.type,
            severity: item.severity,
            summary: item.summary,
            certainty: item.certainty,
            needsReview: item.needsReview,
            decisionMode: item.decisionMode,
            scope: item.scope
          }))
        });
        chrome.storage.local.set({
          [AUDIT_KEY]: {
            ...(current || {}),
            schema: 'simnet-crm-constraint-ack-v1',
            updatedAt: new Date().toISOString(),
            entries: entries.slice(0, MAX_AUDIT)
          }
        });
      });
    } catch {}
  }

  function showModal({ form, submitter, debug, items, context }) {
    closeModal();
    ensureStyles();
    const policy = WB.taskSpecialPolicyV3;
    const host = document.createElement('div');
    host.id = MODAL_ID;
    host.dataset.simnetWbOwned = '1';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML = '<section class="wb-sp-card"><div class="wb-sp-head"><div class="wb-sp-kicker">Важно перед сохранением</div><div class="wb-sp-title">Условия, которые могут повлиять на выполнение заявки</div><div class="wb-sp-purpose">Смысл ниже — не просто показать заметку, а понять риск и что нужно сделать до передачи заявки в работу.</div><div class="wb-sp-address"></div></div><div class="wb-sp-body"><div data-wb-sp-items="1"></div><div class="wb-sp-more" data-wb-sp-more="1" hidden></div></div><div class="wb-sp-check"><label><input type="checkbox" data-role="ack"> <span>Проверил условия и учёл их в заявке: доступ, время, технологию, ресурс или другое требование.</span></label></div><div class="wb-sp-foot"><button type="button" class="wb-sp-cancel" data-action="cancel">Вернуться к заявке</button><button type="button" class="wb-sp-confirm" data-action="confirm" disabled>Учёл — сохранить</button></div></section>';
    host.querySelector('.wb-sp-address').textContent = currentAddress(form, debug);

    const list = host.querySelector('[data-wb-sp-items="1"]');
    const visible = items.slice(0, MAX_VISIBLE);
    for (const item of visible) {
      const presentation = typeof policy?.presentItem === 'function'
        ? policy.presentItem(item, context || {})
        : {
            summary: item.summary,
            severity: item.needsReview ? 'review' : (item.severity || 'warning'),
            severityLabel: item.needsReview ? 'НУЖНА ПРОВЕРКА' : 'ВАЖНО ДО СОХРАНЕНИЯ',
            tag: 'ВАЖНО',
            impact: 'Условие может изменить порядок или результат выполнения заявки.',
            action: 'Сверить исходную заметку и передать важное условие исполнителю.'
          };
      const node = document.createElement('div');
      node.className = 'wb-sp-item';
      node.dataset.severity = presentation.severity || (item.needsReview ? 'review' : (item.severity || 'warning'));

      const top = document.createElement('div');
      top.className = 'wb-sp-item-top';
      const tag = document.createElement('span');
      tag.className = 'wb-sp-tag';
      tag.textContent = presentation.tag || 'ВАЖНО';
      const summary = document.createElement('div');
      summary.className = 'wb-sp-summary';
      summary.textContent = presentation.summary || item.summary;
      top.append(tag, summary);
      node.appendChild(top);

      const severity = document.createElement('div');
      severity.className = 'wb-sp-severity';
      severity.textContent = presentation.severityLabel || 'ВАЖНО ДО СОХРАНЕНИЯ';
      node.appendChild(severity);

      const impact = document.createElement('div');
      impact.className = 'wb-sp-impact';
      const impactLabel = document.createElement('strong');
      impactLabel.textContent = 'Почему важно: ';
      impact.append(impactLabel, document.createTextNode(presentation.impact || 'Условие может повлиять на выполнение заявки.'));
      node.appendChild(impact);

      const action = document.createElement('div');
      action.className = 'wb-sp-action';
      const actionLabel = document.createElement('strong');
      actionLabel.textContent = 'Что сделать: ';
      action.append(actionLabel, document.createTextNode(presentation.action || 'Проверить условие до сохранения.'));
      node.appendChild(action);

      if (item.evidence) {
        const details = document.createElement('details');
        details.className = 'wb-sp-review';
        const title = document.createElement('summary');
        title.textContent = 'Исходная заметка';
        const evidence = document.createElement('div');
        evidence.className = 'wb-sp-evidence';
        evidence.textContent = item.evidence;
        details.append(title, evidence);
        node.appendChild(details);
      }
      list.appendChild(node);
    }

    const more = Math.max(0, items.length - visible.length);
    if (more) {
      const moreNode = host.querySelector('[data-wb-sp-more="1"]');
      moreNode.hidden = false;
      moreNode.textContent = `Ещё важных условий: ${more}`;
    }

    const ack = host.querySelector('[data-role="ack"]');
    const confirm = host.querySelector('[data-action="confirm"]');
    ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });
    host.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
      if (action === 'cancel') {
        closeModal();
        log('info', 'special_policy_v3_cancelled', { actionableCount: items.length });
        return;
      }
      if (action !== 'confirm' || !ack.checked || confirm.disabled) return;
      confirm.disabled = true;
      approve(form);
      writeAudit({ form, debug, items });
      log('info', 'special_policy_v3_confirmed', {
        buildingUuid: debug?.resolvedBuildingUuid || '',
        actionableCount: items.length,
        summaries: items.map(item => item.summary)
      });
      closeModal();
      replay(form, submitter);
    });

    (document.body || document.documentElement).appendChild(host);
    queueMicrotask(() => ack?.focus());
    log('warn', 'special_policy_v3_shown', {
      buildingUuid: debug?.resolvedBuildingUuid || '',
      address: currentAddress(form, debug),
      actionableCount: items.length,
      summaries: items.map(item => item.summary)
    });
  }

  async function preflight(form, submitter) {
    try {
      const policy = WB.taskSpecialPolicyV3;
      const recovery = WB.taskCurrentLiveRecovery;
      if (!policy?.interpretRows || !recovery?.debug) {
        fallbackToExistingGuard(form, submitter, 'dependency-missing');
        return;
      }

      const debug = await recovery.debug(form);
      if (!debug || !Array.isArray(debug.noteRows)) {
        fallbackToExistingGuard(form, submitter, 'context-unavailable');
        return;
      }

      const address = currentAddress(form, debug);
      const context = {
        taskTypeLabel: taskTypeLabel(form),
        entrance: entranceValue(form, address),
        address
      };
      const items = policy.interpretRows(debug.noteRows, context);
      log('info', 'special_policy_v3_evaluated', {
        taskTypeUuid: debug.taskTypeUuid || '',
        buildingUuid: debug.resolvedBuildingUuid || '',
        rawNoteCount: debug.noteRows.length,
        actionableCount: items.length,
        context,
        summaries: items.map(item => item.summary)
      });

      if (!items.length) {
        approve(form);
        replay(form, submitter);
        return;
      }
      showModal({ form, submitter, debug, items, context });
    } catch (error) {
      fallbackToExistingGuard(form, submitter, 'exception', error);
    } finally {
      busyForms.delete(form);
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!isTaskSaveForm(form)) return;

    if (fallbackBypass.has(form)) {
      fallbackBypass.delete(form);
      return;
    }

    if (approvalValid(form)) {
      armLegacyBypass();
      return;
    }

    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (busyForms.has(form)) return;
    busyForms.add(form);
    void preflight(form, event.submitter || null);
  }

  window.addEventListener('submit', handleSubmit, true);

  WB.taskSpecialSavePolicyV3 = Object.freeze({
    version: 3,
    close: closeModal,
    async debug(form = null) {
      const target = isTaskSaveForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isTaskSaveForm) || null;
      if (!target || !WB.taskCurrentLiveRecovery?.debug || !WB.taskSpecialPolicyV3?.interpretRows) return null;
      const debug = await WB.taskCurrentLiveRecovery.debug(target);
      const address = currentAddress(target, debug);
      const context = { taskTypeLabel: taskTypeLabel(target), entrance: entranceValue(target, address), address };
      return { ...debug, policyVersion: 3, context, policyItems: WB.taskSpecialPolicyV3.interpretRows(debug.noteRows || [], context) };
    },
    destroy() {
      window.removeEventListener('submit', handleSubmit, true);
      closeModal();
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(LEGACY_BYPASS_ID)?.remove();
    }
  });
})();
