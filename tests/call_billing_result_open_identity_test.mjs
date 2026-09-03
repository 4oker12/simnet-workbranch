import assert from 'node:assert/strict';
import { __test } from '../src/features/call/index.js';

const start = 1_788_078_000_000;
const state = {};
__test.startTestEvidenceSession(state, { startedAtMs: start }, { atMs: start, nowIso: new Date(start).toISOString() });

__test.recordSearch(state, { source: 'billing', kind: 'submit', query: '171', searchKind: 'contract' }, { tab: { id: 7 } }, { atMs: start + 1000, nowIso: new Date(start+1000).toISOString() });
const opened = __test.recordSearch(state, { source: 'billing', kind: 'result-open', query: '171', searchKind: 'contract', targetSubscriberId: '51034' }, { tab: { id: 7 } }, { atMs: start + 2000, nowIso: new Date(start+2000).toISOString() });
assert.equal(opened.accepted, true);
assert.equal(opened.added, true);
const ev = state.callModule.evidence.events[0];
assert.equal(ev.type, 'IDENTIFIED_BY_SEARCH');
assert.equal(ev.identity.billingId, '51034');
assert.equal(ev.query, '171');
console.log('PASS call_billing_result_open_identity_test');
