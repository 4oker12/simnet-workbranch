'use strict';

import {
  CALL_MODULE_SCHEMA,
  CALL_SCHEMA_VERSION,
  DEFAULT_CALL_CONFIG,
  EVIDENCE_TYPES,
  MAX_PBX_HINTS,
  PBX_HINT_RETENTION_MS,
  SNAPSHOT_RETENTION_MS,
  MAX_CALLS
} from './config.js';
import { createEvidenceState, appendEvidenceEvent, cleanupEvidenceBuffer, resolveSearchSession, evidenceInWindow } from './evidence/repository.js';
import { identityAliases, mergeCallIdentity, normalizeCallIdentity } from './evidence/normalizer.js';
import { createCallStore, upsertCanonicalCall, cleanupCalls, getCall, listCalls, canonicalCallKey } from './storage/call-repository.js';
import { createSnapshotStore, cleanupSnapshots, getSnapshot } from './storage/snapshot-repository.js';
import { createBindingStore, cleanupBindings, getBinding, putBinding, appendAssignment } from './storage/binding-repository.js';
import { migrateLegacyPbxState, migrateOperatorVisitTimeline } from './storage/migrations.js';
import { freezeEligibleCalls } from './correlation/snapshot-service.js';
import { snapshotStatusForCall } from './correlation/call-window.js';
import { scoreSnapshotCandidates } from './correlation/scorer.js';
import { buildCaseCallAudit } from './export/case-audit.js';
import { buildGlobalCallAudit } from './export/global-audit.js';

const cloneJson = value => value == null ? value : JSON.parse(JSON.stringify(value));
const compact = (value, max = 180) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 24) => String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
const factValue = raw => raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : raw;

function createRealtimeHintState() {
  return { schema: 'simnet-call-realtime-hints-v1', hints: [], updatedAt: '' };
}

function createOutcomeState() {
  return { schema: 'simnet-call-outcomes-v1', byCall: {}, updatedAt: '' };
}

function cleanupOutcomes(store = createOutcomeState(), atMs = Date.now()) {
  const cutoff = Number(atMs) - SNAPSHOT_RETENTION_MS;
  const entries = Object.entries(store.byCall || {})
    .filter(([, outcome]) => {
      const ts = Date.parse(String(outcome?.updatedAt || outcome?.createdAt || outcome?.submittedAt || '')) || 0;
      return ts >= cutoff;
    })
    .sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || '')))
    .slice(0, MAX_CALLS);
  store.byCall = Object.fromEntries(entries);
  return store;
}

function outcomeLabel(typer = '') {
  return ({
    '1': 'Новое подключение · ЖК',
    '15': 'Новое подключение · ЧС',
    '41': 'Потенциальный абонент · ЖК',
    '70': 'Потенциальный абонент · ЧС'
  })[String(typer || '')] || '';
}

function cleanupRealtimeHints(store = createRealtimeHintState(), atMs = Date.now()) {
  const cutoff = Number(atMs) - PBX_HINT_RETENTION_MS;
  store.hints = (Array.isArray(store.hints) ? store.hints : [])
    .filter(hint => Number(hint?.ts || 0) >= cutoff)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
    .slice(-MAX_PBX_HINTS);
  return store;
}

function identityForCase(caseId = '', caseData = {}) {
  return normalizeCallIdentity({
    caseId,
    ...(caseData.identity || {}),
    fullName: factValue(caseData.profile?.fullName) || factValue(caseData.identity?.fullName) || ''
  });
}

function overlap(left = {}, right = {}) {
  const aliases = new Set(identityAliases(left));
  return identityAliases(right).some(alias => aliases.has(alias));
}

function resolveIdentityFromCases(state = {}, rawIdentity = {}) {
  let identity = normalizeCallIdentity(rawIdentity);
  for (const [caseId, caseData] of Object.entries(state.cases || {})) {
    const candidate = identityForCase(caseId, caseData);
    if (overlap(identity, candidate)) identity = mergeCallIdentity(identity, candidate);
  }
  return identity;
}

