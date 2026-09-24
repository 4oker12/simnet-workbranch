import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  extractStandaloneSubscriberIdentity,
  identityToolArgs,
  resolveSubscriberIdentityHints
} from '../src/features/ai-operator/subscriber-identity.js';
import {
  classifyBillingExactIdentity,
  classifyStandaloneBillingLogin
} from '../src/features/ai-operator/billing-login-live.js';
import { lookupFromText, normalizeInterpretation } from '../src/features/ai-operator/dialogue-state.js';
import { normalizeLabLookupDecision } from '../src/features/ai-operator/lab-identity-policy.js';
import { buildSubscriberIntentProbeMessages } from '../src/features/ai-operator/semantic-probe.js';
import { compactRuntimeProbe } from '../src/features/ai-operator/runtime-projection.js';
import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker.js';

const talalaMessage = 'Talala\nдоговор\nче по балансу у меня вообще? и на гиг можно перейти?';

test('shared parser preserves free-text identifier exactly as supplied', () => {
  const identity = extractStandaloneSubscriberIdentity([{ role: 'customer', text: talalaMessage }]);
  assert.equal(identity.login, 'Talala');
  assert.deepEqual(identityToolArgs(identity), { login: 'Talala' });
});

test('native Billing free-text classifier preserves casing', () => {
  assert.equal(classifyStandaloneBillingLogin('Talala'), 'Talala');
  assert.equal(classifyStandaloneBillingLogin('Sota'), 'Sota');
  assert.equal(classifyStandaloneBillingLogin('lacanister'), 'lacanister');
});

test('legacy fact-runtime identity path uses the same free-text parser', () => {
  assert.deepEqual(lookupFromText({}, talalaMessage), { login: 'Talala' });
  assert.deepEqual(lookupFromText({}, 'Sota мой договор'), { login: 'Sota' });
  assert.deepEqual(lookupFromText({}, 'логин Lacanister'), { login: 'Lacanister' });
});

test('model-provided free-text login is not discarded by legacy normalization', () => {
  const normalized = normalizeInterpretation({ ids: { login: 'Talala' }, questions: [], language: 'ru', speechAct: 'new' });
  assert.deepEqual(normalized.ids, { login: 'Talala' });
});

test('lab identity decision keeps generic textual login instead of requiring numeric contract', () => {
  const normalized = normalizeLabLookupDecision({ tool: 'customer.lookup', toolArgs: { query: 'Talala' } });
  assert.deepEqual(normalized.toolArgs, { login: 'Talala' });
});

test('Billing native free-text request remains a=listuser&f=n&name=<exact value>', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  assert.match(source, /a:\s*'listuser',\s*f:\s*'n',\s*name:\s*requestedLogin/);
  assert.doesNotMatch(source, /requestedLogin\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /what_search:\s*'login'/);
});


test('semantic identity hint handles a misspelled personal-account phrase but keeps the literal contract value', () => {
  const transcript = [{ role: 'customer', text: 'це мій особов рахонок 2421, глянь баланс' }];
  assert.deepEqual(extractStandaloneSubscriberIdentity(transcript), {}, 'literal regex path should not need to understand every typo');
  assert.deepEqual(
    resolveSubscriberIdentityHints(transcript, { probe: { ids: { contract: '2421' } } }),
    { contract: '2421' }
  );
});

test('semantic identity hint cannot invent a contract number absent from customer text', () => {
  const transcript = [{ role: 'customer', text: 'це мій особов рахонок 2421, глянь баланс' }];
  assert.deepEqual(
    resolveSubscriberIdentityHints(transcript, { probe: { ids: { contract: '5555' } } }),
    {}
  );
});

test('semantic named-login hint survives a typo in the surrounding word only when login is literal', () => {
  const transcript = [{ role: 'customer', text: 'мой логен Talala, проверь тариф' }];
  assert.deepEqual(
    resolveSubscriberIdentityHints(transcript, { probe: { ids: { login: 'Talala' } } }),
    { login: 'Talala' }
  );
  assert.deepEqual(
    resolveSubscriberIdentityHints(transcript, { probe: { ids: { login: 'OtherUser' } } }),
    {}
  );
});

test('semantic prompt exposes identity hints and forbids reconstructing identifier values', () => {
  const prompt = buildSubscriberIntentProbeMessages({
    transcript: [{ role: 'customer', text: 'особов рахонок 2421' }],
    latestCustomer: { text: 'особов рахонок 2421' }
  }).map(item => item.content).join('\n');
  assert.match(prompt, /"ids":\{"contract":"","login":"","ip":"","address":""\}/);
  assert.match(prompt, /НЕ исправляй, НЕ реконструируй и НЕ придумывай/i);
});

test('runtime probe projection preserves semantic identity hints', () => {
  const compact = compactRuntimeProbe({
    language: 'ru',
    ids: { contract: '2421', login: '', ip: '', address: '' }
  });
  assert.equal(compact.ids.contract, '2421');
});


test('abon login and numeric contract use the lightweight exact Billing identity path', () => {
  assert.deepEqual(
    classifyBillingExactIdentity({ login: 'abon230804' }),
    { mode: 'login', value: 'abon230804' }
  );
  assert.deepEqual(
    classifyBillingExactIdentity({ contract: '230804' }),
    { mode: 'contract', value: '230804' }
  );

  const reader = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');
  assert.match(reader, /a:\s*'listuser',\s*f:\s*'n',\s*name:\s*lookupRequest\.value/);
  assert.match(reader, /what_search:\s*lookupRequest\.mode/);
  assert.doesNotMatch(reader, /a:\s*'dopdata'|tmpl:\s*'1'|tmpl:\s*'2'/);
  assert.match(runtime, /classifyBillingExactIdentity\(toolArgs\)/);
  assert.match(runtime, /searchBillingExactIdentityLive\(toolArgs\)/);
  assert.doesNotMatch(runtime, /genericLogin\s*&&\s*!\/\^abon/);
});

test('failed identity bootstrap performs customer.lookup only once per grounded turn', async () => {
  let lookupCalls = 0;
  const result = await groundSubscriberReply({
    draft: {
      reply: 'Не удалось проверить данные.',
      subscriberDataNeeded: [],
      degraded: true,
      degradationReason: 'synthetic'
    },
    transcript: [{ role: 'customer', text: '230804' }],
    latestCustomer: { role: 'customer', text: '230804' },
    analysis: {
      probe: {
        requiredFacts: [],
        whatUserWants: '230804',
        latestMessageMeans: 'Клиент сообщает идентификатор',
        unresolvedRequests: ['230804'],
        language: 'other',
        confidence: 0
      },
      knowledge: { skipped: true, articleEvidence: [] }
    },
    labState: {},
    execute: async ({ tool }) => {
      if (tool === 'customer.lookup') {
        lookupCalls += 1;
        return {
          ok: false,
          tool,
          code: 'BILLING_SEARCH_NO_RESULT',
          observedAt: '2026-09-25T00:00:00.000Z',
          data: { source: 'billing-live-read-only' },
          warnings: [],
          statePatch: {}
        };
      }
      return {
        ok: false,
        tool,
        code: 'IDENTITY_REQUIRED',
        observedAt: '2026-09-25T00:00:00.000Z',
        data: {},
        warnings: [],
        statePatch: {}
      };
    },
    coreGround: async options => ({
      ...options.draft,
      reply: options.draft.reply,
      toolTrace: [],
      toolEvidence: [],
      toolState: options.labState || {}
    })
  });

  assert.equal(lookupCalls, 1);
  assert.equal(result.toolTrace.filter(item => item.tool === 'customer.lookup').length, 1);
});
