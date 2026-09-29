import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BILLING_MAIN_SUMMARY_SELECTOR, readBillingSummaryLive } from '../src/features/ai-operator/billing-summary-live.js';

const summarySource = fs.readFileSync(new URL('../src/features/ai-operator/billing-summary-live.js', import.meta.url), 'utf8');
const snapshotSource = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');

test('Billing finance/tariff summary is anchored to the unique main summary table', () => {
  assert.equal(BILLING_MAIN_SUMMARY_SELECTOR, 'table.tbg1.nav3.width100');
});

test('Billing summary reader refuses to run without a Billing id', async () => {
  const result = await readBillingSummaryLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
});


test('Billing summary keeps hidden-only discount as observed evidence without assuming units', () => {
  assert.match(summarySource, /querySelectorAll\('input\[type="hidden"\]'\)/);
  assert.match(summarySource, /hiddenControls\.length === 1/);
  assert.match(summarySource, /finance\.discountText = discountText/);
  assert.match(summarySource, /billing_observed_discount_field_raw_units_not_assumed/);
  assert.match(summarySource, /\^знижк\/i/);
  assert.match(snapshotSource, /input\[type="hidden"\]/);
  assert.match(snapshotSource, /discountText/);
  assert.match(snapshotSource, /billing_observed_discount_field_raw_units_not_assumed/);
});