function enrichForFreeze(state = {}, callState = {}) {
  const evidence = cloneJson(callState.evidence || createEvidenceState());
  evidence.events = (evidence.events || []).map(event => ({
    ...event,
    identity: resolveIdentityFromCases(state, event.identity || {})
  }));
  const calls = cloneJson(callState.calls || createCallStore());
  for (const call of Object.values(calls.calls || {})) {
    const callIdentity = resolveIdentityFromCases(state, {
      customerId: call.customerId,
      login: call.login,
      contract: call.contract,
      fullName: call.fio
    });
    call.customerId = callIdentity.customerId || call.customerId;
    call.login = callIdentity.login || call.login;
    call.contract = callIdentity.contract || call.contract;
    call.fio = callIdentity.fullName || call.fio;
  }
  return { calls, evidence };
}

export function createCallModuleState() {
  return {
    schema: CALL_MODULE_SCHEMA,
    schemaVersion: CALL_SCHEMA_VERSION,
    config: { ...DEFAULT_CALL_CONFIG },
    calls: createCallStore(),
    evidence: createEvidenceState(),
    snapshots: createSnapshotStore(),
    bindings: createBindingStore(),
    realtimeHints: createRealtimeHintState(),
    outcomes: createOutcomeState(),
    preview: null,
    migrations: {},
    updatedAt: ''
  };
}

export function ensureCallModuleState(state = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  state.callModule ||= createCallModuleState();
  const callState = state.callModule;
  callState.schema = CALL_MODULE_SCHEMA;
  callState.schemaVersion = CALL_SCHEMA_VERSION;
  callState.config = { ...DEFAULT_CALL_CONFIG, ...(callState.config || {}) };
  callState.calls ||= createCallStore();
  callState.evidence ||= createEvidenceState();
  callState.snapshots ||= createSnapshotStore();
  callState.bindings ||= createBindingStore();
  callState.realtimeHints ||= createRealtimeHintState();
  callState.outcomes ||= createOutcomeState();
  callState.migrations ||= {};

  migrateOperatorVisitTimeline(state, callState, { atMs, nowIso });
  migrateLegacyPbxState(state, callState, { atMs, nowIso });
  cleanupEvidenceBuffer(callState.evidence, atMs);
  cleanupCalls(callState.calls, atMs);
  cleanupSnapshots(callState.snapshots, atMs);
  cleanupBindings(callState.bindings, atMs);
  cleanupRealtimeHints(callState.realtimeHints, atMs);
  cleanupOutcomes(callState.outcomes, atMs);
  return callState;
}

function recordPbxRealtimeHints(state, rows = [], observedAt = '', options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled || !callState.config.pbxRealtimeEnabled) {
    return { accepted: false, stored: 0, reason: 'pbx-realtime-disabled' };
  }
  const fallbackTs = Date.parse(String(observedAt || '')) || atMs;
  const existing = new Set((callState.realtimeHints.hints || []).map(hint => hint.id));
  let stored = 0;
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, MAX_PBX_HINTS)) {
    const agentExtension = digits(row?.agentExtension || String(row?.agent || '').match(/^\s*(\d{3,6})\b/)?.[1], 6);
    if (!agentExtension) continue;
    const durationSeconds = Math.max(0, Math.min(86_400, Number(row?.durationSeconds || 0)));
    const type = durationSeconds > 0 ? 'PBX_CALL_ENDED_HINT' : 'PBX_CALL_STARTED_HINT';
    const ts = Date.parse(String(row?.observedAt || '')) || fallbackTs;
    const id = `${type}:${agentExtension}:${Math.floor(ts / 1000)}`;
    if (existing.has(id)) continue;
    existing.add(id);
    // Deliberately omit record/call/customer/phone fields: PBX is only an early
    // lifecycle hint. UserSide call_list remains the sole canonical identity.
    callState.realtimeHints.hints.push({ id, type, ts, agentExtension });
    stored += 1;
  }
  cleanupRealtimeHints(callState.realtimeHints, atMs);
  if (stored) {
    callState.realtimeHints.updatedAt = nowIso;
    callState.updatedAt = nowIso;
  }
  return {
    accepted: true,
    stored,
    total: callState.realtimeHints.hints.length,
    updatedAt: callState.realtimeHints.updatedAt
  };
}

