import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { derivePonWorkflow, PonWorkflowState } from '../src/workflows/pon.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests/fixtures/tmc/bdcom-epon-no-serial.json'),
  'utf8'
));
const parserSource = fs.readFileSync(path.join(root, 'src/parsers/userside/tmc.js'), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(parserSource, sandbox, { filename: 'src/parsers/userside/tmc.js' });
const parser = sandbox.SIMNET_TMC_PARSER;
assert.ok(parser, 'TMC parser must publish its browser API');

const deviceLink = {
  innerText: fixture.tmc.oltName,
  textContent: fixture.tmc.oltName,
  href: `https://userside.simnet.kiev.ua/device/${fixture.tmc.oltDeviceId}`,
  getAttribute(name) { return name === 'href' ? `/device/${fixture.tmc.oltDeviceId}` : ''; }
};
const cells = [
  { innerText: '1', textContent: '1' },
  { innerText: 'ONU', textContent: 'ONU' },
  { innerText: 'PON', textContent: 'PON' },
  { innerText: fixture.tmc.equipmentName, textContent: fixture.tmc.equipmentName },
  {
    innerText: `MAC: ${fixture.tmc.mac}\nНайдено на OLT: ${fixture.tmc.oltName}\nIP: ${fixture.tmc.oltIp}\nInterface: ${fixture.tmc.interface}\nONU Rx: ${fixture.tmc.onuRx}\nONU Tx: ${fixture.tmc.onuTx}\nOLT Rx: ${fixture.tmc.oltRx}`,
    textContent: `MAC: ${fixture.tmc.mac} Найдено на OLT: ${fixture.tmc.oltName} IP: ${fixture.tmc.oltIp} Interface: ${fixture.tmc.interface} ONU Rx: ${fixture.tmc.onuRx} ONU Tx: ${fixture.tmc.onuTx} OLT Rx: ${fixture.tmc.oltRx}`,
    querySelectorAll(selector) { return selector === 'a[href*="/device/"]' ? [deviceLink] : []; }
  }
];
const row = { cells };
const block = {
  className: 'slider_content_double',
  matches(selector) { return selector === '.slider_content_double'; },
  querySelectorAll(selector) { return selector === 'tbody tr.table_item' ? [row] : []; }
};
const header = {
  innerText: 'ТМЦ',
  textContent: 'ТМЦ',
  nextElementSibling: block
};
const anchor = { closest(selector) { return selector === '.label_h3_hr' ? header : null; } };
const documentFixture = { querySelector(selector) { return selector === '#ref_inventory' ? anchor : null; } };

const parsed = parser.parseDocument(documentFixture);
assert.equal(parsed.status, 'parsed');
assert.equal(parsed.tmcFound, true);
assert.equal(parsed.ponFound, true);
for (const key of ['equipmentName', 'mac', 'foundOnOlt', 'oltName', 'oltDeviceId', 'oltIp', 'interface', 'onuRx', 'onuTx', 'oltRx']) {
  assert.equal(parsed.item[key], fixture.tmc[key], `parsed ${key}`);
}
assert.equal(parsed.item.serial, null, 'a real absent Serial stays null');

const fact = (value, source = 'test') => ({ value, source, confidence: 0.99 });
const caseData = {
  id: 'login:abon-field-epon',
  identity: { login: fact('abon-field-epon'), billingId: fact('60') },
  network: { connectionFamily: fact('PON') },
  pon: {
    oltName: fact(fixture.billing.oltName, 'billing:olt-selected-option'),
    onuMac: fact(fixture.billing.onuMac, 'billing:onu-mac'),
    tmcEquipmentName: fact(parsed.item.equipmentName, 'userside:tmc-equipment-name'),
    tmcOltName: fact(parsed.item.oltName, 'userside:tmc-olt-name'),
    tmcOltIp: fact(parsed.item.oltIp, 'userside:tmc-olt-ip'),
    tmcOltDeviceId: fact(parsed.item.oltDeviceId, 'userside:tmc-olt-device-id'),
    tmcPort: fact(parsed.item.interface, 'userside:tmc-interface'),
    tmcOnuMac: fact(parsed.item.mac, 'userside:tmc-onu-mac'),
    tmcOnuSerial: fact('', 'userside:tmc-onu-serial'),
    tmcOnuRx: fact(parsed.item.onuRx, 'userside:tmc-onu-rx'),
    tmcOnuTx: fact(parsed.item.onuTx, 'userside:tmc-onu-tx'),
    tmcOltRx: fact(parsed.item.oltRx, 'userside:tmc-olt-rx')
  },
  currentContext: { pageKind: 'billing_technical' },
  contexts: { technical: { pageKind: 'billing_technical' } },
  locator: {
    state: 'candidate_found',
    sourceStatus: {
      tmc: {
        result: 'found',
        details: {
          equipmentName: parsed.item.equipmentName,
          oltName: parsed.item.oltName,
          oltIp: parsed.item.oltIp,
          deviceId: parsed.item.oltDeviceId,
          interface: parsed.item.interface,
          foundOnOlt: parsed.item.foundOnOlt,
          onuMac: parsed.item.mac,
          onuSerial: '',
          onuRx: parsed.item.onuRx,
          onuTx: parsed.item.onuTx,
          oltRx: parsed.item.oltRx
        }
      }
    },
    candidates: [], evidence: [], attempts: [], hypotheses: [], termination: null
  },
  operations: { poll: { current: null, history: [] } }
};

const workflow = derivePonWorkflow(caseData);
assert.equal(workflow.state, PonWorkflowState.READY_FOR_POLL);
assert.equal(workflow.serialStatus, fixture.expected.serialStatus);
assert.equal(workflow.pollType, fixture.expected.pollType);
assert.equal(workflow.pollAction, fixture.expected.pollAction);
assert.equal(workflow.pollAllowed, fixture.expected.pollAllowed);
assert.deepEqual(workflow.blockers, []);

// Missing Serial is not an EPON classifier. Without real technology evidence,
// readiness remains blocked on route selection instead of defaulting to 310.
const unknownTechnology = structuredClone(caseData);
unknownTechnology.pon.oltName = fact('Unknown access node', 'billing:olt-selected-option');
unknownTechnology.pon.tmcOltName = fact('Unknown access node', 'userside:tmc-olt-name');
unknownTechnology.pon.tmcPort = fact('0/2:44', 'userside:tmc-interface');
unknownTechnology.locator.sourceStatus.tmc.details.oltName = 'Unknown access node';
unknownTechnology.locator.sourceStatus.tmc.details.interface = '0/2:44';
const unresolved = derivePonWorkflow(unknownTechnology);
assert.equal(unresolved.serialStatus, 'optional-missing');
assert.equal(unresolved.state, PonWorkflowState.BLOCKED);
assert.equal(unresolved.pollAction, '');

const gponNoSerial = structuredClone(caseData);
gponNoSerial.pon.oltName = fact('Access GPON OLT', 'billing:olt-selected-option');
gponNoSerial.pon.tmcOltName = fact('Access GPON OLT', 'userside:tmc-olt-name');
gponNoSerial.pon.tmcPort = fact('gpon0/2:44', 'userside:tmc-interface');
gponNoSerial.locator.sourceStatus.tmc.details.oltName = 'Access GPON OLT';
gponNoSerial.locator.sourceStatus.tmc.details.interface = 'gpon0/2:44';
const gpon = derivePonWorkflow(gponNoSerial);
assert.equal(gpon.state, PonWorkflowState.READY_FOR_POLL);
assert.equal(gpon.pollAction, '311');

console.log('tmc_inventory_parser_regression_test: PASS', {
  serial: parsed.item.serial,
  interface: parsed.item.interface,
  pollAction: workflow.pollAction
});
