export const CorrelationVerdict = Object.freeze({
  ACCEPTED: 'accepted',
  PASSIVE: 'passive',
  STALE: 'stale',
  FOREIGN: 'foreign',
  DUPLICATE: 'duplicate',
  REJECTED: 'rejected'
});

export const PollAttemptStage = Object.freeze({
  IDLE: 'IDLE',
  INTENT_RECORDED: 'INTENT_RECORDED',
  REQUEST_STARTED: 'REQUEST_STARTED',
  RESPONSE_DOCUMENT: 'RESPONSE_DOCUMENT',
  PARSED: 'PARSED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT'
});

const POLL_TERMINAL_STAGES = new Set([
  PollAttemptStage.CONFIRMED,
  PollAttemptStage.FAILED,
  PollAttemptStage.TIMEOUT
]);

const POLL_STAGE_ORDER = new Map([
  [PollAttemptStage.IDLE, 0],
  [PollAttemptStage.INTENT_RECORDED, 1],
  [PollAttemptStage.REQUEST_STARTED, 2],
  [PollAttemptStage.RESPONSE_DOCUMENT, 3],
  [PollAttemptStage.PARSED, 4],
  [PollAttemptStage.CONFIRMED, 5],
  [PollAttemptStage.FAILED, 5],
  [PollAttemptStage.TIMEOUT, 5]
]);

