import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { derivePonWorkflow, PonWorkflowState } from '../src/workflows/pon.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests/fixtures/tmc/bdcom-foxgate-epon-no-serial.json'),
  'utf8'
));
const parserSource = fs.readFileSync(path.join(root, 'src/parsers/userside/tmc.js'), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(parserSource, sandbox, { filename: 'src/parsers/userside/tmc.js' });

const deviceLink = {
  innerText: fixture.tmc.oltName,
  textContent: fixture.tmc.oltName,
  href: `https://userside.simnet.kiev.ua/device/${fixture.tmc.oltDeviceId}`,
  getAttribute(name) { return name === 'href' ? `/device/${fixture.tmc.oltDeviceId}` : ''; }
};
const detailText = [
  `MAC: ${fixture.tmc.mac}`,
  `Найдено на OLT: ${fixture.tmc.oltName}`,
  `IP: ${fixture.tmc.oltIp}`,
  `Interface: ${fixture.tmc.interface}`,
  `ONU Rx (dBm): ${fixture.tmc.onuRx}`,
  `ONU Tx (dBm): ${fixture.tmc.onuTx}`,
  `OLT Rx (dBm): ${fixture.tmc.oltRx}`
].join('\n');
const cells = [
  { innerText: '1', textContent: '1' },
  { innerText: 'ONU', textContent: 'ONU' },
  { innerText: 'PON', textContent: 'PON' },
  { innerText: fixture.tmc.equipmentName, textContent: fixture.tmc.equipmentName },
  {
    innerText: detailText,
    textContent: detailText,
    querySelectorAll(selector) { return selector === 'a[href*="/device/"]' ? [deviceLink] : []; }
  }
];
const row = { cells };
const block = {
  className: 'slider_content_double',
  matches(selector) { return selector === '.slider_content_double'; },
  querySelectorAll(selector) { return selector === 'tbody tr.table_item' ? [row] : []; }
};
const header = { innerText: 'ТМЦ', textContent: 'ТМЦ', nextElementSibling: block };
const anchor = { closest(selector) { return selector === '.label_h3_hr' ? header : null; } };
const documentFixture = { querySelector(selector) { return selector === '#ref_inventory' ? anchor : null; } };

const parsed = sandbox.SIMNET_TMC_PARSER.parseDocument(documentFixture);
assert.equal(parsed.status, 'parsed');
assert.equal(parsed.item.equipmentName, fixture.tmc.equipmentName);
assert.equal(parsed.item.serial, null);
for (const key of ['mac', 'foundOnOlt', 'oltName', 'oltDeviceId', 'oltIp', 'interface', 'onuRx', 'onuTx', 'oltRx']) {
  assert.equal(parsed.item[key], fixture.tmc[key], `parsed ${key}`);
}

const fact = (value, source = 'test') => ({ value, source, confidence: 0.99 });
const caseData = {
  id: 'login:foxgate-epon',
  identity: { login: fact('foxgate-epon'), billingId: fact('47043') },
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
    tmcFoundOnOlt: fact(true, 'userside:tmc-found-on-olt')
  },
  currentContext: { pageKind: 'userside_customer' },
  contexts: { technical: { pageKind: 'billing_technical' } },
  locator: {
    sourceStatus: { tmc: { result: 'found', details: { ...parsed.item } } },
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

console.log('tmc_foxgate_epon_regression_test: PASS', {
  equipmentName: parsed.item.equipmentName,
  serial: parsed.item.serial,
  interface: parsed.item.interface,
  pollAction: workflow.pollAction
});
