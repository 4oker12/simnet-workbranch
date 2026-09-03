import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
assert.ok(!scripts.includes('src/ui/billing-group-word-search.js'), 'experimental Billing group search must not be loaded');
assert.equal(fs.existsSync(new URL('../src/ui/billing-group-word-search.js', import.meta.url)), false, 'experimental search source must be absent');
console.log('billing_group_search_rollback_contract_test: PASS');
