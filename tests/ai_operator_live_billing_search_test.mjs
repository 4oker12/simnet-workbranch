import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyBillingLookup } from '../src/features/ai-operator/billing-live-search.js';

assert.deepEqual(
  classifyBillingLookup({ query: 'abon470642' }),
  { mode: 'login', value: 'abon470642' }
);
assert.deepEqual(
  classifyBillingLookup({ contract: '470642' }),
  { mode: 'contract', value: '470642' }
);
assert.deepEqual(
  classifyBillingLookup({ ip: '10.8.2.45' }),
  { mode: 'ip', value: '10.8.2.45' }
);
assert.deepEqual(
  classifyBillingLookup({ address: 'вул. Метрологічна, буд. 44, кв. 9' }),
  { mode: 'address', value: 'вул. Метрологічна, буд. 44, кв. 9' }
);

const searchSource = fs.readFileSync(new URL('../src/features/ai-operator/billing-live-search.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');
const labSource = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');

// Live lookup must reproduce Billing's real read-only listuser forms.
assert.match(searchSource, /a:\s*'listuser'/);
assert.match(searchSource, /what_search:\s*lookupRequest\.mode/);
assert.match(searchSource, /name:\s*lookupRequest\.value/);
assert.match(searchSource, /f:\s*'d'/);
for (const field of ['dopfield_5', 'dopfield_6', 'dopfield_11', 'dopfield_8']) {
  assert.match(searchSource, new RegExp(`${field}:`));
}
assert.match(searchSource, /credentials:\s*'include'/);
assert.match(searchSource, /searchParams\.get\('pp'\)/);
assert.doesNotMatch(searchSource, /chrome\.storage\.local\.set\([^\n]*pp/i);

// Search results must resolve through real Billing user links/cards, not cached cases.
assert.match(searchSource, /searchParams\.get\('a'\).*user/s);
assert.match(searchSource, /a:\s*'user',\s*id:\s*billingId/);
assert.match(runtimeSource, /searchBillingLive\(toolArgs\)/);
assert.match(runtimeSource, /billing-live-read-only/);
assert.match(runtimeSource, /persistSnapshots\(live\.snapshots/);
assert.match(runtimeSource, /billing\.balance/);
assert.match(runtimeSource, /billing\.tariff/);
assert.match(labSource, /from '\.\/live-tool-runtime\.js'/);

console.log('ai_operator_live_billing_search_test: PASS');
