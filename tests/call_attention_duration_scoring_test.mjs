import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';
import { CONFIDENCE } from '../src/features/call/config.js';

const start = Date.parse('2026-08-30T10:00:00Z');
const end = start + 15 * 60_000;
const identity = {
  caseId: 'login:abon123456', customerId: '50001', billingId: '40001',
  contract: '123456', login: 'abon123456', fullName: 'Тест Абонент'
};

const candidate = scoreSnapshotCandidates(
  { startedAtMs: start, endedAtMs: end },
  [{
    id: 'opened', type: 'SEARCH_RESULT_OPEN', source: 'billing', ts: start + 45_000,
    tabId: 1, searchId: 's1', query: 'name=123456', searchKind: 'contract',
    targetSubscriberId: '40001', identity
  }, {
    id: 'att1', type: 'ATTENTION_INTERVAL', source: 'billing', ts: start + 8 * 60_000,
    tabId: 1, pageType: 'billing_user', identity,
    startedAtMs: start + 45_000, endedAtMs: start + 8 * 60_000,
    durationMs: 7 * 60_000 + 15_000
  }, {
    id: 'att2', type: 'ATTENTION_INTERVAL', source: 'userside', ts: end,
    tabId: 2, pageType: 'userside_customer', identity,
    startedAtMs: start + 9 * 60_000, endedAtMs: end,
    durationMs: 6 * 60_000
  }],
  { callStartMs: start, callEndMs: end }
)[0];

assert.equal(candidate.confidence, CONFIDENCE.EARLY_SEARCH_CONFIRMED,
  'early search + long attention → confirmed band');
assert.ok(candidate.attention.ratio >= 0.55);
assert.ok(candidate.reasons.some(r => /Активная работа/i.test(r)));
console.log('PASS call_attention_duration_scoring_test');