function id(prefix = 'evt') {
  return globalThis.crypto?.randomUUID?.()
    || `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function valueOf(raw) {
  return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
}

function clean(raw) {
  return String(valueOf(raw) ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function digits(raw) {
  return String(valueOf(raw) ?? '').replace(/\D+/g, '');
}

function mac(raw) {
  const hex = String(valueOf(raw) ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : '';
}

export function identityFingerprint(input = {}) {
  const identity = input.identity || input;
  const network = input.network || {};
  return [
    clean(identity.login),
    digits(identity.contract),
    digits(identity.billingId),
    digits(identity.customerId),
    mac(network.mac)
  ].join('|');
}

export function bindingFingerprint(input = {}) {
  const pon = input.pon || input;
  return [
    clean(pon.oltName),
    clean(pon.oltIp),
    mac(pon.onuMac),
    clean(pon.onuSerial),
    clean(pon.pollAction),
    clean(pon.locatedInterface || pon.interface)
  ].join('|');
}

export function makeEventEnvelope(raw = {}, {
  type = '',
  payload = null,
  sender = {},
  caseData = null,
  caseId = ''
} = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const origin = source.origin && typeof source.origin === 'object' ? source.origin : {};
  const operation = source.operation && typeof source.operation === 'object' ? source.operation : {};
  const senderDocumentId = String(sender?.documentId || '');
  const resolvedCaseId = String(source.caseId || caseId || caseData?.id || '');

  return {
    eventId: String(source.eventId || id('evt')),
    type: String(source.type || type || ''),
    occurredAt: String(source.occurredAt || new Date().toISOString()),
    caseId: resolvedCaseId,
    episodeId: String(source.episodeId || caseData?.episodeId || ''),
    caseVersion: Number.isFinite(Number(source.caseVersion))
      ? Number(source.caseVersion)
      : Number(caseData?.caseVersion || 0),
    origin: {
      tabId: sender?.tab?.id ?? origin.tabId ?? null,
      frameId: sender?.frameId ?? origin.frameId ?? 0,
      // MessageSender.documentId is authoritative when Chrome provides it.
      documentId: senderDocumentId || String(origin.documentId || ''),
      pageInstanceId: String(origin.pageInstanceId || ''),
      pageInstanceStartedAt: Number(origin.pageInstanceStartedAt || 0),
      system: String(origin.system || ''),
      pageKind: String(origin.pageKind || ''),
      url: String(origin.url || '')
    },
    operation: {
      requestId: String(operation.requestId || ''),
      pollAttemptId: String(operation.pollAttemptId || '')
    },
    identityFingerprint: String(
      source.identityFingerprint
      || (caseData ? identityFingerprint(caseData) : '')
    ),
    bindingFingerprint: String(
      source.bindingFingerprint
      || (caseData ? bindingFingerprint(caseData) : '')
    ),
    payload: source.payload ?? payload ?? null
  };
}

export function validateCorrelation(caseData, envelope, {
  requireCase = true,
  requireEpisode = true,
  requireIdentity = true,
  currentDocument = null,
  requireCurrentDocument = false,
  currentPollAttemptId = '',
  requirePollAttempt = false,
  currentRequestId = '',
  requireRequest = false,
  currentBindingFingerprint = '',
  requireBinding = false,
  processedEventIds = []
} = {}) {
  if (!caseData) {
    return { verdict: CorrelationVerdict.REJECTED, canMutate: false, reason: 'case-not-found' };
  }

  if (requireCase && (!envelope?.caseId || envelope.caseId !== caseData.id)) {
    return { verdict: CorrelationVerdict.FOREIGN, canMutate: false, reason: 'foreign-case' };
  }

  if (processedEventIds.includes(envelope?.eventId)) {
    return { verdict: CorrelationVerdict.DUPLICATE, canMutate: false, reason: 'duplicate-event-id' };
  }

  if (requireEpisode && (!envelope?.episodeId || envelope.episodeId !== caseData.episodeId)) {
    return { verdict: CorrelationVerdict.STALE, canMutate: false, reason: 'stale-episode' };
  }

  const currentIdentity = identityFingerprint(caseData);
  if (
    requireIdentity
    && envelope?.identityFingerprint
    && currentIdentity
    && envelope.identityFingerprint !== currentIdentity
  ) {
    return { verdict: CorrelationVerdict.FOREIGN, canMutate: false, reason: 'identity-fingerprint-mismatch' };
  }

  if (requireCurrentDocument && currentDocument) {
    const incomingDocumentId = String(envelope?.origin?.documentId || '');
    const currentDocumentId = String(currentDocument.documentId || '');
    const incomingStartedAt = Number(envelope?.origin?.pageInstanceStartedAt || 0);
    const currentStartedAt = Number(currentDocument.pageInstanceStartedAt || 0);
    const definitelyOlder = Boolean(
      incomingStartedAt
      && currentStartedAt
      && incomingStartedAt < currentStartedAt
    );
    if (
      incomingDocumentId
      && currentDocumentId
      && incomingDocumentId !== currentDocumentId
      && (definitelyOlder || !incomingStartedAt || !currentStartedAt)
    ) {
      return { verdict: CorrelationVerdict.STALE, canMutate: false, reason: 'stale-document' };
    }
  }

  if (requirePollAttempt) {
    const incomingAttemptId = String(envelope?.operation?.pollAttemptId || '');
    if (!incomingAttemptId) {
      return { verdict: CorrelationVerdict.REJECTED, canMutate: false, reason: 'poll-attempt-required' };
    }
    if (currentPollAttemptId && incomingAttemptId !== String(currentPollAttemptId)) {
      return { verdict: CorrelationVerdict.STALE, canMutate: false, reason: 'stale-poll-attempt' };
    }
  }

  if (requireRequest) {
    const incomingRequestId = String(envelope?.operation?.requestId || '');
    if (!incomingRequestId) {
      return { verdict: CorrelationVerdict.REJECTED, canMutate: false, reason: 'request-id-required' };
    }
    if (currentRequestId && incomingRequestId !== String(currentRequestId)) {
      return { verdict: CorrelationVerdict.STALE, canMutate: false, reason: 'stale-request-id' };
    }
  }

  if (
    requireBinding
    && currentBindingFingerprint
    && envelope?.bindingFingerprint
    && String(envelope.bindingFingerprint) !== String(currentBindingFingerprint)
  ) {
    return { verdict: CorrelationVerdict.STALE, canMutate: false, reason: 'stale-binding-fingerprint' };
  }

  return { verdict: CorrelationVerdict.ACCEPTED, canMutate: true, reason: 'correlation-match' };
}

export function pollAttemptPending(attempt = null) {
  if (!attempt) return false;
  if (typeof attempt.pending === 'boolean') return attempt.pending;
  return !POLL_TERMINAL_STAGES.has(String(attempt.stage || attempt.status || ''));
}

export function nextPollAttempt(current, incoming) {
  const attempt = incoming && typeof incoming === 'object' ? { ...incoming } : null;
  if (!attempt?.pollAttemptId) {
    return { accepted: false, duplicate: false, reason: 'poll-attempt-id-required', attempt: current || null };
  }

  const stage = String(attempt.stage || PollAttemptStage.IDLE);
  if (stage === PollAttemptStage.INTENT_RECORDED) {
    if (current && pollAttemptPending(current)) {
      if (String(current.pollAttemptId || '') === String(attempt.pollAttemptId)) {
        return { accepted: false, duplicate: true, reason: 'duplicate-poll-intent', attempt: current };
      }
      return { accepted: false, duplicate: true, reason: 'poll-attempt-already-pending', attempt: current };
    }
    return {
      accepted: true,
      duplicate: false,
      reason: 'poll-intent-accepted',
      attempt: { ...attempt, pending: true }
    };
  }

  if (!current || String(current.pollAttemptId || '') !== String(attempt.pollAttemptId)) {
    return { accepted: false, duplicate: false, reason: 'stale-poll-attempt', attempt: current || null };
  }

  const currentStage = String(current.stage || PollAttemptStage.IDLE);
  if (POLL_TERMINAL_STAGES.has(currentStage)) {
    return {
      accepted: false,
      duplicate: currentStage === stage,
      reason: currentStage === stage ? 'duplicate-poll-terminal' : 'finished-poll-cannot-return-to-running',
      attempt: current
    };
  }
  if ((POLL_STAGE_ORDER.get(stage) ?? -1) < (POLL_STAGE_ORDER.get(currentStage) ?? -1)) {
    return { accepted: false, duplicate: false, reason: 'poll-stage-cannot-go-backwards', attempt: current };
  }

  const terminal = POLL_TERMINAL_STAGES.has(stage);
  const canonicalStatus = terminal
    ? stage === PollAttemptStage.CONFIRMED
      ? 'resolved'
      : stage === PollAttemptStage.TIMEOUT
        ? 'timeout'
        : 'failed'
    : String(attempt.status || current.status || 'pending');

  return {
    accepted: true,
    duplicate: false,
    reason: 'poll-stage-accepted',
    attempt: {
      ...current,
      ...attempt,
      status: canonicalStatus,
      pending: !terminal
    }
  };
}

export function validateDiagnosticInvariants(previousCase, nextCase, { pollAttemptId = '' } = {}) {
  const violations = [];
  const previousTermination = String(previousCase?.locator?.termination?.status || '');
  const nextTermination = String(nextCase?.locator?.termination?.status || '');
  if (previousTermination === 'confirmed' && nextTermination !== 'confirmed') {
    violations.push('finished-cannot-return-to-running');
  }
  const ponAction = String(nextCase?.diagnostic?.locatorAction || nextCase?.diagnostic?.nextRequiredSource || '');
  const ponReady = nextCase?.diagnostic?.readyForOnuPoll === true;
  if (nextCase?.diagnostic?.isPon === true) {
    if (['poll_current_binding', 'poll_candidate', 'retry_poll'].includes(ponAction) && !ponReady) {
      violations.push('pon-poll-action-requires-ready');
    }
  }

  const activePollAttemptId = String(nextCase?.operations?.poll?.current?.pollAttemptId || '');
  if (
    nextTermination === 'confirmed'
    && pollAttemptId
    && activePollAttemptId
    && String(pollAttemptId) !== activePollAttemptId
  ) {
    violations.push('stale-poll-cannot-confirm-current-attempt');
  }

  return violations;
}

export const __test = Object.freeze({ clean, digits, mac, POLL_TERMINAL_STAGES, POLL_STAGE_ORDER });
