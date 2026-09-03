import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';
import { CONFIDENCE } from '../src/features/call/config.js';

const start = Date.parse('2026-08-30T14:00:00Z');
const end = start + 4 * 60_000;

function score(source, identity, targetSubscriberId) {
  const submitTs = start + 50_000;
  const openTs = start + 55_000;
  const searchId = `${source}-search`;
  const events = [{
    id: `${source}-submit`, type: 'SEARCH_SUBMIT', source, ts: submitTs, tabId: 1,
    searchId, query: source === 'billing' ? 'name=123456' : '123456', searchKind: 'contract', identity: {}
  }, {
    id: `${source}-open`, type: 'SEARCH_RESULT_OPEN', source, ts: openTs, tabId: 1,
    searchId, parentSearchTs: submitTs, query: '123456', searchKind: 'contract',
    targetSubscriberId, identity
  }];
  return scoreSnapshotCandidates(
    { startedAtMs: start, endedAtMs: end },
    events,
    { callStartMs: start, callEndMs: end }
  )[0];
}

const billing = score('billing', { billingId: '12345', contract: '123456', login: 'abon123456' }, '12345');
const userside = score('userside', { customerId: '54321', contract: '123456', login: 'abon123456' }, '54321');

// Production: Billing and UserSide search→open are equal strength (early search band).
assert.equal(billing.confidence, CONFIDENCE.EARLY_SEARCH);
assert.equal(userside.confidence, CONFIDENCE.EARLY_SEARCH);
assert.equal(billing.confidence, userside.confidence);
assert.ok(billing.reasons.some(r => /поиск/i.test(r) || /search/i.test(r) || /карточка/i.test(r)));
assert.ok(userside.reasons.some(r => /поиск/i.test(r) || /search/i.test(r) || /карточка/i.test(r)));
console.log('PASS call_early_search_source_parity_test');
