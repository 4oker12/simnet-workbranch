import assert from 'node:assert/strict';
import {
  appendVisit,
  pruneTimeline,
  scoreCallAgainstTimeline,
  correlationLevel,
  subscriberKeyFromContext,
  DEDUPE_WINDOW_MS
} from '../src/features/call/visit-timeline.js';

const base = Date.parse('2026-08-26T17:00:00');

// Dedupe same page within window
let tl = { visits: [] };
let r = appendVisit(tl, { source: 'userside', subscriberId: '507126', pageType: 'userside_customer', ts: base }, base);
assert.equal(r.added, true);
r = appendVisit({ visits: r.visits }, { source: 'userside', subscriberId: '507126', pageType: 'userside_customer', ts: base + 500 }, base + 500);
assert.equal(r.added, false);
assert.equal(r.visits.length, 1);

// Scenario from requirements
const visits = [
  { ts: base - 120000, source: 'userside', subscriberId: '111111', pageType: 'userside_customer', contractId: '111111' },
  { ts: base + 8000, source: 'userside', subscriberId: '507126', pageType: 'userside_customer', contractId: '507126' },
  { ts: base + 25000, source: 'billing', subscriberId: '507126', pageType: 'billing_user', contractId: '507126' },
  { ts: base + 260000, source: 'userside', subscriberId: '203949', pageType: 'userside_customer', contractId: '203949' },
  { ts: base + 300000, source: 'userside', subscriberId: '507126', pageType: 'userside_customer', contractId: '507126' }
];

const call = {
  callKey: 'pbx:1.2',
  startedAtMs: base + 5 * 60 * 1000, // end ~17:05
  durationSeconds: 5 * 60,
  contract: '507126'
};

const scored = scoreCallAgainstTimeline(call, visits);
assert.ok(scored.score > 0, 'expected positive score');
assert.equal(scored.bestSubscriberId, '507126');
assert.ok(scored.reasons.includes('first-new') || scored.reasons.includes('userside+billing') || scored.reasons.includes('contract-match'));
assert.equal(correlationLevel(scored.score, 'none'), 'strong');

const key = subscriberKeyFromContext({
  pageKind: 'userside_customer',
  entityId: '507126',
  identity: { customerId: { value: '507126' } }
});
assert.equal(key.subscriberId, '507126');
assert.equal(key.source, 'userside');

console.log('visit_timeline_unit_test: PASS');
