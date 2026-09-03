import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

assert.match(source, /CREATE_SCHEDULE_BLOCKING_CODES = new Set\(\[/, 'CREATE field gate must explicitly define its blockers');
for (const code of ['field-date-required', 'field-time-required', 'field-time-past', 'field-time-min-lead', 'field-crew-required']) {
  assert.match(source, new RegExp(code), `CREATE field gate must include ${code}`);
}
assert.match(source, /function createFieldVisitAdvisory\(form, options = \{\}\)/, 'CREATE needs a dedicated policy builder');
assert.match(source, /const target = CREATE_SCHEDULE_BLOCKING_CODES\.has\(issue\.code\) \? errors : warnings/, 'CREATE field findings must be mapped to hard errors by the shared blocking set');
assert.match(source, /valid: errors\.length === 0/, 'CREATE result validity must reflect all field blockers');
assert.match(source, /advisoryOnly: errors\.length === 0/, 'CREATE is advisory-only only when no hard field invariant is broken');
assert.match(source, /if \(context\?\.mode === 'create'\) \{[\s\S]{0,800}renderCreateAdvisory\(form, 'submit-click'\)[\s\S]{0,260}!advisory\.valid[\s\S]{0,180}event\.preventDefault\(\)[\s\S]{0,180}event\.stopImmediatePropagation\(\)/, 'CREATE click must block every invalid field attempt');
assert.match(source, /if \(context\?\.mode === 'create'\) \{[\s\S]{0,650}renderCreateAdvisory\(form, 'submit'\)[\s\S]{0,260}!advisory\.valid[\s\S]{0,180}event\.preventDefault\(\)[\s\S]{0,180}event\.stopImmediatePropagation\(\)/, 'direct CREATE submit must also block an invalid field invariant');
assert.match(source, /No replacement picker/, 'CREATE must still leave native UserSide staff controls untouched');
assert.match(source, /FIELD_MIN_LEAD_MS = 3 \* 60 \* 60 \* 1000/, 'three-hour threshold must remain exact');
assert.match(source, /field-crew-required/, 'missing brigade must be a CREATE blocker');
assert.match(source, /CREATE field gate/, 'CREATE click path must log the unified field gate');

console.log('task_form_create_advisory_only_contract_test: PASS');
