export const RouteRelation = Object.freeze({
  ON_ROUTE: 'on_route',
  SUPPORTING: 'supporting',
  OFF_ROUTE: 'off_route',
  FOREIGN: 'foreign'
});

function factValue(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function comparable(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeMac(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : '';
}

function normalizeIdentityValue(key, value) {
  const text = String(factValue(value) ?? '').trim();
  if (!text) return '';
  if (key === 'login') return comparable(text);
  if (key === 'contract' || key === 'billingId' || key === 'customerId') return text.replace(/\D+/g, '');
  return comparable(text);
}

function identityConflicts(caseData, context) {
  const incoming = context?.identity || {};
  const current = caseData?.identity || {};
  for (const key of ['login', 'billingId', 'customerId']) {
    const left = normalizeIdentityValue(key, current?.[key]);
    const right = normalizeIdentityValue(key, incoming?.[key]);
    if (left && right && left !== right) return true;
  }
  return false;
}

function expectedPollAction(caseData, context = {}) {
  return String(
    context?.meta?.poll?.attemptAction
    || context?.meta?.poll?.expectedPollAction
    || caseData?.diagnostic?.pollAction
    || ''
  );
}

function openedPollAction(context = {}) {
  return String(
    context?.meta?.poll?.openedAction
    || context?.subview?.replace(/^a/i, '')
    || ''
  );
}

function pollActionsMatch(caseData, context = {}, details = {}) {
  const expected = String(details.expectedPollAction || expectedPollAction(caseData, context) || '');
  const actual = String(details.pollAction || openedPollAction(context) || '');
  return !expected || !actual || expected === actual;
}

function isConfirmedPollContext(caseData, context = {}) {
  const poll = context?.meta?.poll || {};
  return Boolean(
    context?.pageKind === 'billing_onu_poll'
    && poll.outcome === 'confirmed'
    && poll.requestObserved === true
    && poll.responseEvidence === true
    && poll.wrongPollTab !== true
    && pollActionsMatch(caseData, context, poll)
  );
}

function isConfirmedPollObservation(caseData, observation = {}, context = {}) {
  const details = observation?.details || {};
  return Boolean(
    observation?.type === 'POLL_RESULT'
    && observation?.result === 'confirmed'
    && details.pollCompleted === true
    && details.pollResponded === true
    && details.requestObserved === true
    && details.wrongPollTab !== true
    && details.uiStable !== false
    && pollActionsMatch(caseData, context, details)
  );
}

/**
 * Same-subscriber pages are independent evidence sources. We no longer classify
 * normal operator navigation as "off route". Only a foreign subscriber or an
 * uncorrelated/wrong OLT response is rejected.
 */
export function classifyContextRelation(caseData, context = {}) {
  if (identityConflicts(caseData, context)) return RouteRelation.FOREIGN;
  if (context?.pageKind === 'billing_onu_poll') {
    if (isConfirmedPollContext(caseData, context)) return RouteRelation.ON_ROUTE;
    const poll = context?.meta?.poll || {};
    if (poll.wrongPollTab === true) return RouteRelation.OFF_ROUTE;
  }
  return RouteRelation.SUPPORTING;
}

export function classifyObservationRelation(caseData, observation = {}, context = {}) {
  if (identityConflicts(caseData, context)) return RouteRelation.FOREIGN;
  if (observation?.type === 'POLL_RESULT') {
    return isConfirmedPollObservation(caseData, observation, context)
      ? RouteRelation.ON_ROUTE
      : RouteRelation.OFF_ROUTE;
  }
  return RouteRelation.SUPPORTING;
}

export function filterContextForCase(caseData, rawContext = {}, relation = null) {
  const context = JSON.parse(JSON.stringify(rawContext || {}));
  const effectiveRelation = relation || classifyContextRelation(caseData, context);
  const blockedFacts = [];

  if (effectiveRelation === RouteRelation.FOREIGN) {
    for (const group of ['identity', 'network', 'pon', 'profile']) {
      if (!context[group] || typeof context[group] !== 'object') continue;
      for (const [key, raw] of Object.entries(context[group])) {
        const value = factValue(raw);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          blockedFacts.push({ group, key, value: String(value).slice(0, 220) });
        }
      }
      context[group] = {};
    }
  } else if (context.pageKind === 'billing_onu_poll' && !isConfirmedPollContext(caseData, context)) {
    // A poll page may be opened manually or still be waiting. Until a correlated
    // response exists, its PON output is not allowed to become canonical facts.
    for (const [key, raw] of Object.entries(context.pon || {})) {
      const value = factValue(raw);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        blockedFacts.push({ group: 'pon', key, value: String(value).slice(0, 220) });
      }
    }
    context.pon = {};
  }

  return { context, relation: effectiveRelation, blockedFacts };
}

export const __test = Object.freeze({
  factValue,
  identityConflicts,
  expectedPollAction,
  openedPollAction,
  pollActionsMatch,
  isConfirmedPollContext,
  isConfirmedPollObservation
});
