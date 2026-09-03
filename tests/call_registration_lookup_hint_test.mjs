import assert from 'node:assert/strict';
import { exactCustomerIdFromSearch } from '../src/features/call/registration-rules.js';

const html = `
<table>
<tr><td><a href="/customer/111">Інший абонент</a></td><td>abon999999</td></tr>
<tr><td><a href="/customer/12842">Потоцький Максим</a></td><td>abon510344</td></tr>
</table>`;
const staleCase = { identity: { login: { value: 'abon171' }, contract: { value: '171' } } };
assert.equal(exactCustomerIdFromSearch(html, staleCase), '');
assert.equal(exactCustomerIdFromSearch(html, staleCase, ['abon510344']), '12842');
console.log('PASS call_registration_lookup_hint_test');
