import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BILLING_MAIN_SUMMARY_SELECTOR, readBillingSummaryLive } from '../src/features/ai-operator/billing-summary-live.js';

function requireSource() {
  return readFileSync(new URL('../src/features/ai-operator/billing-summary-live.js', import.meta.url), 'utf8');
}

test('Billing finance/tariff summary is anchored to the unique main summary table', () => {
  assert.equal(BILLING_MAIN_SUMMARY_SELECTOR, 'table.tbg1.nav3.width100');
});

test('Billing summary reader refuses to run without a Billing id', async () => {
  const result = await readBillingSummaryLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
});


test('Billing summary scans nested tariff rows and preserves both discount percent and amount', () => {
  const source = requireSource();
  assert.match(source, /const pageRows = readRows\(root\)/);
  assert.match(source, /discountFromRows\(pageRows\)/);
  assert.match(source, /row\.cells\.length < 2/);
  assert.match(source, /\^\(\?:скидк\|знижк\)/u);
  assert.match(source, /%\/u\.test\(label\).*percent = numeric/s);
  assert.match(source, /грн\/iu\.test\(label\).*adjustmentUAH = numeric/s);
  assert.match(source, /amountUAH:\s*Math\.abs\(adjustmentUAH\)/);
  assert.match(source, /adjustmentUAH/);
  assert.match(source, /entries/);
  assert.match(source, /finance\.discount = discount/);
});
