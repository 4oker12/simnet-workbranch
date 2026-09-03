import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
assert.equal(manifest.permissions.includes('tabGroups'), false);
assert.equal(/chrome\.tabs\?*\.group|chrome\.tabs\.group|chrome\.tabGroups/.test(background), false);
assert.equal(background.includes('syncCaseTabGroups'), false);
console.log('tab_grouping_disabled_contract_test: PASS');
