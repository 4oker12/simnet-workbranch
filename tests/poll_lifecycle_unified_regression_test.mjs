import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deriveCurrentPollState, derivePonWorkflow, pollRouteForCase } from '../src/workflows/pon.js';
import { computeDiagnosticDecision } from '../src/workflows/diagnostic.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/abon507126-poll-desync.json', import.meta.url), 'utf8'));
const current = fixture.operations.poll.current;
assert.ok(current?.pollAttemptId, 'fixture must contain the real stuck poll attempt');

// The exported Case is the real regression: durable operation says pending while
// the PON recommendation had already returned to ready_for_poll. The projection
// must never treat a >30s attempt as active.
const route = pollRouteForCase(fixture);
const justBeforeTimeout = deriveCurrentPollState(fixture, route, Number(current.startedAt) + 29_000);
assert.equal(justBeforeTimeout.state, 'pending');
const afterTimeout = deriveCurrentPollState(fixture, route, Number(current.startedAt) + 31_000);
assert.equal(afterTimeout.state, 'timeout');

const wrongBinding = structuredClone(fixture);
wrongBinding.operations.poll.current = {
  ...wrongBinding.operations.poll.current,
  startedAt: Date.now(),
  action: '312',
  oltIp: '172.16.13.70',
  pending: true,
  stage: 'REQUEST_STARTED'
};
const wrongState = deriveCurrentPollState(wrongBinding, pollRouteForCase(wrongBinding), Date.now());
assert.equal(wrongState.state, 'superseded', 'wrong OLT/technology cannot remain an active pending for current binding');

const workflow = derivePonWorkflow(fixture);
assert.notEqual(workflow.pollState, 'pending', 'stale exported attempt must not project as pending');
const diagnostic = computeDiagnosticDecision(fixture);
assert.notEqual(diagnostic.pollState, 'pending');
assert.equal(diagnostic.conflictCount, 0, 'historical same-source OLT changes are not current Billing↔TMC conflicts');

// Load the browser parser in a tiny VM and verify terminal-vs-profile-row separation.
const parserSource = fs.readFileSync(new URL('../src/parsers/billing/poll-result.js', import.meta.url), 'utf8');
const sandbox = { globalThis: { SIMNET_WB: {} } };
vm.runInNewContext(parserSource, sandbox, { filename: 'poll-result.js' });
const classify = sandbox.globalThis.SIMNET_WB.parsers.billing.pollResult.classifyPollText;

const huaweiPage = fixture.contexts['billing|billing_onu_poll|50712|a313|abon507126'];
const profileOnlyText = huaweiPage.meta.poll.snapshot.responseSummary;
const profileOnly = classify(profileOnlyText, fixture, { action: '313' });
assert.equal(profileOnly.pollResponded, false, 'native profile/source rows are not terminal OLT output by themselves');

const terminalText = `
F/S/P               : 0/4/6
ONT-ID              : 13
Run state           : online
SN                  : 485750501205DB (XPON501205DB)
Rx optical power(dBm) : -23.01
`;
const terminal = classify(terminalText, fixture, { action: '313' });
assert.equal(terminal.result, 'confirmed');
assert.equal(terminal.pollResponded, true);
assert.ok(terminal.matchedBy.includes('onuSerial'), 'terminal identity should match the fixture ONU serial');

const pending = classify('Данные посланы. Ждите...', fixture, { action: '313' });
assert.equal(pending.result, 'pending');
assert.equal(pending.pollResponded, false);

console.log('poll_lifecycle_unified_regression_test: PASS');
