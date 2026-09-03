/**
 * The complete PON product route in one place.
 *
 * Browser flow:
 * Billing Technical
 *   -> parsers/billing/technical.js reads OLT / ONU MAC / Serial
 *   -> this workflow decides whether UserSide TMC must be checked
 * UserSide /customer/{id}
 *   -> parsers/userside/tmc.js reads #ref_inventory -> category=PON row
 *   -> TMC facts are stored independently from Billing persistence
 * TMC facts are independent evidence only. Workbench never copies them into
 * Billing. If Billing is missing required values, the operator fills and saves
 * the native Technical form manually. Poll becomes available only after a fresh
 * Billing document confirms the required values.
 * Poll
 *   -> the vendor/interface mapping below selects 310 / 311 / 312 / 313
 *   -> the native Billing poll request runs
 *   -> vendor poll parsers read the correlated response
 *
 * Serial contract:
 * - a real Serial is useful and may be copied to Billing;
 * - when Billing has no Serial and a real TMC PON row was checked and also has
 *   no Serial, known OLT + ONU MAC are sufficient for this poll;
 * - missing Serial alone never proves EPON. Technology is resolved separately
 *   from the real OLT name/vendor and interface.
 */

export const PonWorkflowState = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  OPEN_TECHNICAL: 'open_technical',
  CHECK_TMC: 'check_tmc',
  LOCATE_BINDING: 'locate_binding',
  FILL_TECHNICAL: 'manual_fill_billing',
  READY_FOR_POLL: 'ready_for_poll',
  POLLING: 'polling',
  COMPLETE: 'complete',
  MANUAL_REVIEW: 'manual_review',
  BLOCKED: 'blocked'
});

const VALID_POLL_ACTIONS = new Set(['310', '311', '312', '313']);
const POLL_ACTIVE_MAX_AGE_MS = 30000;
const valueOf = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
const sourceOf = fact => fact && typeof fact === 'object' ? String(fact.source || '') : '';
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const comparable = value => text(value).toLowerCase();

