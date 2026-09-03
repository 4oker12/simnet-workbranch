import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

assert.match(source, /EDIT_CREW_DIVISION_ATTR = 'data-simnet-wb-edit-crew-division'/, 'EDIT UI-only staff state remains isolated');
assert.match(source, /input\.setAttribute\(EDIT_CREW_DIVISION_ATTR, id\);[\s\S]{0,260}input\.removeAttribute\('name'\)/, 'EDIT Workbench picker controls must not become successful form controls');
assert.match(source, /submissionAuthority: 'division_task_staffids\[\]'/, 'EDIT still uses UserSide native selected-staff namespace');
assert.match(source, /if \(context\?\.mode === 'create'\) \{[\s\S]{0,420}form\.querySelector\(`\[\$\{FILTER_ATTR\}\]`\)\?\.remove\(\);[\s\S]{0,100}return;/, 'CREATE must not install the Workbench staff filter/picker');
assert.match(source, /CREATE field gate/, 'CREATE click path must enforce the unified field gate');
assert.match(source, /CREATE submit field gate/, 'CREATE submit event must enforce the same field gate before native UserSide save');
assert.doesNotMatch(source, /dedupeCreateStaffSubmission/, 'Workbench must not rewrite native CREATE staff selections');

console.log('task_form_staff_single_authority_contract_test: PASS');
