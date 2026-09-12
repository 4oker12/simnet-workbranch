import assert from 'node:assert/strict';
import {
  canonicalCallKey,
  createCallStore,
  normalizeCanonicalCall,
  upsertCanonicalCall
} from '../src/features/call/storage/call-repository.js';

const uuid = '4c0feb1d-552d-4788-ac81-8a02e703ec2a';

assert.equal(canonicalCallKey(uuid), `call:${uuid}`);
assert.equal(canonicalCallKey(`call:${uuid}`), `call:${uuid}`);
assert.equal(canonicalCallKey({ usersideCallId: uuid }), `call:${uuid}`);

const normalized = normalizeCanonicalCall({
  usersideCallId: uuid,
  startedAtMs: 1_789_222_400_000,
  durationSeconds: 35,
  callerId: '0501699088',
  agentExtension: '6047'
});
assert.equal(normalized?.usersideCallId, uuid);
assert.equal(normalized?.callKey, `call:${uuid}`);

const legacyDigits = uuid.replace(/\D+/g, '').slice(0, 24);
const store = createCallStore();
store.calls[`call:${legacyDigits}`] = {
  schema: 'simnet-call-record-v2',
  callKey: `call:${legacyDigits}`,
  usersideCallId: legacyDigits,
  startedAtMs: 1_789_222_400_000,
  callerId: '0501699088',
  timeline: []
};

const result = upsertCanonicalCall(store, {
  usersideCallId: uuid,
  startedAtMs: 1_789_222_400_000,
  durationSeconds: 35,
  callerId: '0501699088',
  agentExtension: '6047'
});

assert.equal(result.stored, true);
assert.ok(store.calls[`call:${uuid}`]);
assert.equal(store.calls[`call:${legacyDigits}`], undefined);
assert.equal(store.calls[`call:${uuid}`].usersideCallId, uuid);

console.log('call_uuid_key_contract_test: PASS');
