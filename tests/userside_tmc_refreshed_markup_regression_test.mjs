import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const parserSource = fs.readFileSync(new URL('../src/parsers/userside/tmc.js', import.meta.url), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(parserSource, sandbox, { filename: 'src/parsers/userside/tmc.js' });
const parser = sandbox.SIMNET_TMC_PARSER;

const oltLink = {
  innerText: 'Huawei MA5800-X15',
  textContent: 'Huawei MA5800-X15',
  href: 'https://userside.simnet.kiev.ua/device/57547',
  getAttribute(name) { return name === 'href' ? '/device/57547' : ''; }
};
const detailsText = [
  'Учет проданного',
  'к-во: 1 шт.',
  's/n: FGXP15A2C26F',
  'MAC: B4:64:15:A2:C2:6E',
  'Найдено на OLT:',
  '10.09.2026 04:21',
  'Huawei MA5800-X15',
  'IP: 172.16.1.50',
  'Interface: GPON 0/5/9:36',
  'Расстояние до OLT: 1101',
  'ONU Rx (dBm): -19.58',
  'ONU Tx (dBm): 2.93',
  'OLT Rx (dBm): -23.63'
].join('\n');

// This mirrors the refreshed UserSide inventory table: the old leading service
// column remains, but PON moved to cell[1], equipment to cell[2], details to cell[3].
const cells = [
  { innerText: '', textContent: '' },
  { innerText: 'PON', textContent: 'PON' },
  { innerText: 'FoxGate ONU G2001R', textContent: 'FoxGate ONU G2001R' },
  {
    innerText: detailsText,
    textContent: detailsText.replace(/\n/g, ' '),
    querySelector(selector) { return selector === 'a[href*="/device/"]' ? oltLink : null; },
    querySelectorAll(selector) { return selector === 'a[href*="/device/"]' ? [oltLink] : []; }
  },
  { innerText: '500.00', textContent: '500.00' },
  { innerText: '', textContent: '' },
  { innerText: '23.12.2025 14:40', textContent: '23.12.2025 14:40' },
  { innerText: '', textContent: '' }
];
const row = { cells };
const block = {
  className: 'erp-inventory-account-layout',
  matches() { return false; },
  querySelector(selector) { return selector === 'tbody tr' ? row : null; },
  querySelectorAll(selector) { return selector === 'tbody tr' ? [row] : []; },
  nextElementSibling: null
};
const header = {
  innerText: 'ТМЦ',
  textContent: 'ТМЦ',
  nextElementSibling: block,
  matches(selector) { return selector.includes('.erp_object_subtitle'); }
};
const anchor = {
  parentElement: header,
  closest(selector) { return selector.includes('.erp_object_subtitle') ? header : null; }
};
const documentFixture = {
  querySelector(selector) { return selector === '#ref_inventory' ? anchor : null; }
};

const scope = parser.inventoryScope(documentFixture);
assert.equal(scope.status, 'ready', 'new UserSide ERP subtitle must resolve the TMC section');
assert.equal(scope.header, header);
assert.equal(scope.block, block, 'TMC content may be a generic ERP table wrapper');

const parsed = parser.parseDocument(documentFixture);
assert.equal(parsed.status, 'parsed');
assert.equal(parsed.tmcFound, true);
assert.equal(parsed.ponFound, true);
assert.equal(parsed.item.categoryIndex, 1, 'category position must be discovered, not hard-coded');
assert.equal(parsed.item.equipmentName, 'FoxGate ONU G2001R');
assert.equal(parsed.item.serial, 'FGXP15A2C26F');
assert.equal(parsed.item.mac, 'B4:64:15:A2:C2:6E');
assert.equal(parsed.item.foundOnOlt, true, '`Найдено на OLT:` is the binding proof');
assert.equal(parsed.item.foundOnOltAt, '10.09.2026 04:21');
assert.equal(parsed.item.oltName, 'Huawei MA5800-X15');
assert.equal(parsed.item.oltIp, '172.16.1.50');
assert.equal(parsed.item.oltDeviceId, '57547');
assert.equal(parsed.item.interface, 'GPON 0/5/9:36');
assert.equal(parsed.item.onuRx, '-19.58');
assert.equal(parsed.item.onuTx, '2.93');
assert.equal(parsed.item.oltRx, '-23.63');

console.log('userside_tmc_refreshed_markup_regression_test: PASS');
