import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  extractStandaloneSubscriberIdentity,
  identityToolArgs
} from '../src/features/ai-operator/subscriber-identity.js';
import { classifyStandaloneBillingLogin } from '../src/features/ai-operator/billing-login-live.js';
import { lookupFromText, normalizeInterpretation } from '../src/features/ai-operator/dialogue-state.js';
import { normalizeLabLookupDecision } from '../src/features/ai-operator/lab-identity-policy.js';

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
