import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

assert.ok(!manifest.permissions.includes('tabGroups'), 'tabGroups permission must be removed');
assert.doesNotMatch(background, /chrome\.tabs\.group\s*\(/);
assert.doesNotMatch(background, /chrome\.tabGroups/);
assert.doesNotMatch(background, /syncCaseTabGroups/);

console.log('no_tab_groups_contract_test: PASS');
