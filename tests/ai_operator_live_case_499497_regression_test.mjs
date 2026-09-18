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
const runtimeSource = fs.readFileSync(
  new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url),
  'utf8'
);

// A natural confirmation must still resume the original request after customer.confirm.
assert.match(labSource, /basicConfirmationValue/);
assert.match(labSource, /confirmationOnly\s*=\s*value\s*=>\s*basicConfirmationValue\(value\)\s*!==\s*null/);

// Legacy Billing pages are not safe to read with Response.text(): they may be windows-1251.
assert.match(searchSource, /response\.arrayBuffer\(\)/);
assert.match(searchSource, /TextDecoder\('windows-1251'\)/);
assert.match(searchSource, /headerCharset/);
assert.match(searchSource, /metaCharset/);
assert.doesNotMatch(searchSource, /await\s+response\.text\(\)/);

// A sparse live lookup must not wipe already captured finance, and missing finance gets one live refresh.
assert.match(runtimeSource, /function\s+mergeFinance/);
assert.match(runtimeSource, /value\s*===\s*null\s*\|\|\s*value\s*===\s*undefined\s*\|\|\s*value\s*===\s*''/);
assert.match(runtimeSource, /refreshLiveSnapshotForLab/);
assert.match(runtimeSource, /liveResult\?\.code\s*===\s*'DATA_NOT_AVAILABLE'/);

console.log('ai_operator_live_case_499497_regression_test: PASS');
