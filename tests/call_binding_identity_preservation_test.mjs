import assert from 'node:assert/strict';
import { createBindingStore, putBinding } from '../src/features/call/storage/binding-repository.js';

const store = createBindingStore();

const first = putBinding(store, {
  callKey: 'call:2481721',
  identity: {
    caseId: 'case:customer:48702',
    customerId: '48702',
    contract: '20724390',
    login: 'abon20724390'
  },
  caseLabel: 'Subscriber 48702'
}, { nowIso: '2026-09-07T18:00:00.000Z' }).binding;

assert.equal(first.customerId, '48702');
assert.equal(first.identity.customerId, '48702');

// A later score/rebind can contain a normalized identity with empty optional
// fields. It must enrich/retain the binding, never erase a resolved customerId.
const second = putBinding(store, {
  callKey: 'call:2481721',
  identity: {
    caseId: 'case:customer:48702',
    customerId: '',
    contract: '20724390',
    login: 'abon20724390'
  }
}, { nowIso: '2026-09-07T18:01:00.000Z' }).binding;

assert.equal(second.customerId, '48702');
assert.equal(second.identity.customerId, '48702');
assert.equal(second.identity.contract, '20724390');
assert.equal(second.identity.login, 'abon20724390');

console.log('call_binding_identity_preservation_test: PASS');