function recordSearch(state, payload = {}, sender = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled) return { accepted: false, reason: 'call-disabled' };
  const source = ['billing', 'userside'].includes(String(payload.source || '')) ? String(payload.source) : '';
  const legacyKind = String(payload.kind || '').toLowerCase();
  const type = ['submit', 'query'].includes(legacyKind)
    ? EVIDENCE_TYPES.SEARCH_SUBMIT
    : legacyKind === 'resolved'
      ? EVIDENCE_TYPES.SEARCH_RESOLVED
      : legacyKind === 'result-open'
        ? EVIDENCE_TYPES.SEARCH_RESULT_OPEN
        : '';
  if (!source || !type) return { accepted: false, reason: 'invalid-evidence' };
  const tabId = sender?.tab?.id == null ? null : Number(sender.tab.id);
  const base = {
    ...payload,
    type,
    source,
    tabId,
    ts: atMs,
    searchId: compact(payload.searchId, 120) || `${source}:${tabId ?? 'na'}:${atMs}`
  };
  const resolvedSearchId = resolveSearchSession(callState.evidence, base, atMs);
  base.searchId = resolvedSearchId || base.searchId;
  if (type !== EVIDENCE_TYPES.SEARCH_SUBMIT) {
    const parent = [...(callState.evidence.events || [])].reverse().find(event => (
      event.type === EVIDENCE_TYPES.SEARCH_SUBMIT
      && event.source === source
      && (tabId == null || event.tabId == null || event.tabId === tabId)
      && (!base.searchId || !event.searchId || event.searchId === base.searchId)
      && atMs - Number(event.ts || 0) >= 0
      && atMs - Number(event.ts || 0) <= 180_000
    ));
    if (parent) {
      base.parentSearchTs = Number(parent.ts || 0);
      if (!base.query) base.query = parent.query;
      if (!base.searchKind) base.searchKind = parent.searchKind;
    }
  }
  const result = appendEvidenceEvent(callState.evidence, base, { nowMs: atMs, nowIso });
  if (result.added) callState.updatedAt = nowIso;
  return { accepted: result.accepted, added: result.added, duplicate: result.duplicate, ts: result.event?.ts || atMs, searchId: result.event?.searchId || base.searchId };
}

function recordVisit(state, context = {}, sender = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled) return { accepted: false, added: false, reason: 'call-disabled' };
  if (options.accepted !== true) return { accepted: false, added: false, reason: 'context-not-accepted' };
  const pageType = String(context.pageKind || '');
  const source = pageType.startsWith('userside_') ? 'userside' : pageType.startsWith('billing_') ? 'billing' : '';
  if (!source) return { accepted: false, added: false, reason: 'unsupported-page' };
  // CALL evidence must describe the page that actually produced the event.
  // Never seed it from options.caseId: that value can belong to a previously
  // active Case and was the source of stale-subscriber contamination.
  const pageIdentity = normalizeCallIdentity({
    ...(context.identity || {}),
    caseId: '',
    ...(source === 'billing' ? { billingId: context.entityId || factValue(context.identity?.billingId) || '' } : {}),
    ...(source === 'userside' ? { customerId: context.entityId || factValue(context.identity?.customerId) || '' } : {})
  });
  const hasPageIdentity = identityAliases(pageIdentity).some(alias => !alias.startsWith('case:'));
  if (!hasPageIdentity) return { accepted: false, added: false, reason: 'page-identity-missing' };
  const identity = resolveIdentityFromCases(state, pageIdentity);
  const result = appendEvidenceEvent(callState.evidence, {
    type: EVIDENCE_TYPES.SUBSCRIBER_VISIT,
    source,
    ts: atMs,
    tabId: sender?.tab?.id == null ? null : Number(sender.tab.id),
    pageType,
    pageUrl: sender?.tab?.url || context.url || '',
    identity,
    handoff: null
  }, { nowMs: atMs, nowIso });
  let handoffAdded = false;
  if (options.handoff) {
    const handoffResult = appendEvidenceEvent(callState.evidence, {
      type: EVIDENCE_TYPES.HANDOFF,
      source,
      ts: atMs,
      tabId: sender?.tab?.id == null ? null : Number(sender.tab.id),
      pageType,
      pageUrl: sender?.tab?.url || context.url || '',
      identity,
      handoff: options.handoff
    }, { nowMs: atMs, nowIso });
    handoffAdded = Boolean(handoffResult.added);
  }
  if (result.added) callState.updatedAt = nowIso;
  return { accepted: result.accepted, added: result.added || handoffAdded, event: result.event };
}

