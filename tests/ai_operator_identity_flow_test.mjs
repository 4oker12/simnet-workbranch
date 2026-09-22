import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractStandaloneSubscriberIdentity,
  identityFromAnalysisHints,
  identityToolArgs,
  resolveSubscriberIdentityHints
} from '../src/features/ai-operator/subscriber-identity.js';
import { extractIdentityHints, groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker-impl.js';

function customer(text) {
  return [{ role: 'customer', text }];
}

test('standalone named login is extracted as login class', () => {
  const a = extractStandaloneSubscriberIdentity(customer('alphaUser42'));
  assert.equal(a.login, 'alphaUser42');
  assert.equal(a.confidence, 'standalone-login');

  const b = extractStandaloneSubscriberIdentity(customer('beta_login_9, какой у меня баланс?'));
  assert.equal(b.login, 'beta_login_9');
  assert.match(b.confidence, /token-login|standalone/);
});

test('abon and numeric contract remain supported', () => {
  assert.equal(extractStandaloneSubscriberIdentity(customer('abon146888')).login, 'abon146888');
  assert.equal(extractStandaloneSubscriberIdentity(customer('договор 100001')).contract, '100001');
  assert.equal(extractStandaloneSubscriberIdentity(customer('100001')).contract, '100001');
});

test('common non-login words are not treated as subscriber login', () => {
  assert.deepEqual(extractStandaloneSubscriberIdentity(customer('internet')), {});
  assert.deepEqual(extractStandaloneSubscriberIdentity(customer('balance')), {});
  assert.deepEqual(extractStandaloneSubscriberIdentity(customer('tariff')), {});
});

test('analysis probe ids are used only when text has no identity and shape is valid', () => {
  assert.deepEqual(
    identityFromAnalysisHints({ probe: { ids: { login: 'namedLoginX' } } }),
    { login: 'namedLoginX' }
  );
  assert.deepEqual(
    identityFromAnalysisHints({ probe: { ids: { login: 'internet' } } }),
    {}
  );
  assert.deepEqual(
    resolveSubscriberIdentityHints(customer('просто вопрос'), { probe: { ids: { login: 'namedLoginY' } } }),
    { login: 'namedLoginY' }
  );
  assert.deepEqual(
    resolveSubscriberIdentityHints(customer('abon999888'), { probe: { ids: { login: 'namedLoginY' } } }),
    { login: 'abon999888' }
  );
});

test('broker extractIdentityHints returns named login from free text', () => {
  const hints = extractIdentityHints(customer('gammaLogin7 сколько на счету?'));
  assert.equal(hints.login, 'gammaLogin7');
});

test('explicit identifier triggers customer.lookup before subscriber snapshot/facts', async () => {
  const calls = [];
  const IDENTITY = {
    confirmedCaseId: 'billing-live:77',
    confirmedSubscriber: { billingId: '77', contract: '200002', login: 'deltaLogin1' }
  };

  await groundSubscriberReply({
    draft: { reply: '', subscriberDataNeeded: [], degraded: false },
    transcript: customer('deltaLogin1, какой у меня тариф?'),
    analysis: {
      probe: {
        requiredFacts: ['subscriber.tariff.current.name'],
        language: 'ru',
        whatUserWants: 'узнать текущий тариф'
      }
    },
    labState: {},
    execute: async ({ tool, toolArgs, labState }) => {
      calls.push({ tool, toolArgs: { ...(toolArgs || {}) }, hasCase: Boolean(labState?.confirmedCaseId) });
      if (tool === 'customer.lookup') {
        assert.equal(String(toolArgs?.login || ''), 'deltaLogin1');
        return {
          ok: true,
          tool,
          code: 'OK',
          data: { source: 'billing-live-read-only', candidate: IDENTITY.confirmedSubscriber },
          statePatch: IDENTITY
        };
      }
      if (tool === 'billing.main_summary' || tool === 'customer.snapshot') {
        assert.ok(labState?.confirmedCaseId, 'subscriber tool must run only after confirmed identity');
        return {
          ok: true,
          tool,
          code: 'OK',
          observedAt: new Date().toISOString(),
          data: {
            service: { currentTariff: 'LABEL_A', currentTariffDisplay: 'LABEL_A' },
            finance: { accountBalance: 10 },
            source: 'billing-main-summary-live-read-only'
          }
        };
      }
      return { ok: false, tool, code: 'UNEXPECTED', data: {} };
    },
    coreGround: async options => ({
      reply: 'ok',
      toolTrace: [],
      toolEvidence: [],
      toolState: options.factResolution?.context || options.labState,
      factEvidence: options.factResolution?.evidence || [],
      factDiagnostics: options.factResolution?.diagnostics || {}
    })
  });

  assert.ok(calls.length >= 1, 'expected tool activity');
  assert.equal(calls[0].tool, 'customer.lookup');
  const subscriberCalls = calls.filter(item => item.tool === 'billing.main_summary' || item.tool === 'customer.snapshot');
  for (const item of subscriberCalls) {
    assert.equal(item.hasCase, true);
  }
});

test('abon identifier also bootstraps lookup before subscriber facts', async () => {
  const calls = [];
  await groundSubscriberReply({
    draft: { reply: '', subscriberDataNeeded: [], degraded: false },
    transcript: customer('abon200002 какой баланс?'),
    analysis: { probe: { requiredFacts: ['subscriber.finance.balance.account'], language: 'ru' } },
    labState: {},
    execute: async ({ tool, toolArgs }) => {
      calls.push(tool);
      if (tool === 'customer.lookup') {
        assert.ok(toolArgs?.login || toolArgs?.contract);
        return {
          ok: true,
          tool,
          code: 'OK',
          data: { source: 'billing-live-read-only' },
          statePatch: {
            confirmedCaseId: 'billing-live:88',
            confirmedSubscriber: { billingId: '88', login: 'abon200002', contract: '200002' }
          }
        };
      }
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: new Date().toISOString(),
        data: { finance: { accountBalance: 5 }, source: 'billing-main-summary-live-read-only' }
      };
    },
    coreGround: async options => ({
      reply: 'ok',
      toolTrace: [],
      toolEvidence: [],
      toolState: options.labState,
      factEvidence: options.factResolution?.evidence || []
    })
  });
  assert.equal(calls[0], 'customer.lookup');
});

test('identityToolArgs never invents fields', () => {
  assert.deepEqual(identityToolArgs({}), {});
  assert.deepEqual(identityToolArgs({ login: 'x' }), { login: 'x' });
});
