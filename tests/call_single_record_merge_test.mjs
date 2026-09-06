import assert from 'node:assert/strict';
import {
  createCallStore,
  upsertPbxCall,
  upsertCanonicalCall,
  findByPbxRecordId,
  listCalls
} from '../src/features/call/storage/call-repository.js';

const store = createCallStore();
const observedAt = '2026-09-06T10:00:00.000Z';

const provisional = upsertPbxCall(store, {
  recordId: '178868208.233531',
  date: '06.09.2026',
  time: '13:00',
  callerId: '0671234567',
  fio: 'Тестовый абонент',
  createdAtMs: Date.parse(observedAt)
}, observedAt).call;

assert.equal(provisional.callKey, 'pbx:178868208.233531');
assert.equal(listCalls(store).length, 1);

const canonical = upsertCanonicalCall(store, {
  usersideCallId: '24808891',
  recordId: '178868208.233531',
  startedAtMs: Date.parse(observedAt),
  durationSeconds: 120,
  callerId: '0671234567',
  customerId: '26809',
  fio: 'Тестовый абонент'
}, '2026-09-06T10:02:00.000Z').call;

assert.equal(canonical.callKey, 'call:24808891');
assert.equal(canonical.pbxRecordId, '178868208.233531');
assert.equal(listCalls(store).length, 1, 'PBX provisional record must merge into canonical UserSide call');
assert.equal(store.calls['pbx:178868208.233531'], undefined);
assert.equal(findByPbxRecordId(store, '178868208.233531')?.callKey, 'call:24808891');

console.log('call_single_record_merge_test: PASS');
