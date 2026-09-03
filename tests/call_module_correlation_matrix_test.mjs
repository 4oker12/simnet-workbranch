import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';
import { createEvidenceState, appendEvidenceEvent } from '../src/features/call/evidence/repository.js';
import { __test as callTest, createCallModuleState } from '../src/features/call/index.js';

const start = Date.parse('2026-08-28T13:00:00Z');
const ended = start + 5_000;
const submit = {
  id: 'submit', type: 'SEARCH_SUBMIT', source: 'billing', ts: start + 1_000,
  tabId: 10, searchId: 'chain', query: 'abon1', searchKind: 'contract', identity: {}
};
const plus8 = {
  id: 'plus8', type: 'SEARCH_RESULT_OPEN', source: 'billing', ts: ended + 8_000,
  tabId: 10, searchId: 'chain', parentSearchTs: submit.ts, targetSubscriberId: '101',
  identity: { billingId: '101', contract: '1', caseId: 'login:abon1' }
};
const plus16 = {
  id: 'plus16', type: 'SEARCH_RESULT_OPEN', source: 'billing', ts: ended + 16_000,
  tabId: 10, searchId: 'late', parentSearchTs: submit.ts, targetSubscriberId: '102',
  identity: { billingId: '102', contract: '2', caseId: 'login:abon2' }
};
let candidates = scoreSnapshotCandidates({}, [submit, plus8, plus16], {
  windowStartMs: start, endedAtMs: ended, windowEndMs: ended + 15_000
});
assert.equal(candidates.length, 1);
assert.equal(candidates[0].identity.caseId, 'login:abon1', 'RESULT_OPEN at end+8s is included');
assert.ok(candidates[0].reasons.includes('search-result-opened'));

const crossSource = scoreSnapshotCandidates({}, [
  { ...submit, source: 'userside', searchId: 'cross' },
  {
    id: 'visit', type: 'SUBSCRIBER_VISIT', source: 'billing', ts: start + 2_000,
    tabId: 10, identity: { billingId: '101', contract: '1', caseId: 'login:abon1' }
  }
], { windowStartMs: start, endedAtMs: ended, windowEndMs: ended + 15_000 });
assert.equal(crossSource[0].reasons.includes('search-then-open'), false, 'cross-source submit→visit is not a strong causal chain');

const resolved = scoreSnapshotCandidates({}, [
  { ...submit, source: 'userside', searchId: 'resolved' },
  {
    id: 'resolved', type: 'SEARCH_RESOLVED', source: 'userside', ts: start + 2_000,
    tabId: 10, searchId: 'resolved', parentSearchTs: submit.ts, targetSubscriberId: '201',
    identity: { customerId: '201' }
  }
], { windowStartMs: start, endedAtMs: ended, windowEndMs: ended + 15_000 })[0];
const opened = scoreSnapshotCandidates({}, [
  { ...submit, source: 'userside', searchId: 'opened' },
  {
    id: 'opened', type: 'SEARCH_RESULT_OPEN', source: 'userside', ts: start + 2_000,
    tabId: 10, searchId: 'opened', parentSearchTs: submit.ts, targetSubscriberId: '201',
    identity: { customerId: '201' }
  }
], { windowStartMs: start, endedAtMs: ended, windowEndMs: ended + 15_000 })[0];
assert.ok(resolved.reasons.includes('search-unique-resolved'));
assert.ok(opened.confidence > resolved.confidence, 'actual result-open is stronger than unique autocomplete');

const buffer = createEvidenceState();
const visit = {
  type: 'SUBSCRIBER_VISIT', source: 'billing', ts: start + 1_000, tabId: 1,
  pageType: 'billing_user', identity: { billingId: '36706', contract: '367063' }
};
const first = appendEvidenceEvent(buffer, visit, { nowMs: start + 1_000, nowIso: new Date(start + 1_000).toISOString() });
const originalUpdatedAt = buffer.updatedAt;
const duplicate = appendEvidenceEvent(buffer, { ...visit, ts: start + 2_000 }, { nowMs: start + 2_000, nowIso: new Date(start + 2_000).toISOString() });
assert.equal(first.added, true);
assert.equal(duplicate.added, false);
assert.equal(buffer.events[0].ts, start + 1_000);
assert.equal(buffer.updatedAt, originalUpdatedAt, 'duplicate visit does not move timestamp or updatedAt');
assert.equal(buffer.events[0].identity.billingId, '36706');
assert.equal(buffer.events[0].identity.contract, '367063');

const rejectedState = { cases: {}, callModule: createCallModuleState() };
const rejected = callTest.recordVisit(rejectedState, {
  pageKind: 'billing_user', entityId: '1', identity: { billingId: '1', contract: '10' }
}, { tab: { id: 1 } }, { accepted: false, atMs: start, nowIso: new Date(start).toISOString() });
assert.equal(rejected.added, false);
assert.equal(rejectedState.callModule.evidence.events.length, 0, 'rejected/stale context does not enter global buffer');

console.log('call_module_correlation_matrix_test: PASS');
