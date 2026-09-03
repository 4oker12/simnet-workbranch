import { PollAttemptStage } from './case-guard.js';
import { ensureEvidenceState } from '../workflows/discovery.js';

export function createCaseModel({
  nowIso,
  compact,
  rawFactValue,
  trimCaseJournal,
  compactExistingConflicts,
  refreshProgress,
  maxProcessedEventIds = 160,
  maxCaseCallBindings = 16
}) {
  function stableEpisodeId(caseId, createdAt) {
    const text = `${caseId}|${createdAt}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `episode_${(hash >>> 0).toString(36)}_${String(createdAt || '').replace(/\D+/g, '').slice(0, 14)}`;
  }

  function ensureJuniperEvidenceShape(caseData) {
    caseData.juniper ||= {};
    const evidence = caseData.juniper.evidence ||= {};
    if (!('read' in evidence)) evidence.read = null;
    if (!('opened' in evidence)) evidence.opened = null;
    if (!('verified' in evidence)) evidence.verified = null;
    return evidence;
  }

  function normalizeComplaint(raw = {}, legacyClassification = null, fallbackAt = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacy = legacyClassification && typeof legacyClassification === 'object' ? legacyClassification : {};
    const category = compact(source.category || legacy.typeId || '', 80);
    const text = compact(source.text || source.raw || legacy.complaintPhrase || '', 480);
    const migrated = !source.category && !source.text && Boolean(category || text);
    const capturedAt = compact(source.capturedAt || legacy.startedAt || legacy.updatedAt || fallbackAt || '', 40);
    const updatedAt = compact(source.updatedAt || legacy.updatedAt || capturedAt || '', 40);
    return {
      category,
      text,
      source: compact(source.source || (migrated ? 'legacy-complaint-migration' : ''), 60),
      capturedAt,
      updatedAt
    };
  }

  function removeObsoletePonState(caseData) {
    caseData.workflow ||= {};
    // PON acquisition is derived directly from facts by workflows/pon.js. The
    // former mutable policy container is intentionally discarded on migration.
    delete caseData.workflow.ponAcquisition;
    delete caseData.completedSteps;
  }


  function ensureCaseShape(caseData, caseId) {
    const result = caseData || {};
    result.id ||= caseId;
    result.schemaVersion = 5;
    result.createdAt ||= nowIso();
    result.episodeId ||= stableEpisodeId(result.id, result.createdAt);
    result.caseVersion = Math.max(0, Number(result.caseVersion || 0));
    delete result.routeGeneration;
    result.updatedAt ||= nowIso();
    result.identity ||= {};
    result.network ||= {};
    if (!result.network.mac && result.network.routerMac) result.network.mac = result.network.routerMac;
    if ('routerMac' in result.network) delete result.network.routerMac;
    result.pon ||= {};
    result.profile ||= {};
    result.live ||= {};
    result.live.oltSnapshot = result.live.oltSnapshot && typeof result.live.oltSnapshot === 'object'
      ? result.live.oltSnapshot
      : null;
    result.contexts ||= {};
    result.viewsByTab ||= {};
    result.currentContext ||= {};
    result.conflicts = compactExistingConflicts(result.conflicts || []);
    result.meta ||= {};
    delete result.meta.observations;
    delete result.meta.scans;
    if (Number(result.meta.journalFormat || 0) < 2) {
      result.journal = trimCaseJournal(result.journal || []);
      result.meta.journalFormat = 2;
    } else {
      result.journal = Array.isArray(result.journal) ? result.journal : [];
    }
    result.meta.processedEventIds = Array.isArray(result.meta.processedEventIds)
      ? result.meta.processedEventIds.slice(-maxProcessedEventIds)
      : [];
    removeObsoletePonState(result);

    result.visits ||= {};
    result.navigation ||= {};
    const legacyRoute = result.route && typeof result.route === 'object' ? result.route : null;
    if (legacyRoute) {
      result.visits.billingTechnicalAt ||= legacyRoute.billingTechnicalVisitedAt || '';
      result.visits.usersideTmcAt ||= legacyRoute.usersideVisitedAt || '';
      result.visits.onuPollConfirmedAt ||= legacyRoute.onuPollConfirmedAt || '';
      if (!Array.isArray(result.navigation.handoffs) || !result.navigation.handoffs.length) {
        result.navigation.handoffs = Array.isArray(legacyRoute.handoffs) ? legacyRoute.handoffs.slice(-16) : [];
      }
      delete result.route;
    }

    if (String(rawFactValue(result.network.connectionFamily) || '').toUpperCase() === 'PON') {
      const moves = [
        ['accessDeviceId', 'onuDeviceId'],
        ['accessDeviceName', 'onuDeviceName'],
        ['accessDeviceIp', 'onuDeviceIp'],
        ['accessPort', 'onuLanPort'],
        ['accessInterface', 'onuLanInterface'],
        ['accessLinkState', 'onuLanLinkState'],
        ['accessSpeedMbps', 'onuLanSpeedMbps']
      ];
      for (const [networkKey, ponKey] of moves) {
        if (!result.pon[ponKey] && result.network[networkKey]) result.pon[ponKey] = result.network[networkKey];
        if (networkKey in result.network) delete result.network[networkKey];
      }
    }
    result.navigation.handoffs = Array.isArray(result.navigation.handoffs)
      ? result.navigation.handoffs.slice(-16)
      : [];
    ensureEvidenceState(result);
    result.operations ||= {};
    result.operations.poll ||= { current: null, history: [] };
    const normalizeStoredPollAttempt = attempt => {
      if (!attempt || typeof attempt !== 'object') return attempt || null;
      attempt = {
        ...attempt,
        href: attempt.href ? String(attempt.href).replace(/([?&](?:pp|password|passwd|pass|token|secret|csrf|session|sid|auth|authorization)=)[^&#\s]*/gi, '$1[redacted]') : ''
      };
      const stage = String(attempt.stage || '').toUpperCase();
      if (stage === PollAttemptStage.CONFIRMED) return { ...attempt, pending: false, status: 'resolved', outcome: 'confirmed' };
      if (stage === PollAttemptStage.TIMEOUT) return { ...attempt, pending: false, status: 'timeout', outcome: attempt.outcome || 'timeout' };
      if (stage === PollAttemptStage.FAILED) return { ...attempt, pending: false, status: 'failed' };
      return attempt;
    };
    result.operations.poll.current = normalizeStoredPollAttempt(result.operations.poll.current);
    result.operations.poll.history = Array.isArray(result.operations.poll.history)
      ? result.operations.poll.history.slice(-24).map(normalizeStoredPollAttempt)
      : [];
    result.juniper ||= {};
    result.juniper.dataStatus ||= 'missing';
    result.juniper.reviewStatus ||= 'required';
    result.juniper.requestId ||= '';
    result.juniper.readAt ||= '';
    result.juniper.lastReadAt ||= '';
    result.juniper.autoReadAt ||= '';
    result.juniper.openedAt ||= '';
    result.juniper.verifiedAt ||= '';
    result.juniper.readSource ||= '';
    result.juniper.operatorOpened = Boolean(result.juniper.operatorOpened);
    result.juniper.verified = Boolean(result.juniper.verified);
    ensureJuniperEvidenceShape(result);
    result.complaint = normalizeComplaint(result.complaint, result.appeal, result.createdAt);
    if ('appeal' in result) delete result.appeal;
    result.telephony ||= {};
    result.telephony.schema ||= 'simnet-case-call-bindings-v1';
    result.telephony.callBindings = Array.isArray(result.telephony.callBindings)
      ? result.telephony.callBindings
        .filter(binding => binding && typeof binding === 'object' && /^(?:call:\d{1,24}|pbx:\d{9,12}\.\d{1,12})$/.test(String(binding.callKey || '')))
        .slice(-maxCaseCallBindings)
      : [];
    result.diagnosis ||= {};
    result.diagnosis.status ||= 'not-assessed';
    result.diagnosis.conclusion ||= '';
    result.diagnosis.updatedAt ||= '';
    result.diagnosis.evidence = Array.isArray(result.diagnosis.evidence)
      ? result.diagnosis.evidence.slice(-64)
      : [];
    result.diagnostic ||= {
      stage: 'empty',
      completion: 0,
      family: '',
      subtype: '',
      readyForOnuPoll: false,
      nextRequiredSource: 'billing-technical'
    };
    refreshProgress(result);
    return result;
  }

  function emptyCase(caseId) {
    return ensureCaseShape({ id: caseId, createdAt: nowIso(), updatedAt: nowIso() }, caseId);
  }

  return Object.freeze({
    stableEpisodeId,
    normalizeComplaint,
    ensureJuniperEvidenceShape,
    removeObsoletePonState,
    ensureCaseShape,
    emptyCase
  });
}
