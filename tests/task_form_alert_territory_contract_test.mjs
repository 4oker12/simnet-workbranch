import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

assert.match(source, /position:fixed;z-index:2147483646;top:18px/, 'blocking validation must be a fixed top alert');
assert.match(source, /Заявка не сохранена/, 'top alert must state that the task was not saved');
assert.doesNotMatch(source, /Нужно исправить:/, 'old inline error journal must be removed');
assert.doesNotMatch(source, /Проверьте задание · ошибок:/, 'old bottom summary title must be removed');
assert.match(source, /PRIVATE_SECTOR_CREW_IDS = new Set\(\['69', '13', '18', '17', '45'\]\)/, 'private-sector crew matrix must be present');
assert.match(source, /NON_PRIVATE_CREW_IDS = new Set\(Array\.from\(KNOWN_CREW_DIVISION_IDS\)\.filter\(id => !PRIVATE_SECTOR_CREW_IDS\.has\(id\)\)\)/, 'non-private matrix must exclude private-sector crews');
assert.match(source, /\/task\/ajax_load_building_work_description\?unit_id=/, 'building id must be resolved through the proven UserSide endpoint when needed');
assert.match(source, /fetch\(`\/building\/\$\{encodeURIComponent\(id\)\}`/, 'verified building card must be used for generic repair territory detection');
assert.match(source, /field-crew-territory-mismatch/, 'territory mismatch must be a blocking validation code');

console.log('task_form_alert_territory_contract_test: PASS');

assert.match(source, /document\.querySelector\(`\.\$\{SUMMARY_CLASS\}\[data-simnet-wb-owned=\"1\"\]`\)/, 'top alert must be a single document-level element');
assert.match(source, /\(document\.body \|\| document\.documentElement\)\.appendChild\(summary\)/, 'top alert must live outside the native form');
assert.match(source, /NATIVE_EDIT_STAFF_CLASS/, 'current native assignments must be visually joined with the edit assignment picker');
