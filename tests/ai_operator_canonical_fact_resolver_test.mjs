import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_FACT_CATALOG,
  canonicalFactPath
} from '../src/features/ai-operator/canonical-fact-catalog.js';
import {
  createCanonicalDomainContext,
  resolveFacts
} from '../src/features/ai-operator/canonical-fact-resolver.js';
import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker-impl.js';
import { buildSubscriberIntentProbeMessages } from '../src/features/ai-operator/semantic-probe.js';
import { planLiveDataNeeds } from '../src/features/ai-operator/live-need-recovery.js';

const NOW = Date.parse('2026-09-20T02:00:00.000Z');
const IDENTITY = {
  confirmedCaseId: 'billing-live:42',
  confirmedSubscriber: { billingId: '42', contract: '146888', login: 'abon146888' }
};

function mainSummary(overrides = {}) {
  return {
    ok: true,
    tool: 'billing.main_summary',
    code: 'OK',
    observedAt: new Date(NOW).toISOString(),
    data: {
      identity: { billingId: '42' },
      service: { currentTariff: 'SIMNET 500', tariffId: '17', nextTariff: '', nextTariffDelay: '' },
      finance: { accountBalance: 270.1, totalDue: 250, price: 250, balanceAfterTariff: 20.1 },
      unrelatedSecret: 'must-not-reach-projection',
      source: 'billing-main-summary-live-read-only',
      ...overrides
    }
  };
}

function value(result, path) {
  return result.facts.find(item => item.path === path);
}

test('current tariff only returns one requested canonical fact', async () => {
  const calls = [];
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.tariff.current.name'],
    execute: async input => { calls.push(input); return mainSummary(); },
    now: NOW
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'billing.main_summary');
  assert.equal(value(out, 'subscriber.tariff.current.name').value, 'SIMNET 500');
  assert.deepEqual(out.evidence.map(item => item.path), ['subscriber.tariff.current.name']);
  assert.doesNotMatch(JSON.stringify(out.evidence), /unrelatedSecret|must-not-reach/);
});

test('balance and total due share one Billing main-summary source read', async () => {
  let calls = 0;
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.finance.balance.account', 'subscriber.finance.totalDue'],
    execute: async () => { calls += 1; return mainSummary(); },
    now: NOW
  });
  assert.equal(calls, 1);
  assert.equal(value(out, 'subscriber.finance.balance.account').value, 270.1);
  assert.equal(value(out, 'subscriber.finance.totalDue').value, 250);
  assert.deepEqual(out.diagnostics.sourceReads, ['billing.mainSummary']);
});

test('successful empty next tariff is observed no, not unknown', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: [
      'subscriber.tariff.scheduledChange.observed',
      'subscriber.tariff.scheduledChange.hasChange',
      'subscriber.tariff.scheduledChange.nextTariff'
    ],
    execute: async () => mainSummary(),
    now: NOW
  });
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.observed').value, true);
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.hasChange').value, false);
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.nextTariff').status, 'absent');
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.nextTariff').observed, true);
});

test('present next tariff preserves value and effective period', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: [
      'subscriber.tariff.scheduledChange.hasChange',
      'subscriber.tariff.scheduledChange.nextTariff',
      'subscriber.tariff.scheduledChange.effectivePeriod'
    ],
    execute: async () => mainSummary({ service: { currentTariff: 'SIMNET 500', nextTariff: 'SIMNET 1000', nextTariffDelay: '1' } }),
    now: NOW
  });
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.hasChange').value, true);
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.nextTariff').value, 'SIMNET 1000');
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.effectivePeriod').value, '1');
});

test('source failure remains unknown and never becomes a negative fact', async () => {
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.tariff.scheduledChange.hasChange', 'subscriber.finance.balance.account'],
    execute: async ({ tool }) => ({ ok: false, tool, code: 'FRESH_DATA_UNAVAILABLE', data: {} }),
    now: NOW
  });
  for (const item of out.facts) {
    assert.equal(item.status, 'unknown');
    assert.equal(item.observed, false);
    assert.equal(item.value, null);
  }
});

test('stale field inside a fresh grouped payload remains unknown', async () => {
  const old = new Date(NOW - 3600000).toISOString();
  const snapshot = mainSummary();
  snapshot.data.evidence = { fieldObservedAt: { 'service.nextTariff': old } };
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.tariff.scheduledChange.hasChange'],
    execute: async () => snapshot,
    now: NOW
  });
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.hasChange').status, 'unknown');
  assert.equal(value(out, 'subscriber.tariff.scheduledChange.hasChange').code, 'STALE_FIELD');
});

