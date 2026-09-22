import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACT_RESOLUTION_STATUS,
  evaluateLegacyToolFactCoverage,
  isTariffCatalogScope,
  isSubscriberCurrentTariffScope,
  summarizeCanonicalFactResolution
} from '../src/features/ai-operator/fact-evidence-gate.js';
import { requestedFactCovered } from '../src/features/ai-operator/answer-relevance-gate.js';
import { resolveFacts } from '../src/features/ai-operator/canonical-fact-resolver.js';

const NOW = Date.parse('2026-09-20T02:00:00.000Z');
const IDENTITY = {
  confirmedCaseId: 'billing-live:99',
  confirmedSubscriber: { billingId: '99', contract: '100001', login: 'abon100001' }
};

function value(result, path) {
  return result.facts.find(item => item.path === path);
}

test('catalog scope is distinct from subscriber current-tariff scope', () => {
  assert.equal(isTariffCatalogScope('Какие у вас обычные тарифы?'), true);
  assert.equal(isTariffCatalogScope('які тарифи доступні?'), true);
  assert.equal(isTariffCatalogScope('покажи варианты пакетов'), true);
  assert.equal(isTariffCatalogScope('А у меня какой тариф?'), false);
  assert.equal(isSubscriberCurrentTariffScope('А у меня какой тариф?'), true);
  assert.equal(isSubscriberCurrentTariffScope('Какие тарифы есть?'), false);
});

test('tool ok with neighboring field does not cover requested fact', () => {
  const item = {
    ok: true,
    tool: 'billing.balance',
    requestedBy: { field: 'баланс на счету', why: 'сколько на счету' },
    data: { balanceAfterTariff: 0.99, price: 250 }
  };
  const result = evaluateLegacyToolFactCoverage(item);
  assert.equal(result.covered, false);
  assert.match(result.reason, /accountBalance_missing/);
  assert.equal(requestedFactCovered(item), false);
});

test('tool ok with correct field covers balance request', () => {
  const item = {
    ok: true,
    tool: 'billing.balance',
    requestedBy: { field: 'баланс', why: 'что по балансу' },
    data: { accountBalance: 320.99, balanceAfterTariff: 0.99 }
  };
  assert.equal(evaluateLegacyToolFactCoverage(item).covered, true);
  assert.equal(requestedFactCovered(item), true);
});

test('tariff catalog request is not closed by subscriber current tariff payload', () => {
  const item = {
    ok: true,
    tool: 'billing.tariff',
    requestedBy: {
      field: 'available tariff line',
      why: 'какие тарифы доступны? есть обычный стандарт?'
    },
    data: {
      currentTariff: 'SERVICE_STATE_PLACEHOLDER',
      tariffDisplay: 'SERVICE_STATE_PLACEHOLDER'
    }
  };
  const result = evaluateLegacyToolFactCoverage(item);
  assert.equal(result.covered, false);
  assert.match(result.reason, /tariff_catalog_request_not_satisfied/);
  assert.equal(requestedFactCovered(item), false);
});

test('subscriber current tariff request is covered by currentTariff field', () => {
  const item = {
    ok: true,
    tool: 'billing.tariff',
    requestedBy: { field: 'текущий тариф', why: 'какой у меня тариф' },
    data: { currentTariff: 'ANY_LABEL_A' }
  };
  assert.equal(evaluateLegacyToolFactCoverage(item).covered, true);
});

test('tool ok with empty payload does not cover explicit field request', () => {
  const item = {
    ok: true,
    tool: 'billing.balance',
    requestedBy: { field: 'баланс', why: 'сколько на счету' },
    data: { source: 'billing-live', observedAt: '2026-09-20T02:00:00.000Z' }
  };
  assert.equal(evaluateLegacyToolFactCoverage(item).covered, false);
});

