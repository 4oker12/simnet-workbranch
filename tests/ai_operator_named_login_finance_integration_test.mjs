import test from 'node:test';
import assert from 'node:assert/strict';

import { extractIdentityHints } from '../src/features/ai-operator/semantic-tool-broker-core.js';
import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker-impl.js';
import { resolveFacts } from '../src/features/ai-operator/canonical-fact-resolver.js';

const NOW = Date.parse('2026-09-22T01:03:57.984Z');
const CONFIRMED = {
  confirmedCaseId: 'billing-live:14016',
  confirmedSubscriber: {
    billingId: '14016',
    contract: '140163',
    login: 'kundanika'
  }
};

function billingMainSummary(observedAt = NOW) {
  return {
    ok: true,
    tool: 'billing.main_summary',
    code: 'OK',
    observedAt: new Date(observedAt).toISOString(),
    data: {
      service: {
        currentTariffDisplay: 'Інтернет+ТБ 330 (100 Мбит/с)',
        accessState: 'Разрешен',
        serviceState: 'Все ОК'
      },
      finance: {
        accountBalance: 120,
        balanceAfterTariff: -210,
        balanceWithoutTemporary: 120,
        temporaryPayment: null,
        totalDue: 330,
        recurringTotal: 330,
        price: 330
      },
      payments: [
        { date: '31.08.26 23:59', description: 'Списание', amount: '-330' },
        { date: '31.08.26 14:52', description: 'Пополнение', amount: '330' }
      ],
      source: 'billing-main-summary-live-read-only'
    }
  };
}

function fact(result, path) {
  return result.evidence.find(item => item.path === path);
}

test('shared identity parser recognizes a named login inside a natural request', () => {
  const identity = extractIdentityHints([
    { role: 'customer', text: 'kundanika мой договор\nсколько на счету щас?' }
  ]);
  assert.deepEqual(identity, { login: 'kundanika' });
});

test('named login bootstraps customer.lookup before canonical subscriber reads', async () => {
  const calls = [];
  let capturedResolution = null;

  const result = await groundSubscriberReply({
    draft: { reply: '', subscriberDataNeeded: [], degraded: false },
    transcript: [{ role: 'customer', text: 'kundanika мой договор\nсколько на счету щас?' }],
    analysis: {
      probe: {
        requiredFacts: ['subscriber.finance.balance.account'],
        whatUserWants: 'Узнать текущий остаток на счёте.',
        language: 'ru'
      }
    },
    labState: {},
    execute: async ({ tool, toolArgs, labState }) => {
      calls.push({ tool, toolArgs });
      if (tool === 'customer.lookup') {
        assert.deepEqual(toolArgs, { login: 'kundanika' });
        return {
          ok: true,
          tool,
          code: 'OK',
          observedAt: new Date().toISOString(),
          data: {
            source: 'billing-live-read-only',
            candidate: {
              caseId: CONFIRMED.confirmedCaseId,
              billingId: '14016',
              contract: '140163',
              login: 'kundanika'
            }
          },
          statePatch: CONFIRMED
        };
      }
      assert.equal(tool, 'billing.main_summary');
      assert.equal(labState.confirmedCaseId, CONFIRMED.confirmedCaseId);
      return billingMainSummary(Date.now());
    },
    coreGround: async options => {
      capturedResolution = options.factResolution;
      return {
        reply: 'На счету 120 грн.',
        toolTrace: [],
        toolEvidence: [],
        toolState: options.factResolution.context,
        factEvidence: options.factResolution.evidence,
        factDiagnostics: options.factResolution.diagnostics
      };
    }
  });

  assert.deepEqual(calls.map(item => item.tool), ['customer.lookup', 'billing.main_summary']);
  assert.equal(result.reply, 'На счету 120 грн.');
  assert.equal(fact(capturedResolution, 'subscriber.finance.balance.account').value, 120);
});

test('one finance request exposes the full compact finance bundle without extra source reads', async () => {
  const calls = [];
  const out = await resolveFacts({
    context: CONFIRMED,
    facts: ['subscriber.finance.balance.account'],
    execute: async input => {
      calls.push(input);
      return billingMainSummary();
    },
    now: NOW
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'billing.main_summary');
  assert.deepEqual(calls[0].toolArgs.requiredCanonicalFacts, ['subscriber.finance.balance.account']);
  assert.deepEqual(out.requestedFacts, ['subscriber.finance.balance.account']);

  const expectedBundle = [
    'subscriber.finance.balance.account',
    'subscriber.finance.balance.afterTariff',
    'subscriber.finance.balance.withoutTemporary',
    'subscriber.finance.temporaryPayment',
    'subscriber.finance.totalDue',
    'subscriber.finance.recurringTotal',
    'subscriber.finance.payments',
    'subscriber.tariff.current.name',
    'subscriber.tariff.current.price',
    'subscriber.service.accessState',
    'subscriber.service.serviceState'
  ];
  for (const path of expectedBundle) assert.ok(out.resolvedFacts.includes(path), path);

  assert.equal(fact(out, 'subscriber.finance.balance.account').value, 120);
  assert.equal(fact(out, 'subscriber.finance.totalDue').value, 330);
  assert.equal(fact(out, 'subscriber.finance.recurringTotal').value, 330);
  assert.equal(fact(out, 'subscriber.tariff.current.name').value, 'Інтернет+ТБ 330 (100 Мбит/с)');
  assert.equal(fact(out, 'subscriber.tariff.current.price').value, 330);
  assert.equal(fact(out, 'subscriber.service.accessState').value, 'Разрешен');
  assert.equal(fact(out, 'subscriber.finance.temporaryPayment').status, 'absent');
  assert.equal(out.diagnostics.sourceCalls, 1);
});