export const normalizePonMac = value => {
  const hex = text(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : '';
};

export const normalizePonSerial = value => text(value)
  .replace(/[^0-9a-z]/gi, '')
  .toUpperCase();

const factText = fact => text(valueOf(fact));

function contextVisited(caseData, pageKind) {
  if (pageKind === 'billing_technical' && caseData?.visits?.billingTechnicalAt) return true;
  if (pageKind === 'userside_customer' && caseData?.visits?.usersideTmcAt) return true;
  if (caseData?.currentContext?.pageKind === pageKind) return true;
  if (Object.values(caseData?.contexts || {}).some(item => item?.pageKind === pageKind)) return true;
  return Object.values(caseData?.viewsByTab || {}).some(byDocument => (
    Object.values(byDocument || {}).some(item => item?.pageKind === pageKind)
  ));
}

export function billingTechnicalFacts(caseData = {}) {
  const rawOltIp = caseData?.pon?.oltIp;
  const oltIpSource = sourceOf(rawOltIp);
  const oltIp = /^billing:onu-poll-explicit-olt-ip$/i.test(oltIpSource)
    ? ''
    : factText(rawOltIp);
  return {
    oltName: factText(caseData?.pon?.oltName),
    oltIp,
    oltDeviceId: factText(caseData?.pon?.oltId) || factText(caseData?.pon?.oltDeviceId),
    onuMac: factText(caseData?.pon?.onuMac),
    onuSerial: factText(caseData?.pon?.onuSerial),
    observed: Boolean(
      contextVisited(caseData, 'billing_technical')
      || /^billing:/i.test(sourceOf(caseData?.pon?.oltName))
      || /^billing:/i.test(sourceOf(caseData?.pon?.onuMac))
      || /^billing:/i.test(sourceOf(caseData?.pon?.onuSerial))
    )
  };
}

export function tmcFacts(caseData = {}) {
  const status = caseData?.locator?.sourceStatus?.tmc || null;
  const details = status?.details || {};
  const hasStoredFacts = Boolean(
    factText(caseData?.pon?.tmcOltName)
    || factText(caseData?.pon?.tmcOltIp)
    || factText(caseData?.pon?.tmcOnuMac)
    || factText(caseData?.pon?.tmcOnuSerial)
  );
  const found = String(status?.result || '') === 'found' || hasStoredFacts;
  const checked = Boolean(status || hasStoredFacts);
  return {
    checked,
    found,
    result: String(status?.result || (checked ? 'checked' : 'unknown')),
    equipmentName: factText(caseData?.pon?.tmcEquipmentName) || text(details.equipmentName),
    oltName: factText(caseData?.pon?.tmcOltName) || text(details.oltName),
    oltIp: factText(caseData?.pon?.tmcOltIp) || text(details.oltIp),
    oltDeviceId: factText(caseData?.pon?.tmcOltDeviceId) || text(details.oltDeviceId || details.deviceId),
    interface: factText(caseData?.pon?.tmcPort) || text(details.interface),
    onuMac: factText(caseData?.pon?.tmcOnuMac) || text(details.onuMac || details.mac),
    onuSerial: factText(caseData?.pon?.tmcOnuSerial) || text(details.onuSerial || details.serial),
    onuRx: factText(caseData?.pon?.tmcOnuRx) || text(details.onuRx),
    onuTx: factText(caseData?.pon?.tmcOnuTx) || text(details.onuTx),
    oltRx: factText(caseData?.pon?.tmcOltRx) || text(details.oltRx),
    foundOnOlt: comparable(valueOf(caseData?.pon?.tmcFoundOnOlt)) === 'true'
      || details.foundOnOlt === true,
    technology: text(details.technology),
    pollAction: text(details.pollAction)
  };
}

export function tmcTechnicalExpectation(caseData = {}) {
  const tmc = tmcFacts(caseData);
  const expected = {
    oltName: tmc.oltName,
    oltIp: tmc.oltIp,
    onuSerial: tmc.onuSerial,
    onuMac: tmc.onuMac
  };
  const fields = [];
  if (expected.oltName || expected.oltIp) fields.push('olt');
  if (normalizePonMac(expected.onuMac)) fields.push('onuMac');
  if (normalizePonSerial(expected.onuSerial)) fields.push('onuSerial');
  return { expected, fields, sourceFound: tmc.found, sourceChecked: tmc.checked };
}

/**
 * One and only vendor/interface -> Billing poll route mapping.
 * Vendor identity outranks generic port wording: Huawei always uses a=313.
 */
export function pollRouteFromEvidence({ oltName = '', equipmentName = '', technology = '', pollAction = '', interfaceName = '' } = {}) {
  const name = text(oltName);
  const equipment = text(equipmentName);
  const declared = text(technology);
  const iface = text(interfaceName);
  const explicit = text(pollAction);
  const all = `${declared} ${name} ${equipment}`;
  const eponInterface = /\bepon(?=\d|[\s/_:-]|$)/i.test(iface);
  const gponInterface = /\bgpon(?=\d|[\s/_:-]|$)/i.test(iface);

  if (/\bhuawei\b/i.test(all)) {
    return { type: 'Huawei', action: '313', derivedBy: 'vendor-or-type' };
  }
  if (/\bg[\s_-]*com\b/i.test(all)) {
    return { type: 'GCOM', action: '312', derivedBy: 'vendor-or-type' };
  }
  if (eponInterface) {
    return { type: 'EPON', action: '310', derivedBy: 'interface' };
  }
  if (gponInterface) {
    return { type: 'GPON', action: '311', derivedBy: 'interface' };
  }
  if (/\bepon\b/i.test(all) || /bdcom\s+olt\s+p36/i.test(name)) {
    return { type: 'EPON', action: '310', derivedBy: 'name-or-type' };
  }
  if (/\bgpon\b/i.test(all)) {
    return { type: 'GPON', action: '311', derivedBy: 'name-or-type' };
  }
  if (VALID_POLL_ACTIONS.has(explicit)) {
    const type = { '310': 'EPON', '311': 'GPON', '312': 'GCOM', '313': 'Huawei' }[explicit];
    return { type, action: explicit, derivedBy: 'trusted-explicit-action' };
  }
  return { type: '', action: '', derivedBy: '' };
}

export function pollRouteForCase(caseData = {}) {
  const billing = billingTechnicalFacts(caseData);
  // Poll type is derived only from server-backed Billing Technical facts. TMC
  // may tell the operator what to enter, but it cannot unlock a poll by itself.
  const route = pollRouteFromEvidence({
    oltName: billing.oltName,
    interfaceName: factText(caseData?.pon?.port),
    technology: '',
    pollAction: ''
  });
  return route.action
    ? { ...route, source: 'billing' }
    : { ...route, source: '' };
}

export function requiredTechnicalFieldsForCase(caseData = {}) {
  if (comparable(valueOf(caseData?.network?.connectionFamily)) === 'ethernet') return [];
  // OLT + ONU MAC are the fundamental poll identity. Serial is supplemental;
  // its absence is handled explicitly through serialStatus in the workflow.
  return ['olt', 'onuMac'];
}

function fieldPresent(field, facts) {
  if (field === 'olt') return Boolean(text(facts?.oltName) || text(facts?.oltIp));
  if (field === 'onuMac') return Boolean(normalizePonMac(facts?.onuMac));
  if (field === 'onuSerial') return Boolean(normalizePonSerial(facts?.onuSerial));
  return false;
}

function sameOlt(left, right) {
  const leftDeviceId = comparable(left?.oltDeviceId);
  const rightDeviceId = comparable(right?.oltDeviceId);
  const leftIp = comparable(left?.oltIp);
  const rightIp = comparable(right?.oltIp);
  if (leftDeviceId && rightDeviceId && leftDeviceId === rightDeviceId) return true;
  if (leftIp && rightIp && leftIp === rightIp) return true;
  // Stable identifiers were available and neither matched. Do not let a short
  // or stale display label hide a real OLT mismatch.
  if ((leftDeviceId && rightDeviceId) || (leftIp && rightIp)) return false;
  const leftName = comparable(left?.oltName);
  const rightName = comparable(right?.oltName);
  return Boolean(leftName && rightName && (
    leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)
  ));
}

