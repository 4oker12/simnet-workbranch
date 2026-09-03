import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

let now = 2_020_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const start = now;
const oldCase = 'login:abon310601';
const state = { cases: {
  [oldCase]: {
    identity: { caseId: oldCase, login: 'abon310601', contract: '310601', billingId: '31060', customerId: '37676' },
    profile: { fullName: 'Литвиненко Віталій Юрійович' }
  },
  'login:abon245349': {
    identity: { caseId: 'login:abon245349', login: 'abon245349', contract: '245349', billingId: '24534', customerId: '19556' },
    profile: { fullName: 'Дорош Тарас Миколайович' }
  }
} };
mod.ensure(state);

// UserSide autocomplete click selects another customer while the current Workbench
// Case still belongs to Litvinenko. Search evidence itself carries the clicked name.
now = start + 1_000;
mod.recordSearch(state, {
  source: 'userside', kind: 'result-open', searchKind: 'global', query: '345',
  targetSubscriberId: '41645',
  identity: { customerId: '41645', fullName: 'Алоян Данієль Едікович' }
}, { tab: { id: 10, windowId: 1 } });

// Simulate stale DOM/case fields during the page switch. CALL visit identity must
// be anchored by /customer/41645 and the click hint, not by the prior Case.
now = start + 2_000;
mod.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '41645',
  identity: { customerId: '41645', login: 'abon310601', contract: '310601', billingId: '31060' },
  meta: {
    pageInstanceId: 'us-aloyan', pageInstanceStartedAt: start + 1_800,
    callTargetHint: { customerId: '41645', fullName: 'Алоян Данієль Едікович', ts: now - 500 }
  }
}, { tab: { id: 10, windowId: 1 } }, { accepted: true, caseId: oldCase });

// A later direct customer link from a task must likewise not inherit Litvinenko
// or a cached Doroš identity merely because Workbench currently knows them.
now = start + 5_000;
mod.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '19556',
  identity: { customerId: '19556', login: 'abon310601', contract: '310601', billingId: '31060' },
  meta: {
    pageInstanceId: 'us-kozlenko', pageInstanceStartedAt: start + 4_800,
    callTargetHint: { customerId: '19556', fullName: 'Козленко Тестовий Абонент', ts: now - 300 }
  }
}, { tab: { id: 10, windowId: 1 } }, { accepted: true, caseId: oldCase });

now = start + 10_000;
const replay = mod.previewRange(state, { caseId: '', startAtMs: start, endAtMs: start + 9_000 });
const aloyan = replay.candidates.find(c => c.customerId === '41645');
const kozlenko = replay.candidates.find(c => c.customerId === '19556');
assert.ok(aloyan, 'selected UserSide search customer must exist as its own candidate');
assert.equal(aloyan.fullName, 'Алоян Данієль Едікович');
assert.equal(aloyan.login, '', 'new UserSide customer must not inherit previous Case login');
assert.equal(aloyan.billingId, '', 'new UserSide customer must not inherit previous Case Billing ID');
assert.ok(kozlenko, 'direct UserSide customer target must remain independently identifiable');
assert.equal(kozlenko.fullName, 'Козленко Тестовий Абонент', 'current clicked label outranks cached label for CALL evidence');
assert.equal(kozlenko.login, '', 'direct target must not inherit active Case login');

const usVisits = replay.events.filter(e => e.type === 'SUBSCRIBER_VISIT' && e.source === 'userside');
assert.deepEqual(usVisits.map(e => [e.identity.customerId, e.identity.fullName, e.identity.login]), [
  ['41645', 'Алоян Данієль Едікович', ''],
  ['19556', 'Козленко Тестовий Абонент', '']
]);
console.log('PASS call_userside_identity_isolation_test');
