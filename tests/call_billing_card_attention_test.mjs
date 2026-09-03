import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 1_990_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const caseId = 'login:abon245349';
const state = { cases: { [caseId]: { identity: { caseId, login: 'abon245349', contract: '245349', billingId: '24534', customerId: '19556' }, profile: { fullName: 'Дорош Тарас' } } } };
mod.ensure(state);
const start = now;
const sender = { tab: { id: 17, windowId: 1 } };
const id = { login: 'abon245349', contract: '245349', billingId: '24534', customerId: '19556' };

// Fresh main Billing card opening.
now = start + 10_000;
mod.recordVisit(state, { pageKind: 'billing_user', entityId: '24534', identity: id, meta: { pageInstanceId: 'main-1', pageInstanceStartedAt: start + 9_900 } }, sender, { accepted: true, caseId });
// Technical pages must not count as Billing card opens/returns.
now = start + 20_000;
mod.recordVisit(state, { pageKind: 'billing_onu_poll', entityId: '24534', identity: id, meta: { pageInstanceId: 'poll-1', pageInstanceStartedAt: start + 19_900 } }, sender, { accepted: true, caseId });
now = start + 30_000;
mod.recordVisit(state, { pageKind: 'billing_juniper', entityId: '24534', identity: id, meta: { pageInstanceId: 'jun-1', pageInstanceStartedAt: start + 29_900 } }, sender, { accepted: true, caseId });
// Actual return to the already-open main Billing tab: same page instance/start time.
now = start + 40_000;
mod.recordVisit(state, { pageKind: 'billing_user', entityId: '24534', identity: id, meta: { pageInstanceId: 'main-1', pageInstanceStartedAt: start + 9_900 } }, sender, { accepted: true, caseId });

now = start + 90_000;
const replay = mod.previewRange(state, { caseId, startAtMs: start, endAtMs: start + 60_000 });
const c = replay.candidates.find(x => x.billingId === '24534');
assert.ok(c, 'candidate should exist');
const ch = c.candidateEvidenceDetails.checks;
assert.equal(ch.billingCardOpened.yes, true);
assert.deepEqual(ch.billingCardOpened.times, [start + 9_900], 'only main billing document open counts');
assert.equal(ch.billingCardOpened.observedTimes.length, 2, 'technical stat.pl pages are excluded from card observations');
assert.equal(ch.tabReturns.billing.count, 1, 'return to same main Billing tab must be counted');
assert.deepEqual(ch.tabReturns.billing.times, [start + 40_000]);
assert.ok(c.reasons.includes('technical-work'), 'technical navigation should remain a small supporting signal');
assert.ok(c.rawScore < 200, 'two technical pages must not inflate the candidate like repeated main-card opens');
console.log('PASS call_billing_card_attention_test');
