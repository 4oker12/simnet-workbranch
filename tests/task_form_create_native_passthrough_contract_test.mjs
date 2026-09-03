import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

const clickBlock = source.slice(source.indexOf('function onClick'), source.indexOf('async function onSubmit'));
const clickCreate = clickBlock.match(/if \(context\?\.mode === 'create'\) \{[\s\S]*?\n    \}/)?.[0] || '';
assert.ok(clickCreate, 'CREATE click branch must exist');
assert.match(clickCreate, /renderCreateAdvisory\(form, 'submit-click'\)/, 'CREATE click must evaluate the schedule gate');
assert.match(clickCreate, /if \(advisory && !advisory\.valid\)[\s\S]*?preventDefault\(\)[\s\S]*?stopImmediatePropagation\(\)/, 'invalid CREATE schedule must be cancelled before native save');
assert.doesNotMatch(clickCreate, /requestSubmit|\.checked\s*=|\.disabled\s*=/, 'CREATE click gate must not synthesize submit or mutate staff controls');

const submitBlock = source.slice(source.indexOf('async function onSubmit'), source.indexOf('function onInput'));
const createBranch = submitBlock.match(/if \(context\?\.mode === 'create'\) \{[\s\S]*?\n    \}/)?.[0] || '';
assert.ok(createBranch, 'CREATE submit branch must exist');
assert.match(createBranch, /renderCreateAdvisory\(form, 'submit'\)/, 'direct CREATE submit must evaluate the same schedule gate');
assert.match(createBranch, /if \(advisory && !advisory\.valid\)[\s\S]*?preventDefault\(\)[\s\S]*?stopImmediatePropagation\(\)/, 'direct invalid CREATE submit must also be cancelled');
assert.doesNotMatch(createBranch, /requestSubmit|\.checked\s*=|\.disabled\s*=/, 'CREATE submit branch must not mutate or synthesize UserSide staff controls');
assert.match(submitBlock, /needsAsyncPreflight = Boolean\(context\?\.mode === 'edit'/, 'async staff preflight must remain EDIT-only');

console.log('task_form_create_native_passthrough_contract_test: PASS');
