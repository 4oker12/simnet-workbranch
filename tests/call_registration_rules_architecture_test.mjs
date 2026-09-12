import assert from 'node:assert/strict';
import {
  callCustomerId,
  callCustomerUuid,
  customerIdFromCallUrl,
  customerUuidFromCallPage,
  exactCustomerIdFromSearch,
  callRegistrationParams
} from '../src/features/call/registration-rules.js';

const fact = value => ({ value });
assert.equal(callCustomerId('316906'), '316906');
assert.equal(callCustomerId('abc'), '');
const customerUuid = '78063cb6-80c8-4094-8546-b60f6b2028cb';
const phoneFieldUuid = 'f69e83ec-e6ae-4cd7-8022-cd97a8d2590c';
const standardCommentUuid = '5fa27426-94df-41a2-9029-179ddfa66219';
assert.equal(callCustomerUuid(customerUuid.toUpperCase()), customerUuid);
assert.equal(callCustomerUuid('316906'), '');
assert.equal(customerIdFromCallUrl('https://userside.simnet.kiev.ua/customer/316906'), '316906');
assert.equal(customerIdFromCallUrl('https://userside.simnet.kiev.ua/customer/nope'), '');
assert.equal(customerUuidFromCallPage(
  `<a href="/message/tab?section=call&amp;customer_uuid=${customerUuid}">Регистрация звонка</a>`
), customerUuid);
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

const uuidParams = callRegistrationParams({
  customerId: '316906',
  customerUuid,
  phoneFieldName: `dopf_${phoneFieldUuid}`,
  fields: [
    { name: '_csrf', value: 'fresh-token' },
    { name: 'customer_uuid', value: customerUuid },
    { name: 'add_field_sub_category_id', value: 'e95f5f84-f81e-4df4-a634-c7d1d16ff409' },
    { name: 'additional_fields[]', value: phoneFieldUuid },
    { name: `dopf_${phoneFieldUuid}`, value: '0501699088' },
    { name: 'standart_comment', value: standardCommentUuid },
    { name: 'comment', value: '' }
  ]
});
assert.equal(uuidParams.get('customer_uuid'), customerUuid);
assert.equal(uuidParams.has('customer_id'), false);
assert.equal(uuidParams.get(`dopf_${phoneFieldUuid}`), '0501699088');
assert.equal(uuidParams.get('standart_comment'), standardCommentUuid);
assert.throws(() => callRegistrationParams({ customerId: '316906', fields: [{ name: '<script>', value: 'x' }] }));

console.log('call_registration_rules_architecture_test: PASS');
