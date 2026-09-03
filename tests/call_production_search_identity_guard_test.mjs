import assert from 'node:assert/strict';
import { createEvidenceState, openEvidenceSession, appendEvidenceEvent } from '../src/features/call/evidence/repository.js';
import { scoreSnapshotCandidates } from '../src/features/call/correlation/scorer.js';

const start = 1_788_078_000_000;
const buffer = createEvidenceState();
openEvidenceSession(buffer, 'call:test', new Date(start).toISOString());

// Query-only/resolved-only evidence must never create anonymous 80% candidate.
const bad = appendEvidenceEvent(buffer, {
  type: 'IDENTIFIED_BY_SEARCH', source: 'billing', ts: start + 10_000, query: '171', identity: {}
}, { requireActiveCall: true, nowMs: start + 10_000 });
assert.equal(bad.accepted, false);
assert.equal(buffer.events.length, 0);

const good = appendEvidenceEvent(buffer, {
  type: 'IDENTIFIED_BY_SEARCH', source: 'billing', ts: start + 20_000, query: '171',
  identity: { billingId: '51034' }
}, { requireActiveCall: true, nowMs: start + 20_000 });
assert.equal(good.accepted, true);
assert.equal(buffer.events.length, 1);

let candidates = scoreSnapshotCandidates({ startedAtMs: start, endedAtMs: start + 120_000 }, buffer.events);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].identity.billingId, '51034');
assert.equal(candidates[0].confidence, 80);

appendEvidenceEvent(buffer, {
  type: 'TECH_ACTION', source: 'billing', ts: start + 30_000, action: 'billing_technical',
  identity: { billingId: '51034' }
}, { requireActiveCall: true, nowMs: start + 30_000 });
candidates = scoreSnapshotCandidates({ startedAtMs: start, endedAtMs: start + 120_000 }, buffer.events);
assert.equal(candidates[0].confidence, 88);
console.log('PASS call_production_search_identity_guard_test');
