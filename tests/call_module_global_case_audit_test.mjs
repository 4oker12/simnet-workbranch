import assert from 'node:assert/strict';
import { createCallModule, createCallModuleState } from '../src/features/call/index.js';

let clock = Date.parse('2026-08-28T11:00:00Z');
const module = createCallModule({ nowMs: () => clock, nowIso: () => new Date(clock).toISOString() });
const state = { cases: {}, callModule: createCallModuleState() };
const sender = { tab: { id: 9, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl' } };

for (let index = 1; index <= 7; index += 1) {
  const caseId = `login:abon70${index}`;
  state.cases[caseId] = {
    identity: { login: `abon70${index}`, contract: `70${index}`, billingId: `80${index}`, customerId: `90${index}` },
    profile: { fullName: `Audit Subscriber ${index}` },
    telephony: { callBindings: [] }
  };
  module.recordVisit(state, {
    pageKind: 'billing_user', entityId: `80${index}`, identity: state.cases[caseId].identity
  }, { ...sender, tab: { ...sender.tab, id: 10 + index } }, { accepted: true, caseId });
  clock += 1_000;
}

module.recordSearch(state, { source: 'billing', kind: 'submit', searchKind: 'contract', query: 'abon701', searchId: 'audit-search' }, sender);
clock += 2_000;
module.recordSearch(state, { source: 'billing', kind: 'result-open', searchKind: 'contract', targetSubscriberId: '801', searchId: 'audit-search' }, sender);

const callStart = Date.parse('2026-08-28T10:59:50Z');
clock = Date.parse('2026-08-28T11:01:00Z');
module.ingestUsersideCalls(state, [{
  usersideCallId: '2475100', startedAtMs: callStart, durationSeconds: 20,
  customerId: '901', login: 'abon701', contract: '701', fio: 'Audit Subscriber 1',
  date: '2026-08-28', time: '10:59', agentExtension: '6047'
}], null);

const globalAudit = module.globalAudit(state);
assert.equal(globalAudit.summary.subscribersTouched, 7, 'global audit retains all 5–7 subscribers');
assert.equal(globalAudit.summary.completedSearchOpenChains, 1);
assert.equal(globalAudit.summary.callsEvaluated, 1);
assert.equal(globalAudit.summary.frozenSnapshots, 1);

const caseAudit = module.caseAudit(state, 'login:abon701', state.cases['login:abon701']);
assert.equal(caseAudit.caseId, 'login:abon701');
assert.ok(caseAudit.events.every(event => event.type === 'SEARCH_SUBMIT' || event.identity.caseId === 'login:abon701'));
assert.equal(caseAudit.summary.evaluatedCalls, 1);
assert.equal(caseAudit.summary.relevantCalls, 1);
assert.equal(caseAudit.calls[0].callKey, 'call:2475100');

const otherAudit = module.caseAudit(state, 'login:abon707', state.cases['login:abon707']);
assert.equal(otherAudit.summary.relevantCalls, 0, 'conflicting/non-candidate calls are not relevantCalls');
assert.equal(otherAudit.summary.evaluatedCalls, 1, 'evaluatedCalls is tracked separately');

console.log('call_module_global_case_audit_test: PASS');
