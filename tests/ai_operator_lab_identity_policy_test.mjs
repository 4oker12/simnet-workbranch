import assert from 'node:assert/strict';
import {
  isSubscriberLogin,
  normalizeLabLookupDecision,
  publicPendingCandidate,
  sanitizeLookupToolResultData
} from '../src/features/ai-operator/lab-identity-policy.js';

assert.equal(isSubscriberLogin('abon31590'), true);
assert.equal(isSubscriberLogin('ABON 31590'), true);
assert.equal(isSubscriberLogin('31590'), false);

const normalized = normalizeLabLookupDecision({
  action: 'tool_required',
  tool: 'customer.lookup',
  toolArgs: { contract: 'abon31590' },
  reason: 'lookup subscriber'
});
assert.deepEqual(normalized.toolArgs, { contract: '31590' }, 'abonNNN must canonicalize to the same numeric contract identity as NNN');

const untouchedContract = normalizeLabLookupDecision({
  action: 'tool_required',
  tool: 'customer.lookup',
  toolArgs: { contract: '31590' }
});
assert.deepEqual(untouchedContract.toolArgs, { contract: '31590' }, 'real contract number must stay a contract');

const internalCandidate = {
  caseId: 'login:abon31590',
  billingId: 'internal-42',
  contract: '31590',
  login: 'abon31590',
  address: 'Тестовая 10, кв. 2',
  fullName: 'Тестовый Клиент',
  ip: '192.0.2.10',
  connectionFamily: 'PON'
};
const publicCandidate = publicPendingCandidate(internalCandidate);
assert.deepEqual(publicCandidate, {
  contract: '31590',
  login: 'abon31590',
  address: 'Тестовая 10, кв. 2',
  ip: '192.0.2.10'
});
assert.equal(Object.hasOwn(publicCandidate, 'fullName'), false, 'full name must not be exposed to the model before confirmation');
assert.equal(Object.hasOwn(publicCandidate, 'billingId'), false, 'internal Billing id must not be exposed before confirmation');
assert.equal(Object.hasOwn(publicCandidate, 'caseId'), false, 'internal case id must not be exposed before confirmation');

const sanitized = sanitizeLookupToolResultData({
  count: 1,
  candidate: internalCandidate,
  requiresConfirmation: true,
  source: 'simnet_workbench_state_v5'
});
assert.equal(sanitized.candidate.fullName, undefined);
assert.equal(sanitized.candidate.contract, '31590');
assert.equal(sanitized.requiresConfirmation, true);
assert.equal(sanitized.source, 'simnet_workbench_state_v5');

console.log('ai_operator_lab_identity_policy_test: PASS');
