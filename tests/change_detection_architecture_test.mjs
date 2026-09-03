import assert from 'node:assert/strict';
import { caseChanged, stateChanged } from '../src/state/change-detection.js';

const baseCase = {
  id: 'login:abon1', caseVersion: 4, routeGeneration: 2, updatedAt: 'a',
  identity: { login: { value: 'abon1', source: 'billing', confidence: .9, observedAt: 'a' } },
  meta: { scans: 10, observations: 3, processedEventIds: ['a'] },
  currentContext: { key: 'same', observedAt: 'a', meta: { scanGeneration: 4, documentId: 'doc1' } },
  route: { controller: { signature: 'same', updatedAt: 'a' } }
};
const runtimeOnly = structuredClone(baseCase);
runtimeOnly.updatedAt = 'b';
runtimeOnly.meta.scans = 999;
runtimeOnly.meta.observations = 50;
runtimeOnly.meta.processedEventIds.push('b');
runtimeOnly.currentContext.observedAt = 'b';
runtimeOnly.currentContext.meta.scanGeneration = 99;
runtimeOnly.route.controller.updatedAt = 'b';
assert.equal(caseChanged(baseCase, runtimeOnly), false, 'runtime-only scan churn must not write state');
const real = structuredClone(runtimeOnly);
real.identity.login.value = 'abon2';
assert.equal(caseChanged(baseCase, real), true, 'real fact change must write state');
assert.equal(stateChanged({ meta:{updatedAt:'a'}, cases:{a:baseCase} }, { meta:{updatedAt:'b'}, cases:{a:runtimeOnly} }), false);
console.log('change_detection_architecture_test: PASS');
