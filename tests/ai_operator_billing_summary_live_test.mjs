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


test('Billing summary scans full table rows and preserves an observed discount field', () => {
  const source = requireSource();
  assert.match(source, /const pageRows = readRows\(root\)/);
  assert.match(source, /discountFromRows\(pageRows\)/);
  assert.match(source, /\(\?:скидк\|знижк\)/u);
  assert.match(source, /finance\.discount = discount/);
});
