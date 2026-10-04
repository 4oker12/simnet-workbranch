import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Billing page snapshot captures nested discount percent and UAH rows separately', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /function readDiscount\(\)/);
  assert.match(source, /querySelectorAll\('tr'\)/);
  assert.match(source, /cells\.length < 2/);
  assert.match(source, /\^\(\?:скидк\|знижк\)/u);
  assert.match(source, /%\/u\.test\(label\).*percent = numeric/s);
  assert.match(source, /грн\/iu\.test\(label\).*adjustmentUAH = numeric/s);
  assert.match(source, /amountUAH:\s*Math\.abs\(adjustmentUAH\)/);
  assert.match(source, /appliesTo:\s*'internet_tariff'/);
  assert.match(source, /const discount = readDiscount\(\)/);
  assert.match(source, /discount\n\s*}/);
});

test('passive Billing snapshot mirrors the wide a=user main-page fields', () => {
  const source = readFileSync(
    new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /MAIN_FORM_SELECTOR = 'form#formedit > table\.tbg1\.width100'/);
  assert.match(source, /groupId:/);
  assert.match(source, /currentTariffSelectedId:/);
  assert.match(source, /tvTariff:/);
  assert.match(source, /ppk:\s*rowValue/);
  assert.match(source, /displayedPlanCost:/);
  assert.match(source, /accountBalanceSemantics:\s*'billing_displayed_balance_may_include_temporary_payment'/);
  assert.match(source, /temporaryPaymentSemantics:\s*'billing_temporary_credit_not_customer_money'/);
  assert.match(source, /uaixOutgoingBytes:/);
  assert.match(source, /parseMeta:/);
  assert.match(source, /unselected_select_options/);
});

test('local subscriber snapshot preserves captured discount for canonical fallback', async () => {
  const { executeOperatorTool } = await import('../src/features/ai-operator/tool-runtime.js');
  const discount = { percent: 10, amountUAH: 25, appliesTo: 'internet_tariff', evidence: { rows: Array.from({ length: 20 }, (_, i) => ({ i })) } };
  const memory = {
    simnet_workbench_state_v5: { cases: { '900001': { identity: { billingId: '900001' } } } },
    simnet_ai_operator_billing_snapshots_v1: { '900001': { billingId: '900001', service: { currentTariff: 'Test tariff' }, finance: { discount } } }
  };
  globalThis.chrome = { storage: { local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, memory[k]])); } } } };
  const result = await executeOperatorTool({ tool: 'customer.snapshot', labState: { confirmedCaseId: '900001' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.finance.discount, discount);
});
