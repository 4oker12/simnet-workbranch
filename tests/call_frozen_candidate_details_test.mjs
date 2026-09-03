import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 1_900_000_000_000;
const mod = createCallModule({ nowMs:()=>now, nowIso:()=>new Date(now).toISOString() });
const caseId='login:abon184565';
const state={cases:{[caseId]:{identity:{caseId,login:'abon184565',contract:'184565',billingId:'18456',customerId:'191'},profile:{fullName:'Міняєва Вікторія Олександрівна'}}}};
mod.ensure(state);
const start=now;

// Old Billing tab existed two hours before range; switching back must not count as a fresh open.
now=start+10_000;
mod.recordVisit(state,{pageKind:'billing_user',entityId:'18456',identity:{login:'abon184565',contract:'184565',billingId:'18456'},meta:{pageInstanceId:'old-billing',pageInstanceStartedAt:start-2*60*60_000}}, {tab:{id:1,windowId:1}}, {accepted:true,caseId});
// Second return to same old tab.
now=start+20_000;
mod.recordVisit(state,{pageKind:'billing_user',entityId:'18456',identity:{login:'abon184565',contract:'184565',billingId:'18456'},meta:{pageInstanceId:'old-billing',pageInstanceStartedAt:start-2*60*60_000}}, {tab:{id:1,windowId:1}}, {accepted:true,caseId});
// Click UserSide and complete handoff.
now=start+30_000;
mod.recordNavigation(state,{phase:'intent',source:'billing',target:'userside',caseId,identity:{login:'abon184565',contract:'184565',billingId:'18456'},pageType:'billing_user'}, {tab:{id:1,windowId:1}});
now=start+31_000;
mod.recordNavigation(state,{phase:'target-open',source:'userside',target:'userside',caseId,identity:{customerId:'191',login:'abon184565',contract:'184565'},pageType:'userside_customer'}, {tab:{id:2,windowId:1}});
now=start+31_100;
mod.recordVisit(state,{pageKind:'userside_customer',entityId:'191',identity:{customerId:'191',login:'abon184565',contract:'184565'},meta:{pageInstanceId:'us-new',pageInstanceStartedAt:start+31_000}}, {tab:{id:2,windowId:1}}, {accepted:true,caseId});
// UserSide search result for this same subscriber.
now=start+40_000;
mod.recordSearch(state,{source:'userside',kind:'submit',query:'184565',searchKind:'contract',searchId:'us:q1'}, {tab:{id:2}});
now=start+41_000;
mod.recordSearch(state,{source:'userside',kind:'result-open',searchId:'us:q1',targetSubscriberId:'191',identity:{customerId:'191',login:'abon184565',contract:'184565'}}, {tab:{id:2}});
// Return to same UserSide tab.
now=start+50_000;
mod.recordVisit(state,{pageKind:'userside_customer',entityId:'191',identity:{customerId:'191',login:'abon184565',contract:'184565'},meta:{pageInstanceId:'us-new',pageInstanceStartedAt:start+31_000}}, {tab:{id:2,windowId:1}}, {accepted:true,caseId});

now=start+5*60_000;
const replay=mod.previewRange(state,{caseId,startAtMs:start,endAtMs:start+60_000});
const c=replay.candidates.find(x=>x.contract==='184565');
assert.ok(c);
const ch=c.candidateEvidenceDetails.checks;
assert.equal(ch.billingCardOpened.yes,false,'old billing tab return must not become fresh card open');
assert.ok(ch.billingCardOpened.observedTimes.length>=2);
assert.equal(ch.billingUsersideButtonClicked.yes,true);
assert.deepEqual(ch.billingUsersideButtonClicked.times,[start+30_000]);
assert.equal(ch.handoffConfirmed.yes,true);
assert.equal(ch.usersideSearchFoundSubscriber.yes,true);
assert.ok(ch.tabReturns.billing.count>=2);
assert.ok(ch.tabReturns.userside.count>=1);
assert.equal(replay.schema,'simnet-call-frozen-replay-v2');
assert.ok(Array.isArray(replay.events));
assert.ok(replay.events.some(e=>e.type==='NAVIGATION_INTENT'));
console.log('call_frozen_candidate_details_test: PASS');
