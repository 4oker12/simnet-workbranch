import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCallModule } from '../src/features/call/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/readers/userside.js'), 'utf8');

const WB = { readers: {}, tmcParser: null };
globalThis.SIMNET_WB = WB;
globalThis.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
globalThis.location = { href: 'https://userside.simnet.kiev.ua/customer/15862' };
vm.runInThisContext(source, { filename: 'src/readers/userside.js' });

const parsed = WB.readers.userside.__test.parseCustomerCardIdentity(
  '! ЧАСТНЫЙ СЕКТОР Id: 15862 ФИО: Акієв Куртеюп Учетная запись/Логин: abon124569 Договор: 124569 от 2018-12-10 Активность в сети: 30.08.2026 01:47',
  new Map(),
  { entityId: '15862' }
);
assert.deepEqual(parsed, {
  customerId: '15862',
  login: 'abon124569',
  contract: '124569',
  fullName: 'Акієв Куртеюп'
});

let now = 2_030_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const state = { cases: {
  'login:abon124569': {
    identity: { caseId: 'login:abon124569', login: 'abon124569', contract: '124569', billingId: '12456' },
    profile: { fullName: 'Акієв Куртеюп' }
  }
} };
mod.ensure(state);
const start = now;

now += 1000;
mod.recordVisit(state, {
  pageKind: 'billing_user', entityId: '12456',
  identity: { billingId: '12456', login: 'abon124569', contract: '124569' },
  profile: { fullName: 'Акієв Куртеюп' },
  meta: { pageInstanceId: 'bill-a', pageInstanceStartedAt: now - 100 }
}, { tab: { id: 1, windowId: 1 } }, { accepted: true });

now += 1000;
mod.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '15862',
  identity: {
    customerId: { value: '15862', source: 'url:path' },
    login: { value: 'abon124569', source: 'userside:customer-card-login' },
    contract: { value: '124569', source: 'userside:customer-card-contract' }
  },
  profile: { fullName: { value: 'Акієв Куртеюп', source: 'userside:customer-card-full-name' } },
  meta: { pageInstanceId: 'us-a', pageInstanceStartedAt: now - 100 }
}, { tab: { id: 2, windowId: 1 } }, { accepted: true });

now += 1000;
const replay = mod.previewRange(state, { caseId: '', startAtMs: start, endAtMs: now });
assert.equal(replay.candidates.length, 1, 'Billing and UserSide evidence with exact login/contract must merge into one subscriber candidate');
const candidate = replay.candidates[0];
assert.equal(candidate.customerId, '15862');
assert.equal(candidate.billingId, '12456');
assert.equal(candidate.contract, '124569');
assert.equal(candidate.login, 'abon124569');
assert.equal(candidate.fullName, 'Акієв Куртеюп');
assert.ok(candidate.reasons.includes('userside+billing'));
console.log('PASS call_userside_card_identity_bridge_test');
