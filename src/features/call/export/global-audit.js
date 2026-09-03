'use strict';

import { EVIDENCE_TYPES } from '../config.js';
import { identityAliases, mergeCallIdentity, normalizeCallIdentity } from '../evidence/normalizer.js';

function normalizedSubscribers(callModuleState = {}) {
  const rows = [];
  const add = raw => {
    const identity = normalizeCallIdentity(raw);
    const aliases = new Set(identityAliases(identity));
    if (!aliases.size) return;
    let row = rows.find(item => [...aliases].some(alias => item.aliases.has(alias)));
    if (!row) {
      row = { identity, aliases };
      rows.push(row);
    } else {
      row.identity = mergeCallIdentity(row.identity, identity);
      for (const alias of aliases) row.aliases.add(alias);
    }
  };
  for (const event of callModuleState.evidence?.events || []) add(event.identity || {});
  for (const snapshot of Object.values(callModuleState.snapshots?.snapshots || {})) {
    for (const candidate of snapshot.candidates || []) add(candidate.identity || {});
  }
  for (const binding of Object.values(callModuleState.bindings?.bindings || {})) add(binding.identity || {});
  return rows.map(row => ({ ...row.identity, aliases: [...row.aliases] }));
}

function completedSearchChains(events = []) {
  const submits = events.filter(event => event.type === EVIDENCE_TYPES.SEARCH_SUBMIT);
  return events.filter(event => {
    if (event.type !== EVIDENCE_TYPES.SEARCH_RESULT_OPEN) return false;
    return submits.some(submit => (
      submit.source === event.source
      && (submit.tabId == null || event.tabId == null || submit.tabId === event.tabId)
      && (!event.searchId || !submit.searchId || event.searchId === submit.searchId)
      && Number(submit.ts || 0) <= Number(event.ts || 0)
    ));
  }).length;
}

export function buildGlobalCallAudit(callModuleState = {}, options = {}) {
  const events = JSON.parse(JSON.stringify(callModuleState.evidence?.events || []));
  const calls = JSON.parse(JSON.stringify(Object.values(callModuleState.calls?.calls || {})));
  const snapshots = JSON.parse(JSON.stringify(Object.values(callModuleState.snapshots?.snapshots || {})));
  const bindings = JSON.parse(JSON.stringify(Object.values(callModuleState.bindings?.bindings || {})));
  const subscribers = normalizedSubscribers(callModuleState);
  return {
    schema: 'simnet-call-global-audit-v1',
    schemaVersion: 1,
    generatedAt: String(options.nowIso || new Date().toISOString()),
    summary: {
      subscribersTouched: subscribers.length,
      completedSearchOpenChains: completedSearchChains(events),
      autocompleteResolved: events.filter(event => event.type === EVIDENCE_TYPES.SEARCH_RESOLVED).length,
      callsEvaluated: calls.length,
      frozenSnapshots: snapshots.length,
      bindings: bindings.length
    },
    config: JSON.parse(JSON.stringify(callModuleState.config || {})),
    callEvidenceBuffer: events,
    normalizedSubscribers: subscribers,
    calls,
    frozenSnapshots: snapshots,
    bindings
  };
}