test('building context is stored and reused without a second source call', async () => {
  let calls = 0;
  const execute = async ({ tool, toolArgs }) => {
    calls += 1;
    assert.equal(tool, 'building.snapshot');
    assert.match(toolArgs.address, /Метрологическая 44/);
    return {
      ok: true,
      tool,
      code: 'OK',
      observedAt: new Date(NOW).toISOString(),
      data: {
        buildingId: '521',
        address: 'ул. Метрологическая, 44',
        fields: { gpon: 'Да', ktv: 'Есть' },
        source: 'userside-building-snapshot-local'
      }
    };
  };
  const first = await resolveFacts({
    context: createCanonicalDomainContext(),
    facts: ['building.gpon'],
    request: { address: 'ул. Метрологическая 44' },
    execute,
    now: NOW
  });
  const second = await resolveFacts({
    context: first.context,
    facts: ['building.ktv'],
    execute,
    now: NOW + 1000
  });
  assert.equal(calls, 1);
  assert.equal(value(second, 'building.ktv').value, 'Есть');
  assert.equal(second.context.domainContext.activeBuildingId, 'userside-building:521');
  assert.deepEqual(second.diagnostics.cacheHits, ['userside.building']);
});

test('PON and Ethernet facts remain separate under one access entity', async () => {
  let calls = 0;
  const out = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.access.connectionFamily', 'subscriber.access.ethernet.port', 'subscriber.access.pon.onu.serial'],
    execute: async ({ tool }) => {
      calls += 1;
      assert.equal(tool, 'userside.snapshot');
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: new Date(NOW).toISOString(),
        data: {
          network: { connectionFamily: 'Ethernet', accessPort: '8' },
          pon: { onuSerial: '' },
          source: 'userside-live-read-only'
        }
      };
    },
    now: NOW
  });
  assert.equal(calls, 1);
  assert.equal(value(out, 'subscriber.access.connectionFamily').value, 'Ethernet');
  assert.equal(value(out, 'subscriber.access.ethernet.port').value, '8');
  assert.equal(value(out, 'subscriber.access.pon.onu.serial').status, 'absent');
});

test('IP has NetworkAccess ownership and legacy alias resolves canonically', () => {
  assert.equal(CANONICAL_FACT_CATALOG['subscriber.network.currentIp'].source, 'billing.customer');
  assert.equal(Object.hasOwn(CANONICAL_FACT_CATALOG, 'subscriber.identity.ip'), false);
  assert.equal(canonicalFactPath('accountBalance'), 'subscriber.finance.balance.account');
});

test('fresh source cache avoids repeated reads and reports payload reduction', async () => {
  let calls = 0;
  const first = await resolveFacts({
    context: IDENTITY,
    facts: ['subscriber.finance.balance.account'],
    execute: async () => { calls += 1; return mainSummary({ padding: 'x'.repeat(2000) }); },
    now: NOW
  });
  const second = await resolveFacts({
    context: first.context,
    facts: ['subscriber.finance.balance.account'],
    execute: async () => { calls += 1; return mainSummary(); },
    now: NOW + 1000
  });
  assert.equal(calls, 1);
  assert.deepEqual(second.diagnostics.cacheHits, ['billing.mainSummary']);
  assert.ok(first.diagnostics.broadPayloadChars > first.diagnostics.evidenceChars);
  assert.ok(first.diagnostics.savedChars > 1500);
});

test('modern semantic broker resolves canonical facts before synthesis', async () => {
  const calls = [];
  let capturedResolution = null;
  const result = await groundSubscriberReply({
    draft: { reply: '', subscriberDataNeeded: [], degraded: false },
    transcript: [{ role: 'customer', text: 'Договор 146888, какой у меня тариф?' }],
    analysis: { probe: { requiredFacts: ['subscriber.tariff.current.name'], language: 'ru' } },
    labState: {},
    execute: async ({ tool, labState }) => {
      calls.push(tool);
      if (tool === 'customer.lookup') {
        return { ok: true, tool, code: 'OK', data: { source: 'billing-live-read-only' }, statePatch: IDENTITY };
      }
      assert.equal(labState.confirmedCaseId, IDENTITY.confirmedCaseId);
      return mainSummary();
    },
    coreGround: async options => {
      capturedResolution = options.factResolution;
      return {
        reply: 'Текущий тариф — SIMNET 500.',
        toolTrace: [],
        toolEvidence: [],
        toolState: options.factResolution.context,
        factEvidence: options.factResolution.evidence,
        factDiagnostics: options.factResolution.diagnostics
      };
    }
  });
  assert.deepEqual(calls, ['customer.lookup', 'billing.main_summary']);
  assert.deepEqual(capturedResolution.requestedFacts, ['subscriber.tariff.current.name']);
  assert.deepEqual(result.factEvidence.map(item => item.path), ['subscriber.tariff.current.name']);
});

test('semantic understanding requests canonical facts without choosing tools', () => {
  const messages = buildSubscriberIntentProbeMessages({ latestCustomer: { text: 'Какой у меня тариф?' } });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /"required_facts"/);
  assert.match(prompt, /subscriber\.tariff\.current\.name/);
  assert.match(prompt, /не выбирай tools/i);

  const needs = planLiveDataNeeds({ probe: { requiredFacts: ['subscriber.tariff.current.name'], liveDataNeed: 'needed' } });
  assert.equal(needs[0].field, 'subscriber.tariff.current.name');
});
