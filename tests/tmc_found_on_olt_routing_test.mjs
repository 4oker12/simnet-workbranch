import assert from 'node:assert/strict';
import { derivePonWorkflow, pollRouteForCase, PonWorkflowState } from '../src/workflows/pon.js';

const fact = (value, source = 'test') => ({ value, source, confidence: 0.99 });

function baseCase(foundOnOlt = true) {
  return {
    id: 'billing:billing:2003',
    identity: { billingId: fact('2003', 'billing:url-id') },
    network: { connectionFamily: fact('PON') },
    pon: {
      // Billing is complete but its display name alone is not enough to identify
      // the vendor-specific native poll tab.
      oltName: fact('Sim36 access node', 'billing:olt-selected-option'),
      oltIp: fact('172.16.1.50', 'billing:olt-selected-option-ip'),
      onuMac: fact('B4:64:15:A2:C2:6E', 'billing:onu-mac'),
      onuSerial: fact('FGXP15A2C26F', 'billing:onu-serial'),
      tmcEquipmentName: fact('FoxGate ONU G2001R', 'userside:tmc-equipment-name'),
      tmcOltName: fact('Huawei MA5800-X15', 'userside:tmc-olt-name'),
      tmcOltIp: fact('172.16.1.50', 'userside:tmc-olt-ip'),
      tmcOltDeviceId: fact('57547', 'userside:tmc-olt-device-id'),
      tmcPort: fact('GPON 0/5/9:36', 'userside:tmc-interface'),
      tmcOnuMac: fact('B4:64:15:A2:C2:6E', 'userside:tmc-onu-mac'),
      tmcOnuSerial: fact('FGXP15A2C26F', 'userside:tmc-onu-serial'),
      tmcFoundOnOlt: fact(foundOnOlt ? 'true' : '', 'userside:tmc-found-on-olt')
    },
    currentContext: { pageKind: 'billing_technical' },
    contexts: {
      technical: { pageKind: 'billing_technical' },
      userside: { pageKind: 'userside_customer' }
    },
    locator: {
      sourceStatus: {
        tmc: {
          result: 'found',
          details: {
            equipmentName: 'FoxGate ONU G2001R',
            oltName: 'Huawei MA5800-X15',
            oltIp: '172.16.1.50',
            deviceId: '57547',
            interface: 'GPON 0/5/9:36',
            onuMac: 'B4:64:15:A2:C2:6E',
            onuSerial: 'FGXP15A2C26F',
            foundOnOlt
          }
        }
      },
      attempts: [],
      candidates: [],
      evidence: []
    },
    operations: { poll: { current: null, history: [] } }
  };
}

const confirmedBinding = baseCase(true);
const route = pollRouteForCase(confirmedBinding);
assert.equal(route.action, '313', 'confirmed Huawei OLT binding must choose native Huawei tab');
assert.equal(route.type, 'Huawei');
assert.equal(route.source, 'tmc-found-on-olt');

const workflow = derivePonWorkflow(confirmedBinding);
assert.equal(workflow.state, PonWorkflowState.READY_FOR_POLL);
assert.equal(workflow.pollAllowed, true);
assert.equal(workflow.pollAction, '313');
assert.equal(workflow.pollSource, 'tmc-found-on-olt');

const inventoryOnly = baseCase(false);
const unconfirmedRoute = pollRouteForCase(inventoryOnly);
assert.equal(unconfirmedRoute.action, '', 'TMC inventory without `Найдено на OLT:` must not select a poll technology');
const unresolved = derivePonWorkflow(inventoryOnly);
assert.equal(unresolved.state, PonWorkflowState.BLOCKED);
assert.equal(unresolved.pollAction, '');

console.log('tmc_found_on_olt_routing_test: PASS');
