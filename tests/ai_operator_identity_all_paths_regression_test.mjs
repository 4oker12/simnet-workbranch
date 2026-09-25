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

test('Billing exact lookup submits a real hidden Billing GET form through the persistent content bridge', () => {
  const reader = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');

  assert.match(reader, /chrome\.tabs\.sendMessage\(tabId/);
  assert.match(reader, /files:\s*\[BILLING_CAPTURE_SCRIPT\]/, 'stale Billing tabs must self-bootstrap the current bridge');
  assert.match(capture, /SIMNET_AI_BILLING_EXACT_LOOKUP/);
  assert.match(capture, /submitBillingForm/);
  assert.match(capture, /form\.method\s*=\s*'get'/);
  assert.match(capture, /form\.target\s*=\s*targetName/);
  assert.match(capture, /submitButton\.value\s*=\s*'Найти'/);
  assert.match(capture, /form\.requestSubmit\(submitButton\)/);
  assert.match(capture, /iframe\.contentDocument/);
  assert.match(capture, /f:\s*'n',\s*a:\s*'listuser',\s*name:\s*nativeQuery/);
  assert.doesNotMatch(capture, /what_search/);
  assert.doesNotMatch(capture, /fetch\(url,\s*\{\s*method:\s*'GET'/, 'exact identity path must not use content-script fetch transport');
  assert.match(capture, /nativeQueries\s*=\s*\[\.\.\.new Set\(\[rawValue, abonDigits\]/);
  assert.match(capture, /for \(const nativeQuery of nativeQueries\)/);
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
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');
  assert.match(reader, /sendExactLookup\(tabId, request\)/);
  assert.match(capture, /name:\s*nativeQuery/);
  assert.match(capture, /\[rawValue, abonDigits\]/, 'literal abon login must be tried before numeric alias');
  const exactLookup = capture.slice(
    capture.indexOf('async function exactIdentityLookup'),
    capture.indexOf('chrome.runtime.onMessage.addListener')
  );
  assert.match(exactLookup, /a:\s*'dopdata',\s*parent_type:\s*'0',\s*id,\s*tmpl:\s*'2'/);
  assert.match(exactLookup, /address\.full\s*=\s*composeAddress\(address\)/);
  assert.match(exactLookup, /candidate\.address\s*=\s*address\.full/);
  assert.match(exactLookup, /tmpl:\s*'1'/, 'confirmed identity must trigger bounded TechnicalSnapshot bootstrap');
  assert.match(exactLookup, /TECHNICAL_READ_FAILED/);
  assert.match(exactLookup, /snapshots\[id\]\s*=\s*snapshot/);
  assert.match(runtime, /classifyBillingExactIdentity\(toolArgs\)/);
  assert.match(runtime, /searchBillingExactIdentityLive\(toolArgs\)/);
  const exactRuntime = runtime.slice(
    runtime.indexOf('async function executeExactIdentityLookup'),
    runtime.indexOf('async function executeBillingSummaryTool')
  );
  assert.doesNotMatch(exactRuntime, /core\.executeOperatorTool/, 'exact identity failures must not fall back to the legacy broad lookup');
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


test('confirmed subscriber address is the shared input for building index lookups', () => {
  const dialogue = fs.readFileSync(new URL('../src/features/ai-operator/dialogue-runtime-state.js', import.meta.url), 'utf8');
  const building = fs.readFileSync(new URL('../src/features/ai-operator/building-snapshot-tool.js', import.meta.url), 'utf8');
  assert.match(dialogue, /confirmedSubscriber\?\.address/);
  assert.match(dialogue, /The service address is already known; do not ask for it again\./);
  assert.match(building, /labState\?\.confirmedSubscriber\?\.address/);
  assert.match(building, /simnet_crm_building_snapshot_v1/);
});


test('Billing exact lookup exposes execution phase instead of collapsing source errors into NOT_FOUND', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const reader = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');

  assert.match(capture, /simnetPhase/);
  assert.match(capture, /native-listuser-submit/);
  assert.match(capture, /main-card-submit/);
  assert.match(capture, /address-submit/);
  assert.match(capture, /technical-submit/);
  assert.match(capture, /native-form-submit-hidden-iframe/);
  assert.match(capture, /candidateErrors/);
  assert.match(capture, /BILLING_CARD_READ_FAILED/);
  assert.doesNotMatch(capture, /candidates\.push\(candidate\);\s*}\s*catch\s*\{\s*\}/, 'candidate read failures must not be silently swallowed');

  assert.match(reader, /failurePhase:\s*'content-bridge-reinject'/);
  assert.match(reader, /initialBridgeError/);
  assert.match(runtime, /failurePhase:\s*text\(live\?\.failurePhase/);
  assert.match(runtime, /failureMessage:\s*text\(live\?\.message/);
});


test('Billing lookup bridge can rebind on an already open tab after extension reload', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const reader = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  assert.match(capture, /SIMNET_AI_BILLING_EXACT_LOOKUP_V3/);
  assert.match(reader, /SIMNET_AI_BILLING_EXACT_LOOKUP_V3/);
  assert.match(capture, /previousBridge\?\.listener/);
  assert.match(capture, /removeListener\(previousBridge\.listener\)/);
  assert.match(capture, /bridgeState\.listener\s*=\s*exactLookupListener/);
  assert.doesNotMatch(capture, /if \(globalThis\.__SIMNET_AI_BILLING_SNAPSHOT_CAPTURE_[A-Z0-9_]+__\) return/);
});


test('Billing subscriber bootstrap uses the same native form-submit transport for search, main, address and technical reads', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const exact = capture.slice(
    capture.indexOf('async function exactIdentityLookup'),
    capture.indexOf('const exactLookupListener')
  );
  assert.match(exact, /submitBillingForm\(\{\s*pp,\s*f:\s*'n',\s*a:\s*'listuser'/s);
  assert.match(exact, /submitBillingForm\(\{ pp, a:\s*'user', id \}, 'main-card-submit'\)/);
  assert.match(exact, /tmpl:\s*'2'[\s\S]*'address-submit'/);
  assert.match(exact, /tmpl:\s*'1'[\s\S]*'technical-submit'/);
  assert.doesNotMatch(exact, /await fetch\(/);
});


test('numeric contract and abonNNN derive Billing card id by dropping the final digit, but confirmation requires full card identity match', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const exact = capture.slice(
    capture.indexOf('async function exactIdentityLookup'),
    capture.indexOf('const exactLookupListener')
  );

  assert.match(exact, /const contractDigits = mode === 'contract' \? rawValue\.replace\(\/\\D\+\/g, ''\) : abonDigits/);
  assert.match(exact, /const derivedBillingId = contractDigits\.length >= 2 \? contractDigits\.slice\(0, -1\) : ''/);
  assert.match(exact, /'derived-card-submit'/);
  assert.match(exact, /cardMatchesRequestedIdentity/);
  assert.match(exact, /actualContract === expectedContract/);
  assert.match(exact, /loginMatches \|\| contractMatches/);
  assert.match(exact, /preloadedCards\.set\(derivedBillingId, derivedPage\)/);
  assert.match(exact, /lookupStrategy = 'derived-card-validated'/);
  assert.match(exact, /if \(!ids\.size\) \{[\s\S]*native-listuser-submit/);
  assert.match(exact, /lookupStrategy = 'native-listuser-fallback'/);
});
