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
// Selectize removes unselected options from the underlying select.
select.value = '';
select.options = [{ value: '', textContent: '' }];
select.selectize = {
  settings: { valueField: 'id', labelField: 'label' },
  options: { 44: { id: '44', label: 'Panoramna-2B-GPON (172.16.13.90) BDCOM' } },
  setValue: value => { calls.push(`set:${value}`); select.value = value; },
  close: () => calls.push('selectize:close'), blur: () => calls.push('selectize:blur')
};
calls.length = 0;
let result = sandbox.sync('40839', '', '172.16.13.90');
assert.equal(result.ok, true);
assert.equal(result.changed, true);
assert.equal(select.value, '44');
assert.deepEqual(calls, ['set:44', 'blur', 'selectize:close', 'selectize:blur']);
calls.length = 0;
result = sandbox.sync('40839', '44', '172.16.13.90');
assert.equal(result.changed, false);
assert.ok(!calls.some(call => call.startsWith('set:')));
assert.equal(sandbox.sync('40839', '44', '172.16.13.9').ok, false, 'exact IP only');
select.selectize.options[45] = { id: '45', label: 'Duplicate (172.16.13.90)' };
assert.equal(sandbox.sync('40839', '44', '172.16.13.90').reason, 'olt-ip-ambiguous');
console.log('billing_select_sync_test: PASS');