function recordTaskOutcome(state, payload = {}, sender = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled) return { accepted: false, reason: 'call-disabled' };
  const callKey = canonicalCallKey(payload.callKey || '');
  const typer = String(payload.typer || '').replace(/\D+/g, '');
  const label = outcomeLabel(typer);
  if (!callKey || !label) return { accepted: false, reason: 'invalid-outcome' };
  const call = getCall(callState.calls, callKey);
  if (!call) return { accepted: false, reason: 'call-missing' };
  const stage = String(payload.stage || 'submitted') === 'created' ? 'created' : 'submitted';
  const taskId = digits(payload.taskId, 14);
  if (stage === 'created' && !taskId) return { accepted: false, reason: 'task-id-missing' };
  const existing = callState.outcomes.byCall?.[callKey] || null;
  const next = {
    ...(existing || {}),
    schema: 'simnet-call-outcome-v1',
    callKey,
    typer,
    label,
    stage: existing?.stage === 'created' ? 'created' : stage,
    taskId: taskId || existing?.taskId || '',
    submittedAt: existing?.submittedAt || nowIso,
    createdAt: stage === 'created' ? (existing?.createdAt || nowIso) : (existing?.createdAt || ''),
    updatedAt: nowIso,
    byTabId: sender?.tab?.id == null ? null : Number(sender.tab.id)
  };
  callState.outcomes.byCall ||= {};
  callState.outcomes.byCall[callKey] = next;
  callState.outcomes.updatedAt = nowIso;
  cleanupOutcomes(callState.outcomes, atMs);
  callState.updatedAt = nowIso;
  return { accepted: true, outcome: cloneJson(next) };
}

function ingestUsersideCalls(state, rows = [], preview = null, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled || !callState.config.usersideCallListEnabled) return { accepted: false, stored: 0 };
  let stored = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const result = upsertCanonicalCall(callState.calls, row, nowIso);
    if (result.stored) stored += 1;
  }
  // Keep the current unresolved UserSide row in the canonical repository too.
  // Its call:<usersideId> key is already stable, so LIVE registration can lock
  // an intent before the duration becomes available. The same row is upgraded
  // in-place to completed on the next call_list refresh.
  if (preview?.usersideCallId) {
    const live = upsertCanonicalCall(callState.calls, { ...preview, ongoing: true }, nowIso);
    if (live.stored) stored += 1;
  }
  callState.preview = preview ? cloneJson(preview) : null;
  const enriched = enrichForFreeze(state, callState);
  const freezes = freezeEligibleCalls(enriched.calls, enriched.evidence, callState.snapshots, { atMs, nowIso });
  cleanupCalls(callState.calls, atMs);
  cleanupSnapshots(callState.snapshots, atMs);
  callState.updatedAt = nowIso;
  return {
    accepted: true,
    stored,
    frozen: freezes.filter(result => result.stored).length,
    total: Object.keys(callState.calls.calls || {}).length,
    updatedAt: nowIso
  };
}

