import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const fetchClient = fs.readFileSync(new URL('../src/infrastructure/fetch-client.js', import.meta.url), 'utf8');

assert.match(ui, /function currentCustomerUuid\(\)/);
assert.match(ui, /url\.searchParams\.set\('customer_uuid', uuid\)/);
assert.match(ui, /hiddenValue\('customer_uuid'\)/);
assert.match(ui, /input\[name\^="dopf_"\]/);
assert.match(ui, /phoneFieldName:\s*this\.model\.phoneFieldName/);
assert.match(ui, /customerUuid:\s*this\.caseSnapshot\.customerUuid/);
assert.match(ui, /await Promise\.allSettled\(\[/);

assert.match(background, /customerUuidFromCallPage\(customerPage\.data, customerPage\.url\)/);
assert.match(background, /url\.searchParams\.set\('customer_uuid', customerUuid\)/);
assert.match(fetchClient, /headers\.set\('x-requested-with', 'XMLHttpRequest'\)/);
assert.match(fetchClient, /hasCustomerUuid/);

console.log('call_registration_uuid_form_contract_test: PASS');
