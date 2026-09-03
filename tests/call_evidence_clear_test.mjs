import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 2_040_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const state = { cases: {} };
mod.ensure(state);
const start = now;

now += 1000;
mod.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '15862',
  identity: {
    login: { value: 'abon124569', source: 'userside:customer-card-login' },
    contract: { value: '124569', source: 'userside:customer-card-contract' }
  },
  profile: { fullName: { value: 'Акієв Куртеюп', source: 'userside:customer-card-full-name' } },
  meta: { pageInstanceId: 'us-clear', pageInstanceStartedAt: now - 50 }
}, { tab: { id: 3, windowId: 1 } }, { accepted: true });
assert.equal(state.callModule.evidence.events.length, 1);

const result = mod.clearEvidence(state);
assert.equal(result.accepted, true);
assert.equal(result.removed, 1);
assert.equal(state.callModule.evidence.events.length, 0);
assert.equal(state.callModule.navigationEvidence.pending.length, 0);
assert.equal(state.callModule.realtimeHints.hints.length, 0);

now += 1000;
const replay = mod.previewRange(state, { caseId: '', startAtMs: start, endAtMs: now });
assert.equal(replay.eventCount, 0);
assert.equal(replay.candidates.length, 0);
console.log('PASS call_evidence_clear_test');