function liveSnapshotForCall(call = {}, evidenceBuffer = {}, atMs = Date.now()) {
  const startedAtMs = Number(call?.startedAtMs || 0);
  if (!startedAtMs || !call?.callKey) return null;
  const completed = String(call.status || '') === 'completed' || Number(call.endedAtMs || 0) > 0;
  const endedAtMs = completed ? Number(call.endedAtMs || 0) : Number(atMs);
  const windowEndMs = completed
    ? Math.min(Number(atMs), endedAtMs + 15_000)
    : Number(atMs);
  if (windowEndMs < startedAtMs) return null;
  const events = evidenceInWindow(evidenceBuffer, startedAtMs, windowEndMs);
  return {
    schema: 'simnet-call-live-snapshot-v1',
    schemaVersion: 1,
    callKey: String(call.callKey || ''),
    usersideCallId: String(call.usersideCallId || ''),
    startedAtMs,
    endedAtMs: completed ? endedAtMs : 0,
    windowEndMs,
    frozenAt: '',
    status: completed ? 'pending' : 'live',
    live: !completed,
    candidates: scoreSnapshotCandidates(call, events, {
      windowStartMs: startedAtMs,
      endedAtMs,
      windowEndMs
    })
  };
}

function effectiveSnapshotForCall(callState = {}, call = {}, atMs = Date.now()) {
  const frozen = getSnapshot(callState.snapshots, call.callKey);
  return frozen || liveSnapshotForCall(call, callState.evidence, atMs);
}

function registrationState(binding = null) {
  const raw = binding?.registrationStatus;
  if (raw && typeof raw === 'object') return String(raw.state || 'unknown');
  return ['registered', 'unregistered', 'unknown', 'submitting', 'review_required', 'bound'].includes(String(raw || ''))
    ? (String(raw) === 'bound' ? 'unknown' : String(raw))
    : 'unknown';
}

function candidateForIdentity(snapshot = null, identity = {}) {
  return (snapshot?.candidates || []).find(candidate => overlap(candidate.identity || {}, identity)) || null;
}

function candidateMatch(candidate = null) {
  const confidence = Number(candidate?.confidence || 0);
  const conflict = candidate?.hardConflict === true;
  const level = conflict ? 'conflict' : confidence >= 80 ? 'strong' : confidence >= 55 ? 'supporting' : confidence > 0 ? 'weak' : 'none';
  return {
    level,
    correlationLevel: level === 'supporting' ? 'secondary' : level,
    correlationScore: Number(candidate?.rawScore || 0),
    confidence,
    correlationReasons: candidate?.reasons || [],
    matchedBy: candidate?.authoritative ? ['customer'] : [],
    conflicts: conflict ? ['customer'] : [],
    currentCaseSearch: null,
    callStartMs: Number(candidate?.evidence?.[0]?.ts || 0)
  };
}

function decorateCandidate(candidate = {}, currentIdentity = {}) {
  const identity = normalizeCallIdentity(candidate.identity || {});
  return {
    ...cloneJson(candidate),
    ...identity,
    subscriberId: identity.contract || identity.customerId || identity.billingId,
    score: Number(candidate.rawScore || 0),
    isCurrentCase: overlap(identity, currentIdentity),
    label: identity.fullName || identity.login || (identity.contract ? `abon${identity.contract}` : identity.customerId || identity.billingId)
  };
}

