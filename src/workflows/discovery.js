import { assessPonTechnical, assessPonCandidate, requiredTechnicalFieldsForCase as ponRequiredTechnicalFields, normalizePonMac, pollRouteFromEvidence } from './pon.js';
export const EvidenceType = Object.freeze({
  POLL_RESULT: 'POLL_RESULT',
  JUNIPER_SESSION: 'JUNIPER_SESSION',
  TMC_RESULT: 'TMC_RESULT',
  CUSTOMER_MACS: 'CUSTOMER_MACS',
  MAC_SEARCH_RESULT: 'MAC_SEARCH_RESULT',
  INTERFACE_CONFIRMATION: 'INTERFACE_CONFIRMATION',
  DEVICE_DETAILS: 'DEVICE_DETAILS',
  ETHERNET_ACCESS_POINT: 'ETHERNET_ACCESS_POINT',
  ETHERNET_DEVICE: 'ETHERNET_DEVICE',
  ETHERNET_FDB_RESULT: 'ETHERNET_FDB_RESULT',
  ETHERNET_PORT_ERRORS: 'ETHERNET_PORT_ERRORS'
});

export const NextStep = Object.freeze({
  CHECK_JUNIPER: 'check_juniper',
  OPEN_TECHNICAL: 'open_technical',
  POLL_CURRENT_BINDING: 'poll_current_binding',
  WAIT_POLL: 'wait_poll',
  RETRY_POLL: 'retry_poll',
  CHECK_TMC: 'check_tmc',
  SEARCH_MAC: 'search_mac',
  SEARCH_UPLINK_DOWNLINK: 'search_uplink_downlink',
  INSPECT_INTERFACE: 'inspect_interface',
  INSPECT_DEVICE: 'inspect_device',
  FILL_BILLING_OLT: 'fill_billing_olt',
  MANUAL_FILL_BILLING: 'manual_fill_billing',
  INSPECT_ONU_DETAILS: 'inspect_onu_details',
  POLL_CANDIDATE: 'poll_candidate',
  COMPLETE_CONFIRMED: 'complete_confirmed',
  COMPLETE_NOT_FOUND: 'complete_not_found',
  RESOLVE_CONFLICT: 'resolve_conflict',
  MANUAL_REVIEW: 'manual_review',
  SWITCH_PORT: 'switch_port',
  CHECK_ETHERNET_FDB: 'check_ethernet_fdb',
  CHECK_ETHERNET_ERRORS: 'check_ethernet_errors',
  ETHERNET_SUMMARY: 'ethernet_summary',
  WAIT_CONTEXT: 'wait_context'
});

export const CaseOutcome = Object.freeze({
  CONFIRMED: 'confirmed',
  NOT_FOUND: 'not_found',
  INCONCLUSIVE: 'inconclusive',
  BLOCKED: 'blocked',
  MANUAL_REVIEW: 'manual_review'
});

const MAX_ATTEMPTS = 120;
const MAX_EVIDENCE = 160;
const MAX_CANDIDATES = 40;
const POLL_PARTIAL_GRACE_MS = 3000;
const TMC_UNCONFIRMED_RESULTS = new Set([
  'missing',
  'identity_mismatch',
  'identity_incomplete',
  'ambiguous'
]);

function nowIso() {
  return new Date().toISOString();
}

export function pollPartialStable(locator, now = Date.now()) {
  const poll = locator?.sourceStatus?.poll || null;
  if (!poll || poll.result !== 'partial') return false;
  const started = Date.parse(poll.partialSinceAt || poll.updatedAt || '');
  if (!Number.isFinite(started)) return false;
  return Math.max(0, Number(now || Date.now()) - started) >= Number(poll.partialGraceMs || POLL_PARTIAL_GRACE_MS);
}

function comparable(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isLikelyPonOltCandidate(candidate) {
  const name = comparable(candidate?.oltName || candidate?.deviceName || '');
  const iface = comparable(candidate?.interface || '');
  if (!name && !iface) return false;

  // MAC history often lands first on an aggregation/access switch. That is a useful
  // topology hop, but it is not an OLT and must never be written into Billing as one.
  const obviousTransit = /(?:arista|dcs-|cisco|juniper|mikrotik|port-channel|etherchannel|switch)/i.test(`${name} ${iface}`);
  if (obviousTransit) return false;

  const oltIdentity = /(?:\bolt\b|huawei\s+ma\d{3,5}|bdcom|gcom|zte|c-data|v-sol|fiberhome)/i.test(name);
  const ponInterface = /\b(?:epon|gpon|xpon)\b/i.test(`${name} ${iface}`);
  return Boolean(oltIdentity && (ponInterface || /\bolt\b|huawei\s+ma\d{3,5}/i.test(name)));
}

function compact(value, max = 260) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max
    ? `${text.slice(0, max)}…`
    : text;
}

