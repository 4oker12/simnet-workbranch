import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 2_010_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const start = now;
const activeCase = 'login:abon111111';
const callerCase = 'login:abon222222';
const state = { cases: {
  [activeCase]: { identity: { caseId: activeCase, login: 'abon111111', contract: '111111', billingId: '11111', customerId: '111' }, profile: { fullName: 'Старый открытый абонент' } },
  [callerCase]: { identity: { caseId: callerCase, login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222' }, profile: { fullName: 'Найденный звонящий' } }
} };
mod.ensure(state);

// A card that was already open before the test call: repeated focus/returns must stay weak.
const oldInstanceStart = start - 120_000;
for (const offset of [5_000, 15_000, 25_000, 35_000, 45_000]) {
  now = start + offset;
  mod.recordVisit(state, {
    pageKind: 'billing_user', entityId: '11111',
    identity: { login: 'abon111111', contract: '111111', billingId: '11111', customerId: '111' },
    meta: { pageInstanceId: 'old-billing', pageInstanceStartedAt: oldInstanceStart }
  }, { tab: { id: 1, windowId: 1 } }, {
    accepted: true, caseId: activeCase,
    // Legacy cross-tab claims must NOT become CALL handoffs.
    handoff: { purpose: 'userside-navigation', token: 'legacy-focus-token' }
  });
}

// Subscriber identification: operator searches the data given by caller and opens INFO/card.
now = start + 55_000;
const submit = mod.recordSearch(state, {
  source: 'billing', kind: 'submit', searchKind: 'contract', query: 'name=222222'
}, { tab: { id: 2, windowId: 1 } });
assert.equal(submit.added, true);

now = start + 58_000;
const result = mod.recordSearch(state, {
  source: 'billing', kind: 'result-open', searchKind: 'contract', query: 'name=222222',
  searchId: submit.searchId, targetSubscriberId: '22222',
  identity: { login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222', fullName: 'Найденный звонящий' }
}, { tab: { id: 2, windowId: 1 } });
assert.equal(result.added, true);

now = start + 59_000;
mod.recordVisit(state, {
  pageKind: 'billing_user', entityId: '22222',
  identity: { login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222' },
  meta: { pageInstanceId: 'caller-billing', pageInstanceStartedAt: start + 58_800 }
}, { tab: { id: 2, windowId: 1 } }, { accepted: true, caseId: callerCase });

// One real Billing -> UserSide handoff.
now = start + 62_000;
mod.recordNavigation(state, {
  phase: 'intent', source: 'billing', target: 'userside', caseId: callerCase,
  identity: { login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222' }
}, { tab: { id: 2, windowId: 1 } });
now = start + 63_000;
mod.recordNavigation(state, {
  phase: 'target-open', source: 'userside', target: 'userside', caseId: callerCase,
  identity: { login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222' },
  targetCustomerId: '222', pageType: 'userside_customer'
}, { tab: { id: 3, windowId: 1 } });

// Later tab returns are visits only. Repeated legacy handoff token must not create HANDOFF evidence.
now = start + 75_000;
mod.recordVisit(state, {
  pageKind: 'billing_user', entityId: '22222',
  identity: { login: 'abon222222', contract: '222222', billingId: '22222', customerId: '222' },
  meta: { pageInstanceId: 'caller-billing', pageInstanceStartedAt: start + 58_800 }
}, { tab: { id: 2, windowId: 1 } }, {
  accepted: true, caseId: callerCase,
  handoff: { purpose: 'userside-navigation', token: 'legacy-caller-focus' }
});

now = start + 90_000;
const replay = mod.previewRange(state, { caseId: '', startAtMs: start, endAtMs: start + 85_000 });
const caller = replay.candidates.find(c => c.billingId === '22222');
const old = replay.candidates.find(c => c.billingId === '11111');
assert.ok(caller && old);
assert.equal(replay.winner.billingId, '22222', 'search -> INFO must dominate passive tab attention');
assert.ok(caller.reasons.includes('search-result-opened'));
assert.ok(caller.rawScore >= 220, 'linked Billing search -> INFO is strong identifying evidence');
assert.ok(old.rawScore < 50, 'many returns to an already-open card must remain weak');
assert.equal(caller.candidateEvidenceDetails.checks.handoffConfirmed.times.length, 1, 'handoff is counted once');
assert.equal(caller.candidateEvidenceDetails.checks.tabReturns.billing.count, 1, 'same Billing tab return is a Billing return');
const handoffs = replay.events.filter(e => e.type === 'HANDOFF');
assert.equal(handoffs.length, 1, 'legacy tab navigation must not emit repeated CALL HANDOFF evidence');
console.log('PASS call_identification_evidence_priority_test');
