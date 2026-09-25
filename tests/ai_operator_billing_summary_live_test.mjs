import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BILLING_MAIN_FORM_SELECTOR, BILLING_MAIN_SUMMARY_SELECTOR, readBillingSummaryLive } from '../src/features/ai-operator/billing-summary-live.js';

function requireSource() {
  return readFileSync(new URL('../src/features/ai-operator/billing-summary-live.js', import.meta.url), 'utf8');
}

test('Billing main-page reader is anchored to the actual a=user data blocks', () => {
  assert.equal(BILLING_MAIN_FORM_SELECTOR, 'form#formedit > table.tbg1.width100');
  assert.equal(BILLING_MAIN_SUMMARY_SELECTOR, 'table.tbg1.nav3.width100');
});

test('Billing summary reader refuses to run without a Billing id', async () => {
  const result = await readBillingSummaryLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
});


test('Billing main-page reader scans the full known blocks and preserves nested discount rows', () => {
  const source = requireSource();
  assert.match(source, /const mainRows = readRows\(mainForm\)/);
  assert.match(source, /const summaryRows = readRows\(summaryTable\)/);
  assert.match(source, /discountFromRows\(summaryRows\) \|\| discountFromRows\(mainRows\)/);
  assert.match(source, /row\.cells\.length < 2/);
  assert.match(source, /\^\(\?:скидк\|знижк\)/u);
  assert.match(source, /%\/u\.test\(label\).*percent = numeric/s);
  assert.match(source, /грн\/iu\.test\(label\).*adjustmentUAH = numeric/s);
  assert.match(source, /amountUAH:\s*Math\.abs\(adjustmentUAH\)/);
  assert.match(source, /discount\.appliesTo = 'internet_tariff'/);
  assert.match(source, /finance\.discount = discount/);
});

test('Billing main-page snapshot is wide locally but select catalogs stay collapsed', () => {
  const source = requireSource();
  assert.match(source, /const selectedOption = \(root, name\)/);
  assert.match(source, /value:\s*compact\(option\?\.value/);
  assert.match(source, /label:\s*compact\(option\?\.textContent/);
  assert.match(source, /fullName:\s*input\(root, 'fio'\)/);
  assert.match(source, /contractDate:\s*input\(root, 'contract_date'\)/);
  assert.match(source, /ppk:\s*rowValueFromIndex\(mainIndex/);
  assert.match(source, /currentTariffSelectedId/);
  assert.match(source, /tvTariff:/);
  assert.match(source, /displayedPlanCost/);
  assert.match(source, /accountBalanceSemantics:\s*'billing_displayed_balance_may_include_temporary_payment'/);
  assert.match(source, /temporaryPaymentSemantics:\s*'billing_temporary_credit_not_customer_money'/);
  assert.match(source, /authorization:\s*auth/);
  assert.match(source, /uaixIncomingBytes/);
  assert.match(source, /internetAccountingMb/);
  assert.match(source, /unselected_select_options/);
});


test('configured internet package is authoritative over access/service state labels', () => {
  const source = requireSource();
  assert.match(source, /const configuredTariff = compact\(currentTariffOption\?\.label/);
  assert.match(source, /const currentTariff = configuredTariff \|\| summaryTariff/);
  assert.match(source, /currentTariffSource: configuredTariff \? 'select\[name="paket"\]'/);
  assert.match(source, /accessState: accessOption\?\.label/);
  assert.match(source, /serviceState: serviceStateOption\?\.label/);
  assert.ok(
    source.indexOf('const configuredTariff =') < source.indexOf('const currentTariff = configuredTariff'),
    'paket selection must be resolved before current tariff value'
  );
});