function localDateKey(ms = Date.now()) {
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function query(state, payload = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  const enriched = enrichForFreeze(state, callState);
  freezeEligibleCalls(enriched.calls, enriched.evidence, callState.snapshots, { atMs, nowIso });
  const caseId = String(payload.caseId || '');
  const caseData = state.cases?.[caseId] || {};
  const currentIdentity = identityForCase(caseId, caseData);
  const calls = listCalls(callState.calls).map(call => {
    const frozenSnapshot = getSnapshot(callState.snapshots, call.callKey);
    const snapshot = frozenSnapshot || liveSnapshotForCall(call, callState.evidence, atMs);
    const candidate = candidateForIdentity(snapshot, currentIdentity);
    const binding = getBinding(callState.bindings, call.callKey);
    return {
      ...cloneJson(call),
      snapshotStatus: frozenSnapshot ? 'frozen' : (snapshot?.status || snapshotStatusForCall(call, null, atMs)),
      snapshotKind: frozenSnapshot ? 'frozen' : (snapshot?.status || 'none'),
      registrationReady: Boolean(call.callKey && snapshot),
      frozenCandidateCount: frozenSnapshot?.candidates?.length || 0,
      candidateCount: snapshot?.candidates?.length || 0,
      topConfidence: Number(snapshot?.candidates?.[0]?.confidence || 0),
      topCandidate: snapshot?.candidates?.[0] ? decorateCandidate(snapshot.candidates[0], currentIdentity) : null,
      match: candidateMatch(candidate),
      binding: binding ? { ...cloneJson(binding), registrationState: registrationState(binding) } : null,
      outcome: callState.outcomes.byCall?.[call.callKey] ? cloneJson(callState.outcomes.byCall[call.callKey]) : null
    };
  });
  const requestedKey = canonicalCallKey(payload.focusCallKey || '');
  let focusCall = requestedKey ? calls.find(call => call.callKey === requestedKey) || null : calls[0] || null;
  const previewAlreadyStored = Boolean(callState.preview?.callKey && calls.some(call => call.callKey === callState.preview.callKey));
  const preview = !previewAlreadyStored && callState.preview && Number(callState.preview.startedAtMs || 0) > Number(focusCall?.startedAtMs || 0)
    ? { ...cloneJson(callState.preview), snapshotStatus: 'live', snapshotKind: 'live', registrationReady: true, binding: null, bindable: false, match: candidateMatch(null) }
    : null;
  if (!requestedKey && preview) focusCall = preview;
  const focusFrozenSnapshot = focusCall?.callKey ? getSnapshot(callState.snapshots, focusCall.callKey) : null;
  const focusSnapshot = focusCall?.callKey
    ? (focusFrozenSnapshot || liveSnapshotForCall(focusCall, callState.evidence, atMs))
    : null;
  const focusCandidates = (focusSnapshot?.candidates || []).map(candidate => decorateCandidate(candidate, currentIdentity));
  const currentCaseCandidate = focusCandidates.find(candidate => candidate.isCurrentCase) || null;

  const today = localDateKey(atMs);
  const dayCalls = calls.filter(call => String(call.date || localDateKey(call.startedAtMs)) === today).map(call => ({
    callKey: call.callKey,
    usersideCallId: call.usersideCallId,
    pbxRecordId: call.pbxRecordId,
    date: call.date,
    time: call.time,
    startedAtMs: call.startedAtMs,
    duration: call.duration,
    durationSeconds: call.durationSeconds,
    callerMasked: call.callerMasked,
    agentExtension: call.agentExtension,
    registrationStatus: registrationState(call.binding) === 'registered' ? 'registered' : (call.ongoing === true ? 'ongoing' : registrationState(call.binding)),
    registrationSource: call.binding?.registrationStatus?.source || 'unknown',
    snapshotStatus: call.snapshotStatus,
    snapshotKind: call.snapshotKind || call.snapshotStatus,
    frozenCandidateCount: call.frozenCandidateCount,
    candidateCount: call.candidateCount || 0,
    topConfidence: call.topConfidence,
    topCandidateLabel: call.topCandidate?.label || call.topCandidate?.fullName || call.topCandidate?.login || '',
    direction: call.direction || '',
    caseId: call.binding?.identity?.caseId || '',
    caseLabel: call.binding?.caseLabel || '',
    customerId: call.binding?.identity?.customerId || '',
    outcome: call.outcome ? cloneJson(call.outcome) : null
  }));
  if (preview && String(preview.date || localDateKey(preview.startedAtMs)) === today) {
    dayCalls.unshift({
      callKey: '', usersideCallId: preview.usersideCallId || '', date: preview.date || today, time: preview.time || '',
      startedAtMs: preview.startedAtMs, duration: '', durationSeconds: 0, callerMasked: preview.callerMasked || '',
      agentExtension: preview.agentExtension || '', registrationStatus: 'ongoing', registrationSource: 'unknown',
      snapshotStatus: 'none', frozenCandidateCount: 0, topConfidence: 0, caseId: '', caseLabel: '', customerId: ''
    });
  }

  const available = calls.filter(call => !call.binding || overlap(call.binding.identity || {}, currentIdentity));
  const takenCalls = calls.filter(call => call.binding && !overlap(call.binding.identity || {}, currentIdentity)).map(call => ({
    callKey: call.callKey,
    caseLabel: call.binding.caseLabel || call.binding.identity?.caseId || '',
    customerId: call.binding.identity?.customerId || '',
    registrationStatus: registrationState(call.binding),
    time: call.time,
    callerMasked: call.callerMasked
  }));
  return {
    schema: CALL_MODULE_SCHEMA,
    caseId,
    customerId: currentIdentity.customerId,
    updatedAt: callState.updatedAt,
    timelineVisits: callState.evidence.events.filter(event => event.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT).length,
    timelineSearches: callState.evidence.events.filter(event => event.type.startsWith('SEARCH_')).length,
    focusCall: focusCall ? cloneJson(focusCall) : null,
    focusSnapshot: focusSnapshot ? cloneJson(focusSnapshot) : null,
    focusCandidates,
    currentCaseCandidate,
    dayCalls,
    calls: available,
    takenCalls,
    assignmentLog: cloneJson(callState.bindings.assignmentLog || []),
    refresh: payload.refresh ? cloneJson(payload.refresh) : null
  };
}

function bind(state, payload = {}, sender = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const nowIso = String(options.nowIso || new Date(atMs).toISOString());
  const callState = ensureCallModuleState(state, { atMs, nowIso });
  if (!callState.config.enabled) throw new Error('CALL module is disabled');
  const callKey = canonicalCallKey(payload.callKey || payload.pbxCallKey || '');
  const call = getCall(callState.calls, callKey);
  if (!call || !['completed', 'ongoing'].includes(String(call.status || ''))) {
    throw new Error('Звонок отсутствует в актуальном UserSide call_list');
  }
  const frozenSnapshot = getSnapshot(callState.snapshots, callKey);
  const snapshot = frozenSnapshot || liveSnapshotForCall(call, callState.evidence, atMs);
  if (!snapshot) throw new Error('Evidence для звонка ещё не доступен');
  const caseId = String(payload.caseId || payload.candidateIdentity?.caseId || '');
  const caseData = state.cases?.[caseId] || {};
  const identity = resolveIdentityFromCases(state, {
    ...identityForCase(caseId, caseData),
    ...(payload.candidateIdentity || {}),
    customerId: payload.customerId || payload.candidateIdentity?.customerId || factValue(caseData.identity?.customerId) || ''
  });
  const candidate = candidateForIdentity(snapshot, identity);
  const override = payload.operatorOverride === true && payload.overrideAcknowledged === true;
  if (!candidate && !override) throw new Error('Выбранный абонент отсутствует в frozen snapshot');
  if (candidate?.hardConflict && !override) throw new Error('Hard identity conflict требует явного подтверждения');
  if (candidate && Number(candidate.confidence || 0) < 80 && !override) {
    throw new Error('Кандидат недостаточно подтверждён; требуется явное подтверждение оператора');
  }
  const result = putBinding(callState.bindings, {
    callKey,
    identity,
    caseLabel: identity.fullName || identity.login || identity.caseId,
    snapshotFrozenAt: frozenSnapshot?.frozenAt || '',
    liveBoundAt: frozenSnapshot ? '' : nowIso,
    candidateConfidence: Number(candidate?.confidence || 0),
    mode: override ? 'operator-override' : (frozenSnapshot ? 'snapshot-candidate' : 'live-candidate'),
    operatorOverride: override ? {
      acknowledged: true,
      acknowledgedAt: nowIso,
      byTabId: sender?.tab?.id == null ? null : Number(sender.tab.id),
      hardConflict: Boolean(candidate?.hardConflict),
      candidate: candidate ? cloneJson(candidate) : null
    } : null
  }, { nowIso });
  appendAssignment(callState.bindings, {
    callKey,
    usersideCallId: call.usersideCallId,
    time: call.time,
    date: call.date,
    callerMasked: call.callerMasked,
    duration: call.duration,
    caseId: identity.caseId,
    caseLabel: result.binding.caseLabel,
    customerId: identity.customerId,
    contract: identity.contract,
    registrationStatus: 'unknown',
    mode: result.binding.mode,
    at: nowIso
  });
  callState.updatedAt = nowIso;
  return { accepted: true, alreadyBound: result.existing, binding: cloneJson(result.binding), call: cloneJson(call), candidate: candidate ? cloneJson(candidate) : null, match: candidateMatch(candidate) };
}

export function createCallModule(dependencies = {}) {
  const nowMs = typeof dependencies.nowMs === 'function' ? dependencies.nowMs : Date.now;
  const nowIso = typeof dependencies.nowIso === 'function' ? dependencies.nowIso : () => new Date(nowMs()).toISOString();
  let enabled = true;
  let opened = false;
  let destroyed = false;
  return Object.freeze({
    enable() { if (destroyed) return false; enabled = true; return true; },
    disable() { enabled = false; opened = false; return true; },
    open() { if (destroyed || !enabled) return false; opened = true; return true; },
    destroy() { enabled = false; opened = false; destroyed = true; },
    status() { return { enabled, opened, destroyed }; },
    ensure(state) {
      const callState = ensureCallModuleState(state, { atMs: nowMs(), nowIso: nowIso() });
      if (callState.config.enabled === false) enabled = false;
      callState.config.enabled = enabled && !destroyed;
      return callState;
    },
    recordSearch(state, payload, sender) { if (!enabled || destroyed) return { accepted: false, reason: 'call-disabled' }; return recordSearch(state, payload, sender, { atMs: nowMs(), nowIso: nowIso() }); },
    recordVisit(state, context, sender, options) { if (!enabled || destroyed) return { accepted: false, added: false, reason: 'call-disabled' }; return recordVisit(state, context, sender, { ...options, atMs: nowMs(), nowIso: nowIso() }); },
    recordTaskOutcome(state, payload, sender) { if (!enabled || destroyed) return { accepted: false, reason: 'call-disabled' }; return recordTaskOutcome(state, payload, sender, { atMs: nowMs(), nowIso: nowIso() }); },
    recordPbxRealtimeHints(state, rows, observedAt) { if (!enabled || destroyed) return { accepted: false, stored: 0, reason: 'call-disabled' }; return recordPbxRealtimeHints(state, rows, observedAt, { atMs: nowMs(), nowIso: nowIso() }); },
    ingestUsersideCalls(state, rows, preview) { if (!enabled || destroyed) return { accepted: false, stored: 0 }; return ingestUsersideCalls(state, rows, preview, { atMs: nowMs(), nowIso: nowIso() }); },
    query(state, payload) { if (!enabled || destroyed) throw new Error('CALL module is disabled'); opened = true; return query(state, payload, { atMs: nowMs(), nowIso: nowIso() }); },
    bind(state, payload, sender) { if (!enabled || destroyed) throw new Error('CALL module is disabled'); return bind(state, payload, sender, { atMs: nowMs(), nowIso: nowIso() }); },
    caseAudit(state, caseId, caseData) { if (!enabled || destroyed) throw new Error('CALL module is disabled'); const callState = ensureCallModuleState(state, { atMs: nowMs(), nowIso: nowIso() }); return buildCaseCallAudit(callState, caseId, caseData, { nowIso: nowIso() }); },
    globalAudit(state) { if (!enabled || destroyed) throw new Error('CALL module is disabled'); const callState = ensureCallModuleState(state, { atMs: nowMs(), nowIso: nowIso() }); return buildGlobalCallAudit(callState, { nowIso: nowIso() }); }
  });
}

export const __test = Object.freeze({
  identityForCase,
  resolveIdentityFromCases,
  recordSearch,
  recordVisit,
  recordPbxRealtimeHints,
  recordTaskOutcome,
  ingestUsersideCalls,
  query,
  bind,
  registrationState,
  liveSnapshotForCall,
  effectiveSnapshotForCall,
  overlap
});
