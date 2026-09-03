import assert from 'node:assert/strict';
import { derivePonWorkflow,PonWorkflowState,pollRouteFromEvidence } from '../src/workflows/pon.js';
const fact=(value,source='test')=>({value,source,confidence:.99});
const c={
  network:{connectionFamily:fact('PON')},
  pon:{
    oltName:fact('Huawei MA5800-X15','billing:olt-selected-option'),oltIp:fact('172.16.1.50','billing:olt-selected-option-ip'),onuMac:fact('D4:25:CC:05:DE:40','billing:onu-mac'),
    tmcOltName:fact('BDCOM OLT P3600-16E','userside:tmc-olt-name'),tmcOltIp:fact('172.16.1.239','userside:tmc-olt-ip'),tmcOnuMac:fact('D4:25:CC:05:DE:40','userside:tmc-onu-mac'),tmcPort:fact('epon0/12:55','userside:tmc-interface')
  },
  contexts:{technical:{pageKind:'billing_technical'},us:{pageKind:'userside_customer'}},
  locator:{sourceStatus:{tmc:{result:'found',details:{oltName:'BDCOM OLT P3600-16E',oltIp:'172.16.1.239',onuMac:'D4:25:CC:05:DE:40',interface:'epon0/12:55'}}},candidates:[],attempts:[],termination:null},operations:{poll:{current:null}}
};
let w=derivePonWorkflow(c);
assert.equal(w.state,PonWorkflowState.MANUAL_REVIEW,'Billing/TMC OLT mismatch must hard-lock LIVE poll readiness');
assert.equal(w.pollAllowed,false);
assert.equal(w.pollAction,'313','saved Billing OLT remains route authority even while LIVE poll is locked');
assert.equal(w.effectiveOltSource,'billing');
assert.ok(w.warnings.some(x=>x.code==='BILLING_OLT_DIFFERS_FROM_TMC'));
c.pon.tmcOnuMac=fact('AA:BB:CC:DD:EE:FF','userside:tmc-onu-mac');c.locator.sourceStatus.tmc.details.onuMac='AA:BB:CC:DD:EE:FF';
w=derivePonWorkflow(c);assert.equal(w.state,PonWorkflowState.MANUAL_REVIEW);assert.equal(w.pollAllowed,false);
assert.equal(pollRouteFromEvidence({oltName:'Huawei MA5800',interfaceName:'epon0/1:1'}).action,'313');
assert.equal(pollRouteFromEvidence({oltName:'BDCOM EPON',interfaceName:'epon0/1:1'}).action,'310');

// A successful poll is downstream evidence only; it must never reconcile Billing↔TMC facts.
c.locator.termination={status:'confirmed',pollResponded:true,pollCompleted:true};
c.live={oltSnapshot:{status:'confirmed',outcome:'confirmed',oltIp:'172.16.1.239'}};
w=derivePonWorkflow(c);
assert.equal(w.state,PonWorkflowState.MANUAL_REVIEW,'upstream conflicts outrank successful downstream poll');
assert.ok(w.conflicts.some(x=>x.field==='olt'),'OLT conflict must survive successful poll');
assert.ok(w.conflicts.some(x=>x.field==='onuMac'),'ONU MAC conflict must survive successful poll');

const missingBillingWithSuccessfulPoll={
  network:{connectionFamily:fact('PON')},
  pon:{
    onuMac:fact('D4:25:CC:05:DE:40','billing:onu-mac'),
    tmcOltName:fact('Huawei MA5800-X15','userside:tmc-olt-name'),
    tmcOltIp:fact('172.16.1.50','userside:tmc-olt-ip'),
    tmcOnuMac:fact('D4:25:CC:05:DE:40','userside:tmc-onu-mac')
  },
  contexts:{technical:{pageKind:'billing_technical'},us:{pageKind:'userside_customer'}},
  locator:{
    sourceStatus:{tmc:{result:'found',details:{oltName:'Huawei MA5800-X15',oltIp:'172.16.1.50',onuMac:'D4:25:CC:05:DE:40',identityCheck:{isMatch:true}}}},
    candidates:[],attempts:[],termination:{status:'confirmed',pollResponded:true,pollCompleted:true}
  },
  live:{oltSnapshot:{status:'confirmed',outcome:'confirmed',oltIp:'172.16.1.50'}},
  operations:{poll:{current:{pending:false,stage:'CONFIRMED',outcome:'confirmed'}}}
};
const missingAfterPoll=derivePonWorkflow(missingBillingWithSuccessfulPoll);
assert.equal(missingAfterPoll.state,PonWorkflowState.FILL_TECHNICAL,'missing Billing data must outrank successful downstream poll');
assert.ok(missingAfterPoll.prefillFields.includes('olt'),'successful poll must not erase missing Billing OLT reconciliation');
assert.equal(missingAfterPoll.billingTechnicalComplete,false,'successful poll must not make Billing Technical complete');

console.log('tmc_olt_authority_regression_test: PASS');
