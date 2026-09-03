import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';
import { CONFIDENCE } from '../src/features/call/config.js';

const start = Date.parse('2026-08-30T00:00:00Z');
const end = start + 8 * 60_000;

function opened(id, ts, tabId, billingId, customerId, contract) {
  return {
    id: `open-${id}`,
    type: 'SEARCH_RESULT_OPEN',
    source: 'billing',
    ts,
    tabId,
    searchId: id,
    parentSearchTs: ts - 2_000,
    query: `name=${contract}`,
    searchKind: 'contract',
    targetSubscriberId: billingId,
    identity: {
      caseId: `login:abon${contract}`,
      billingId, customerId, contract,
      login: `abon${contract}`,
      fullName: `Абонент ${contract}`
    }
  };
}

const firstOpenTs = start + 50_000;
const secondOpenTs = start + 315_000;
const scored = scoreSnapshotCandidates(
  { startedAtMs: start, endedAtMs: end },
  [
    opened('first', firstOpenTs, 1, '11111', '101', '111111'),
    opened('second', secondOpenTs, 2, '22222', '202', '222222')
  ],
  { callStartMs: start, callEndMs: end }
);

const first = scored.find(item => item.identity.billingId === '11111');
const second = scored.find(item => item.identity.billingId === '22222');
assert.ok(first && second);
assert.equal(first.confidence, CONFIDENCE.EARLY_SEARCH, 'early SEARCH→OPEN is primary');
assert.equal(second.confidence, CONFIDENCE.LATE_SEARCH, 'later SEARCH→OPEN lags visibly');
assert.ok(first.confidence - second.confidence >= 40, 'no near-ties between primary and late');
console.log('PASS call_late_competing_search_decay_test');
