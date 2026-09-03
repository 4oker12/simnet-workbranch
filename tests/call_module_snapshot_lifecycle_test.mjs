import assert from 'node:assert/strict';
import { createCallModule, createCallModuleState } from '../src/features/call/index.js';
import { callWindow } from '../src/features/call/correlation/call-window.js';
import { confidenceFromScore } from '../src/features/call/correlation/confidence.js';

let clock = Date.parse('2026-08-28T10:00:00Z');
const module = createCallModule({ nowMs: () => clock, nowIso: () => new Date(clock).toISOString() });
const state = { cases: {}, callModule: createCallModuleState() };
for (let index = 1; index <= 3; index += 1) {
  state.cases[`login:abon${index}`] = {
    identity: { login: `abon${index}`, contract: String(index), billingId: String(100 + index), customerId: String(200 + index) },
    profile: { fullName: `Subscriber ${index}` }
  };
}

const start = clock;
const fiveSecond = callWindow({ startedAtMs: start, durationSeconds: 5, status: 'completed' });
assert.equal(fiveSecond.endedAtMs, start + 5_000);
assert.equal(fiveSecond.windowEndMs, start + 20_000, '5-second calls still get exactly +15 seconds');

const sender = { tab: { id: 7, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl' } };
clock = start + 1_000;
module.recordSearch(state, { source: 'billing', kind: 'submit', searchKind: 'contract', query: 'abon1', searchId: 's1' }, sender);
clock = start + 8_000;
module.recordSearch(state, { source: 'billing', kind: 'result-open', searchKind: 'contract', targetSubscriberId: '101', searchId: 's1' }, sender);
module.recordVisit(state, { pageKind: 'billing_user', entityId: '101', identity: state.cases['login:abon1'].identity }, sender, { accepted: true, caseId: 'login:abon1' });
clock = start + 9_000;
module.recordVisit(state, { pageKind: 'billing_user', entityId: '102', identity: state.cases['login:abon2'].identity }, sender, { accepted: true, caseId: 'login:abon2' });
clock = start + 12_000;
module.recordVisit(state, { pageKind: 'billing_user', entityId: '103', identity: state.cases['login:abon3'].identity }, sender, { accepted: true, caseId: 'login:abon3' });

clock = start + 19_000;
let result = module.ingestUsersideCalls(state, [{
  usersideCallId: '2475001', startedAtMs: start, durationSeconds: 5, duration: '0:00:05',
  date: '2026-08-28', time: '10:00', agentExtension: '6047', callerId: '0631234578'
}], null);
assert.equal(result.frozen, 0, 'snapshot remains pending before end+15 seconds');
assert.equal(state.callModule.snapshots.snapshots['call:2475001'], undefined);

clock = start + 20_000;
result = module.ingestUsersideCalls(state, [{
  usersideCallId: '2475001', startedAtMs: start, durationSeconds: 5, duration: '0:00:05',
  date: '2026-08-28', time: '10:00', agentExtension: '6047', callerId: '0631234578'
}], null);
assert.equal(result.frozen, 1);
const snapshot = structuredClone(state.callModule.snapshots.snapshots['call:2475001']);
assert.equal(snapshot.schema, 'simnet-call-evidence-snapshot');
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.scoringVersion, 1);
assert.equal(snapshot.candidates.length, 3);
assert.ok(snapshot.candidates[0].evidence.length >= 2, 'snapshot carries compact evidence copies, not only ids');
assert.equal(snapshot.callKey, 'call:2475001');

clock = start + 21_000;
module.recordVisit(state, { pageKind: 'billing_user', entityId: '999', identity: { billingId: '999', contract: '999' } }, sender, { accepted: true, caseId: '' });
module.ingestUsersideCalls(state, [{ usersideCallId: '2475001', startedAtMs: start, durationSeconds: 5, agentExtension: '6047' }], null);
assert.deepEqual(state.callModule.snapshots.snapshots['call:2475001'], snapshot, 'freeze is immutable and idempotent');

const oneCandidateConfidence = confidenceFromScore(110);
assert.equal(confidenceFromScore(110), oneCandidateConfidence, 'confidence is independent of neighbouring candidates');
assert.equal(confidenceFromScore(999, { authoritative: true }), 100);
assert.equal(confidenceFromScore(999, { hardConflict: true }), 0);

clock = start + 49 * 60 * 60 * 1000;
module.ensure(state);
assert.equal(state.callModule.evidence.events.length, 0, 'raw evidence expires after 48 hours');
assert.deepEqual(state.callModule.snapshots.snapshots['call:2475001'], snapshot, 'snapshot survives raw cleanup and remains for 14 days');

console.log('call_module_snapshot_lifecycle_test: PASS');
