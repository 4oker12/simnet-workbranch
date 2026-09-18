import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyUserSideLookup } from '../src/features/ai-operator/userside-live-search.js';

assert.deepEqual(
  classifyUserSideLookup({ customerId: '383410' }),
  { mode: 'customerId', value: '383410' }
);
assert.deepEqual(
  classifyUserSideLookup({ login: 'abon470642' }),
  { mode: 'login', value: 'abon470642' }
);
assert.deepEqual(
  classifyUserSideLookup({ contract: '470642' }),
  { mode: 'contract', value: '470642' }
);
assert.deepEqual(
  classifyUserSideLookup({ ip: '10.8.2.45' }),
  { mode: 'ip', value: '10.8.2.45' }
);
assert.deepEqual(
  classifyUserSideLookup({ address: 'вул. Метрологічна 44 кв 9' }),
  { mode: 'address', value: 'вул. Метрологічна 44 кв 9' }
);

const searchSource = fs.readFileSync(new URL('../src/features/ai-operator/userside-live-search.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');
const brokerSource = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');

// UserSide live access must stay GET/read-only and reuse the authenticated browser session.
assert.match(searchSource, /new URL\('\/customer_list'/);
assert.match(searchSource, /searchParams\.set\('search'/);
assert.match(searchSource, /new URL\(`\/customer\/\$\{customerId\}`/);
assert.match(searchSource, /method:\s*'GET'/);
assert.match(searchSource, /credentials:\s*'include'/);
assert.match(searchSource, /cache:\s*'no-store'/);
assert.doesNotMatch(searchSource, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/i);
assert.doesNotMatch(searchSource, /\.click\s*\(/);

// Snapshot must expose the technical evidence the operator actually uses.
for (const field of [
  'connectionFamily', 'accessDeviceId', 'accessDeviceName', 'accessDeviceIp',
  'accessPort', 'accessInterface', 'accessLinkState', 'accessSpeedMbps',
  'onuSerial', 'onuMac', 'oltName', 'oltIp', 'oltDeviceId', 'foundOnOlt',
  'rx', 'tx', 'oltRx'
]) {
  assert.match(searchSource, new RegExp(`\\b${field}\\b`), `UserSide snapshot must expose ${field}`);
}
assert.match(searchSource, /userside-live-read-only/);
assert.match(searchSource, /#ref_inventory/);
assert.match(searchSource, /точка\\s\+подключения/);

// Runtime must keep the Billing identity and refuse mismatched UserSide evidence.
assert.match(runtimeSource, /searchUserSideLive/);
assert.match(runtimeSource, /USERSIDE_IDENTITY_MISMATCH/);
assert.match(runtimeSource, /userside\.snapshot/);
assert.match(runtimeSource, /pon\.onu/);
assert.match(runtimeSource, /pon\.signal/);
assert.match(runtimeSource, /userside-live-read-only/);

// Semantic broker must describe UserSide as live and route directly to the runtime tool.
assert.equal(/workbench-userside-reader-context/.test(brokerSource), false);
assert.match(brokerSource, /userside:\s*'live-read-only'/);
assert.match(brokerSource, /source=userside-live-read-only/);

console.log('ai_operator_live_userside_search_test: PASS');
