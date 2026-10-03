import test from 'node:test';
import assert from 'node:assert/strict';
import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker.js';
import { groundSubscriberReply as groundSoft } from '../src/features/ai-operator/semantic-tool-broker-impl-base.js';
import { augmentRequiredFactsForTurn } from '../src/features/ai-operator/semantic-tool-broker-impl.js';

const candidate={caseId:'billing-live:70001',billingId:'70001',contract:'700011',address:'вул. Синтетична, буд. 8, кв. 63'};
const analysis={probe:{language:'ru',requiredFacts:['subscriber.finance.balance.account'],ids:{address:'Синтетична 8 кв 63'},whatUserWants:'Проверить баланс',unresolvedRequests:['Проверить баланс']}};

test('canonical address finance turn asks about the found candidate before any account READ',async()=>{
 const calls=[];
 const r=await groundSubscriberReply({draft:{reply:'',subscriberDataNeeded:[]},transcript:[{role:'customer',text:'Синтетична 8 кв 63, что по балансу?'}],analysis,execute:async ({tool})=>{
  calls.push(tool);assert.equal(tool,'customer.lookup');return {tool,ok:true,code:'OK',data:{candidate,requiresConfirmation:true},statePatch:{pendingCandidate:candidate,confirmedCaseId:'',confirmedSubscriber:null}};
 }});
 assert.deepEqual(calls,['customer.lookup']);assert.match(r.reply,/Нашёл договор 700011/);assert.match(r.reply,/Это ваше подключение/);
 assert.equal(r.toolState.pendingCandidate.caseId,candidate.caseId);assert.equal(r.factSourceTrace.length,0);
 assert.deepEqual(r.toolState.domainContext.dialogue.activeRequiredFacts,['subscriber.finance.balance.account']);
 const next={probe:{language:'ru',requiredFacts:[],discourseAct:'CONFIRM'}};
 assert.deepEqual(augmentRequiredFactsForTurn({analysis:next,requestText:'да',labState:r.toolState}),['subscriber.finance.balance.account']);
});

test('confirmation uses the existing customer.confirm before the canonical balance read',async()=>{
 const calls=[];let grounded=false;
 const r=await groundSoft({draft:{reply:''},analysis:{probe:{language:'ru',requiredFacts:['subscriber.finance.balance.account']}},transcript:[{role:'customer',text:'да'}],labState:{pendingCandidate:candidate,confirmedCaseId:''},execute:async ({tool,labState})=>{
  calls.push(tool);
  if(tool==='customer.confirm')return {tool,ok:true,code:'OK',data:{},statePatch:{pendingCandidate:null,confirmedCaseId:candidate.caseId,confirmedSubscriber:candidate}};
  assert.equal(tool,'billing.main_summary');assert.equal(labState.confirmedCaseId,candidate.caseId);
  return {tool,ok:false,code:'SYNTHETIC_READ_UNAVAILABLE',data:{},statePatch:{}};
 },coreGround:async ({labState})=>{grounded=true;return {reply:'Синтетический результат',toolState:labState};}});
 assert.equal(calls[0],'customer.confirm');assert.ok(calls.includes('billing.main_summary'));assert.equal(grounded,true);assert.equal(r.toolState.confirmedCaseId,candidate.caseId);
});

test('rejecting a pending address candidate never reads its balance',async()=>{
 const calls=[];const r=await groundSoft({analysis:{probe:{requiredFacts:['subscriber.finance.balance.account']}},transcript:[{role:'customer',text:'нет'}],labState:{pendingCandidate:candidate},execute:async ({tool})=>{calls.push(tool);return {tool,ok:true,code:'OK',data:{},statePatch:{pendingCandidate:null,confirmedCaseId:'',confirmedSubscriber:null}};}});
 assert.deepEqual(calls,['customer.confirm']);assert.match(r.reply,/другое подключение/);
});
