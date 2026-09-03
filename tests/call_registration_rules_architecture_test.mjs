import assert from 'node:assert/strict';
import {
  callCustomerId,
  customerIdFromCallUrl,
  exactCustomerIdFromSearch,
  callRegistrationParams
} from '../src/features/call/registration-rules.js';

const fact = value => ({ value });
assert.equal(callCustomerId('316906'), '316906');
assert.equal(callCustomerId('abc'), '');
assert.equal(customerIdFromCallUrl('https://userside.simnet.kiev.ua/customer/316906'), '316906');
assert.equal(customerIdFromCallUrl('https://userside.simnet.kiev.ua/customer/nope'), '');
const caseData = { identity: { login: fact('abon203949'), contract: fact('203949') } };
const html = '<tr><td>abon203949</td><td><a href="/customer/316906">Открыть</a></td></tr>';
assert.equal(exactCustomerIdFromSearch(html, caseData), '316906');
const params = callRegistrationParams({
  customerId: '316906',
  fields: [
    { name: '_csrf', value: 'token' },
    { name: 'dopf_13', value: '0631234567' },
    { name: 'standart_comment', value: '1' },
    { name: 'additional_fields[]', value: '13' }
  ]
});
assert.equal(params.get('customer_id'), '316906');
assert.equal(params.get('dopf_13'), '0631234567');
assert.throws(() => callRegistrationParams({ customerId: '316906', fields: [{ name: '<script>', value: 'x' }] }));

console.log('call_registration_rules_architecture_test: PASS');
