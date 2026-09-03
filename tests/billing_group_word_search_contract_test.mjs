import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/billing-group-word-search.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.ok(
  manifest.content_scripts.some(entry => entry.js?.includes('src/ui/billing-group-word-search.js')),
  'Billing word-search content script must be loaded'
);
assert.match(source, /select\[name="grp"\]/, 'feature targets only native Billing group select');
assert.match(source, /terms\.every\(term => item\.normalized\.includes\(term\)\)/, 'all query words must match in any order');
assert.match(source, /\['є', 'е'\]/, 'mixed Ukrainian/Russian group labels are folded');
assert.match(source, /const selectedValue = select\.value;/, 'current native value is preserved while filtering');
assert.match(source, /\[selectedItem, \.\.\.matches\]/, 'current group remains visible when it does not match the query');
assert.match(source, /select\.addEventListener\('change'/, 'native group change remains authoritative');
assert.match(source, /queueMicrotask\(restoreAll\)/, 'full option list restores after a real selection');
assert.doesNotMatch(source, /MutationObserver|setInterval/, 'feature must not add a permanent DOM scanner or poller');

console.log('billing_group_word_search_contract_test: PASS');
