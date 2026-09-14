import assert from 'node:assert/strict';
import vm from 'node:vm';
import { syncBillingOltWidget } from '../src/infrastructure/billing-select-sync.js';
const calls = [];
const select = { value: '22', size: 5, blur: () => calls.push('blur') };
const widget = { trigger: event => { calls.push(event); return widget; }, data: key => key === 'select2', select2: action => calls.push(action) };
const sandbox = { URL, location: { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&id=40839' },
  document: { querySelector: () => select }, window: { jQuery: () => widget } };
vm.createContext(sandbox);
vm.runInContext(`globalThis.sync = ${syncBillingOltWidget.toString()}`, sandbox);
assert.equal(sandbox.sync('other', '22').ok, false);
assert.equal(calls.length, 0);
assert.equal(sandbox.sync('40839', 'wrong-value').ok, false);
assert.equal(sandbox.sync('40839', '22').ok, true);
assert.equal(select.size, 1);
assert.deepEqual(calls, ['blur', 'change', 'close']);
console.log('billing_select_sync_test: PASS');
