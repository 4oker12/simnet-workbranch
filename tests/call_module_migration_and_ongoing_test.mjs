import assert from 'node:assert/strict';
import { createCallModule, ensureCallModuleState } from '../src/features/call/index.js';
import { parseUsersideCallListHtml } from '../src/features/call/userside-call-list-bridge.js';

const now = Date.parse('2026-08-28T12:00:00Z');
const state = {
  cases: {
    'login:abon367063': {
      identity: { login: 'abon367063', contract: '367063', billingId: '36706', customerId: '501' },
      profile: { fullName: 'Migration Subscriber' },
      telephony: { callBindings: [{ callKey: 'pbx:1787856966.210849', recordId: '1787856966.210849' }] }
    }
  },
  operatorVisitTimeline: {
    visits: [{ ts: now - 1000, source: 'billing', subscriberId: '36706', contractId: '36706', pageType: 'billing_user', caseId: 'login:abon367063' }],
    searches: [{ ts: now - 500, source: 'billing', kind: 'submit', searchKind: 'contract', query: '367063', searchId: 'legacy-search' }]
  },
  telephony: {
    calls: {
      'pbx:1787856966.210849': {
        callKey: 'pbx:1787856966.210849', recordId: '1787856966.210849', usersideCallId: '2475200',
        startedAtMs: now - 60_000, durationSeconds: 30, callerId: '0631234578', agentExtension: '6047'
      },
      'pbx:1787856967.210850': {
        callKey: 'pbx:1787856967.210850', recordId: '1787856967.210850', startedAtMs: now - 50_000,
        durationSeconds: 20, callerId: '0630000000', agentExtension: '6047'
      }
    },
    bindings: {
      'pbx:1787856966.210849': { caseId: 'login:abon367063', customerId: '501', caseLabel: 'abon367063', registrationStatus: 'registered' }
    }
  }
};

const callState = ensureCallModuleState(state, { atMs: now, nowIso: new Date(now).toISOString() });
assert.equal(state.operatorVisitTimeline, undefined);
assert.equal(state.telephony, undefined);
assert.ok(callState.migrations.operatorVisitTimelineV1.completed);
assert.ok(callState.migrations.pbxToCanonicalV1.completed);
assert.equal(Object.keys(callState.calls.calls).length, 1, 'unresolved pbx row does not create a false physical call');
assert.ok(callState.calls.calls['call:2475200']);
assert.ok(callState.calls.calls['call:2475200'].legacyAliases.includes('pbx:1787856966.210849'));
assert.equal(Object.keys(callState.bindings.bindings).length, 1, 'legacy binding is deduped under canonical key');
assert.equal(callState.evidence.events[0].identity.billingId, '36706');
assert.equal(callState.evidence.events[0].identity.contract, '367063', 'Billing internal id is not copied into contract');

const html = `<tr class="table_item">
  <td id="2475300_ANSWERPHONE_Id">6047</td><td id="2475300_callIntervalInt_Id">0:00:05</td>
  <td id="2475300_DATEADD_Id">28.08.2026 12:00:00</td><td id="2475300_PHONE_Id">0631234578</td>
  <td id="2475300_OPER_Id">6047 Zyatev_Andriy</td><td id="2475300_CUSTOMER_Id"></td>
  <td><a href="/message/2475300/call_comment_add">comment</a></td>
</tr>`;
const [withoutPbxRecord] = parseUsersideCallListHtml(html, { operatorExtension: '6047', completedOnly: true });
assert.equal(withoutPbxRecord.usersideCallId, '2475300', 'completed call works without pbxRecordId');
assert.equal(withoutPbxRecord.recordId, '');

let clock = now;
const module = createCallModule({ nowMs: () => clock, nowIso: () => new Date(clock).toISOString() });
const ongoingState = { cases: {}, callModule: callState };
module.ingestUsersideCalls(ongoingState, [], {
  callKey: 'call:2475400', usersideCallId: '2475400', startedAtMs: now, ongoing: true, bindable: false,
  date: '2026-08-28', time: '12:00', callerMasked: '063***78', agentExtension: '6047'
});
const view = module.query(ongoingState, { caseId: '' });
assert.equal(view.focusCall.bindable, false);
assert.equal(view.focusSnapshot?.status, 'live');
assert.equal(view.focusSnapshot?.live, true);
assert.throws(() => module.bind(ongoingState, { callKey: 'call:2475400', candidateIdentity: { customerId: '501' } }, {}), /отсутствует в frozen snapshot|требуется явное подтверждение/);

ongoingState.callModule.config.pbxRealtimeEnabled = true;
const hints = module.recordPbxRealtimeHints(ongoingState, [{
  recordId: '1787856966.210849', callKey: 'pbx:1787856966.210849', customerId: '501',
  callerId: '0631234578', agentExtension: '6047', durationSeconds: 30, observedAt: new Date(now).toISOString()
}], new Date(now).toISOString());
assert.equal(hints.stored, 1);
const [hint] = ongoingState.callModule.realtimeHints.hints;
assert.deepEqual(Object.keys(hint).sort(), ['agentExtension', 'id', 'ts', 'type']);
assert.equal(hint.type, 'PBX_CALL_ENDED_HINT');
assert.equal(ongoingState.callModule.calls.calls['pbx:1787856966.210849'], undefined, 'PBX hint cannot define canonical identity');
ongoingState.callModule.config.pbxRealtimeEnabled = false;

module.disable();
assert.equal(module.recordSearch(ongoingState, { source: 'billing', kind: 'submit', query: 'x' }, {} ).accepted, false);
assert.throws(() => module.query(ongoingState, { caseId: '' }), /disabled/);

console.log('call_module_migration_and_ongoing_test: PASS');
