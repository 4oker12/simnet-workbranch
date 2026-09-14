import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const BILLING_SEMANTIC_ROUTES'), source.indexOf('async function recordEvidenceRequest'));
const caseId = 'login:test';
const state = { cases: { [caseId]: { identity: { billingId: '40839' }, contexts: {
  billing: { url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?id=40839' }
} } }, handoffs: {
  stale: { caseId: 'login:other', sourceTabId: 9, createdAtMs: 100, status: 'claimed' },
  closed: { caseId, sourceTabId: 8, createdAtMs: 100, status: 'claimed' }
} };
let tabs = [
  { id: 2, windowId: 1, url: 'https://admin.looknet.kiev.ua/cgi-bin/adm/adm.pl?pp=test-session&id=40839' },
  { id: 3, windowId: 1, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=test-session&id=40839' }
];
const updates = [];
const sandbox = { URL, Set, Date, console, readStateReference: async () => state,
  validHandoffToken: () => true, CLAIMED_HANDOFF_TTL_MS: 10000, HANDOFF_TTL_MS: 10000,
  nowMs: () => 200, nowIso: () => new Date(200).toISOString(),
  rawFactValue: v => v?.value ?? v, compact: v => String(v),
  enqueue: async fn => fn(state),
  chrome: { tabs: {
    get: async id => { const tab = tabs.find(t => t.id === id); if (!tab) throw Error('closed'); return tab; },
    query: async () => tabs,
    update: async (id, update) => { updates.push({ id, update }); }
  }, windows: { update: async () => {} } }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
let result = await sandbox.focusHandoffSource({ token: 'stale', caseId, entityId: '40839', semanticTargetId: 'billing.poll.gpon' });
assert.equal(result.focused, true);
assert.equal(result.navigated, true);
assert.equal(updates[0].id, 3, 'closed source recovers only within the correct Billing realm');
assert.equal(new URL(updates[0].update.url).searchParams.get('a'), '311');
assert.equal(new URL(updates[0].update.url).searchParams.get('id'), '40839');
tabs = [];
result = await sandbox.focusHandoffSource({ caseId, entityId: '40839', semanticTargetId: 'billing.poll.gpon' });
assert.equal(result.focused, false);
assert.equal(result.code, 'BILLING_SESSION_NOT_CONFIRMED');
console.log('billing_reverse_navigation_test: PASS');
