'use strict';

import { EVIDENCE_TYPES, EVIDENCE_RETENTION_MS } from '../config.js';
import { identityAliases, mergeCallIdentity, normalizeCallIdentity } from '../evidence/normalizer.js';

function identitiesOverlap(left = {}, right = {}) {
  const a = new Set(identityAliases(left));
  return identityAliases(right).some(alias => a.has(alias));
}

function eventMatchesIdentity(event = {}, identity = {}) {
  return identitiesOverlap(event.identity || {}, identity);
}

export function buildCaseCallAudit(callModuleState = {}, caseId = '', caseData = {}, options = {}) {
  const identity = normalizeCallIdentity({
    caseId,
    ...(caseData.identity || {}),
    fullName: caseData.profile?.fullName || caseData.identity?.fullName || ''
  });
  const allEvents = callModuleState.evidence?.events || [];
  const directEvents = allEvents.filter(event => eventMatchesIdentity(event, identity));
  const searchIds = new Set(directEvents.map(event => event.searchId).filter(Boolean));
  const parentSearchTs = new Set(directEvents.map(event => Number(event.parentSearchTs || 0)).filter(Boolean));
  const events = allEvents
    .filter(event => directEvents.includes(event)
      || (event.type === EVIDENCE_TYPES.SEARCH_SUBMIT
        && (searchIds.has(event.searchId) || parentSearchTs.has(Number(event.ts || 0)))))
    .map(event => ({
      ...JSON.parse(JSON.stringify(event)),
      identity: directEvents.includes(event)
        ? mergeCallIdentity(event.identity || {}, identity)
        : normalizeCallIdentity(event.identity || {})
    }))
    .slice(-240);
  const bindings = Object.values(callModuleState.bindings?.bindings || {})
    .filter(binding => identitiesOverlap(binding.identity || {}, identity))
    .map(binding => JSON.parse(JSON.stringify(binding)));
  const bindingKeys = new Set(bindings.map(binding => binding.callKey));
  const snapshotFragments = [];
  const relevantCallKeys = new Set(bindingKeys);
  for (const snapshot of Object.values(callModuleState.snapshots?.snapshots || {})) {
    const candidates = (snapshot.candidates || []).filter(candidate => (
      !candidate.hardConflict
      && Number(candidate.confidence || 0) > 0
      && identitiesOverlap(candidate.identity || {}, identity)
    ));
    if (!candidates.length) continue;
    relevantCallKeys.add(snapshot.callKey);
    snapshotFragments.push({
      callKey: snapshot.callKey,
      usersideCallId: snapshot.usersideCallId,
      frozenAt: snapshot.frozenAt,
      scoringVersion: snapshot.scoringVersion,
      candidates: JSON.parse(JSON.stringify(candidates))
    });
  }

  const allCalls = Object.values(callModuleState.calls?.calls || {});
  const calls = allCalls
    .filter(call => relevantCallKeys.has(call.callKey))
    .map(call => JSON.parse(JSON.stringify(call)));
  const generatedAt = String(options.nowIso || new Date().toISOString());
  return {
    schema: 'simnet-call-case-audit-v2',
    schemaVersion: 2,
    generatedAt,
    retentionMs: EVIDENCE_RETENTION_MS,
    caseId: String(caseId || ''),
    identity,
    summary: {
      events: events.length,
      visits: events.filter(event => event.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT).length,
      searchSubmits: events.filter(event => event.type === EVIDENCE_TYPES.SEARCH_SUBMIT).length,
      searchResolved: events.filter(event => event.type === EVIDENCE_TYPES.SEARCH_RESOLVED).length,
      searchResultOpens: events.filter(event => event.type === EVIDENCE_TYPES.SEARCH_RESULT_OPEN).length,
      handoffs: events.filter(event => event.type === EVIDENCE_TYPES.HANDOFF).length,
      callBindings: bindings.length,
      relevantCalls: calls.length,
      evaluatedCalls: allCalls.length,
      frozenSnapshots: snapshotFragments.length
    },
    evaluatedCalls: allCalls.length,
    events,
    bindings,
    calls,
    snapshots: snapshotFragments
  };
}