function valueOf(fact) {
  return fact && typeof fact === 'object' && 'value' in fact
    ? fact.value
    : fact;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function pollBindingFromCase(caseData, details = {}) {
  const current = currentBillingBinding(caseData) || {};
  return {
    ...current,
    ...details,
    oltName: firstNonEmpty(details.oltName, current.oltName),
    oltIp: firstNonEmpty(details.oltIp, current.oltIp),
    onuMac: firstNonEmpty(details.onuMac, current.onuMac),
    onuSerial: firstNonEmpty(details.onuSerial, current.onuSerial),
    subscriberMac: firstNonEmpty(details.subscriberMac, current.subscriberMac),
    pollAction: firstNonEmpty(details.pollAction, current.pollAction),
    technology: firstNonEmpty(details.technology, current.technology)
  };
}

function normalizeMac(value) {
  const hex = String(value || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  return hex.length === 12 ? hex : '';
}

function normalizeSerial(value) {
  return String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();
}

/** Extract IPv4 from free-form OLT labels like "V_Pokotilova-7-2-GPON (172.16.13.185)". */
function extractOltIp(value) {
  const text = String(value || '');
  const match = text.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match ? match[1] : '';
}

function billingTechnicalState(caseData, locator = null) {
  const assessment = assessPonTechnical(caseData);
  return {
    billing: assessment.billing,
    tmc: assessment.tmc,
    missingBilling: assessment.missingBilling,
    conflicts: assessment.conflicts,
    identityConflicts: assessment.identityConflicts,
    correctionFields: assessment.correctionFields,
    remainingAfterTmc: assessment.remainingAfterTmc,
    searchMacs: assessment.searchMacs,
    billingReadyCore: assessment.billingComplete,
    hasBillingOnuMac: Boolean(normalizePonMac(assessment.billing.onuMac)),
    requiredFields: assessment.requiredFields,
    technology: assessment.pollRoute,
    tmcObserved: (locator || caseData?.locator)?.sourceStatus?.tmc != null,
    tmcFound: (locator || caseData?.locator)?.sourceStatus?.tmc?.result === 'found',
    expectedTechnical: assessment.expectedTechnical
  };
}

export function requiredTechnicalFieldsForCase(caseData) {
  return ponRequiredTechnicalFields(caseData);
}

function candidateTechnicalState(caseData, candidate) {
  return assessPonCandidate(caseData, candidate);
}

function bindingFingerprint(binding = {}) {
  const olt = comparable(binding.oltIp || binding.oltName || binding.deviceId);
  const onu = normalizeMac(binding.onuMac)
    || normalizeSerial(binding.onuSerial)
    || comparable(binding.interface)
    || comparable(binding.subscriberMac)
    || 'unknown-onu';
  const action = comparable(binding.pollAction || binding.technology || '');
  return [olt || 'unknown-olt', onu, action].join('|');
}

function candidateId(candidate = {}) {
  const device = comparable(candidate.deviceId || candidate.oltIp || candidate.oltName);
  const iface = comparable(candidate.interface || candidate.ifIndex || '');
  const identity = normalizeMac(candidate.onuMac)
    || normalizeSerial(candidate.onuSerial)
    || normalizeMac(candidate.subscriberMac)
    || 'unknown';
  return [device || 'unknown-device', iface || 'unknown-interface', identity].join('|');
}

function observationSignature(observation = {}) {
  const details = observation.details || observation.candidate || {};
  return [
    observation.type,
    observation.result,
    observation.method,
    observation.searchMode,
    bindingFingerprint({
      ...details,
      ...observation
    }),
    candidateId({
      ...details,
      ...observation
    }),
    comparable(observation.searchedMac),
    comparable(observation.pageKind)
  ].join('|');
}

function emptyEvidenceState() {
  return {
    schemaVersion: 1,
    state: 'idle',
    attempts: [],
    evidence: [],
    candidates: [],
    hypotheses: [],
    sourceStatus: {},
    recommendation: {
      action: NextStep.WAIT_CONTEXT,
      ruleId: 'locator.wait-context',
      reason: 'Недостаточно данных для выбора ветки.',
      params: {}
    },
    termination: null,
    currentBinding: null,
    lastObservationAt: '',
    updatedAt: nowIso()
  };
}

export function ensureEvidenceState(caseData) {
  caseData.locator ||= emptyEvidenceState();
  const locator = caseData.locator;
  locator.schemaVersion = 1;
  locator.state ||= 'idle';
  locator.attempts ||= [];
  locator.evidence ||= [];
  locator.candidates ||= [];
  locator.hypotheses ||= [];
  locator.sourceStatus ||= {};
  // Migration cleanup only: historical Save-click observations were telemetry
  // accidentally persisted with discovery evidence. They are never workflow evidence.
  delete locator.sourceStatus.billing_save_intent;
  delete locator.sourceStatus.billing_saved;
  delete locator.sourceStatus.billing_save_failed;
  locator.recommendation ||= emptyEvidenceState().recommendation;
  if (comparable(valueOf(caseData.network?.connectionFamily)) === 'pon') {
    // PON discovery is evidence/candidate storage only. A recommendation stored
    // by an older build must not survive as a competing workflow authority.
    locator.recommendation = null;
  }
  locator.termination = locator.termination || null;
  locator.currentBinding = locator.currentBinding || null;

  // v1.7.13 could reopen a case after a confirmed poll. Recover that terminal
  // latch on upgrade from the durable candidate/attempt history so an already
  // confirmed subscriber does not stay in `searching / wait_context`.
  if (!locator.termination) {
    const confirmedCandidate = locator.candidates.find(item => item?.status === 'direct_confirmed') || null;
    const confirmedAttempt = locator.attempts.find(item => (
      item?.type === EvidenceType.POLL_RESULT
      && item?.result === 'confirmed'
    )) || null;
    if (confirmedCandidate || confirmedAttempt) {
      locator.state = 'confirmed';
      locator.termination = {
        status: CaseOutcome.CONFIRMED,
        reason: 'direct_olt_poll_completed',
        pollCompleted: true,
        pollResponded: true,
        confirmedBy: ['onu_response'],
        identityAssessment: confirmedAttempt?.details?.identityAssessment || (confirmedAttempt?.details?.matchedBy?.length ? 'matched' : 'unverified'),
        identityMatchedBy: confirmedAttempt?.details?.matchedBy || [],
        identityConflicts: confirmedAttempt?.details?.identityConflicts || [],
        candidateId: confirmedCandidate?.id || '',
        completedAt: confirmedAttempt?.at || confirmedCandidate?.updatedAt || nowIso(),
        recovered: true
      };
    }
  }

  locator.updatedAt ||= nowIso();
  return locator;
}

export function currentBillingBinding(caseData) {
  const oltName = String(valueOf(caseData.pon?.oltName) || '');
  const oltIp = String(valueOf(caseData.pon?.oltIp) || '');
  const onuMac = String(valueOf(caseData.pon?.onuMac) || '');
  const onuSerial = String(valueOf(caseData.pon?.onuSerial) || '');
  const subscriberMac = String(valueOf(caseData.network?.mac) || '');
  const pollAction = String(valueOf(caseData.pon?.pollAction) || '');
  const technology = String(valueOf(caseData.pon?.pollType) || '');

  if (!oltName && !oltIp) return null;

  return {
    source: 'billing',
    oltName,
    oltIp,
    onuMac,
    onuSerial,
    subscriberMac,
    pollAction,
    technology,
    fingerprint: bindingFingerprint({
      oltName,
      oltIp,
      onuMac,
      onuSerial,
      subscriberMac,
      pollAction,
      technology
    })
  };
}

function setSourceStatus(locator, key, patch) {
  locator.sourceStatus[key] = {
    ...(locator.sourceStatus[key] || {}),
    ...patch,
    updatedAt: nowIso()
  };
}

function upsertCandidate(locator, candidate = {}, evidence = {}) {
  const normalized = {
    id: candidate.id || candidateId(candidate),
    source: candidate.source || evidence.source || 'unknown',
    status: candidate.status || 'candidate',
    oltName: compact(candidate.oltName || '', 220),
    oltIp: compact(candidate.oltIp || '', 80),
    deviceId: compact(candidate.deviceId || '', 80),
    interface: compact(candidate.interface || '', 120),
    ifIndex: compact(candidate.ifIndex || '', 80),
    vlan: compact(candidate.vlan || '', 40),
    technology: compact(candidate.technology || '', 40),
    pollAction: compact(candidate.pollAction || '', 20),
    onuMac: normalizeMac(candidate.onuMac),
    onuSerial: normalizeSerial(candidate.onuSerial),
    subscriberMac: normalizeMac(candidate.subscriberMac),
    customerId: compact(candidate.customerId || '', 80),
    login: compact(candidate.login || '', 80),
    matchedCurrentSubscriber: Boolean(candidate.matchedCurrentSubscriber),
    confidence: Number(candidate.confidence || 0.6),
    evidence: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const index = locator.candidates.findIndex(item => item.id === normalized.id);
  const old = index >= 0 ? locator.candidates[index] : null;
  const merged = {
    ...(old || {}),
    ...Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => (
        value !== ''
        && value !== false
        && value != null
        && !(Array.isArray(value) && value.length === 0)
      ))
    ),
    evidence: [
      ...(old?.evidence || []),
      ...(evidence.signature ? [evidence.signature] : [])
    ].slice(-30),
    updatedAt: nowIso()
  };

  if (old?.status === 'direct_confirmed') {
    merged.status = 'direct_confirmed';
  } else if (candidate.status) {
    merged.status = candidate.status;
  }

  if (index >= 0) {
    locator.candidates[index] = merged;
  } else {
    locator.candidates.unshift(merged);
    locator.candidates = locator.candidates.slice(0, MAX_CANDIDATES);
  }

  return merged;
}

function findCandidate(locator, details = {}) {
  const id = details.id || candidateId(details);
  return locator.candidates.find(item => item.id === id)
    || locator.candidates.find(item => (
      details.deviceId
      && item.deviceId === String(details.deviceId)
      && (!details.interface || comparable(item.interface) === comparable(details.interface))
    ))
    || locator.candidates.find(item => (
      details.oltIp
      && item.oltIp === String(details.oltIp)
      && (!details.interface || comparable(item.interface) === comparable(details.interface))
    ))
    || null;
}

function storeEvidence(locator, observation, context = {}) {
  const signature = observation.signature || observationSignature(observation);
  const existing = locator.evidence.find(item => item.signature === signature);
  if (existing) {
    // A fact may first be seen outside the active route. If the operator later
    // revisits it while that source is actually requested, promote the same
    // evidence instead of creating a duplicate or losing it to dedupe.
    if (existing.passive && !observation.passive && !observation.passiveAfterTermination) {
      existing.passive = false;
      existing.promotedAt = nowIso();
      return existing;
    }
    return null;
  }

  const entry = {
    signature,
    at: nowIso(),
    type: observation.type,
    result: observation.result || '',
    method: observation.method || '',
    source: observation.source || context.system || '',
    pageKind: observation.pageKind || context.pageKind || '',
    summary: compact(observation.summary || observation.reason || '', 320),
    details: observation.details || observation.candidate || null,
    passive: Boolean(observation.passiveAfterTermination || observation.passive),
    passiveReason: observation.passiveReason || '',
    routeRelation: observation.routeRelation || ''
  };

  locator.evidence.unshift(entry);
  locator.evidence = locator.evidence.slice(0, MAX_EVIDENCE);
  locator.lastObservationAt = entry.at;
  return entry;
}

function storeAttempt(locator, observation, context = {}) {
  const signature = observation.signature || observationSignature(observation);
  if (locator.attempts.some(item => item.signature === signature)) {
    return null;
  }

  const entry = {
    signature,
    at: nowIso(),
    type: observation.type,
    result: observation.result || '',
    method: observation.method || '',
    source: observation.source || context.system || '',
    pageKind: observation.pageKind || context.pageKind || '',
    searchMode: observation.searchMode || '',
    bindingFingerprint: observation.bindingFingerprint || bindingFingerprint({
      ...(observation.details || {}),
      ...observation
    }),
    summary: compact(observation.summary || observation.reason || '', 320),
    details: observation.details || observation.candidate || null
  };

  locator.attempts.unshift(entry);
  locator.attempts = locator.attempts.slice(0, MAX_ATTEMPTS);
  return entry;
}

function markHypothesis(locator, hypothesis) {
  const fingerprint = hypothesis.fingerprint || bindingFingerprint(hypothesis);
  const index = locator.hypotheses.findIndex(item => item.fingerprint === fingerprint);
  const merged = {
    ...(index >= 0 ? locator.hypotheses[index] : {}),
    ...hypothesis,
    fingerprint,
    updatedAt: nowIso()
  };

  if (index >= 0) locator.hypotheses[index] = merged;
  else locator.hypotheses.unshift(merged);

  locator.hypotheses = locator.hypotheses.slice(0, 50);
  return merged;
}

function processPollResult(caseData, locator, observation, evidence) {
  const details = observation.details || {};
  const fingerprint = observation.bindingFingerprint || bindingFingerprint({
    ...details,
    ...observation
  });
  const result = observation.result || 'unknown';

  const hypothesis = markHypothesis(locator, {
    source: details.source || 'billing-poll',
    status: result === 'confirmed'
      ? 'direct_confirmed'
      : result === 'not_found'
        ? 'rejected'
        : 'unconfirmed',
    rejectionScope: result === 'not_found'
      ? 'binding'
      : '',
    reason: result,
    oltName: details.oltName || '',
    oltIp: details.oltIp || '',
    onuMac: details.onuMac || '',
    onuSerial: details.onuSerial || '',
    subscriberMac: details.subscriberMac || '',
    interface: details.interface || '',
    pollAction: details.pollAction || '',
    technology: details.technology || '',
    fingerprint,
    evidence: evidence?.signature || ''
  });

  const previousPoll = locator.sourceStatus.poll || {};
  const samePartialEpisode = Boolean(
    result === 'partial'
    && previousPoll.result === 'partial'
    && previousPoll.fingerprint === fingerprint
    && previousPoll.partialSinceAt
  );
  setSourceStatus(locator, 'poll', {
    result,
    fingerprint,
    details,
    count: Number(previousPoll.count || 0) + 1,
    partialSinceAt: result === 'partial'
      ? (samePartialEpisode ? previousPoll.partialSinceAt : nowIso())
      : '',
    partialGraceMs: POLL_PARTIAL_GRACE_MS
  });

  if (result === 'confirmed') {
    const pollBinding = pollBindingFromCase(caseData, details);
    const identityMatchedBy = observation.matchedBy || details.matchedBy || [];
    const identityConflicts = Array.isArray(details.identityConflicts)
      ? details.identityConflicts
      : [];
    const identityAssessment = details.identityAssessment
      || (identityConflicts.length ? 'mismatch' : identityMatchedBy.length ? 'matched' : 'unverified');

    const candidate = upsertCandidate(locator, {
      ...pollBinding,
      status: 'direct_confirmed',
      source: 'direct-olt-poll',
      confidence: 1,
      // A completed poll is not the same thing as an identity match.  Keep the
      // identity flag truthful while still closing the diagnostic route.
      matchedCurrentSubscriber: identityAssessment === 'matched'
    }, evidence || {});
    candidate.matchedCurrentSubscriber = identityAssessment === 'matched';

    locator.state = 'confirmed';
    locator.termination = {
      status: CaseOutcome.CONFIRMED,
      reason: 'direct_olt_poll_completed',
      pollCompleted: true,
      pollResponded: details.pollResponded !== false,
      confirmedBy: ['onu_response'],
      identityAssessment,
      identityMatchedBy,
      identityConflicts,
      expected: details.expected || null,
      observed: details.observed || null,
      candidateId: candidate.id,
      completedAt: nowIso()
    };
    hypothesis.status = 'direct_confirmed';
    hypothesis.reason = 'poll_completed';
    return;
  }

  if (result === 'conflict') {
    locator.state = 'inconclusive';
    locator.termination = {
      status: CaseOutcome.INCONCLUSIVE,
      reason: 'poll_identity_conflict',
      expected: details.expected || null,
      observed: details.observed || null,
      completedAt: nowIso()
    };
    return;
  }

  if (result === 'not_found') {
    // Reject only this OLT + ONU/subscriber binding. The OLT itself may
    // become valid later with other identifiers or another interface.
    locator.state = 'searching';
    locator.termination = null;
    return;
  }

  if (['timeout', 'olt_unreachable', 'parser_error'].includes(result)) {
    locator.state = 'blocked';
    locator.termination = null;
    return;
  }

  if (result === 'pending') {
    locator.state = 'polling';
    locator.termination = null;
  }
}

function processTmcResult(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const result = observation.result || 'unknown';
  const nested = details.bestObserved || {};
  const candidateDetails = (
    details.oltName || details.oltIp
      ? details
      : nested
  );
  const hasOlt = Boolean(
    candidateDetails.oltName || candidateDetails.oltIp
  );

  setSourceStatus(locator, 'tmc', {
    result: hasOlt ? 'found' : result,
    observedResult: result,
    details: candidateDetails,
    identityCheck: details.identityCheck || null
  });

  if (hasOlt) {
    const tech = pollRouteFromEvidence({
      oltName: candidateDetails.oltName || '',
      interfaceName: candidateDetails.interface || '',
      technology: candidateDetails.technology || '',
      pollAction: candidateDetails.pollAction || ''
    });
    upsertCandidate(locator, {
      ...candidateDetails,
      source: 'userside-tmc',
      status: 'candidate',
      technology: candidateDetails.technology || tech.type,
      pollAction: candidateDetails.pollAction || tech.action,
      confidence: Number(candidateDetails.confidence || 0.9)
    }, evidence || {});
    locator.state = 'candidate_found';
    locator.termination = null;
  } else if (TMC_UNCONFIRMED_RESULTS.has(result)) {
    locator.state = 'searching';
    locator.termination = null;
  }
}

function processCustomerMacs(locator, observation) {
  const details = observation.details || {};
  const macs = Array.isArray(details.macs) ? details.macs : [];
  setSourceStatus(locator, 'customer_macs', {
    result: macs.length ? 'found' : 'missing',
    macs
  });
}

function processMacSearch(locator, observation, evidence) {
  const result = observation.result || 'unknown';
  const searchMode = observation.searchMode === 'uplink_downlink'
    ? 'mac_topology'
    : 'mac_direct';
  const details = observation.details || {};
  const candidates = Array.isArray(details.candidates)
    ? details.candidates
    : (observation.candidate ? [observation.candidate] : []);

  setSourceStatus(locator, searchMode, {
    result,
    searchedMac: observation.searchedMac || details.searchedMac || '',
    candidateCount: candidates.length
  });

  for (const candidate of candidates) {
    const tech = pollRouteFromEvidence({
      oltName: candidate.oltName || '',
      interfaceName: candidate.interface || '',
      technology: candidate.technology || '',
      pollAction: candidate.pollAction || ''
    });
    upsertCandidate(locator, {
      ...candidate,
      source: searchMode,
      status: candidate.matchedCurrentSubscriber
        ? 'candidate'
        : 'weak_candidate',
      technology: candidate.technology || tech.type,
      pollAction: candidate.pollAction || tech.action,
      confidence: Number(candidate.confidence || (
        candidate.matchedCurrentSubscriber ? 0.85 : 0.62
      ))
    }, evidence || {});
  }

  locator.state = candidates.length
    ? 'candidate_found'
    : 'searching';
  locator.termination = null;
}

function processInterfaceConfirmation(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const result = observation.result || 'unknown';

  setSourceStatus(locator, 'interface', {
    result,
    details
  });

  if (result === 'confirmed') {
    const existing = findCandidate(locator, details);
    const candidate = upsertCandidate(locator, {
      ...(existing || {}),
      ...details,
      source: details.source || 'interface-mac-list',
      status: 'interface_confirmed',
      matchedCurrentSubscriber: true,
      confidence: Math.max(Number(existing?.confidence || 0), 0.94)
    }, evidence || {});
    locator.state = 'interface_confirmed';
    locator.termination = null;
    return candidate;
  }

  if (result === 'not_found') {
    locator.state = 'searching';
  }
  return null;
}

function processDeviceDetails(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const tech = pollRouteFromEvidence({
    oltName: `${details.oltName || ''} ${details.systemName || ''} ${details.model || ''}`,
    interfaceName: details.interface || '',
    technology: details.technology || '',
    pollAction: details.pollAction || ''
  });
  const candidate = findCandidate(locator, details);

  const enriched = upsertCandidate(locator, {
    ...(candidate || {}),
    ...details,
    source: details.source || candidate?.source || 'userside-device',
    status: candidate?.status || 'candidate',
    technology: details.technology || candidate?.technology || tech.type,
    pollAction: details.pollAction || candidate?.pollAction || tech.action,
    confidence: Math.max(Number(candidate?.confidence || 0), 0.9)
  }, evidence || {});

  setSourceStatus(locator, 'device_details', {
    result: enriched.oltIp || enriched.oltName ? 'found' : 'partial',
    candidateId: enriched.id
  });
  locator.state = enriched.status === 'interface_confirmed'
    ? 'interface_confirmed'
    : 'candidate_found';
  locator.termination = null;
}

function processEthernetEvidence(locator, key, observation) {
  const details = observation.details || {};
  const result = observation.result || 'unknown';
  setSourceStatus(locator, key, {
    result,
    details,
    summary: compact(observation.summary || '', 420),
    method: observation.method || ''
  });
  locator.state = key === 'ethernet_errors'
    ? 'ethernet_checked'
    : key === 'ethernet_fdb'
      ? 'ethernet_fdb_checked'
      : key === 'ethernet_device'
        ? 'ethernet_switch_opened'
        : 'ethernet_access_confirmed';
  locator.termination = null;
}

function processJuniperSession(locator, observation) {
  const details = observation.details || {};
  const result = observation.result || details.status || 'unknown';
  setSourceStatus(locator, 'juniper', {
    result,
    details,
    summary: compact(observation.summary || '', 360),
    method: observation.method || '',
    readOnly: true
  });
  locator.state = 'juniper_checked';
  locator.termination = null;
}

export function recordEvidence(caseData, observations = [], context = {}) {
  const locator = ensureEvidenceState(caseData);
  const applied = [];

  for (const raw of observations || []) {
    if (!raw?.type) continue;
    const observation = {
      ...raw,
      pageKind: raw.pageKind || context.pageKind || '',
      source: raw.source || context.system || ''
    };

    // Defense in depth: no caller can turn a click/tab/render into a confirmed
    // ONU poll merely by sending result=confirmed. A real confirmation must carry
    // the request/response guards from the Billing reader and must be on-route.
    if (
      observation.type === EvidenceType.POLL_RESULT
      && observation.result === 'confirmed'
    ) {
      const details = observation.details || {};
      const validConfirmedPoll = Boolean(
        details.pollCompleted === true
        && details.pollResponded === true
        && details.requestObserved === true
        && details.wrongPollTab !== true
        && details.uiStable !== false
        && (!observation.routeRelation || observation.routeRelation === 'on_route')
      );
      if (!validConfirmedPoll) {
        observation.result = 'unknown';
        observation.passive = true;
        observation.passiveReason = observation.passiveReason || 'invalid-poll-confirmation';
      }
    }

    if (observation.routeRelation && ['off_route', 'foreign'].includes(observation.routeRelation)) {
      observation.passive = true;
      observation.passiveReason ||= `route-${observation.routeRelation}`;
    }

    observation.signature ||= observationSignature(observation);

    const confirmedLatched = locator.termination?.status === CaseOutcome.CONFIRMED;
    if (confirmedLatched && !(
      observation.type === EvidenceType.POLL_RESULT
      && observation.result === 'confirmed'
    )) {
      observation.passiveAfterTermination = true;
    }

    const evidence = storeEvidence(locator, observation, context);
    if (!evidence) continue;
    const isPassive = Boolean(observation.passiveAfterTermination || observation.passive);
    const attempt = isPassive ? null : storeAttempt(locator, observation, context);

    // Passive discovery is evidence memory only. It cannot move the route until
    // the operator revisits the source while that source is actually requested.
    if (isPassive) {
      applied.push({ observation, evidence, attempt, passive: true });
      continue;
    }

    switch (observation.type) {
      case EvidenceType.POLL_RESULT:
        processPollResult(caseData, locator, observation, evidence);
        break;
      case EvidenceType.JUNIPER_SESSION:
        processJuniperSession(locator, observation);
        break;
      case EvidenceType.TMC_RESULT:
        processTmcResult(locator, observation, evidence);
        break;
      case EvidenceType.CUSTOMER_MACS:
        processCustomerMacs(locator, observation);
        break;
      case EvidenceType.MAC_SEARCH_RESULT:
        processMacSearch(locator, observation, evidence);
        break;
      case EvidenceType.INTERFACE_CONFIRMATION:
        processInterfaceConfirmation(locator, observation, evidence);
        break;
      case EvidenceType.DEVICE_DETAILS:
        processDeviceDetails(locator, observation, evidence);
        break;
      case EvidenceType.ETHERNET_ACCESS_POINT:
        processEthernetEvidence(locator, 'ethernet_access', observation);
        break;
      case EvidenceType.ETHERNET_DEVICE:
        processEthernetEvidence(locator, 'ethernet_device', observation);
        break;
      case EvidenceType.ETHERNET_FDB_RESULT:
        processEthernetEvidence(locator, 'ethernet_fdb', observation);
        break;
      case EvidenceType.ETHERNET_PORT_ERRORS:
        processEthernetEvidence(locator, 'ethernet_errors', observation);
        break;
      default:
        break;
    }

    applied.push({ observation, evidence, attempt });
  }

  locator.updatedAt = nowIso();
  return applied;
}

function latestPoll(locator) {
  return locator.attempts.find(item => item.type === EvidenceType.POLL_RESULT) || null;
}

function pollAttemptsFor(locator, fingerprint) {
  return locator.attempts.filter(item => (
    item.type === EvidenceType.POLL_RESULT
    && (!fingerprint || item.bindingFingerprint === fingerprint)
  ));
}

function bestCandidate(locator) {
  const rank = {
    direct_confirmed: 100,
    billing_ready: 90,
    interface_confirmed: 80,
    candidate: 60,
    weak_candidate: 30
  };
  return [...locator.candidates]
    .sort((a, b) => (
      (rank[b.status] || 0) - (rank[a.status] || 0)
      || Number(b.confidence || 0) - Number(a.confidence || 0)
    ))[0] || null;
}

function candidateMatchesBilling(candidate, binding) {
  if (!candidate || !binding) return false;
  const ipMatch = candidate.oltIp && binding.oltIp
    && comparable(candidate.oltIp) === comparable(binding.oltIp);
  const nameMatch = candidate.oltName && binding.oltName
    && comparable(candidate.oltName) === comparable(binding.oltName);
  const actionMatch = !candidate.pollAction || !binding.pollAction
    || candidate.pollAction === binding.pollAction;
  return Boolean((ipMatch || nameMatch) && actionMatch);
}

export function isBindingRejected(caseData, binding = null) {
  const locator = ensureEvidenceState(caseData);
  const target = binding || currentBillingBinding(caseData);
  if (!target) return false;
  const fingerprint = target.fingerprint || bindingFingerprint(target);
  return locator.hypotheses.some(item => (
    item.fingerprint === fingerprint
    && item.status === 'rejected'
  ));
}

function recommendation(action, ruleId, reason, params = {}) {
  return { action, ruleId, reason, params };
}

function allSearchSourcesExhausted(locator) {
  return (
    TMC_UNCONFIRMED_RESULTS.has(locator.sourceStatus.tmc?.result)
    && locator.sourceStatus.mac_direct?.result === 'not_found'
    && locator.sourceStatus.mac_topology?.result === 'not_found'
    && !locator.candidates.some(item => (
      ['candidate', 'interface_confirmed', 'billing_ready', 'direct_confirmed']
        .includes(item.status)
    ))
  );
}

function allAvailableSourcesBlocked(locator) {
  const pollResult = latestPoll(locator)?.result || '';
  const tmc = locator.sourceStatus.tmc?.result || '';
  const direct = locator.sourceStatus.mac_direct?.result || '';
  const topology = locator.sourceStatus.mac_topology?.result || '';
  const sourceResults = [tmc, direct, topology].filter(Boolean);

  return (
    ['timeout', 'olt_unreachable', 'parser_error'].includes(pollResult)
    && sourceResults.length > 0
    && sourceResults.some(result => result === 'blocked')
    && sourceResults.every(result => (
      ['blocked', 'missing', 'identity_mismatch', 'identity_incomplete', 'ambiguous', 'not_found'].includes(result)
    ))
    && !locator.candidates.some(item => (
      ['candidate', 'interface_confirmed', 'billing_ready', 'direct_confirmed']
        .includes(item.status)
    ))
  );
}

function completedDiscovery(locator) {
  const status = locator.termination?.status || '';
  if (status === CaseOutcome.CONFIRMED) {
    return recommendation(
      NextStep.COMPLETE_CONFIRMED,
      'terminal.confirmed',
      'Штатный опрос OLT/ONU выполнен: оборудование вернуло ответ. Маршрут завершён.',
      { termination: locator.termination }
    );
  }
  if (status === CaseOutcome.INCONCLUSIVE) {
    return recommendation(
      NextStep.RESOLVE_CONFLICT,
      'terminal.inconclusive',
      'Получены противоречивые идентификаторы. Требуется сверка.',
      { termination: locator.termination }
    );
  }
  if ([CaseOutcome.BLOCKED, CaseOutcome.MANUAL_REVIEW].includes(status)) {
    return recommendation(
      NextStep.MANUAL_REVIEW,
      `terminal.${status}`,
      status === CaseOutcome.BLOCKED
        ? 'Автоматизированный поиск заблокирован недоступностью источников.'
        : 'Дальнейшее продолжение требует ручной проверки или NOC.',
      { termination: locator.termination }
    );
  }
  if (allAvailableSourcesBlocked(locator)) {
    locator.state = 'blocked';
    locator.termination = {
      status: CaseOutcome.BLOCKED,
      reason: 'available_sources_unreachable',
      attemptedSources: ['billing-poll', 'userside-tmc', 'mac-direct', 'mac-uplink-downlink'],
      completedAt: nowIso()
    };
    return recommendation(
      NextStep.MANUAL_REVIEW,
      'terminal.blocked',
      'Источники проверены, но необходимые системы или оборудование недоступны.',
      { termination: locator.termination }
    );
  }
  if (allSearchSourcesExhausted(locator)) {
    locator.state = 'not_found';
    locator.termination = {
      status: CaseOutcome.NOT_FOUND,
      reason: 'search_sources_exhausted',
      attemptedSources: ['billing-poll', 'userside-tmc', 'mac-direct', 'mac-uplink-downlink'],
      completedAt: nowIso()
    };
    return recommendation(
      NextStep.COMPLETE_NOT_FOUND,
      'terminal.not-found',
      'Доступные автоматизированные ветки исчерпаны: абонент не найден.',
      { termination: locator.termination }
    );
  }
  return null;
}

function ethernetStep(caseData, locator) {
  if (locator.sourceStatus.ethernet_device?.result !== 'confirmed') {
    return recommendation(
      NextStep.SWITCH_PORT,
      'ethernet.open-switch',
      'Тип подтверждён: Ethernet по витой паре. Открой точку подключения и указанный коммутатор.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        deviceName: String(valueOf(caseData.network?.accessDeviceName) || ''),
        deviceIp: String(valueOf(caseData.network?.accessDeviceIp) || ''),
        port: String(valueOf(caseData.network?.accessPort) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || '')
      }
    );
  }
  if (locator.sourceStatus.ethernet_fdb == null) {
    return recommendation(
      NextStep.CHECK_ETHERNET_FDB,
      'ethernet.check-fdb',
      'Коммутатор открыт. Проверь MAC текущего абонента в FDB на его порту.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || ''),
        subscriberMac: String(valueOf(caseData.network?.mac) || '')
      }
    );
  }
  if (locator.sourceStatus.ethernet_errors == null) {
    return recommendation(
      NextStep.CHECK_ETHERNET_ERRORS,
      'ethernet.check-errors',
      locator.sourceStatus.ethernet_fdb?.result === 'confirmed'
        ? 'MAC и порт подтверждены. Проверь ошибки целевого интерфейса.'
        : 'FDB не дала чистого подтверждения. Проверь ошибки целевого интерфейса и сохрани расхождение.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || ''),
        fdbResult: locator.sourceStatus.ethernet_fdb?.result || ''
      }
    );
  }
  return recommendation(
    NextStep.ETHERNET_SUMMARY,
    'ethernet.summary',
    [
      `Ethernet-ветка проверена: ${String(valueOf(caseData.network?.accessDeviceName) || 'коммутатор')}`,
      String(valueOf(caseData.network?.accessInterface) || valueOf(caseData.network?.accessPort) || ''),
      `FDB: ${locator.sourceStatus.ethernet_fdb?.result || 'нет данных'}`,
      `ошибки порта: ${locator.sourceStatus.ethernet_errors?.result || 'нет данных'}`
    ].filter(Boolean).join(' · '),
    {
      fdb: locator.sourceStatus.ethernet_fdb || null,
      errors: locator.sourceStatus.ethernet_errors || null
    }
  );
}

