import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

const openStart = ui.indexOf('async open(caseData');
const lazyStart = ui.indexOf('async loadRegistrationFormForFocusedCall()', openStart);
assert.ok(openStart >= 0 && lazyStart > openStart, 'open and lazy registration methods must exist');
const openBlock = ui.slice(openStart, lazyStart);
assert.match(openBlock, /PBX_QUERY_MESSAGE|CALL_LATEST_SNAPSHOT_MESSAGE/);
assert.doesNotMatch(openBlock, /FORM_MESSAGE/, 'opening CALL must not load the UserSide registration form');

const draftStart = ui.indexOf('\n    draft()', lazyStart);
const lazyBlock = ui.slice(lazyStart, draftStart);
assert.match(lazyBlock, /FORM_MESSAGE/);
assert.match(lazyBlock, /callKey:\s*String\(call\.callKey/);
assert.match(ui, /data-action="open-registration-form"/);
assert.match(ui, /await this\.loadRegistrationFormForFocusedCall\(\)/);

const resolverStart = background.indexOf('async function resolveCallCustomer');
const resolverEnd = background.indexOf('\nasync function loadCallRegistrationForm', resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'resolveCallCustomer must exist');
const resolver = background.slice(resolverStart, resolverEnd);
assert.match(resolver, /resolver:\s*'call_list'/);
assert.match(resolver, /callModule\.latestSnapshot\(state, \{ callKey: requestedCallKey \}\)/);
assert.match(resolver, /resolveCallOwnerCase\(state/);
assert.ok(
  resolver.indexOf("resolver: 'call_list'") < resolver.indexOf('call-resolve-gotouser'),
  'authoritative call_list resolution must run before gotouser/ajax fallback'
);
assert.ok(
  resolver.indexOf('callModule.latestSnapshot') < resolver.indexOf('callCaseFromState'),
  'current open card must be consulted only after call_list failed to identify the call'
);

console.log('call_lazy_registration_contract_test: PASS');
