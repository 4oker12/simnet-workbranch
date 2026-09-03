import assert from 'node:assert/strict';
import { derivePonWorkflow, PonWorkflowState } from '../src/workflows/pon.js';
const fact=(value,source='test')=>({value,source,confidence:.99});
const c={
  network:{connectionFamily:fact('PON')},
  pon:{onuMac:fact('C4:CD:50:12:08:35','billing:onu-mac'),tmcOltName:fact('Huawei MA5800-X15','userside:tmc-olt-name'),tmcOltIp:fact('172.16.1.50','userside:tmc-olt-ip'),tmcOnuMac:fact('C4:CD:50:12:08:35','userside:tmc-onu-mac')},
  contexts:{tech:{pageKind:'billing_technical'},us:{pageKind:'userside_customer'}},
  locator:{sourceStatus:{tmc:{result:'found',details:{oltName:'Huawei MA5800-X15',oltIp:'172.16.1.50',onuMac:'C4:CD:50:12:08:35'}}},candidates:[],attempts:[]},
  operations:{poll:{current:null}},live:{}
};
let w=derivePonWorkflow(c);
assert.equal(w.state,PonWorkflowState.FILL_TECHNICAL);
assert.equal(w.action,'manual_fill_billing');
assert.equal(w.pollAllowed,false);
assert.equal(w.pollAction,'','TMC facts alone cannot expose 313');
assert.deepEqual(w.billingMissingTechnical,['olt']);
c.pon.oltName=fact('Huawei MA5800-X15','billing:olt-selected-option');
c.pon.oltIp=fact('172.16.1.50','billing:olt-selected-option-ip');
w=derivePonWorkflow(c);
assert.equal(w.state,PonWorkflowState.READY_FOR_POLL);
assert.equal(w.pollAction,'313');
assert.equal(w.pollAllowed,true);
console.log('billing_prefill_behavior_integration_test: PASS');