function isFingerprintRejected(locator, fingerprint) {
  if (!fingerprint) return false;
  return locator.hypotheses.some(item => (
    item.fingerprint === fingerprint
    && item.status === 'rejected'
  ));
}

function synchronizeFacts(caseData, locator) {
  const tmcOltName = String(valueOf(caseData.pon?.tmcOltName) || '');
  const tmcOltIp = String(valueOf(caseData.pon?.tmcOltIp) || '');
  const tmcDeviceId = String(valueOf(caseData.pon?.tmcOltDeviceId) || '');
  const tmcInterface = String(valueOf(caseData.pon?.tmcPort) || '');
  const tmcOnuMac = String(valueOf(caseData.pon?.tmcOnuMac) || '');
  const tmcOnuSerial = String(valueOf(caseData.pon?.tmcOnuSerial) || '');

  if ((tmcOltName || tmcOltIp) && locator.sourceStatus.tmc == null) {
    const tech = pollRouteFromEvidence({ oltName: tmcOltName, interfaceName: tmcInterface });
    setSourceStatus(locator, 'tmc', {
      result: 'found',
      details: {
        oltName: tmcOltName,
        oltIp: tmcOltIp,
        deviceId: tmcDeviceId,
        interface: tmcInterface
      },
      inferredFromFacts: true
    });
    upsertCandidate(locator, {
      source: 'userside-tmc',
      status: 'candidate',
      oltName: tmcOltName,
      oltIp: tmcOltIp,
      deviceId: tmcDeviceId,
      interface: tmcInterface,
      onuMac: tmcOnuMac,
      onuSerial: tmcOnuSerial,
      technology: tech.type,
      pollAction: tech.action,
      matchedCurrentSubscriber: true,
      confidence: 0.94
    });
  }

  const locatedDeviceId = String(valueOf(caseData.pon?.locatedDeviceId) || '');
  const locatedName = String(
    valueOf(caseData.pon?.locatedOltName)
    || valueOf(caseData.pon?.locatedDeviceName)
    || ''
  );
  const locatedIp = String(valueOf(caseData.pon?.locatedOltIp) || '');
  const locatedInterface = String(valueOf(caseData.pon?.locatedInterface) || '');
  const locatedIfIndex = String(valueOf(caseData.pon?.locatedIfIndex) || '');
  const locatedMac = String(valueOf(caseData.pon?.locatedSubscriberMac) || '');
  const locatedType = String(valueOf(caseData.pon?.locatedPollType) || '');
  const locatedAction = String(valueOf(caseData.pon?.locatedPollAction) || '');

  if ((locatedDeviceId || locatedName || locatedInterface)) {
    const tech = pollRouteFromEvidence({
      oltName: locatedName,
      interfaceName: locatedInterface,
      technology: locatedType,
      pollAction: locatedAction
    });
    upsertCandidate(locator, {
      source: 'userside-locator-facts',
      status: locatedInterface ? 'interface_confirmed' : 'candidate',
      deviceId: locatedDeviceId,
      oltName: locatedName,
      oltIp: locatedIp,
      interface: locatedInterface,
      ifIndex: locatedIfIndex,
      subscriberMac: locatedMac,
      technology: locatedType || tech.type,
      pollAction: locatedAction || tech.action,
      matchedCurrentSubscriber: Boolean(locatedInterface),
      confidence: locatedInterface ? 0.94 : 0.8
    });
  }
}

