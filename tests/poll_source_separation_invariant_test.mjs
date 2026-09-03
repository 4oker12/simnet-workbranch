import assert from 'node:assert/strict';
import fs from 'node:fs';
import { derivePonWorkflow, PonWorkflowState } from '../src/workflows/pon.js';

const reader = fs.readFileSync(new URL('../src/readers/billing.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

assert.doesNotMatch(reader, /billing:onu-poll-explicit-olt-ip/, 'poll response must not write canonical pon.oltIp');
assert.match(background, /restoreBillingOltSource/, 'legacy poll-derived OLT source must be repairable on next Billing Technical read');
assert.match(background, /billing:olt-selected-option-ip/, 'repair must prefer actual Billing Technical source');

const fact = (value, source) => ({ value, source, confidence: .99 });
const legacyPollPollutedCase = {
  network: { connectionFamily: fact('PON', 'billing:connection-type') },
  pon: {
    oltIp: fact('172.16.1.50', 'billing:onu-poll-explicit-olt-ip'),
    onuMac: fact('AA:BB:CC:DD:EE:FF', 'billing:onu-mac'),
    tmcOltIp: fact('172.16.1.50', 'userside:tmc-olt-ip'),
    tmcOnuMac: fact('AA:BB:CC:DD:EE:FF', 'userside:tmc-onu-mac')
  },
  contexts: { tech: { pageKind: 'billing_technical' }, us: { pageKind: 'userside_customer' } },
  locator: {
    sourceStatus: { tmc: { result: 'found', details: { oltIp: '172.16.1.50', onuMac: 'AA:BB:CC:DD:EE:FF' } } },
    candidates: [], attempts: [], evidence: [], termination: { status: 'confirmed', pollCompleted: true, pollResponded: true }
  },
  operations: { poll: { current: { pending: false, stage: 'CONFIRMED' }, history: [] } },
  live: { oltSnapshot: { status: 'confirmed', oltIp: '172.16.1.50' } }
};
const workflow = derivePonWorkflow(legacyPollPollutedCase);
assert.equal(workflow.billingTechnicalComplete, false, 'poll-derived OLT IP must not satisfy Billing Technical');
assert.equal(workflow.state, PonWorkflowState.FILL_TECHNICAL, 'TMC OLT must still be treated as not saved in Billing');
assert.ok(workflow.prefillFields.includes('olt'));

console.log('poll_source_separation_invariant_test: PASS');