export function assessPonTechnical(caseData = {}) {
  const billing = billingTechnicalFacts(caseData);
  const tmc = tmcFacts(caseData);
  const requiredFields = requiredTechnicalFieldsForCase(caseData);
  const missingBilling = requiredFields.filter(field => !fieldPresent(field, billing));
  const availableFromTmc = [];
  if (!fieldPresent('olt', billing) && fieldPresent('olt', tmc)) availableFromTmc.push('olt');
  if (!fieldPresent('onuMac', billing) && fieldPresent('onuMac', tmc)) availableFromTmc.push('onuMac');
  if (!fieldPresent('onuSerial', billing) && fieldPresent('onuSerial', tmc)) availableFromTmc.push('onuSerial');

  const conflicts = [];
  if (fieldPresent('olt', billing) && fieldPresent('olt', tmc) && !sameOlt(billing, tmc)) {
    conflicts.push({
      field: 'olt',
      billing: billing.oltName || billing.oltIp,
      tmc: tmc.oltName || tmc.oltIp,
      blocking: false,
      effectiveSource: 'billing'
    });
  }
  if (normalizePonMac(billing.onuMac) && normalizePonMac(tmc.onuMac)
      && normalizePonMac(billing.onuMac) !== normalizePonMac(tmc.onuMac)) {
    conflicts.push({ field: 'onuMac', billing: billing.onuMac, tmc: tmc.onuMac, blocking: true });
  }
  if (normalizePonSerial(billing.onuSerial) && normalizePonSerial(tmc.onuSerial)
      && normalizePonSerial(billing.onuSerial) !== normalizePonSerial(tmc.onuSerial)) {
    conflicts.push({ field: 'onuSerial', billing: billing.onuSerial, tmc: tmc.onuSerial, blocking: false });
  }

  const warnings = conflicts
    .filter(item => item.field === 'olt')
    .map(item => ({
      code: 'BILLING_OLT_DIFFERS_FROM_TMC',
      level: 'warning',
      blocking: false,
      message: 'OLT в Billing отличается от TMC. Для poll используется только сохранённое значение Billing.',
      billing: item.billing,
      tmc: item.tmc
    }));

  return {
    billing,
    tmc,
    effective: billing,
    requiredFields,
    missingBilling,
    missingEffective: missingBilling,
    prefillFields: availableFromTmc,
    conflicts,
    identityConflicts: conflicts.filter(item => item.field === 'onuMac'),
    warnings,
    tmcAuthoritativeOlt: false,
    serialStatus: normalizePonSerial(billing.onuSerial) ? 'known' : (tmc.checked ? 'optional-missing' : 'unknown'),
    billingComplete: missingBilling.length === 0,
    effectiveComplete: missingBilling.length === 0,
    pollRoute: pollRouteForCase(caseData),
    expectedTechnical: {
      oltName: tmc.oltName,
      oltIp: tmc.oltIp,
      onuMac: tmc.onuMac,
      onuSerial: tmc.onuSerial
    }
  };
}

