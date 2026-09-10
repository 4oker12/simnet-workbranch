import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const parserSource = fs.readFileSync(new URL('../src/parsers/userside/tmc.js', import.meta.url), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(parserSource, sandbox, { filename: 'src/parsers/userside/tmc.js' });
const parser = sandbox.SIMNET_TMC_PARSER;

const oltLink = {
  innerText: 'Test GPON OLT',
  textContent: 'Test GPON OLT',
  href: 'https://userside.simnet.kiev.ua/device/61',
  getAttribute(name) { return name === 'href' ? '/device/61' : ''; }
};
const cells = [
  { innerText: '1', textContent: '1' },
  { innerText: 'ONU', textContent: 'ONU' },
  { innerText: 'PON', textContent: 'PON' },
  { innerText: 'ONU Test', textContent: 'ONU Test' },
  {
    innerText: 'MAC: 4C:D7:C8:40:3F:14\nНайдено на OLT: Test GPON OLT\nIP: 172.16.13.248\nInterface: gpon0/5:2\nONU Rx: -18.4\nONU Tx: 2.1\nOLT Rx: -19.0',
    textContent: 'MAC: 4C:D7:C8:40:3F:14 Найдено на OLT: Test GPON OLT IP: 172.16.13.248 Interface: gpon0/5:2 ONU Rx: -18.4 ONU Tx: 2.1 OLT Rx: -19.0',
    querySelectorAll(selector) { return selector === 'a[href*="/device/"]' ? [oltLink] : []; }
  }
];
const row = { cells };
const block = {
  className: 'erp_object_content',
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
assert.equal(scope.block, block, 'TMC content may be a generic table wrapper instead of slider_content_double');

const parsed = parser.parseDocument(documentFixture);
assert.equal(parsed.status, 'parsed');
assert.equal(parsed.tmcFound, true);
assert.equal(parsed.ponFound, true);
assert.equal(parsed.item.mac, '4C:D7:C8:40:3F:14');
assert.equal(parsed.item.oltIp, '172.16.13.248');
assert.equal(parsed.item.oltDeviceId, '61');
assert.equal(parsed.item.interface, 'gpon0/5:2');

console.log('userside_tmc_refreshed_markup_regression_test: PASS');
