import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');

assert.match(ui, /liveFeedEvents\(events = \[\]\)/, 'LIVE board must coalesce low-level transition events');
assert.match(ui, /String\(item\.handoff\?\.token \|\| ''\) === token/, 'intent and handoff are paired by the same token');
assert.match(ui, /ts - handoffTs > 2500/, 'initial UserSide visit is folded into confirmed transition');
assert.match(ui, /Billing → UserSide: \$\{who\}/, 'confirmed transition is shown as one semantic line');
assert.match(ui, /Открываю UserSide:/, 'pending intent can still be shown before confirmation');

assert.match(bootstrap, /USERSIDE_CALL_TARGET_KEY/);
assert.match(bootstrap, /rememberUsersideCustomerTarget/);
assert.match(bootstrap, /callTargetHint/);
assert.match(bootstrap, /fullName: targetHint\?\.fullName \|\| ''/);
assert.match(bootstrap, /identity:\s*\{\s*customerId: match\[1\],\s*fullName:/s, 'UserSide search click transports clicked identity label');

assert.match(callModule, /visitIdentityFromContext/);
assert.match(callModule, /pageLogin = \/\^userside:customer-card-login\$\/i/, 'UserSide login must come from the current card parser');
assert.match(callModule, /pageContract = \/\^userside:customer-card-contract\$\/i/, 'UserSide contract must come from the current card parser');
assert.match(callModule, /\(pageLogin \|\| pageContract\) \? resolveIdentityFromCases\(state, raw\) : raw/, 'cross-system enrichment requires current-card login/contract; customerId alone is insufficient');
assert.doesNotMatch(callModule, /caseId: String\(options\.caseId \|\| ''\),\s*\.\.\.\(context\.identity/s, 'CALL visit must not inject the active caseId into a new page target');
console.log('PASS call_live_transition_coalesce_contract_test');
