import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 1_800_000_000_000;
const module = createCallModule({
  nowMs: () => now,
  nowIso: () => new Date(now).toISOString()
});
const caseId = 'login:abon402568';
const state = {
  cases: {
    [caseId]: {
      id: caseId,
      identity: { login: 'abon402568', contract: '402568', billingId: '40256', customerId: '48032' },
      profile: { fullName: 'Бойчук Василь Дмитрович' }
    }
  }
};
module.ensure(state);

const intent = module.recordNavigation(state, {
  phase: 'intent', source: 'billing', target: 'userside', caseId,
  identity: { caseId, login: 'abon402568', contract: '402568', billingId: '40256' },
  targetPath: '/script/gotouser.php'
}, { tab: { id: 11, windowId: 3, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=40256' } });
assert.equal(intent.added, true);
assert.equal(state.callModule.navigationEvidence.pending.length, 1);

now += 1200;
const confirmed = module.recordNavigation(state, {
  phase: 'target-open', source: 'userside', target: 'userside', caseId,
  identity: { customerId: '48032', login: 'abon402568', contract: '402568', fullName: 'Бойчук Василь Дмитрович' },
  targetCustomerId: '48032', pageType: 'userside_customer', pageUrl: 'https://userside.simnet.kiev.ua/customer/48032'
}, { tab: { id: 12, windowId: 3, url: 'https://userside.simnet.kiev.ua/customer/48032' } });
assert.equal(confirmed.added, true);
assert.equal(state.callModule.navigationEvidence.pending.length, 0);

now += 300;
module.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '48032', url: 'https://userside.simnet.kiev.ua/customer/48032',
  identity: { customerId: '48032', login: 'abon402568', contract: '402568' }
}, { tab: { id: 12, windowId: 3, url: 'https://userside.simnet.kiev.ua/customer/48032' } }, {
  accepted: true, caseId,
  handoff: { purpose: 'userside-tmc-focus', token: 'simnet_wb_abcdefgh1234' }
});

const handoffs = state.callModule.evidence.events.filter(event => event.type === 'HANDOFF');
assert.equal(handoffs.length, 1, 'lightweight confirmation and legacy claimed handoff must collapse into one CALL HANDOFF');
assert.equal(handoffs[0].handoff?.purpose, 'billing-userside-click');
assert.equal(handoffs[0].identity.customerId, '48032');
assert.equal(handoffs[0].identity.contract, '402568');
console.log('call_handoff_lite_test: PASS');