test('canonical ok source without requested field stays UNKNOWN with FIELD_NOT_OBSERVED', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.finance.balance.account'],
    execute: async () => ({
      ok: true,
      tool: 'billing.main_summary',
      code: 'OK',
      observedAt: new Date(NOW).toISOString(),
      data: {
        finance: { balanceAfterTariff: 12.5, totalDue: 250 },
        service: { currentTariff: 'LABEL_X' },
        source: 'billing-main-summary-live-read-only'
      }
    }),
    now: NOW
  });

  const row = value(out, 'subscriber.finance.balance.account');
  assert.equal(row.status, 'unknown');
  assert.equal(row.observed, false);
  assert.equal(row.code, 'FIELD_NOT_OBSERVED');

  const summary = summarizeCanonicalFactResolution({
    requestedFacts: out.requestedFacts,
    evidence: out.evidence,
    sourceTrace: out.sourceTrace
  });
  assert.deepEqual(summary.unknown, ['subscriber.finance.balance.account']);
  assert.equal(summary.requestClosed, false);
  assert.ok(summary.unresolved.includes('subscriber.finance.balance.account'));
});

test('canonical observed value becomes KNOWN and can close request', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.finance.balance.account'],
    execute: async () => ({
      ok: true,
      tool: 'billing.main_summary',
      code: 'OK',
      observedAt: new Date(NOW).toISOString(),
      data: {
        finance: { accountBalance: 150 },
        source: 'billing-main-summary-live-read-only'
      }
    }),
    now: NOW
  });

  assert.equal(value(out, 'subscriber.finance.balance.account').status, 'known');
  assert.equal(value(out, 'subscriber.finance.balance.account').value, 150);

  const summary = summarizeCanonicalFactResolution({
    requestedFacts: ['subscriber.finance.balance.account'],
    evidence: out.evidence,
    sourceTrace: out.sourceTrace
  });
  assert.deepEqual(summary.known, ['subscriber.finance.balance.account']);
  assert.equal(summary.requestClosed, true);
});

test('source failure maps to UNAVAILABLE and leaves request open', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.tariff.current.name'],
    execute: async ({ tool }) => ({
      ok: false,
      tool,
      code: 'SOURCE_UNAVAILABLE',
      data: {}
    }),
    now: NOW
  });

  const summary = summarizeCanonicalFactResolution({
    requestedFacts: out.requestedFacts,
    evidence: out.evidence,
    sourceTrace: out.sourceTrace
  });
  assert.equal(summary.facts[0].status, FACT_RESOLUTION_STATUS.UNAVAILABLE);
  assert.equal(summary.requestClosed, false);
});

test('requested fact without evidence row is UNKNOWN not silently omitted', () => {
  const summary = summarizeCanonicalFactResolution({
    requestedFacts: ['subscriber.access.connectionFamily', 'subscriber.finance.balance.account'],
    evidence: [{
      path: 'subscriber.finance.balance.account',
      status: 'known',
      observed: true,
      value: 10
    }],
    sourceTrace: []
  });
  assert.equal(summary.facts.length, 2);
  assert.ok(summary.unknown.includes('subscriber.access.connectionFamily'));
  assert.equal(summary.facts.find(f => f.path === 'subscriber.access.connectionFamily').code, 'FACT_NOT_ATTEMPTED');
  assert.equal(summary.requestClosed, false);
});

test('ABSENT is resolved observation and does not leave fact as UNKNOWN', () => {
  const summary = summarizeCanonicalFactResolution({
    requestedFacts: ['subscriber.tariff.scheduledChange.nextTariff'],
    evidence: [{
      path: 'subscriber.tariff.scheduledChange.nextTariff',
      status: 'absent',
      observed: true,
      value: null
    }]
  });
  assert.deepEqual(summary.absent, ['subscriber.tariff.scheduledChange.nextTariff']);
  assert.equal(summary.requestClosed, true);
  assert.deepEqual(summary.unresolved, []);
});

test('neighboring access fact does not satisfy a different access fact', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.access.connectionFamily'],
    execute: async ({ tool }) => ({
      ok: true,
      tool,
      code: 'OK',
      observedAt: new Date(NOW).toISOString(),
      data: {
        network: { accessPort: '8' },
        source: 'userside-live-read-only'
      }
    }),
    now: NOW
  });
  const row = value(out, 'subscriber.access.connectionFamily');
  assert.equal(row.status, 'unknown');
  assert.equal(row.observed, false);

  const summary = summarizeCanonicalFactResolution({
    requestedFacts: out.requestedFacts,
    evidence: out.evidence,
    sourceTrace: out.sourceTrace
  });
  assert.equal(summary.requestClosed, false);
});
