import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';
import { CONFIDENCE } from '../src/features/call/config.js';

const start = Date.parse('2026-08-30T12:00:00Z');
const end = start + 5 * 60_000;
const identity = {
  caseId: 'login:abon555', billingId: '555', customerId: '5550',
  contract: '555', login: 'abon555', fullName: 'ONU Test'
};

const candidate = scoreSnapshotCandidates(
  { startedAtMs: start, endedAtMs: end },
  [{
    id: 'open', type: 'SEARCH_RESULT_OPEN', source: 'billing', ts: start + 10_000,
    tabId: 1, searchId: 's1', query: '555', searchKind: 'contract',
    targetSubscriberId: '555', identity
  }, {
    id: 'onu1', type: 'SUBSCRIBER_VISIT', source: 'billing', ts: start + 30_000,
    tabId: 1, pageType: 'billing_onu_poll', pageInstanceId: 'onu1',
    pageInstanceStartedAtMs: start + 29_000, identity
  }],
  { callStartMs: start, callEndMs: end }
)[0];

assert.equal(candidate.confidence, CONFIDENCE.EARLY_SEARCH_CONFIRMED,
  'early search + ONU/OLT tech action → confirmed band');
assert.ok(candidate.reasons.some(r => /ONU|OLT|опрош/i.test(r)));
console.log('PASS call_onu_poll_weight_test');
