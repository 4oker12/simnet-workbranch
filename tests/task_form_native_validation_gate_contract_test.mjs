import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

assert.match(source, /function normalizeNativeStaffValidation\(form\)/, 'native validation cleanup must stay explicit');
assert.match(source, /restoreNativeStaffValidation\(form\);/, 'legacy .47/.48 staff-validation mutations must be restorable');
assert.match(source, /function syncNativeConstraintGate\(form\)/, 'native form validation compatibility hook must stay explicit');
assert.match(source, /restoreNativeConstraintGate\(form\);/, 'legacy .48 noValidate state must be restored');
assert.doesNotMatch(source, /form\.noValidate\s*=\s*fieldVisit/, 'Workbench must not disable UserSide browser validation for field tasks');
assert.match(source, /We no longer set noValidate for field tasks/, 'source must document native-validation ownership');

console.log('task_form_native_validation_gate_contract_test: PASS');
