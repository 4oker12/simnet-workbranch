import test from 'node:test';
import assert from 'node:assert/strict';
import { billingBalanceView, billingTariffView, normalizeBillingMainSnapshot } from '../src/features/ai-operator/billing-main-snapshot.js';

test('canonical Billing main snapshot merges one fresh read over stored context', () => {
  const snapshot = normalizeBillingMainSnapshot({
    billingId: '49378',
    observedAt: '2026-09-18T20:30:00.000Z',
    cache: 'miss',
    baseData: {
      identity: { billingId: '49378', login: 'old-login', contract: '493782' },
      technical: { technologyHint: 'GPON' },
      address: { street: 'вул. Білицька' },
      payments: [{ date: 'old', description: 'old', amount: '1' }]
    },
    liveData: {
      identity: { billingId: '49378', login: 'abon493782', fullName: 'Грицак Володимир Юрійович' },
      service: {
        currentTariff: 'BIZ 800 (20/100) - 2025',
        nextTariff: '',
        accessState: 'Разрешен',
        serviceState: 'Все ОК',
        activeServices: [{ name: 'Виділ. 1xIP', amount: 50 }],
        activeServicesTotal: 50
      },
      finance: { accountBalance: 1900, price: 800, totalDue: 800, balanceAfterTariff: 1100 },
      network: { ip: '10.7.0.13', trafficIncomingBytes: '47 731 274 506' },
      payments: [{ date: '31.08.26 23:59', description: 'Снятие за услуги интернет', amount: '-800 грн.' }],
      evidence: { source: 'billing-main-live-read-only' }
    }
  });

  assert.equal(snapshot.identity.login, 'abon493782');
  assert.equal(snapshot.identity.contract, '493782');
  assert.equal(snapshot.service.currentTariff, 'BIZ 800 (20/100) - 2025');
  assert.equal(snapshot.finance.accountBalance, 1900);
  assert.equal(snapshot.technical.technologyHint, 'GPON');
  assert.equal(snapshot.address.street, 'вул. Білицька');
  assert.equal(snapshot.payments[0].amount, '-800 грн.');
  assert.equal(snapshot.evidence.observedAt, '2026-09-18T20:30:00.000Z');
});

test('balance and tariff are views of the same canonical Billing main snapshot', () => {
  const snapshot = normalizeBillingMainSnapshot({
    billingId: '42',
    liveData: {
      service: { currentTariff: 'Гігабіт 350', accessState: 'Разрешен', activeServicesTotal: 50 },
      finance: { accountBalance: 450, price: 350, totalDue: 400, balanceAfterTariff: 50 },
      network: { trafficIncomingBytes: '100', trafficOutgoingBytes: '50' },
      payments: [{ date: 'today', description: 'Wayforpay', amount: '100 грн.' }]
    }
  });
  const balance = billingBalanceView(snapshot);
  const tariff = billingTariffView(snapshot);

  assert.equal(balance.accountBalance, 450);
  assert.equal(balance.currentTariff, 'Гігабіт 350');
  assert.equal(balance.activeServicesTotal, 50);
  assert.equal(balance.recentOperations.length, 1);
  assert.equal(tariff.currentTariff, 'Гігабіт 350');
  assert.equal(tariff.price, 350);
  assert.equal(tariff.totalDue, 400);
  assert.equal(balance.source, tariff.source);
});
