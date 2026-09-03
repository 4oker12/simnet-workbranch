import assert from 'node:assert/strict';
import { computeDiagnosticDecision } from '../src/workflows/diagnostic.js';
import { ensureEvidenceState, CaseOutcome } from '../src/workflows/discovery.js';

const fact = (value, source='test') => ({ value, source, confidence: .99, observedAt: new Date().toISOString() });
const c = {
  id: 'login:abon-test', identity: { login: fact('abon-test'), billingId: fact('100') },
  network: { connectionFamily: fact('PON'), ip: fact('10.0.0.1'), mac: fact('00:11:22:33:44:55') },
  pon: { onuMac: fact('AA:BB:CC:DD:EE:FF'), oltName: fact('Test OLT','billing:olt-selected-option'), oltIp: fact('172.16.1.10','billing:olt-selected-option-ip'), pollAction: fact('313'), pollType: fact('Huawei'), status: fact('online') },
  complaint: { category: '', text: '' }, diagnosis: { status: 'not-assessed', conclusion: '', evidence: [] },
  contexts: { t: { pageKind: 'billing_technical' }, u: { pageKind: 'userside_customer' } },
  workflow: {}, live: { oltSnapshot: { status: 'confirmed', outcome: 'confirmed', onuStatus: 'online' } }, conflicts: []
};
ensureEvidenceState(c);
c.locator.termination = { status: CaseOutcome.CONFIRMED, pollResponded: true, pollCompleted: true, identityAssessment: 'matched' };
c.locator.bestCandidate = { matchedCurrentSubscriber: true };
const d = computeDiagnosticDecision(c);
assert.equal(d.locatorCompletion, 100, 'network binding acquisition may be complete');
assert.equal(d.locatorStage, 'confirmed');
assert.equal(d.completion, 0, 'diagnosis must not become 100% without an explicit diagnosis');
assert.equal(d.stage, 'awaiting-complaint', 'no complaint means diagnosis has not started');
assert.equal(d.diagnosisComplete, false);
assert.equal(d.accessReachable, true, 'ONU online remains useful access evidence');
assert.equal(d.serviceHealthy, false, 'ONU online alone must not claim the whole service is healthy');
console.log('diagnostic_locator_separation_test: PASS');
