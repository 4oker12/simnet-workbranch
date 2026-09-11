import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-current-staff-transition.js', import.meta.url), 'utf8');

assert.match(source, /select\[name="task_type_uuid"\]/, 'current UserSide task type UUID selector must be used');
assert.match(source, /f1b8154a-abd7-4816-bb97-d323da5ca4d5/, 'L1 - Інше UUID must be recognized');
assert.match(source, /76fce89d-3304-4d26-a4cf-86dd78a9d89e/, 'current Techsupport L1 division UUID must be recognized');
assert.match(source, /3496276b-010a-46ed-a2c5-534c32e8f9e2/, 'B2C repair UUID must be a field visit');
assert.match(source, /1b34ce66-cd14-4893-a2ec-59c19bcf16dc/, 'B2C connection UUID must be a field visit');
assert.match(source, /division_auto_task_staffuuids\[\]/, 'current auto-staff UUID namespace must be read');
assert.match(source, /division_task_staffuuids\[\]/, 'current saved-staff UUID namespace must be supported');
assert.match(source, /Переоформление L1 → выездная заявка/, 'transition UI must explain L1 to field conversion');
assert.match(source, /Открепить L1/, 'operator must have an explicit L1 detach action');
assert.match(source, /Выбери выездную бригаду «Бр\. …»/, 'save guard must require a real brigade');
assert.match(source, /if \(!state\.l1Removed\).*Открепи/s, 'save must block while L1 remains attached');
assert.match(source, /selectedCrewUuids\(form\)/, 'save must inspect current crew selection');
assert.match(source, /STAFF_DIALOG_PATH = '\/task\/dialog_change_staff'/, 'native UserSide staff dialog must remain the write authority');
assert.match(source, /STAFF_SAVE_PATH = '\/task\/staff_save'/, 'native UserSide staff save endpoint must remain the write authority');
assert.match(source, /credentials: 'same-origin'/, 'staff transition must stay inside authenticated UserSide session');
assert.match(source, /new FormData\(dialogForm\)/, 'native returned staff form and CSRF fields must be preserved');
assert.match(source, /dialogStaffNamespace/, 'staff bridge must detect UUID vs legacy namespace from the live native dialog');
assert.match(source, /return 'division_task_staffuuids\[\]'/, 'UUID staff namespace must be the current-contract default');
assert.match(source, /new MutationObserver/, 'dynamic UserSide staff reload must be observed without polling');
assert.match(source, /observer\.observe\(form, \{ childList: true, subtree: true \}\)/, 'observer must stay scoped to the task form');
assert.doesNotMatch(source, /setInterval\(/, 'staff transition must not use endless polling');

console.log('task_current_staff_transition_contract_test: PASS');