export function assessPonCandidate(caseData = {}, candidate = {}) {
  const billing = billingTechnicalFacts(caseData);
  const expectedTechnical = {
    oltName: text(candidate.oltName),
    oltIp: text(candidate.oltIp),
    onuMac: text(candidate.onuMac),
    onuSerial: text(candidate.onuSerial)
  };
  const final = {
    oltName: billing.oltName || expectedTechnical.oltName,
    oltIp: billing.oltIp || expectedTechnical.oltIp,
    onuMac: billing.onuMac || expectedTechnical.onuMac,
    onuSerial: billing.onuSerial || expectedTechnical.onuSerial
  };
  const fields = [];
  if (!fieldPresent('olt', billing) && fieldPresent('olt', expectedTechnical)) fields.push('olt');
  if (!fieldPresent('onuMac', billing) && fieldPresent('onuMac', expectedTechnical)) fields.push('onuMac');
  if (!fieldPresent('onuSerial', billing) && fieldPresent('onuSerial', expectedTechnical)) fields.push('onuSerial');
  const pollRoute = pollRouteFromEvidence({
    oltName: final.oltName,
    equipmentName: candidate.equipmentName,
    technology: candidate.technology,
    pollAction: candidate.pollAction,
    interfaceName: candidate.interface
  });
  return {
    fields,
    remainingMissing: ['olt', 'onuMac'].filter(field => !fieldPresent(field, final)),
    requiredFields: ['olt', 'onuMac'],
    expectedTechnical,
    pollRoute
  };
}

export function deriveCurrentPollState(caseData = {}, route = pollRouteForCase(caseData), now = Date.now()) {
  const attempt = caseData?.operations?.poll?.current || null;
  const snapshot = caseData?.live?.oltSnapshot || null;
  const billingId = factText(caseData?.identity?.billingId);
  const billing = billingTechnicalFacts(caseData);

  const bindingMismatch = subject => {
    if (!subject) return '';
    if (subject.billingId && billingId && String(subject.billingId) !== billingId) return 'billing-id-changed';
    const subjectAction = String(subject.action || subject.pollAction || '');
    if (route?.action && subjectAction && subjectAction !== String(route.action)) return 'poll-action-changed';
    const subjectOltIp = text(subject.oltIp || '');
    if (billing.oltIp && subjectOltIp && comparable(billing.oltIp) !== comparable(subjectOltIp)) return 'olt-binding-changed';
    return '';
  };

  if (!attempt) {
    if (snapshot?.status === 'confirmed') {
      const mismatch = bindingMismatch(snapshot);
      return mismatch
        ? { state: 'superseded', reason: mismatch, attempt: null, snapshot }
        : { state: 'confirmed', reason: 'confirmed-snapshot', attempt: null, snapshot };
    }
    return { state: 'idle', reason: 'no-attempt', attempt: null, snapshot };
  }

  const mismatch = bindingMismatch(attempt);
  if (mismatch) return { state: 'superseded', reason: mismatch, attempt };

  const stage = String(attempt.stage || '').toUpperCase();
  const outcome = String(attempt.outcome || '').toLowerCase();
  if (attempt.pending === false || ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(stage)) {
    if (stage === 'CONFIRMED' || outcome === 'confirmed') return { state: 'confirmed', reason: 'attempt-confirmed', attempt };
    if (stage === 'TIMEOUT' || outcome === 'timeout') return { state: 'timeout', reason: 'attempt-timeout', attempt };
    if (outcome === 'superseded') return { state: 'superseded', reason: 'attempt-superseded', attempt };
    return { state: 'failed', reason: String(attempt.failureReason || 'attempt-failed'), attempt };
  }

  const startedAt = Number(attempt.startedAt || 0);
  const ageMs = startedAt ? now - startedAt : Number.POSITIVE_INFINITY;
  if (!startedAt || ageMs < 0 || ageMs >= POLL_ACTIVE_MAX_AGE_MS) {
    return { state: 'timeout', reason: 'attempt-expired', attempt, ageMs };
  }

  return { state: 'pending', reason: 'active-attempt', attempt, ageMs };
}

export function pollAttemptIsActiveForCurrentBinding(caseData = {}, route = pollRouteForCase(caseData), now = Date.now()) {
  return deriveCurrentPollState(caseData, route, now).state === 'pending';
}

function latestPoll(caseData) {
  return (caseData?.locator?.attempts || []).find(item => item?.type === 'POLL_RESULT') || null;
}

