import assert from 'node:assert/strict';

import { executeOperatorTool, userSideIdentityMatches } from '../src/features/ai-operator/live-tool-runtime.js';

const storage = {
  simnet_ai_operator_billing_snapshots_v1: {
    '4242': {
      billingId: '4242',
      observedAt: new Date().toISOString(),
      identity: { billingId: '4242', contract: '117426', login: 'abon117426' },
      service: { currentTariff: '100 Мбит/с — 250 грн', nextTariff: '', nextTariffDelay: '' },
      finance: { accountBalance: 230, price: 250, totalDue: 250 }
    }
  }
};

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: storage[key] };
      },
      async set(patch) {
        Object.assign(storage, patch);
      }
    }
  }
};

const nextCharge = await executeOperatorTool({
  tool: 'billing.next_charge',
  labState: {
    confirmedCaseId: 'billing-live:4242',
    confirmedSubscriber: { billingId: '4242', contract: '117426', login: 'abon117426' }
  }
});
assert.equal(nextCharge.ok, false, 'exact next charge must not be invented from current Billing totals');
assert.equal(nextCharge.code, 'DATA_NOT_AVAILABLE', 'live Billing case must fail safely instead of falling through to CASE_NOT_FOUND');
assert.equal(nextCharge.data.currentTariff, '100 Мбит/с — 250 грн');
assert.equal(nextCharge.data.accountBalance, 230);
assert.match(nextCharge.data.message, /точную дату и сумму следующего списания/i);
assert.ok(nextCharge.warnings.some(item => /не выводить следующее списание/i.test(item)));

assert.equal(userSideIdentityMatches({
  identity: { login: 'abon117426', contract: '999999' },
  network: { ip: '10.0.0.1' }
}, {
  confirmedSubscriber: { login: 'abon117426', contract: '117426', ip: '10.0.0.1' }
}), false, 'one matching identifier must never override a conflicting contract');

assert.equal(userSideIdentityMatches({
  identity: { login: 'abon117426', contract: '117426' },
  network: { ip: '10.0.0.2' }
}, {
  confirmedSubscriber: { login: 'abon117426', contract: '117426', ip: '10.0.0.1' }
}), false, 'a conflicting comparable strong identifier must reject cross-system data');

assert.equal(userSideIdentityMatches({
  identity: { login: 'abon117426', contract: '117426' },
  network: { ip: '10.0.0.1' }
}, {
  confirmedSubscriber: { login: 'abon117426', contract: '117426', ip: '10.0.0.1' }
}), true, 'all comparable strong identifiers may confirm the same subscriber');

assert.equal(userSideIdentityMatches({
  identity: {},
  address: { full: 'ул. Метрологическая, дом 44, кв. 9' },
  network: {}
}, {
  confirmedSubscriber: { address: 'Метрологическая 44 9' }
}), true, 'address may be used only as fallback when no strong identifiers are comparable');

assert.equal(userSideIdentityMatches({ identity: {}, address: {}, network: {} }, {
  confirmedSubscriber: { login: 'abon117426' }
}), false, 'missing comparable evidence must not silently confirm UserSide identity');

console.log('ai_operator_live_runtime_guard_test: PASS');
