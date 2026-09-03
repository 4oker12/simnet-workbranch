import assert from 'node:assert/strict';
import {
  NextStep,
  EvidenceType,
  ensureEvidenceState,
  recordEvidence,
  nextDiscoveryStep
} from '../../src/workflows/discovery.js';
import {
  RouteRelation,
  classifyObservationRelation
} from '../../src/state/context-guard.js';

const fact = value => ({ value, confidence: 0.99 });

globalThis.SIMNET_WB = { readers: {} };
await import('../../src/readers/userside.js');
const usersideTest = globalThis.SIMNET_WB.readers.userside.__test;

assert.equal(usersideTest.classifyEthernetAccessPoint({
  deviceId: '17723',
  deviceName: 'D-Link DGS-1210-48 - P.Chubinskogo-4A_p3',
  port: '20',
  interface: 'Slot0/20',
  interfaceClass: 'item ifaceRow-ethernetCsmacd',
  ownerMatched: true
}), true, 'recorded abon288111 access point is Ethernet');

assert.equal(usersideTest.classifyEthernetAccessPoint({
  deviceId: '9001',
  deviceName: 'Huawei MA5800 OLT',
  port: '3',
  interface: 'GPON0/3:11',
  interfaceClass: 'ifaceRow-ethernetCsmacd',
  ownerMatched: true
}), false, 'PON OLT/ONU evidence must not be reclassified as Ethernet');

const c = {
  id: 'login:abon288111',
  identity: {
    login: fact('abon288111'),
    billingId: fact('28811'),
    customerId: fact('35628')
  },
  network: {
    connectionFamily: fact('Ethernet'),
    ip: fact('10.8.186.23'),
    mac: fact('7C:8B:CA:D1:FC:1B'),
    accessDeviceId: fact('17723'),
    accessDeviceName: fact('D-Link DGS-1210-48'),
    accessDeviceIp: fact('172.16.12.54'),
    accessPort: fact('20'),
    accessInterface: fact('Slot0/20')
  },
  pon: {}, profile: {},
  contexts: { technical: { pageKind: 'billing_technical' }, subscriber: { pageKind: 'billing_user' } },
  route: {}, conflicts: []
};
const locator = ensureEvidenceState(c);
locator.sourceStatus.juniper = { result: 'online' };

let rec = nextDiscoveryStep(c);
assert.equal(rec.action, NextStep.SWITCH_PORT);
assert.equal(rec.params.deviceId, '17723');

const accessObservation = {
  type: EvidenceType.ETHERNET_ACCESS_POINT,
  result: 'confirmed', routeRelation: RouteRelation.ON_ROUTE,
  details: { deviceId: '17723', interface: 'Slot0/20', ownerMatched: true }
};
assert.equal(classifyObservationRelation(c, accessObservation, { system: 'userside', pageKind: 'userside_customer' }), RouteRelation.SUPPORTING);
recordEvidence(c, [accessObservation], { system: 'userside', pageKind: 'userside_customer' });
rec = nextDiscoveryStep(c);
assert.equal(rec.action, NextStep.SWITCH_PORT, 'access point alone does not pretend switch page was opened');

const deviceObservation = {
  type: EvidenceType.ETHERNET_DEVICE,
  result: 'confirmed', routeRelation: RouteRelation.ON_ROUTE,
  details: { deviceId: '17723', deviceIp: '172.16.12.54', sameDevice: true }
};
recordEvidence(c, [deviceObservation], { system: 'userside', pageKind: 'userside_device' });
rec = nextDiscoveryStep(c);
assert.equal(rec.action, NextStep.CHECK_ETHERNET_FDB);

const fdbObservation = {
  type: EvidenceType.ETHERNET_FDB_RESULT,
  result: 'confirmed', routeRelation: RouteRelation.ON_ROUTE,
  details: { deviceId: '17723', subscriberMac: '7C:8B:CA:D1:FC:1B', interface: 'Slot0/20', vlan: '221', portMatched: true }
};
recordEvidence(c, [fdbObservation], { system: 'userside', pageKind: 'device_poller', subview: 'fdb_table' });
rec = nextDiscoveryStep(c);
assert.equal(rec.action, NextStep.CHECK_ETHERNET_ERRORS);

const errorsObservation = {
  type: EvidenceType.ETHERNET_PORT_ERRORS,
  result: 'clear', routeRelation: RouteRelation.ON_ROUTE,
  details: { deviceId: '17723', interface: 'Slot0/20', rowCount: 1 }
};
recordEvidence(c, [errorsObservation], { system: 'userside', pageKind: 'device_interface_errors' });
rec = nextDiscoveryStep(c);
assert.equal(rec.action, NextStep.ETHERNET_SUMMARY);
assert.equal(c.locator.termination, null, 'Ethernet access check does not falsely close symptom diagnostics');

console.log('ethernet_access_route_unit_test: PASS');