function bestDiscoveryCandidate(caseData) {
  const rank = { direct_confirmed: 100, billing_ready: 90, interface_confirmed: 80, candidate: 60, weak_candidate: 30 };
  return [...(caseData?.locator?.candidates || [])]
    .filter(Boolean)
    .sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0) || Number(b.confidence || 0) - Number(a.confidence || 0))[0]
    || null;
}

function fallbackDiscovery(caseData, technical) {
  const candidate = bestDiscoveryCandidate(caseData);
  if (candidate) {
    const assessment = assessPonCandidate(caseData, candidate);
    if (!['interface_confirmed', 'billing_ready', 'direct_confirmed'].includes(String(candidate.status || ''))) {
      return { action: 'inspect_interface', reason: 'MAC найден на устройстве; подтверждаем реальный интерфейс.', candidate };
    }
    if (!candidate.oltIp || !assessment.pollRoute.action) {
      return { action: 'inspect_device', reason: 'Интерфейс подтверждён; читаем устройство для OLT IP/technology.', candidate };
    }
    if (!assessment.remainingMissing.length) {
      return {
        action: 'manual_fill_billing',
        reason: 'Найдены данные для Billing. Оператор переносит их в Technical вручную и сохраняет штатной кнопкой.',
        candidate,
        fields: assessment.fields,
        expectedTechnical: assessment.expectedTechnical
      };
    }
  }

  const macs = [];
  for (const raw of [valueOf(caseData?.network?.mac), ...(caseData?.locator?.sourceStatus?.customer_macs?.macs || []).map(item => item?.mac)]) {
    const normalized = normalizePonMac(raw);
    if (normalized && !macs.some(item => item.normalized === normalized)) macs.push({ mac: text(raw), normalized });
  }
  if (!macs.length) return { action: 'manual_review', reason: 'Неизвестны OLT/ONU MAC и нет MAC для fallback search.' };
  if (!caseData?.locator?.sourceStatus?.mac_direct) {
    return { action: 'search_mac', reason: 'После Billing и TMC неизвестны OLT/ONU MAC; запускаем реальный MAC search.', searchMacs: macs };
  }
  if (caseData.locator.sourceStatus.mac_direct?.result === 'not_found' && !caseData.locator.sourceStatus.mac_topology) {
    return { action: 'search_uplink_downlink', reason: 'Прямой MAC search пуст; проверяем uplink/downlink.', searchMacs: macs };
  }
  return { action: 'manual_review', reason: 'Подтверждённые fallback sources не дали usable binding.' };
}

function result(base, state, action, reason, extra = {}) {
  return {
    ...base,
    ...extra,
    state,
    action,
    reason,
    blockers: extra.blockers || [],
    pollAllowed: state === PonWorkflowState.READY_FOR_POLL
  };
}

