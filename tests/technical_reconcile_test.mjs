import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assessPonTechnical } from '../src/workflows/pon.js';
import { computeDiagnosticDecision } from '../src/workflows/diagnostic.js';

const sandbox = { SIMNET_WB: {} };
vm.runInNewContext(fs.readFileSync(new URL('../src/parsers/billing/technical.js', import.meta.url), 'utf8'), sandbox);
const { planTmcPatch } = sandbox.SIMNET_WB.parsers.billing.technical;
const values = { oltIp: '172.16.1.50', onuMac: '4c:d7:c8:2c:93:e0', onuSerial: 'Fgxp:c82c93e1' };
const controls = { onuMac: {}, onuSerial: {}, olt: { options: [
  { value: '11', textContent: 'Different name (172.16.1.50)' },
  { value: '22', textContent: 'Same name (172.16.1.51)' }
] } };
const expected = { ...values, onuMac: '4CD7C82C93E0', onuSerial: 'FGXPC82C93E1' };
assert.equal(planTmcPatch({ values, controls }, expected).changes.length, 0);
let plan = planTmcPatch({ values, controls }, { ...expected, onuSerial: 'FGXPC82C93E2' });
assert.equal(plan.changes.length, 1);
assert.equal(plan.changes[0].field, 'onuSerial');
assert.equal(plan.changes[0].value, 'FGXP:C82C93E2');
plan = planTmcPatch({ values, controls }, { ...expected, oltIp: '172.16.1.51' });
assert.equal(plan.changes.length, 1);
assert.equal(plan.changes[0].value, '22');
assert.equal(planTmcPatch({ values, controls }, { ...expected, oltIp: '172.16.1.99' }).unavailable[0], 'olt');
controls.olt.options.push({ value: '33', textContent: 'Duplicate (172.16.1.51)' });
assert.equal(planTmcPatch({ values, controls }, { ...expected, oltIp: '172.16.1.51' }).changes.length, 0);
const c = { network: { connectionFamily: 'PON' }, pon: {
  ...values, oltName: 'Sim36-OLT-Huawei Huawei', oltId: 'local1',
  tmcOltIp: values.oltIp, tmcOltName: 'Huawei MA5800-X15', tmcOltDeviceId: 'foreign2',
  tmcOnuMac: expected.onuMac, tmcOnuSerial: expected.onuSerial, tmcFoundOnOlt: true
}, contexts: { tech: { pageKind: 'billing_technical' } }, locator: { sourceStatus: {} } };
assert.equal(assessPonTechnical(c).conflicts.length, 0);
assert.equal(computeDiagnosticDecision(c).pollAction, '313');
c.pon.onuMac = '';
const diagnostic = computeDiagnosticDecision(c);
assert.equal(diagnostic.pollAction, '');
assert.equal(diagnostic.pollNavigationAction, '313');
c.pon.oltIp = '172.16.1.51';
c.pon.oltId = 'foreign2';
assert.equal(assessPonTechnical(c).conflicts[0].field, 'olt');
delete c.network.connectionFamily;
assert.equal(computeDiagnosticDecision(c).isPon, true, 'confirmed TMC binding supplies missing family');
assert.equal(computeDiagnosticDecision(c).pollNavigationAction, '313');
c.network.connectionFamily = 'Ethernet';
assert.equal(computeDiagnosticDecision(c).isPon, false, 'explicit Ethernet remains authoritative');
console.log('technical_reconcile_test: PASS');
