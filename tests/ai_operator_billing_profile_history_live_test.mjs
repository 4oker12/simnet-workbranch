import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readBillingProfileLive } from '../src/features/ai-operator/billing-profile-live.js';
import { classifyBillingHistoryEvent, historyPaymentsView, readBillingHistoryLive } from '../src/features/ai-operator/billing-history-live.js';

const profileSource = fs.readFileSync(new URL('../src/features/ai-operator/billing-profile-live.js', import.meta.url), 'utf8');
const historySource = fs.readFileSync(new URL('../src/features/ai-operator/billing-history-live.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');

test('Billing profile reader requires identity and uses canonical tmpl=2 fields', async () => {
  const result = await readBillingProfileLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
  assert.match(profileSource, /url\.searchParams\.set\('tmpl', '2'\)/);
  for (const field of ['dopfield_5', 'dopfield_6', 'dopfield_11', 'dopfield_12', 'dopfield_7', 'dopfield_8', 'dopfield_9', 'dopfield_22', 'dopfield_14', 'dopfield_31', 'dopfield_32', 'dopfield_33', 'dopfield_43', 'dopfield_25', 'dopfield_10']) {
    assert.match(profileSource, new RegExp(field));
  }
});

test('Billing history reader uses payshow and preserves events beyond payments', async () => {
  const result = await readBillingHistoryLive({ billingId: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_ID_REQUIRED');
  assert.match(historySource, /url\.searchParams\.set\('mid'/);
  assert.match(historySource, /url\.searchParams\.set\('a', 'payshow'\)/);
  assert.equal(classifyBillingHistoryEvent('Wayforpay пополнение 500 грн'), 'payment');
  assert.equal(classifyBillingHistoryEvent('Снятие за услуги интернет -250 грн'), 'charge');
  assert.equal(classifyBillingHistoryEvent('Изменение тарифного пакета'), 'tariff_change');
  assert.equal(classifyBillingHistoryEvent('Изменение IP адреса'), 'ip_change');
});

test('billing.payments is now a compatibility view over canonical billing.history', () => {
  const payments = historyPaymentsView({ events: [
    { kind: 'payment', date: '01.09.2026', description: 'Wayforpay', amount: 500, amountText: '500 грн' },
    { kind: 'charge', date: '02.09.2026', description: 'Снятие за интернет', amount: -250, amountText: '-250 грн' },
    { kind: 'tariff_change', date: '03.09.2026', description: 'Смена тарифа', amount: null, amountText: '' }
  ] });
  assert.deepEqual(payments, [
    { date: '01.09.2026', description: 'Wayforpay', amount: '500 грн' },
    { date: '02.09.2026', description: 'Снятие за интернет', amount: '-250 грн' }
  ]);
  assert.match(runtimeSource, /name === 'billing\.history' \|\| name === 'billing\.payments'/);
  assert.match(runtimeSource, /historyPaymentsView\(data\)/);
});
