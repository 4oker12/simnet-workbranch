(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callRegistrationIdentityUx) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  let documentObserver = null;
  let shadowObserver = null;
  let observedShadow = null;
  let stopped = false;
  let scheduled = false;
  let applying = false;

  const clean = (value, max = 220) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);

  function registration() {
    const current = WB.callRegistration;
    return current && current.__lazy !== true ? current : null;
  }

  function directionArrow(call = {}) {
    const direction = String(call.direction || '').toLowerCase();
    if (/out|исход|outgoing/.test(direction)) return '→';
    return '←';
  }

  function callRelationSource(call = {}) {
    if (!call || typeof call !== 'object') return 'unresolved';
    const binding = call.binding && typeof call.binding === 'object' ? call.binding : null;
    if (binding?.operatorOverride) return 'manual';
    // customerId stored directly on the canonical call comes from UserSide
    // call_list. Merely opening a subscriber card never creates this field.
    if (digits(call.customerId, 14)) return 'direct';
    if (
      digits(binding?.customerId || binding?.identity?.customerId, 14)
      || clean(binding?.caseId || binding?.identity?.caseId, 120)
      || Number(binding?.candidateConfidence || 0) > 0
    ) return 'inferred';
    if (Number(call.topConfidence || 0) >= 80 && Number(call.frozenCandidateCount || 0) > 0) return 'inferred';
    return 'unresolved';
  }

  function mergedDayCall(reg, raw = {}) {
    const key = String(raw.callKey || '');
    const live = (Array.isArray(reg?.pbxCalls) ? reg.pbxCalls : []).find(item => String(item?.callKey || '') === key) || null;
    return live ? { ...raw, ...live, binding: live.binding || raw.binding } : raw;
  }

  function ensureStyle(shadow) {
    if (shadow.querySelector('style[data-wb-call-identity-ux]')) return;
    const style = document.createElement('style');
    style.dataset.wbCallIdentityUx = '1';
    style.textContent = `
      .wb-binding-origin{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;margin-left:5px;border-radius:50%;vertical-align:1px;font:800 8px/1 inherit;cursor:help}
      .wb-binding-origin.inferred{background:#FFF1F6;color:#A50046;border:1px solid #F2B8CF}
      .wb-binding-origin.manual{background:#F2F4F7;color:#667085;border:1px solid #D0D5DD}
      .wb-call-link{display:grid;gap:1px;min-width:62px;line-height:1.15}
      .wb-call-link-main{font-size:9px;font-weight:800;color:#667085;white-space:nowrap}
      .wb-call-link-main.direct{color:#475467}.wb-call-link-main.inferred{color:#A50046}.wb-call-link-main.manual{color:#667085}
      .wb-call-link-pbx{font-size:8px;color:#98A2B3;white-space:nowrap}
      .hist-pop{width:min(450px,calc(100vw - 64px))!important;max-height:340px!important}
      .hist-table td:nth-child(4){min-width:72px}
    `;
    shadow.appendChild(style);
  }

  function patchHeader(shadow, reg) {
    const node = shadow.querySelector('.head .title p');
    if (!node) return;
    const call = reg?.focusCall || null;
    let text = 'глобальный CALL · выбери звонок';
    if (call) {
      const callId = digits(call.usersideCallId, 24);
      const phone = clean(call.callerMasked || call.callerId || 'номер не определён', 32);
      const when = clean(call.time || '', 16);
      const duration = clean(call.duration || (call.ongoing ? 'идёт' : ''), 24);
      text = [callId ? `CALL #${callId}` : 'CALL', `${directionArrow(call)} ${phone}`, when, duration].filter(Boolean).join(' · ');
    }
    if (node.dataset.wbCallIdentityText === text) return;
    node.textContent = text;
    node.dataset.wbCallIdentityText = text;
    node.title = 'Это идентичность выбранного звонка. Открытая карточка абонента сама по себе звонок не привязывает.';
  }

  function patchFocusTarget(shadow, reg) {
    const kicker = shadow.querySelector('.focus-target-kicker');
    if (!kicker) return;

    const call = reg?.focusCall || {};
    const source = callRelationSource(call);
    const markerKind = source === 'manual' ? 'manual' : source === 'inferred' ? 'inferred' : '';
    const signature = `subscriber-label|${markerKind}`;
    if (kicker.dataset.wbBindingPatch === signature) return;

    const textNode = Array.from(kicker.childNodes).find(node => node.nodeType === Node.TEXT_NODE) || null;
    if (textNode) {
      if (textNode.nodeValue !== 'Абонент звонка') textNode.nodeValue = 'Абонент звонка';
    } else {
      kicker.insertBefore(document.createTextNode('Абонент звонка'), kicker.firstChild || null);
    }

    const existing = kicker.querySelector('.wb-binding-origin');
    if (!markerKind) {
      existing?.remove();
      kicker.dataset.wbBindingPatch = signature;
      return;
    }

    const markerText = markerKind === 'manual' ? 'm' : '◇';
    const markerTitle = markerKind === 'manual'
      ? 'Связь звонка с абонентом подтверждена оператором вручную.'
      : 'Связь звонка с абонентом определена Workbench по evidence, а не напрямую UserSide call_list.';

    let marker = existing;
    if (!marker) {
      marker = document.createElement('span');
      kicker.appendChild(marker);
    }
    marker.className = `wb-binding-origin ${markerKind}`;
    if (marker.textContent !== markerText) marker.textContent = markerText;
    if (marker.title !== markerTitle) marker.title = markerTitle;
    kicker.dataset.wbBindingPatch = signature;
  }

  function historyCallForRow(reg, tr) {
    const button = tr.querySelector('[data-action="focus-history-call"][data-call-key]');
    const key = String(button?.dataset?.callKey || '');
    if (!key) return null;
    const row = (Array.isArray(reg?.dayCalls) ? reg.dayCalls : []).find(item => String(item?.callKey || '') === key) || null;
    return row ? mergedDayCall(reg, row) : null;
  }

  function linkMarkup(call = {}) {
    const source = callRelationSource(call);
    const callId = digits(call.usersideCallId || String(call.callKey || '').match(/^call:(\d+)$/)?.[1], 24);
    const recordId = clean(call.pbxRecordId || call.recordId, 80);
    const confidence = Math.max(0, Math.min(100, Math.round(Number(call.binding?.candidateConfidence || call.topConfidence || 0))));
    const main = source === 'direct'
      ? 'call_list'
      : source === 'manual'
        ? 'ручная'
        : source === 'inferred'
          ? `◇ WB${confidence ? ` ${confidence}%` : ''}`
          : '—';
    const pbx = recordId ? 'PBX ✓' : 'PBX —';
    const title = [
      callId ? `UserSide CALL #${callId}` : '',
      recordId ? `PBX recordId ${recordId}` : 'PBX recordId ещё не установлен',
      source === 'direct' ? 'Абонент определён напрямую UserSide call_list' : '',
      source === 'inferred' ? 'Абонент определён Workbench по evidence' : '',
      source === 'manual' ? 'Абонент подтверждён оператором вручную' : '',
      source === 'unresolved' ? 'Абонент звонка пока не установлен' : ''
    ].filter(Boolean).join('\n');
    return { source, main, pbx, title };
  }

  function patchHistory(shadow, reg) {
    const rows = shadow.querySelectorAll('.hist-table tbody tr');
    rows.forEach(tr => {
      const call = historyCallForRow(reg, tr);
      if (!call || !tr.cells || tr.cells.length < 4) return;
      const link = linkMarkup(call);
      const cell = tr.cells[3];
      const signature = `${call.callKey}|${call.pbxRecordId || call.recordId || ''}|${link.source}|${call.topConfidence || ''}|${call.binding?.candidateConfidence || ''}`;
      if (cell.dataset.wbCallLink === signature) return;
      cell.dataset.wbCallLink = signature;
      cell.innerHTML = `<span class="wb-call-link" title="${link.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"><span class="wb-call-link-main ${link.source}">${link.main}</span><span class="wb-call-link-pbx">${link.pbx}</span></span>`;
    });
  }

  function patch(shadow) {
    if (stopped || applying) return;
    const reg = registration();
    if (!reg) return;
    applying = true;
    try {
      ensureStyle(shadow);
      patchHeader(shadow, reg);
      patchFocusTarget(shadow, reg);
      patchHistory(shadow, reg);
    } finally {
      applying = false;
    }
  }

  function queuePatch() {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const host = document.getElementById(HOST_ID);
      const shadow = host?.shadowRoot;
      if (!shadow) return;
      hookShadow(shadow);
      patch(shadow);
    });
  }

  function hookShadow(shadow) {
    if (!shadow || observedShadow === shadow) return;
    shadowObserver?.disconnect();
    observedShadow = shadow;
    shadowObserver = new MutationObserver(queuePatch);
    shadowObserver.observe(shadow, { childList: true, subtree: true });
  }

  documentObserver = new MutationObserver(queuePatch);
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  queuePatch();

  WB.callRegistrationIdentityUx = Object.freeze({
    scan: queuePatch,
    destroy() {
      stopped = true;
      documentObserver?.disconnect();
      shadowObserver?.disconnect();
      documentObserver = null;
      shadowObserver = null;
      observedShadow = null;
    }
  });
})();
