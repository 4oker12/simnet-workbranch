'use strict';

import { EVIDENCE_RETENTION_MS, EVIDENCE_TYPES } from '../config.js';
import { appendEvidenceEvent, cleanupEvidenceBuffer } from '../evidence/repository.js';
import { normalizeCallIdentity } from '../evidence/normalizer.js';
import { upsertCanonicalCall, legacyPbxKey } from './call-repository.js';
import { putBinding } from './binding-repository.js';

function factValue(raw) {
  return raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : raw;
}

function caseIdentity(state = {}, caseId = '') {
  const caseData = state.cases?.[caseId] || {};
  return normalizeCallIdentity({
    caseId,
    ...(caseData.identity || {}),
    fullName: factValue(caseData.profile?.fullName) || factValue(caseData.identity?.fullName) || ''
  });
}

export function migrateOperatorVisitTimeline(state = {}, callState = {}, options = {}) {
  callState.migrations ||= {};
  if (callState.migrations.operatorVisitTimelineV1?.completed) return { migrated: false, reason: 'already-completed' };
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const cutoff = atMs - EVIDENCE_RETENTION_MS;
  const timeline = state.operatorVisitTimeline || {};
  let attempted = 0;
  let added = 0;

  for (const visit of timeline.visits || []) {
    if (Number(visit?.ts || 0) < cutoff) continue;
    attempted += 1;
    const subscriberId = String(visit.subscriberId || '').replace(/\D+/g, '');
    const rawContract = String(visit.contract || visit.contractId || '').replace(/\D+/g, '');
    const contract = visit.source === 'billing' && rawContract === subscriberId ? '' : rawContract;
    const identity = {
      ...(visit.caseId ? caseIdentity(state, String(visit.caseId)) : {}),
      ...(visit.source === 'billing' ? { billingId: subscriberId } : { customerId: subscriberId }),
      ...(contract ? { contract, login: `abon${contract}` } : {})
    };
    const result = appendEvidenceEvent(callState.evidence, {
      ...visit,
      type: EVIDENCE_TYPES.SUBSCRIBER_VISIT,
      identity
    }, { nowMs: atMs, nowIso });
    if (result.added) added += 1;
  }

  for (const search of timeline.searches || []) {
    if (Number(search?.ts || 0) < cutoff) continue;
    attempted += 1;
    const legacyKind = String(search.kind || '').toLowerCase();
    const type = ['submit', 'query'].includes(legacyKind)
      ? EVIDENCE_TYPES.SEARCH_SUBMIT
      : legacyKind === 'resolved'
        ? EVIDENCE_TYPES.SEARCH_RESOLVED
        : legacyKind === 'result-open'
          ? EVIDENCE_TYPES.SEARCH_RESULT_OPEN
          : '';
    if (!type) continue;
    const result = appendEvidenceEvent(callState.evidence, { ...search, type }, { nowMs: atMs, nowIso });
    if (result.added) added += 1;
  }

  cleanupEvidenceBuffer(callState.evidence, atMs);
  callState.migrations.operatorVisitTimelineV1 = {
    completed: true,
    completedAt: nowIso,
    attempted,
    added,
    verifiedEvents: callState.evidence.events.length
  };
  delete state.operatorVisitTimeline;
  return { migrated: attempted > 0, attempted, added };
}

export function migrateLegacyPbxState(state = {}, callState = {}, options = {}) {
  callState.migrations ||= {};
  if (callState.migrations.pbxToCanonicalV1?.completed) return { migrated: false, reason: 'already-completed' };
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const legacy = state.telephony || {};
  const aliasToCall = new Map();
  let callsMigrated = 0;
  let bindingsMigrated = 0;

  for (const rawCall of Object.values(legacy.calls || {})) {
    const usersideCallId = String(rawCall?.usersideCallId || '').replace(/\D+/g, '');
    const legacyKey = legacyPbxKey(rawCall || {});
    if (!usersideCallId) {
      if (legacyKey) callState.calls.unresolvedLegacy.push({
        legacyCallKey: legacyKey,
        startedAtMs: Number(rawCall?.startedAtMs || 0),
        reason: 'userside-call-id-missing'
      });
      continue;
    }
    const result = upsertCanonicalCall(callState.calls, {
      ...rawCall,
      usersideCallId,
      status: Number(rawCall.durationSeconds || 0) > 0 ? 'completed' : 'unknown'
    }, nowIso);
    if (!result.stored) continue;
    callsMigrated += 1;
    if (legacyKey) aliasToCall.set(legacyKey, result.call.callKey);
  }

  for (const [rawKey, rawBinding] of Object.entries(legacy.bindings || {})) {
    const canonicalKey = aliasToCall.get(legacyPbxKey(rawKey)) || '';
    if (!canonicalKey) continue;
    const identity = caseIdentity(state, String(rawBinding?.caseId || ''));
    if (!identity.caseId && rawBinding?.customerId) identity.customerId = String(rawBinding.customerId).replace(/\D+/g, '');
    try {
      putBinding(callState.bindings, {
        callKey: canonicalKey,
        identity,
        caseLabel: rawBinding.caseLabel || '',
        mode: rawBinding.mode || 'legacy-migrated',
        registrationStatus: {
          state: String(rawBinding.registrationStatus || '') === 'registered' ? 'registered' : 'unknown',
          source: String(rawBinding.registrationStatus || '') === 'registered' ? 'workbench-local' : 'unknown'
        },
        operatorOverride: rawBinding.operatorOverride || null
      }, { nowIso });
      bindingsMigrated += 1;
    } catch {}
  }

  for (const [caseId, caseData] of Object.entries(state.cases || {})) {
    const rows = Array.isArray(caseData.telephony?.callBindings) ? caseData.telephony.callBindings : [];
    caseData.telephony ||= {};
    caseData.telephony.callBindings = rows.map(row => {
      const canonicalKey = aliasToCall.get(legacyPbxKey(row.callKey || row.recordId)) || '';
      return canonicalKey ? { ...row, callKey: canonicalKey, legacyCallKey: row.callKey || '' } : row;
    });
  }

  callState.migrations.pbxToCanonicalV1 = {
    completed: true,
    completedAt: nowIso,
    callsMigrated,
    bindingsMigrated,
    unresolved: callState.calls.unresolvedLegacy.length
  };
  delete state.telephony;
  return { migrated: callsMigrated > 0 || bindingsMigrated > 0, callsMigrated, bindingsMigrated };
}
