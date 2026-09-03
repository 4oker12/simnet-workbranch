import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = Date.parse('2026-08-30T08:00:00Z');
const module = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const state = {
  cases: {
    'login:abon12345': {
      identity: {
        customerId: { value: '111' }, billingId: { value: '222' },
        contract: { value: '12345' }, login: { value: 'abon12345' }
      },
      profile: { fullName: { value: 'Тест Абонент' } }
    }
  }
};

const preview = {
  usersideCallId: '900001', callKey: 'call:900001', startedAtMs: now,
  callerId: '0500000000', ongoing: true
};
const started = module.ingestUsersideCalls(state, [], preview);
assert.equal(started.session.active, true);
assert.equal(started.session.callKey, 'call:900001');

now += 20_000;
module.recordSearch(state, { source: 'billing', kind: 'submit', query: 'name=12345', searchKind: 'contract' }, { tab: { id: 1 } });
now += 2_000;
module.recordSearch(state, {
  source: 'billing', kind: 'result-open', query: 'name=12345', searchKind: 'contract',
  identity: { customerId: '111', billingId: '222', contract: '12345', login: 'abon12345', fullName: 'Тест Абонент' }
}, { tab: { id: 1 } });
assert.equal(state.callModule.evidence.events.length, 1);
assert.equal(state.callModule.evidence.events[0].type, 'IDENTIFIED_BY_SEARCH');

now = Date.parse('2026-08-30T08:01:00Z');
const ended = module.ingestUsersideCalls(state, [{
  usersideCallId: '900001', startedAtMs: Date.parse('2026-08-30T08:00:00Z'),
  durationSeconds: 60, duration: '0:01:00', ongoing: false, callerId: '0500000000'
}], null);
assert.equal(ended.sealed, true);
assert.equal(ended.session.active, false);
assert.equal(ended.frozen, 1);
assert.equal(state.callModule.evidence.events.length, 0);

const result = module.query(state, { caseId: 'login:abon12345' });
assert.equal(result.focusCandidates[0].confidence, 80);
assert.equal(result.focusCandidates[0].identity.customerId, '111');
console.log('call_office_live_session_lifecycle_test: PASS');
