import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 1_800_100_000_000;
const module = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const boychuk = 'login:abon402568';
const other = 'login:abon777777';
const state = { cases: {
  [boychuk]: { id: boychuk, identity: { login:'abon402568', contract:'402568', billingId:'40256', customerId:'48032' }, profile:{ fullName:'Бойчук Василь Дмитрович' } },
  [other]: { id: other, identity: { login:'abon777777', contract:'777777', billingId:'77777', customerId:'57000' }, profile:{ fullName:'Другой Абонент' } }
}};
module.ensure(state);
const start = now;

now = start + 20_000;
module.recordVisit(state, { pageKind:'billing_customer', entityId:'40256', url:'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=40256', identity:{ login:'abon402568', contract:'402568', billingId:'40256' } }, { tab:{id:1,windowId:1} }, { accepted:true, caseId:boychuk });
now = start + 60_000;
module.recordNavigation(state, { phase:'intent', source:'billing', target:'userside', caseId:boychuk, identity:{ login:'abon402568', contract:'402568', billingId:'40256' }, targetPath:'/script/gotouser.php' }, {tab:{id:1,windowId:1}});
now = start + 61_000;
module.recordNavigation(state, { phase:'target-open', source:'userside', target:'userside', caseId:boychuk, identity:{ customerId:'48032', login:'abon402568', contract:'402568' }, targetCustomerId:'48032', pageType:'userside_customer' }, {tab:{id:2,windowId:1}});
now = start + 62_000;
module.recordVisit(state, { pageKind:'userside_customer', entityId:'48032', url:'https://userside.simnet.kiev.ua/customer/48032', identity:{ customerId:'48032', login:'abon402568', contract:'402568' } }, {tab:{id:2,windowId:1}}, {accepted:true,caseId:boychuk});
now = start + 90_000;
module.recordVisit(state, { pageKind:'userside_customer', entityId:'57000', url:'https://userside.simnet.kiev.ua/customer/57000', identity:{ customerId:'57000', login:'abon777777', contract:'777777' } }, {tab:{id:3,windowId:1}}, {accepted:true,caseId:other});

const beforeBindings = JSON.stringify(state.callModule.bindings);
const beforeSnapshots = JSON.stringify(state.callModule.snapshots);
now = start + 10 * 60_000;
const replay = module.previewRange(state, { caseId: boychuk, startAtMs:start, endAtMs:start + 3*60_000 });
assert.equal(replay.mode, 'test');
assert.equal(replay.readOnly, true);
assert.equal(replay.synthetic, true);
assert.ok(replay.eventCount >= 4);
assert.ok(replay.candidates.length >= 2);
assert.equal(replay.winner.contract, '402568');
assert.ok(replay.winner.reasons.includes('handoff'));
assert.ok(replay.winner.reasons.includes('userside+billing'));
assert.equal(JSON.stringify(state.callModule.bindings), beforeBindings, 'TEST replay must not create bindings');
assert.equal(JSON.stringify(state.callModule.snapshots), beforeSnapshots, 'TEST replay must not create/freeze snapshots');
console.log('call_frozen_replay_test: PASS');