export function derivePonWorkflow(caseData = {}) {
  const family = comparable(valueOf(caseData?.network?.connectionFamily));
  if (family !== 'pon') {
    return {
      applicable: false,
      state: PonWorkflowState.NOT_APPLICABLE,
      action: '',
      reason: 'not-pon',
      blockers: [],
      pollAllowed: false,
      pollAction: '',
      pollType: '',
      billingMissingTechnical: [],
      billingTechnicalComplete: false,
      requiredTechnicalFields: []
    };
  }

  const technical = assessPonTechnical(caseData);
  const technicalVisited = contextVisited(caseData, 'billing_technical') || technical.billing.observed;
  const usersideVisited = contextVisited(caseData, 'userside_customer') || technical.tmc.checked;
  const route = technical.pollRoute;
  const currentPoll = deriveCurrentPollState(caseData, route);
  const base = {
    applicable: true,
    pollAction: technical.billingComplete ? route.action : '',
    pollType: technical.billingComplete ? route.type : '',
    pollDerivedBy: technical.billingComplete ? route.derivedBy : '',
    pollSource: technical.billingComplete ? route.source : '',
    pollState: currentPoll.state,
    pollStateReason: currentPoll.reason,
    requiredTechnicalFields: technical.requiredFields,
    billingMissingTechnical: technical.missingBilling,
    billingTechnicalComplete: technical.billingComplete,
    effectiveTechnicalComplete: technical.billingComplete,
    technicalVisited,
    usersideVisited,
    tmcChecked: technical.tmc.checked,
    tmcFound: technical.tmc.found,
    serialStatus: technical.serialStatus,
    prefillFields: technical.prefillFields,
    conflicts: technical.conflicts,
    identityConflicts: technical.identityConflicts,
    warnings: technical.warnings,
    effectiveOltSource: technical.billingComplete ? 'billing' : '',
    billing: technical.billing,
    tmc: technical.tmc,
    effective: technical.billing,
    fields: [],
    expectedTechnical: null,
    candidate: null,
    searchMacs: []
  };

  if (!technicalVisited) {
    return result(base, PonWorkflowState.OPEN_TECHNICAL, 'open_technical', 'Технические данные этого абонента ещё не прочитаны. Результат OLT не заменяет проверку Billing Technical.');
  }

  // Source conflicts always outrank downstream results. A successful poll is
  // independent evidence and cannot reconcile Billing with TMC.
  if (technical.conflicts.length) {
    return result(base, PonWorkflowState.MANUAL_REVIEW, 'manual_review', 'Billing и TMC расходятся. Успешный OLT poll это расхождение не снимает.', {
      blockers: ['billing-tmc-conflict']
    });
  }

  // TMC values that are still absent from Billing remain an upstream issue even
  // when an OLT happened to answer successfully.
  if (technical.prefillFields.length) {
    return result(base, PonWorkflowState.FILL_TECHNICAL, 'manual_fill_billing', 'В TMC есть данные, которых ещё нет в Billing. Перенеси их вручную и сохрани Billing; результат OLT это не заменяет.', {
      source: 'tmc',
      fields: technical.prefillFields,
      expectedTechnical: technical.expectedTechnical,
      blockers: ['billing-tmc-not-reconciled']
    });
  }

  // Required Billing fields are a hard gate. TMC facts never unlock poll.
  if (!technical.billingComplete) {
    if (!technical.tmc.checked) {
      return result(base, PonWorkflowState.CHECK_TMC, 'check_tmc', `В Billing отсутствуют ${technical.missingBilling.join(', ')}. Сверь TMC как независимый источник.` , {
        fields: technical.missingBilling
      });
    }

    const fallback = fallbackDiscovery(caseData, technical);
    const fallbackState = fallback.action === 'manual_review'
      ? PonWorkflowState.MANUAL_REVIEW
      : fallback.action === 'manual_fill_billing'
        ? PonWorkflowState.FILL_TECHNICAL
        : PonWorkflowState.LOCATE_BINDING;
    return result(base, fallbackState, fallback.action, fallback.reason, {
      ...fallback,
      blockers: fallback.action === 'manual_fill_billing' ? ['billing-technical-not-saved'] : []
    });
  }

  // Billing may already be complete, but until TMC was actually read there is
  // nothing to compare it with. This is not a conflict; it is an unresolved
  // source check, and it remains visible even after a successful poll.
  if (!technical.tmc.checked) {
    return result(base, PonWorkflowState.CHECK_TMC, 'check_tmc', 'Billing Technical заполнен, но TMC текущего абонента ещё не сверено. Успешный OLT poll не заменяет эту сверку.', {
      blockers: ['tmc-not-checked']
    });
  }

  const lastPoll = latestPoll(caseData);
  if (currentPoll.state === 'pending') {
    return result(base, PonWorkflowState.POLLING, 'wait_poll', 'Текущий ONU poll ещё выполняется.');
  }

  // Downstream success is terminal only after the independent upstream sources
  // have been read and reconciled.
  if (currentPoll.state === 'confirmed') {
    return result(base, PonWorkflowState.COMPLETE, 'complete_confirmed', 'Штатный ONU poll подтверждён; Billing и TMC предварительно сверены.');
  }

  if (!route.action) {
    return result(base, PonWorkflowState.BLOCKED, 'manual_review', 'Billing сохранён, но по выбранной OLT не удалось определить тип штатного опроса.', {
      blockers: ['poll-action-unresolved']
    });
  }

  if (lastPoll?.result === 'parser_error') {
    return result(base, PonWorkflowState.MANUAL_REVIEW, 'manual_review', 'Ответ OLT не удалось безопасно разобрать.', {
      blockers: ['poll-parser-error']
    });
  }
  if (['timeout', 'olt_unreachable'].includes(String(lastPoll?.result || ''))) {
    const attempts = (caseData?.locator?.attempts || []).filter(item => item?.type === 'POLL_RESULT').length;
    if (attempts <= 1) {
      return result(base, PonWorkflowState.READY_FOR_POLL, 'retry_poll', 'Один ограниченный retry разрешён для той же сохранённой Billing binding.');
    }
  }

  return result(base, PonWorkflowState.READY_FOR_POLL, 'poll_candidate', 'Billing Technical содержит сохранённые OLT + ONU MAC; тип poll определён из Billing.');
}
