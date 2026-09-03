import assert from 'node:assert/strict';
import { derivePonWorkflow, PonWorkflowState } from '../src/workflows/pon.js';
import { computeDiagnosticDecision } from '../src/workflows/diagnostic.js';

const fact = (value, source = 'test') => ({ value, source, confidence: .99 });
const base = () => ({
  id: 'login:abon-hard-poll',
  network: { connectionFamily: fact('PON'), mac: fact('00:11:22:33:44:55') },
  pon: {},
  contexts: {
    tech: { pageKind: 'billing_technical' },
    us: { pageKind: 'userside_customer' }
  },
  locator: {
    sourceStatus: { tmc: { result: 'found' } },
    candidates: [], evidence: [], attempts: [], hypotheses: [], recommendation: null, termination: null
  },
  operations: { poll: { current: null, history: [] } },
  live: {}
});

const addTmc = c => {
  c.pon.tmcOltName = fact('Huawei MA5800-X15', 'userside:tmc-olt-name');
  c.pon.tmcOltIp = fact('172.16.1.50', 'userside:tmc-olt-ip');
  c.pon.tmcOnuMac = fact('AA:BB:CC:DD:EE:FF', 'userside:tmc-onu-mac');
  c.pon.tmcOnuSerial = fact('XPON50120835', 'userside:tmc-onu-serial');
};

const addBilling = (c, { oltIp = '172.16.1.50', serial = 'XPON50120835' } = {}) => {
  c.pon.oltName = fact('Huawei MA5800-X15', 'billing:olt-selected-option');
  c.pon.oltIp = fact(oltIp, 'billing:olt-selected-option-ip');
  c.pon.onuMac = fact('AA:BB:CC:DD:EE:FF', 'billing:onu-mac');
  if (serial) c.pon.onuSerial = fact(serial, 'billing:onu-serial');
};

// TMC facts alone never unlock the LIVE poll CTA.
let c = base();
addTmc(c);
let w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.FILL_TECHNICAL);
assert.equal(w.pollAllowed, false);
assert.equal(w.pollAction, '');

// Even when minimal OLT+MAC exists, a TMC value still absent from Billing keeps poll locked.
c = base();
addTmc(c);
addBilling(c, { serial: '' });
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.FILL_TECHNICAL);
assert.equal(w.pollAllowed, false);
assert.deepEqual(w.prefillFields, ['onuSerial']);

// Fully reconciled Billing/TMC facts unlock poll.
c = base();
addTmc(c);
addBilling(c);
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.READY_FOR_POLL);
assert.equal(w.pollAllowed, true);
assert.equal(w.pollAction, '313');

// Any Billing/TMC field conflict locks the poll CTA.
c = base();
addTmc(c);
addBilling(c, { oltIp: '172.16.13.70' });
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.MANUAL_REVIEW);
assert.equal(w.pollAllowed, false);
assert.ok(w.conflicts.some(x => x.field === 'olt'));
const d = computeDiagnosticDecision(c);
assert.equal(d.readyForOnuPoll, false);
assert.ok(d.ponWorkflowDetails.conflicts.some(x => x.field === 'olt'));

// Successful downstream poll never erases the upstream Billing/TMC conflict.
c.locator.termination = { status: 'confirmed', reason: 'direct_olt_poll_completed', pollCompleted: true, pollResponded: true };
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.MANUAL_REVIEW, 'source conflict must outrank successful downstream poll');
assert.equal(w.pollAllowed, false);
assert.ok(w.conflicts.some(x => x.field === 'olt'), 'source conflict must survive successful poll');


// A successful poll with no TMC read is not a completed source check.
c = base();
delete c.contexts.us;
c.locator.sourceStatus = {};
addBilling(c);
c.locator.termination = { status: 'confirmed', reason: 'direct_olt_poll_completed', pollCompleted: true, pollResponded: true };
c.live.oltSnapshot = { status: 'confirmed', outcome: 'confirmed', oltIp: '172.16.1.50' };
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.CHECK_TMC, 'unread TMC must remain the recommendation after poll success');
assert.equal(w.action, 'check_tmc');
assert.equal(w.pollAllowed, false);


// A stale/mismatched pending request cannot control the current Billing binding.
c = base();
addTmc(c);
addBilling(c);
c.operations.poll.current = {
  pollAttemptId: 'old-epon',
  attemptId: 'old-epon',
  action: '310',
  billingId: '50504',
  oltIp: '172.16.11.50',
  startedAt: Date.now(),
  pending: true,
  status: 'pending',
  stage: 'REQUEST_STARTED'
};
c.identity = { billingId: fact('50504', 'billing:url-id') };
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.READY_FOR_POLL, 'old request for another OLT/technology must not force wait_poll');
assert.equal(w.action, 'poll_candidate');

// A matching fresh request is the only pending request that can produce wait_poll.
c.operations.poll.current = {
  ...c.operations.poll.current,
  pollAttemptId: 'current-huawei',
  attemptId: 'current-huawei',
  action: '313',
  oltIp: '172.16.1.50',
  startedAt: Date.now()
};
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.POLLING);
assert.equal(w.action, 'wait_poll');

// Even a matching request stops controlling the workflow after the fallback age.
c.operations.poll.current.startedAt = Date.now() - 31000;
w = derivePonWorkflow(c);
assert.equal(w.state, PonWorkflowState.READY_FOR_POLL, '30 s stale pending must never remain authoritative');

console.log('pon_poll_cta_hard_invariant_test: PASS');
