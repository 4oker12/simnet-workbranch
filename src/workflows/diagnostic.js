import {
  EvidenceType,
  NextStep,
  CaseOutcome,
  discoverySnapshot,
  evidenceSnapshot
} from './discovery.js';
import { derivePonWorkflow } from './pon.js';

function nowIso() { return new Date().toISOString(); }
function comparable(value) { return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function factValue(fact) { return fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact; }
function rawFactValue(fact) { const value = factValue(fact); return value == null ? '' : String(value).trim(); }
function hasFact(group, key) { const value = factValue(group?.[key]); return value != null && String(value).trim() !== ''; }
function normalizeMac(value) { return String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase(); }
function normalizeSerial(value) { return String(value || '').replace(/[^0-9a-z]/gi, '').toUpperCase(); }
function compact(value, max = 120) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`; }
function contextWasVisited(caseData, pageKind) { return Object.values(caseData?.contexts || {}).some(context => context?.pageKind === pageKind); }
export function validOltIp(caseData) {
  const subscriberIp = comparable(rawFactValue(caseData?.network?.ip));
  const oltIp = comparable(rawFactValue(caseData?.pon?.oltIp));
  return Boolean(oltIp && oltIp !== subscriberIp);
}

export function computeDiagnosticDecision(caseData) {
  const family = rawFactValue(
    caseData.network?.connectionFamily
  );

  const ponWorkflow = derivePonWorkflow(caseData);
  const subtype = ponWorkflow.applicable
    ? ponWorkflow.pollType
    : rawFactValue(caseData.pon?.pollType);
  const pollAction = ponWorkflow.applicable
    ? ponWorkflow.pollAction
    : rawFactValue(caseData.pon?.pollAction);

  const hasIdentity = [
    'login',
    'contract',
    'billingId',
    'customerId'
  ].some(
    key => hasFact(caseData.identity, key)
  );

  const hasIp = hasFact(
    caseData.network,
    'ip'
  );

  const hasSubscriberMac = hasFact(caseData.network, 'mac');

  const hasBillingOnuMac = Boolean(
    normalizeMac(factValue(caseData.pon?.onuMac))
  );

  const hasBillingOnuSerial = Boolean(
    normalizeSerial(factValue(caseData.pon?.onuSerial))
  );

  const hasBillingOnu = (
    hasBillingOnuMac
    || hasBillingOnuSerial
  );

  const hasTmcOnu = (
    hasFact(caseData.pon, 'tmcOnuMac')
    || hasFact(caseData.pon, 'tmcOnuSerial')
  );

  const hasOnu = hasBillingOnu || hasTmcOnu;

  const hasBillingOltName = hasFact(
    caseData.pon,
    'oltName'
  );

  const hasTmcOlt = (
    hasFact(caseData.pon, 'tmcOltName')
    && hasFact(caseData.pon, 'tmcOltIp')
  );

  const hasValidOltIp = validOltIp(caseData);
  const hasOlt = (
    hasBillingOltName
    || hasTmcOlt
    || hasValidOltIp
  );

  const technicalVisited = contextWasVisited(
    caseData,
    'billing_technical'
  );

  const usersideVisited = contextWasVisited(
    caseData,
    'userside_customer'
  );

  const isPon = comparable(family) === 'pon';
  const isEthernet = comparable(family) === 'ethernet';

  // PON workflow decisions must not execute Locator recommendation rules.
  // For PON, consume only discovery/evidence state; non-PON families may still
  // use the Locator recommendation engine (notably Ethernet).
  const locator = isPon
    ? evidenceSnapshot(caseData)
    : discoverySnapshot(caseData);
  const juniper = locator.sourceStatus?.juniper
    || locator.sourceStatus?.juniperPreview
    || (caseData.juniper?.dataStatus === 'available' ? {
      result: caseData.juniper?.result || '',
      details: caseData.juniper?.details || {},
      observedAt: caseData.juniper?.lastReadAt || caseData.juniper?.updatedAt || ''
    } : null);
  const juniperChecked = Boolean(
    juniper
    && String(juniper?.result || caseData.juniper?.result || '').toLowerCase() !== 'error'
  );
  const juniperReviewed = Boolean(caseData.juniper?.operatorOpened);

  const currentBindingRejected = Boolean(
    locator.currentBindingRejected
  );

  const recommendation = locator.recommendation || {};
  // PON has one workflow authority. Locator may discover candidates, but it no
  // longer decides whether Technical must be saved or whether Poll is allowed.
  const workflowAction = ponWorkflow.applicable
    ? ponWorkflow.action
    : (recommendation.action || 'wait_context');
  const billingMissingTechnical = ponWorkflow.applicable
    ? ponWorkflow.billingMissingTechnical
    : [];
  const billingTechnicalComplete = ponWorkflow.applicable
    ? ponWorkflow.billingTechnicalComplete
    : false;
  const canAttemptOnuPoll = ponWorkflow.applicable
    ? ponWorkflow.pollAllowed
    : false;
  const readyForOnuPoll = canAttemptOnuPoll;

  const liveSnapshotStatus = String(caseData.live?.oltSnapshot?.status || '');
  const hasLiveResult = Boolean(
    locator.termination?.status === CaseOutcome.CONFIRMED
    || ['confirmed', 'observed'].includes(liveSnapshotStatus)
  );
  const pollResponded = Boolean(
    hasLiveResult
    && (
      ['confirmed', 'observed'].includes(liveSnapshotStatus)
      || caseData.live?.oltSnapshot?.outcome === 'confirmed'
      || locator.termination?.pollResponded === true
      || locator.termination?.pollCompleted === true
    )
  );
  const crossSourceIdentityMatch = Boolean(
    (caseData.locator?.evidence || []).some(item => (
      item?.type === EvidenceType.TMC_RESULT
      && item?.result === 'found'
      && item?.details?.identityCheck?.isMatch === true
    ))
  );
  const bindingVerified = Boolean(
    locator.bestCandidate?.matchedCurrentSubscriber
    || locator.termination?.identityAssessment === 'matched'
    || crossSourceIdentityMatch
  );
  const liveOnuState = compact(
    caseData.live?.oltSnapshot?.onuStatus
    || rawFactValue(caseData.pon?.status)
    || '',
    40
  ).toLowerCase();
  const accessReachable = Boolean(
    pollResponded
    && ['online', 'up', 'active', 'ok'].includes(liveOnuState)
  );

  const terminal = Boolean(locator.termination);

  // Acquisition/locator progress answers "did we locate and poll the subscriber
  // network binding?". It is deliberately separate from Diagnosis, which needs
  // a complaint and an explicit evidence-backed conclusion.
  let locatorCompletion = 0;
  if (hasIdentity) locatorCompletion += 15;
  if (juniperChecked) locatorCompletion += 6;
  if (technicalVisited) locatorCompletion += 15;
  if (hasIp) locatorCompletion += 8;
  if (family) locatorCompletion += 8;
  if (hasSubscriberMac) locatorCompletion += 8;
  if (usersideVisited) locatorCompletion += 8;
  if (isEthernet && hasFact(caseData.network, 'accessDeviceId')) locatorCompletion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_device?.result === 'confirmed') locatorCompletion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_fdb) locatorCompletion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_errors) locatorCompletion += 5;
  if (hasOnu) locatorCompletion += 8;
  if (hasBillingOltName || hasTmcOlt) locatorCompletion += 8;
  locatorCompletion += Math.min(14, Number(locator.attemptCount || 0) * 2);
  if (locator.bestCandidate) locatorCompletion += 8;
  if (terminal) locatorCompletion = 100;
  else locatorCompletion = Math.min(99, locatorCompletion);
  locatorCompletion = Math.min(100, locatorCompletion);

  let locatorStage = 'identity';
  const terminationStatus = locator.termination?.status || '';
  const effectiveAction = ponWorkflow.applicable ? workflowAction : (recommendation.action || '');

  if (!hasIdentity) {
    locatorStage = 'empty';
  } else if (terminationStatus === CaseOutcome.CONFIRMED || (ponWorkflow.applicable && ponWorkflow.state === 'complete')) {
    locatorStage = 'confirmed';
  } else if (terminationStatus === CaseOutcome.NOT_FOUND) {
    locatorStage = 'not-found';
  } else if (terminationStatus === CaseOutcome.INCONCLUSIVE) {
    locatorStage = 'inconclusive';
  } else if (terminationStatus === CaseOutcome.BLOCKED) {
    locatorStage = 'blocked';
  } else if (terminationStatus === CaseOutcome.MANUAL_REVIEW) {
    locatorStage = 'manual-review';
  } else if (effectiveAction === NextStep.CHECK_JUNIPER) {
    locatorStage = 'juniper-session';
  } else if (effectiveAction === NextStep.WAIT_POLL) {
    locatorStage = 'polling';
  } else if (effectiveAction === NextStep.SWITCH_PORT) {
    locatorStage = 'ethernet-route';
  } else if (effectiveAction === NextStep.CHECK_ETHERNET_FDB) {
    locatorStage = 'ethernet-fdb';
  } else if (effectiveAction === NextStep.CHECK_ETHERNET_ERRORS) {
    locatorStage = 'ethernet-errors';
  } else if (effectiveAction === NextStep.ETHERNET_SUMMARY) {
    locatorStage = 'ethernet-complete';
  } else if (
    [
      NextStep.CHECK_TMC,
      NextStep.SEARCH_MAC,
      NextStep.SEARCH_UPLINK_DOWNLINK,
      NextStep.INSPECT_INTERFACE,
      NextStep.INSPECT_DEVICE,
      NextStep.INSPECT_ONU_DETAILS
    ].includes(effectiveAction)
  ) {
    locatorStage = 'locating-subscriber';
  } else if (
    effectiveAction === NextStep.POLL_CURRENT_BINDING
    || effectiveAction === NextStep.POLL_CANDIDATE
    || effectiveAction === NextStep.RETRY_POLL
    || readyForOnuPoll
  ) {
    locatorStage = 'ready-for-poll';
  } else if (effectiveAction === 'manual_fill_billing' || effectiveAction === NextStep.FILL_BILLING_OLT) {
    locatorStage = 'need-billing-save';
  } else if (effectiveAction === 'open_technical' || !technicalVisited) {
    locatorStage = 'need-technical-data';
  } else {
    locatorStage = 'searching';
  }

  const complaintPresent = Boolean(
    compact(caseData?.complaint?.category || '', 80)
    || compact(caseData?.complaint?.text || '', 480)
  );
  const diagnosisStatus = compact(caseData?.diagnosis?.status || 'not-assessed', 60).toLowerCase();
  const diagnosisComplete = ['confirmed', 'resolved'].includes(diagnosisStatus);
  const stage = diagnosisComplete
    ? 'confirmed'
    : !complaintPresent
      ? 'awaiting-complaint'
      : terminal
        ? 'evidence-ready'
        : 'collecting-evidence';
  const completion = diagnosisComplete ? 100 : 0;

  // UI/CTA consume the same PON workflow action. Locator recommendation
  // remains useful only for unresolved non-PON/fallback discovery.
  const nextRequiredSource = ponWorkflow.applicable
    ? workflowAction
    : (recommendation.action || 'wait_context');


  return {
    stage,
    completion,
    diagnosisStatus,
    diagnosisComplete,
    locatorStage,
    locatorCompletion,
    family,
    subtype,
    pollAction,
    pollState: ponWorkflow.applicable ? String(ponWorkflow.pollState || 'idle') : '',
    pollStateReason: ponWorkflow.applicable ? String(ponWorkflow.pollStateReason || '') : '',
    isPon,
    isEthernet,
    hasIdentity,
    hasIp,
    hasSubscriberMac,
    hasBillingOnu,
    hasBillingOnuMac,
    hasBillingOnuSerial,
    billingMissingTechnical,
    requiredTechnicalFields: ponWorkflow.applicable
      ? (Array.isArray(ponWorkflow.requiredTechnicalFields) ? ponWorkflow.requiredTechnicalFields : [])
      : [],
    hasTmcOnu,
    hasOnu,
    hasBillingOltName,
    hasTmcOlt,
    hasOlt,
    hasValidOltIp,
    hasLiveResult,
    pollResponded,
    bindingVerified,
    accessReachable,
    serviceHealthy: false,
    serviceState: liveOnuState || 'unknown',
    juniperChecked,
    juniperReviewed,
    juniperResult: juniper?.result || '',
    juniper: juniper || null,
    technicalVisited,
    usersideVisited,
    readyForOnuPoll,
    canAttemptOnuPoll,
    billingTechnicalComplete,
    currentBindingRejected,
    locatorState: locator.state,
    locatorAction: nextRequiredSource,
    locatorRuleId: ponWorkflow.applicable ? `pon.workflow.${ponWorkflow.state}` : (recommendation.ruleId || ''),
    locatorReason: ponWorkflow.applicable ? ponWorkflow.reason : (recommendation.reason || ''),
    ponWorkflowState: ponWorkflow.state,
    ponWorkflowBlockers: ponWorkflow.blockers || [],
    ponWorkflowDetails: ponWorkflow.applicable ? {
      source: ponWorkflow.source || '',
      fields: Array.isArray(ponWorkflow.fields) ? ponWorkflow.fields : [],
      expectedTechnical: ponWorkflow.expectedTechnical || null,
      serialStatus: ponWorkflow.serialStatus || '',
      tmcChecked: ponWorkflow.tmcChecked === true,
      tmcFound: ponWorkflow.tmcFound === true,
      prefillFields: Array.isArray(ponWorkflow.prefillFields) ? ponWorkflow.prefillFields : [],
      pollDerivedBy: ponWorkflow.pollDerivedBy || '',
      effectiveOltSource: ponWorkflow.effectiveOltSource || '',
      conflicts: Array.isArray(ponWorkflow.conflicts) ? ponWorkflow.conflicts : [],
      warnings: Array.isArray(ponWorkflow.warnings) ? ponWorkflow.warnings : [],
      candidate: ponWorkflow.candidate || null,
      searchMacs: Array.isArray(ponWorkflow.searchMacs) ? ponWorkflow.searchMacs : []
    } : null,
    terminationStatus,
    termination: locator.termination,
    bestCandidate: locator.bestCandidate,
    attemptCount: locator.attemptCount,
    candidateCount: locator.candidateCount,
    nextRequiredSource,
    // case.conflicts is an audit history of canonical fact changes, not a
    // statement that the sources currently disagree. LIVE conflict state for
    // PON is derived only from the current Billing/TMC comparison.
    conflictCount: ponWorkflow.applicable
      ? Number(ponWorkflow.conflicts?.length || 0)
      : Number(caseData.conflicts?.length || 0),
    updatedAt: nowIso()
  };
}
