import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  basicConfirmationValue,
  routeBasicCase
} from '../src/features/ai-operator/basic-case-router.js';

// Real Test Lab wording must confirm once, not ask the same question again.
for (const phrase of [
  'да',
  'да, все верно',
  'да все правильно',
  'так, все вірно',
  'верно',
  'правильно'
]) {
  assert.equal(basicConfirmationValue(phrase), true, `expected affirmative confirmation: ${phrase}`);
}
assert.equal(basicConfirmationValue('нет'), false);
assert.equal(basicConfirmationValue('это не мой'), false);
assert.equal(basicConfirmationValue('да, но адрес другой'), null);

const confirmationDecision = routeBasicCase({
  customerText: 'да, все верно',
  latestCustomerText: 'да, все верно',
  labState: {
    pendingCandidate: {
      contract: '499497',
      address: 'тестовый адрес'
    },
    confirmedCaseId: ''
  },
  toolResults: []
});
assert.equal(confirmationDecision?.action, 'tool_required');
assert.equal(confirmationDecision?.tool, 'customer.confirm');
assert.deepEqual(confirmationDecision?.toolArgs, { confirmed: true });

const labSource = fs.readFileSync(
  new URL('../src/features/ai-operator/lab-background.js', import.meta.url),
  'utf8'
);
const searchSource = fs.readFileSync(
  new URL('../src/features/ai-operator/billing-live-search.js', import.meta.url),
  'utf8'
);

// A natural confirmation must still resume the original request after customer.confirm.
assert.match(labSource, /basicConfirmationValue/);
assert.match(labSource, /confirmationOnly\s*=\s*value\s*=>\s*basicConfirmationValue\(value\)\s*!==\s*null/);

// Legacy Billing pages are not safe to read with Response.text(): they may be windows-1251.
assert.match(searchSource, /response\.arrayBuffer\(\)/);
assert.match(searchSource, /TextDecoder\('windows-1251'\)/);
assert.match(searchSource, /charset\s*\\s\*=/);
assert.doesNotMatch(searchSource, /await\s+response\.text\(\)/);

console.log('ai_operator_live_case_499497_regression_test: PASS');
