import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCallModule } from '../src/features/call/index.js';

let now = Date.parse('2026-08-31T12:00:00Z');
const module = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const state = {
  cases: {
    'customer:501': {
      id: 'customer:501',
      identity: { customerId: '501', contract: '367063', login: 'abon367063' },
      profile: { fullName: 'Live Subscriber' }
    }
  }
};
module.ensure(state);
module.ingestUsersideCalls(state, [], {
  callKey: 'call:2475999', usersideCallId: '2475999', startedAtMs: now - 30_000,
  ongoing: true, date: '2026-08-31', time: '15:00', callerId: '0671234567', callerMasked: '067***67',
  agentExtension: '6047'
});
now += 1000;
module.recordVisit(state, {
  pageKind: 'userside_customer', entityId: '501', identity: { customerId: '501', contract: '367063', login: 'abon367063' }
}, { tab: { id: 17, url: 'https://userside.simnet.kiev.ua/customer/501' } }, { accepted: true });
let view = module.query(state, { caseId: 'customer:501' });
assert.equal(view.focusSnapshot?.status, 'live');
assert.ok(view.focusCandidates.length >= 1, 'LIVE evidence produces a candidate before call completion');
assert.equal(view.focusCandidates[0].customerId, '501');

let outcome = module.recordTaskOutcome(state, { callKey: 'call:2475999', typer: '1', stage: 'submitted' }, { tab: { id: 22 } });
assert.equal(outcome.accepted, true);
assert.equal(outcome.outcome.stage, 'submitted');
now += 2000;
outcome = module.recordTaskOutcome(state, { callKey: 'call:2475999', typer: '1', stage: 'created', taskId: '123456' }, { tab: { id: 22 } });
assert.equal(outcome.outcome.stage, 'created');
assert.equal(outcome.outcome.taskId, '123456');
view = module.query(state, { caseId: 'customer:501' });
assert.equal(view.dayCalls[0].outcome?.label, 'Новое подключение · ЖК');
assert.equal(view.dayCalls[0].outcome?.taskId, '123456');

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../src/ui/popup.js', import.meta.url), 'utf8');
const task = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');
const callUi = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(shared, /WORKBENCH_DATA_CLEAR/);
assert.match(background, /async function clearWorkbenchData/);
assert.match(background, /chrome\.storage\.local\.clear\(\)/);
assert.match(background, /cookies.*untouched|auth cookies.*preserved/i);
assert.match(rail, /Полный сброс WB/);
assert.match(popup, /WORKBENCH_DATA_CLEAR/);
assert.equal(manifest.permissions.includes('cookies'), false, 'Workbench reset must not get permission to clear CRM auth cookies');
assert.match(task, /CALL_TASK_PENDING_KEY/);
assert.match(task, /CALL_TASK_OUTCOME_RECORDED/);
assert.match(callUi, /data-typer="41"/);
assert.match(callUi, /data-typer="70"/);
assert.match(callUi, /data-typer="1"/);
assert.match(callUi, /data-typer="15"/);
assert.match(callUi, /CALL_REGISTRATION_ROUTE_TARGET/);

console.log('call_live_routing_outcome_maintenance_contract_test: PASS');
