import assert from 'node:assert/strict';
import fs from 'node:fs';
const rail=fs.readFileSync(new URL('../src/ui/rail.js',import.meta.url),'utf8');
const start=rail.indexOf('ponContextCard(currentCase');
const end=rail.indexOf('clearPonPageHints()',start);
assert.ok(start>=0&&end>start);
const block=rail.slice(start,end);
assert.match(block,/WB\.caseView\?\.live\?\.\(currentCase\)/);
assert.match(block,/semanticAction === 'manual_fill_billing'/);
assert.match(block,/данные не внесены в Billing|не сохранены в Billing/i);
assert.match(block,/вручную/i);
assert.doesNotMatch(block,/saveHint|pendingNativeSave|live-apply-tmc|Открыть и подставить/);
assert.match(rail,/manual_fill_billing'.*manual_review|manual_fill_billing/);

assert.match(rail,/tmcPrefillFields\.length > 0 \|\| tmcConflicts\.length > 0/,'TMC history state must derive from Billing↔TMC reconciliation, not route action');
assert.match(rail,/const signal = pending \? '○' : \(pendingBilling \? '\?' : '✓'\)/,'unsynchronized TMC must not render green check');
assert.doesNotMatch(rail,/tmcNeedsBilling = String\(currentCase\?\.diagnostic\?\.locatorAction/,'TMC status must not depend on workflow action');

console.log('live_case_view_authority_contract_test: PASS');
