import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  executeInformationNeeds,
  extractIdentityHints
} from '../src/features/ai-operator/semantic-tool-broker.js';
import { classifyStandaloneBillingLogin } from '../src/features/ai-operator/billing-login-live.js';

function successfulLookup(expected) {
  return async ({ tool, toolArgs }) => {
    assert.equal(tool, 'customer.lookup');
    assert.deepEqual(toolArgs, expected);
    const identity = expected.contract
      ? { contract: expected.contract, login: `abon${expected.contract}` }
      : { contract: '99999', login: expected.login };
    return {
      ok: true,
      tool,
      code: 'OK',
      observedAt: '2026-09-17T00:00:00.000Z',
      data: {
        candidate: { billingId: '50845', ...identity },
        source: 'billing-live-read-only'
      },
      warnings: [],
      statePatch: {
        confirmedCaseId: 'billing-live:50845',
        confirmedSubscriber: { billingId: '50845', ...identity }
      }
    };
  };
}

test('standalone numeric message is remembered as contract for the next customer question', async () => {
  const transcript = [
    { role: 'customer', text: '33455' },
    { role: 'customer', text: 'почему у меня нет интернета?' }
  ];

  assert.deepEqual(extractIdentityHints(transcript, {}), { contract: '33455' });

  const result = await executeInformationNeeds({
    needs: [],
    transcript,
    analysis: { probe: { whatUserWants: 'Понять, почему нет интернета' } },
    labState: {},
    execute: successfulLookup({ contract: '33455' })
  });

  assert.equal(result.labState.confirmedCaseId, 'billing-live:50845');
  assert.equal(result.trace[0].tool, 'customer.lookup');
  assert.equal(result.trace[0].args.contract, '33455');
});

test('standalone ordinary login is remembered across turns and searched through Billing', async () => {
  const transcript = [
    { role: 'customer', text: 'lacanister' },
    { role: 'customer', text: 'какой у меня тариф?' }
  ];

  assert.deepEqual(extractIdentityHints(transcript, {}), { login: 'lacanister' });
  assert.equal(classifyStandaloneBillingLogin('lacanister'), 'lacanister');

  const result = await executeInformationNeeds({
    needs: [],
    transcript,
    analysis: { probe: { whatUserWants: 'Узнать текущий тариф' } },
    labState: {},
    execute: successfulLookup({ login: 'lacanister' })
  });

  assert.equal(result.labState.confirmedCaseId, 'billing-live:50845');
  assert.equal(result.trace[0].args.login, 'lacanister');
});

test('text identifier explicitly labeled as contract is searched through Billing', async () => {
  const transcript = [
    { role: 'customer', text: 'Boxing договір\nхочу на гигабит' }
  ];

  assert.deepEqual(extractIdentityHints(transcript, {}), { login: 'boxing' });
  assert.equal(classifyStandaloneBillingLogin('boxing'), 'boxing');

  const result = await executeInformationNeeds({
    needs: [],
    transcript,
    analysis: { probe: { whatUserWants: 'Перейти на гигабит' } },
    labState: {},
    execute: successfulLookup({ login: 'boxing' })
  });

  assert.equal(result.labState.confirmedCaseId, 'billing-live:50845');
  assert.equal(result.trace[0].args.login, 'boxing');
});

test('possessive text identifier labeled as contract is accepted as Billing search key', () => {
  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: 'Sota мой договор' }], {}),
    { login: 'sota' }
  );
  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: 'Sota — это мой договор' }], {}),
    { login: 'sota' }
  );
  assert.equal(classifyStandaloneBillingLogin('Sota'), 'sota');
});

test('clarification that text token is the contract keeps the same identifier', () => {
  assert.deepEqual(
    extractIdentityHints([
      { role: 'customer', text: 'Boxing договір\nхочу на гигабит' },
      { role: 'customer', text: 'Boxing - це і є договір' }
    ], {}),
    { login: 'boxing' }
  );
});

test('generic text lookup preserves Billing native listuser name search formula', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  assert.match(source, /a:\s*'listuser',\s*f:\s*'n',\s*name:\s*requestedLogin/);
  assert.doesNotMatch(source, /what_search:\s*'login'/);
  assert.doesNotMatch(source, /actualLogin\s*&&\s*actualLogin\s*!==/);
});

test('existing abon login behavior remains explicit login identity', () => {
  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: 'abon23422' }], {}),
    { login: 'abon23422' }
  );
});

test('ordinary natural-language standalone words are not treated as subscriber login', () => {
  assert.equal(classifyStandaloneBillingLogin('internet'), '');
  assert.deepEqual(extractIdentityHints([{ role: 'customer', text: 'internet' }], {}), {});
});
