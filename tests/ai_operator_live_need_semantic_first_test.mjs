import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_NEED_RECOVERY_VERSION,
  hasLiveDataNeeds,
  planLiveDataNeeds,
  recoverLiveDataNeeds
} from '../src/features/ai-operator/live-need-recovery.js';

test('semantic evidence needs are authoritative before regex recovery', () => {
  const analysis = {
    probe: {
      whatUserWants: 'Клиент спрашивает о балансе и текущем тарифе',
      unresolvedRequests: ['Узнать баланс и тариф'],
      liveDataNeed: 'needed',
      evidenceNeeds: [
        { system: 'Billing', field: 'current balance', why: 'Нужен текущий финансовый факт' },
        { system: 'Billing', field: 'current tariff', why: 'Нужен текущий тариф договора' }
      ]
    }
  };

  const needs = planLiveDataNeeds(analysis);
  assert.deepEqual(needs, analysis.probe.evidenceNeeds);
  assert.equal(hasLiveDataNeeds(analysis), true);
  assert.equal(needs.some(item => /^billing\./i.test(item.field)), false, 'semantic layer describes facts, not tool names');
});

test('regex derivation remains recovery-only when semantic evidence plan is absent', () => {
  const analysis = {
    probe: {
      whatUserWants: 'Какой у меня баланс и тариф?',
      unresolvedRequests: ['Какой у меня баланс и тариф?']
    }
  };

  const needs = recoverLiveDataNeeds({ analysis, draft: {} });
  assert.equal(needs.some(item => item.field.startsWith('billing.balance:')), true);
  assert.equal(needs.some(item => item.field.startsWith('billing.tariff:')), true);
});

test('general definitions do not trigger subscriber live reads', () => {
  const analysis = {
    probe: {
      whatUserWants: 'Что такое баланс после тарифа?',
      unresolvedRequests: ['Что такое баланс после тарифа?']
    }
  };

  assert.deepEqual(planLiveDataNeeds(analysis), []);
  assert.equal(hasLiveDataNeeds(analysis), false);
});

test('live need recovery contract version reflects semantic-first planner', () => {
  assert.equal(LIVE_NEED_RECOVERY_VERSION, 6);
});
