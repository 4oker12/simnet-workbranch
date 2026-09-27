import test from 'node:test';
import assert from 'node:assert/strict';
import { executeOperatorTool as localTool } from '../src/features/ai-operator/tool-runtime.js';
import { executeOperatorTool as liveTool } from '../src/features/ai-operator/live-tool-runtime.js';
import { runFactTurn } from '../src/features/ai-operator/fact-runtime.js';

const KEY = 'simnet_ai_operator_billing_snapshots_v1';
const NOW = Date.now();
const time = new Date(NOW).toISOString();
const subscriber = { billingId: '42', contract: '123456', login: 'abon777777' };
const identity = { confirmedCaseId: 'billing-live:42', confirmedSubscriber: subscriber };
const snapshot = {
  billingId: '42', identity: subscriber, observedAt: time,
  service: { currentTariff: 'Тариф 250', nextTariff: '', startDay: 1, accessState: 'Разрешен', group: 'Рабочие' },
  finance: { accountBalance: 270.1, totalDue: 250, balanceAfterTariff: 20.1 }
};
function install(storage, response = null) {
  let searches = 0;
  globalThis.chrome = {
    storage: { local: {
      get: async keys => typeof keys === 'string' ? { [keys]: structuredClone(storage[keys]) } : Object.fromEntries(keys.map(k => [k, structuredClone(storage[k])])),
      set: async patch => Object.assign(storage, structuredClone(patch))
    } },
    tabs: { query: async () => response ? [{ id: 7, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl' }] : [] },
    scripting: { executeScript: async () => { searches++; return [{ result: structuredClone(response) }]; } }
  };
  return () => searches;
}

test('real live adapter and resolver use stored confirmed snapshot without network round trip', async () => {
  const count = install({ [KEY]: { 42: snapshot } });
  const out = await runFactTurn({ text: 'следующий месяц', state: identity, now: NOW, execute: liveTool,
    interpret: async () => ({ questions: [{ entity: 'recurring_charge', relation: 'amount', period: 'next' }] }) });
  assert.match(out.decision.reply, /229,90/); assert.equal(count(), 0);
});
test('real live adapter cannot read account with subscriber fields but no confirmation', async () => {
  install({ [KEY]: { 42: snapshot } });
  const r = await liveTool({ tool: 'customer.snapshot', labState: { confirmedSubscriber: subscriber } });
  assert.equal(r.code, 'IDENTITY_REQUIRED');
});
test('failed refresh never serves stale data as a successful new observation', async () => {
  install({ [KEY]: { 42: { ...snapshot, observedAt: '2020-01-01T00:00:00Z' } } });
  const r = await liveTool({ tool: 'customer.snapshot', toolArgs: { refresh: true, maxAgeMs: 1000 }, labState: identity });
  assert.equal(r.ok, false); assert.equal(r.code, 'FRESH_DATA_UNAVAILABLE');
});
test('sparse live refresh preserves old field age; old balance cannot support a new answer', async () => {
  const oldTime = new Date(NOW - 3600000).toISOString();
  const fresh = { ...snapshot, finance: { totalDue: 250, accountBalance: null, balanceAfterTariff: null } };
  const storage = { [KEY]: { 42: { ...snapshot, observedAt: oldTime } } };
  const count = install(storage, { ok: true, candidates: [subscriber], snapshots: { 42: fresh } });
  const out = await runFactTurn({ text: 'баланс?', state: identity, now: NOW, execute: liveTool,
    interpret: async () => ({ questions: [{ entity: 'balance', relation: 'amount', period: 'current' }] }) });
  assert.equal(count(), 1);
  assert.equal(storage[KEY]['42'].finance.accountBalance, 270.1, 'legacy captured value preserved');
  assert.equal(storage[KEY]['42'].fieldObservedAt['finance.accountBalance'], oldTime);
  assert.doesNotMatch(out.decision.reply, /270/);
});
test('local login lookup never matches another subscribers equal contract digits', async () => {
  install({ [KEY]: {}, simnet_workbench_state_v5: { cases: {
    a: { identity: { contract: '777777', login: 'abon888888', billingId: '1' } },
    b: { identity: { contract: '123456', login: 'abon777777', billingId: '2' } }
  } } });
  const byLogin = await localTool({ tool: 'customer.lookup', toolArgs: { login: 'abon777777' } });
  assert.equal(byLogin.data.candidate.caseId, 'b');
  const byContract = await localTool({ tool: 'customer.lookup', toolArgs: { contract: '777777' } });
  assert.equal(byContract.data.candidate.caseId, 'a');
});
test('snapshot fallback never binds login digits to another contract', async () => {
  install({ [KEY]: { 999: { ...snapshot, identity: { contract: '777777', login: 'abon999999' } } },
    simnet_workbench_state_v5: { cases: { a: { identity: subscriber } } } });
  const r = await localTool({ tool: 'customer.snapshot', labState: { confirmedCaseId: 'a', confirmedSubscriber: subscriber } });
  assert.equal(r.data.finance.accountBalance, '');
});
test('real local source carries checked services and original observation timestamp', async () => {
  install({ [KEY]: { 42: { ...snapshot, service: { ...snapshot.service, activeServicesTotal: 50, nextTariffPrice: 350 } } },
    simnet_workbench_state_v5: { cases: { a: { identity: subscriber } } } });
  const r = await localTool({ tool: 'customer.snapshot', labState: { confirmedCaseId: 'a', confirmedSubscriber: subscriber } });
  assert.equal(r.data.service.activeServicesTotal, 50); assert.equal(r.data.service.nextTariffPrice, 350);
  assert.equal(r.data.evidence.billingSnapshotObservedAt, time);
});
