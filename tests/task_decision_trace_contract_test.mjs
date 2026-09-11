import fs from 'node:fs';
import assert from 'node:assert/strict';

const contract = fs.readFileSync(new URL('../src/ui/task-current-contract-guard.js', import.meta.url), 'utf8');
const staff = fs.readFileSync(new URL('../src/ui/task-current-staff-transition.js', import.meta.url), 'utf8');

// Save/validation decision trace: enough evidence to reconstruct why a live save
// was allowed, blocked, or diverted to the special-address acknowledgement.
for (const event of [
  'task_form_baseline_captured',
  'task_save_decision',
  'Current UserSide field visit validation blocked save',
  'special_info_evaluated',
  'special_info_guard_shown',
  'UserSide LIVE special conditions acknowledged',
  'task_save_replay_requested'
]) {
  assert.ok(contract.includes(event), `current task guard must trace ${event}`);
}

// L1 -> field transition trace: capture source state before UserSide can replace
// dynamic form fragments, then trace type/staff decisions and the native write.
for (const event of [
  'staff_source_captured',
  'task_type_changed',
  'crew_selection_changed',
  'l1_detach_toggled',
  'staff_save_preflight',
  'staff_save_blocked',
  'native_staff_payload_prepared',
  'native_staff_save_success',
  'staff_save_apply_complete'
]) {
  assert.ok(staff.includes(event), `staff transition must trace ${event}`);
}

assert.match(staff, /if \(event\.defaultPrevented\)/,
  'staff layer must not race a prior date/time/special-info save guard');
assert.match(staff, /pageSourceSeed/,
  'original L1 source must survive a dynamic UserSide form replacement');
assert.match(staff, /documentObserver = new MutationObserver/,
  'dynamic replacement of the task form must be rediscovered without polling');
assert.doesNotMatch(staff, /setInterval\(/,
  'task transition tracing must remain event-driven');

// Current task UI should visually blend into the refreshed UserSide form rather
// than reusing the Workbench plum rail styling.
assert.match(contract, /#f3f6f8/i, 'special-info dialog must use UserSide-like neutral header');
assert.match(contract, /#4c7da1/i, 'confirm action must use UserSide-like blue action color');
assert.match(staff, /#f7f9fb/i, 'L1 transition panel must use UserSide-like neutral surface');
assert.doesNotMatch(contract, /#a50046/i,
  'current task guard must not use the Workbench plum accent inside UserSide forms');
assert.doesNotMatch(staff, /#a50046/i,
  'current staff transition must not use the Workbench plum accent inside UserSide forms');

console.log('task_decision_trace_contract_test: PASS');
