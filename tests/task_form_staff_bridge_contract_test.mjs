import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

assert.match(source, /STAFF_DIALOG_PATH = '\/task\/dialog_change_staff'/, 'must use UserSide native change-staff dialog');
assert.match(source, /STAFF_SAVE_PATH = '\/task\/staff_save'/, 'must use UserSide native staff-save endpoint');
assert.match(source, /async function applyStaffViaNativeDialog/, 'native staff bridge must be explicit and testable');
assert.match(source, /credentials: 'same-origin'/, 'staff bridge must stay in the authenticated UserSide session');
assert.match(source, /'X-Requested-With': 'XMLHttpRequest'/, 'staff bridge must preserve native AJAX semantics');
assert.match(source, /new FormData\(dialogForm\)/, 'staff save must reuse the native returned form fields/tokens');
assert.match(source, /input\.name = 'division_task_staffids\[\]'/, 'selected divisions must be written using native staff form naming');
assert.match(source, /sameOriginTaskUrl/, 'native form action must be constrained to same-origin expected paths');
assert.match(source, /await applyStaffViaNativeDialog\(context\.taskId, current\.divisionIds\)/, 'EDIT field save must persist staff before task save resumes');
assert.match(source, /event\.preventDefault\(\);[\s\S]{0,900}await applyStaffViaNativeDialog/, 'first submit must be stopped before async staff write');
assert.match(source, /resumeNativeSubmit\(form, event\.submitter \|\| null\)/, 'native task save must resume only after staff save succeeds');
assert.match(source, /STAFF_SUBMIT_BYPASS_ATTR/, 'resumed native submit must avoid recursion through the bridge');
assert.match(source, /showStaffBridgeError/, 'bridge failure must leave task save stopped with visible error');

assert.match(source, /function syncEditStaffNativePayload\(form, selectedDivisionIds\)/, 'EDIT save must serialize the final Workbench staff selection into the real task form');
assert.match(source, /hidden\.name = 'division_task_staffids\[\]'/, 'real EDIT /task/save payload must use division_task_staffids[]');
assert.match(source, /dummy\.name = 'dummy_pers_id'/, 'native dummy_pers_id must be named so the browser actually submits it');
assert.match(source, /syncEditStaffNativePayload\(form, current\.divisionIds\);[\s\S]{0,220}await applyStaffViaNativeDialog/, 'main-form staff payload must be synchronized before the auxiliary staff bridge');

assert.match(source, /NATIVE_ASSIGNMENT_REMOVE_ATTR = 'data-simnet-wb-native-assignment-remove'/, 'current native assignments must expose a per-item remove action');
assert.match(source, /button\.textContent = '×'/, 'assignment removal must use a visible cross');
assert.match(source, /function removeDivisionFromEditCrew\(form, wrap, divisionId\)/, 'generic assignment removal must be explicit and reusable');
assert.match(source, /function removeL1FromEditCrew\(form, wrap\)/, 'legacy L1 quick-remove API may remain available');
assert.match(source, /fallbackLabel = KNOWN_L1_DIVISION_IDS\.has\(id\) \? 'Техподдержка L1' : ''/, 'current L1 must remain removable even if native target staff list omits it');

console.log('task_form_staff_bridge_contract_test: PASS');

assert.match(source, /const staffChanged = Boolean\([\s\S]{0,260}assignmentsChanged\(baseline, currentSnapshot\)\)/, 'non-field EDIT must detect assignment changes');
assert.match(source, /const needsAsyncPreflight = Boolean\(context\?\.mode === 'edit' && \(fieldVisit \|\| staffChanged\)\)/, 'staff changes on non-field EDIT must use the native async bridge while CREATE stays native');
