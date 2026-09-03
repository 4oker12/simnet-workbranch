import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const navCode = fs.readFileSync(new URL('../src/core/evidence-navigator.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const callUi = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const railStyles = fs.readFileSync(new URL('../src/ui/rail-styles.js', import.meta.url), 'utf8');
const billingNav = fs.readFileSync(new URL('../src/core/billing-navigation.js', import.meta.url), 'utf8');

const context = { SIMNET_WB: {} };
vm.createContext(context);
vm.runInContext(navCode, context);
const nav = context.SIMNET_WB.evidenceNavigator;
assert.ok(nav, 'evidence navigator should load');

const blankPonCase = {
  diagnostic: { isEthernet: false, ponWorkflowDetails: { prefillFields: [], conflicts: [] } },
  network: {},
  progress: {},
  contexts: {},
  locator: { evidence: [], sourceStatus: {} },
  operations: { poll: { current: null } },
  live: {}
};
const pending = nav.planTrail(blankPonCase);
assert.deepEqual(Array.from(pending, x => x.key), ['technical', 'tmc', 'juniper', 'poll']);
for (const item of pending) {
  assert.equal(item.level, 'pending');
  assert.equal(item.replay, false, `${item.key}: locked item cannot navigate`);
  assert.ok(item.help.includes('Маршрут известен:'), `${item.key}: known route should be shown in help`);
}
assert.equal(pending.find(x => x.key === 'technical').status, 'не посещались');
assert.equal(pending.find(x => x.key === 'tmc').status, 'не посещалось');
assert.equal(pending.find(x => x.key === 'poll').status, 'не выполнялся');

const pollCase = structuredClone(blankPonCase);
pollCase.live.oltSnapshot = {
  status: 'confirmed',
  outcome: 'confirmed',
  observedSubscriberMac: 'B0:4E:26:D3:C4:4B',
  linkState: 'up',
  interface: 'epon0/12/14:19',
  pollAction: '310',
  capturedAt: '2026-08-30T02:00:00.000Z'
};
const poll = nav.trail(pollCase).find(x => x.key === 'poll');
assert.ok(poll, 'confirmed OLT snapshot should become a LIVE checkpoint');
assert.equal(poll.label, 'Опрос ONU / OLT');
assert.match(poll.status, /MAC найден/);
assert.match(poll.status, /Link Up/);
assert.match(poll.status, /epon0\/12\/14:19/);
assert.equal(poll.replay, true, 'completed checkpoint unlocks replay navigation');

const downCase = structuredClone(blankPonCase);
downCase.live.oltSnapshot = {
  status: 'confirmed', outcome: 'confirmed', onuStatus: 'online',
  observedSubscriberMac: 'B0:4E:26:D3:C4:4B', linkState: 'down',
  capturedAt: '2026-08-30T02:01:00.000Z'
};
const downPoll = nav.trail(downCase).find(x => x.key === 'poll');
assert.equal(downPoll.level, 'attention', 'Link Down is an attention result, not a failed poll');
assert.equal(downPoll.replay, true, 'Link Down still unlocks the completed poll route');

const losCase = structuredClone(blankPonCase);
losCase.live.oltSnapshot = {
  status: 'confirmed', outcome: 'confirmed', onuStatus: 'los',
  observedOnuMac: 'AA:BB:CC:DD:EE:FF',
  capturedAt: '2026-08-30T02:02:00.000Z'
};
const losPoll = nav.trail(losCase).find(x => x.key === 'poll');
assert.match(losPoll.status, /MAC найден|ONU LOS/);
assert.equal(losPoll.replay, true, 'LOS is still a successful completed poll checkpoint');


const observedLosCase = structuredClone(blankPonCase);
observedLosCase.live.oltSnapshot = {
  status: 'observed', outcome: 'observed', onuStatus: 'los', pollAction: '313',
  observedOnuMac: 'AA:BB:CC:DD:EE:FF',
  capturedAt: '2026-08-30T02:03:00.000Z'
};
const observedLosPoll = nav.trail(observedLosCase).find(x => x.key === 'poll');
assert.match(observedLosPoll.status, /ONU LOS/, 'observed terminal LOS remains a completed visible poll result');
assert.equal(observedLosPoll.replay, true, 'observed LOS keeps the route replay unlocked');

assert.match(rail, /pollUnlocked[\s\S]*data-action=\"live-open-poll\"/, 'pending OLT checkpoint can unlock direct poll route when prerequisites are green');
assert.match(rail, /pollPrerequisitesReady\(currentCase\)/, 'OLT unlock is gated by reconciled prerequisite checkpoints');
assert.match(rail, /pollReplayAllowed/, 'completed poll replay remains gated by usable result or ready prerequisites');
assert.match(rail, /pending && item\.help[\s\S]*this\.liveNavHelp\(item\.help\)/, 'other pending checkpoints expose help instead of navigation');
assert.match(rail, /live-mini-alert attention/, 'LIVE warnings are compact rows');
assert.doesNotMatch(rail, /evidence-history-head[\s\S]*live-progress/, 'LIVE checkpoint list no longer renders the progress bar');
assert.match(rail, /live-poll-keyfacts/, 'important poll facts are promoted into the main LIVE subscriber card');
assert.match(rail, /CPE MAC/, 'subscriber MAC is highlighted in the main LIVE card');
assert.match(rail, /LINK \${linkState\.toUpperCase\(\)}/, 'ethernet link state is highlighted in the main LIVE card');
assert.match(rail, /open-billing-card/, 'bottom utility action returns to the Billing subscriber card');
assert.doesNotMatch(rail, /data-action=\"copy-contract\"[^>]*>[\s\S]{0,100}Договор/, 'large bottom copy-contract button was replaced');

assert.match(callUi, /const LIVE_CALL_ROW_PREVIEW_ENABLED = false;/, 'call-list test preview is parked');
assert.match(callUi, /if \(!LIVE_CALL_ROW_PREVIEW_ENABLED\) return null;/, 'disabled preview cannot poll call_list');

console.log('PASS live_checkpoint_unlock_contract_test');
