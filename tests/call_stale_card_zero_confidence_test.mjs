import assert from 'node:assert/strict';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';

const start = 1_788_078_000_000;
const call = { startedAtMs: start, endedAtMs: start + 600_000 };
const id = { billingId: '51034', login: 'abon171', contract: '171' };

// A card merely present/visited during the call is not enough anymore.
let candidates = scoreSnapshotCandidates(call, [{
  type: 'SUBSCRIBER_VISIT', source: 'billing', ts: start + 1000, pageType: 'billing_user', identity: id
}]);
assert.equal(candidates.length, 0);

// Deliberate technical work is weak evidence without a search.
candidates = scoreSnapshotCandidates(call, [{
  type: 'TECH_ACTION', source: 'billing', ts: start + 60_000, action: 'billing_technical', identity: id
}]);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].confidence, 15);

// Long active work is stronger than a technical touch, but still far below search identification.
candidates = scoreSnapshotCandidates(call, [{
  type: 'ATTENTION_INTERVAL', source: 'billing', ts: start + 400_000,
  startedAtMs: start + 20_000, endedAtMs: start + 400_000, identity: id
}]);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].confidence, 20);
console.log('PASS call_stale_card_zero_confidence_test');