export function nextDiscoveryStep(caseData) {
  const locator = ensureEvidenceState(caseData);
  synchronizeFacts(caseData, locator);

  const family = comparable(valueOf(caseData.network?.connectionFamily));
  if (family === 'pon') {
    // PON workflow decisions belong exclusively to derivePonWorkflow().
    // Discovery retains evidence only and must not synthesize a parallel CTA.
    locator.recommendation = null;
    return null;
  }

  locator.recommendation = completedDiscovery(locator)
    || (family === 'ethernet'
      ? ethernetStep(caseData, locator)
      : recommendation(NextStep.WAIT_CONTEXT, 'route.wait', 'Workbench ожидает новый результат или подтверждённый факт.'));
  locator.updatedAt = nowIso();
  return locator.recommendation;
}

export function evidenceSnapshot(caseData) {
  const locator = ensureEvidenceState(caseData);
  const best = bestCandidate(locator);
  return {
    state: locator.state,
    recommendation: locator.recommendation || null,
    termination: locator.termination,
    bestCandidate: best,
    attemptCount: locator.attempts.length,
    evidenceCount: locator.evidence.length,
    candidateCount: locator.candidates.length,
    currentBindingRejected: isBindingRejected(caseData),
    sourceStatus: locator.sourceStatus,
    updatedAt: locator.updatedAt
  };
}

export function discoverySnapshot(caseData) {
  const locator = ensureEvidenceState(caseData);
  const recommendation = nextDiscoveryStep(caseData);
  const best = bestCandidate(locator);
  return {
    state: locator.state,
    recommendation,
    termination: locator.termination,
    bestCandidate: best,
    attemptCount: locator.attempts.length,
    evidenceCount: locator.evidence.length,
    candidateCount: locator.candidates.length,
    currentBindingRejected: isBindingRejected(caseData),
    sourceStatus: locator.sourceStatus,
    updatedAt: locator.updatedAt
  };
}

export const __test = Object.freeze({
  bindingFingerprint,
  candidateId,
  observationSignature,
  currentBillingBinding,
  bestCandidate,
  candidateMatchesBilling,
  billingTechnicalState,
  allSearchSourcesExhausted,
  pollPartialStable,
  completedDiscovery,
  ethernetStep
});
