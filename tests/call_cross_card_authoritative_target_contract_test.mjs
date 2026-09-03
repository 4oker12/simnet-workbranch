import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

const headerStart = ui.indexOf('header() {');
const headerEnd = ui.indexOf('\n    surface(', headerStart);
assert.ok(headerStart >= 0 && headerEnd > headerStart);
const header = ui.slice(headerStart, headerEnd);
assert.match(header, /const target = this\.callTargetIdentity\(\)/);
assert.match(header, /const hasTarget = Boolean\(target\.customerId \|\| target\.login \|\| target\.contract \|\| target\.fullName\)/);
assert.doesNotMatch(header, /this\.caseSnapshot/, 'header must never fall back to the card behind CALL');

const snapshotStart = ui.indexOf('renderSnapshotOnly(notice = null)');
const snapshotEnd = ui.indexOf('\n    testReplayPanel', snapshotStart);
const snapshot = ui.slice(snapshotStart, snapshotEnd);
assert.match(snapshot, /const authoritativeCustomerId = customerIdOf\(call\.customerId\)/);
assert.match(snapshot, /const canRegister = Boolean\(snapshotReady && \(authoritativeCustomerId \|\| evidenceTarget\)\)/);
assert.doesNotMatch(snapshot, /Открытая страница|текущая карточка|другой абонент/i);

const lazyStart = ui.indexOf('async loadRegistrationFormForFocusedCall()');
const lazyEnd = ui.indexOf('\n    draft()', lazyStart);
const lazy = ui.slice(lazyStart, lazyEnd);
assert.match(lazy, /this\.callTargetLocked = true/);
assert.match(lazy, /result\.caseId \|\| targetCandidate\?\.caseId/);
assert.doesNotMatch(lazy, /Открытая карточка не совпадает с абонентом из call_list/);

const resolverStart = background.indexOf('async function resolveCallCustomer');
const resolverEnd = background.indexOf('\nasync function loadCallRegistrationForm', resolverStart);
const resolver = background.slice(resolverStart, resolverEnd);
assert.ok(resolver.indexOf('callModule.latestSnapshot') < resolver.indexOf('callCaseFromState'));
assert.match(resolver, /resolveCallOwnerCase\(state/);
assert.match(resolver, /resolver: 'call_list'/);

const validateStart = background.indexOf('function validateCallSubmissionState');
const validateEnd = background.indexOf('\nfunction syncCaseCallBindingState', validateStart);
const validate = background.slice(validateStart, validateEnd);
assert.match(validate, /const authoritativeCustomerId = callCustomerId\(call\.customerId\)/);
assert.match(validate, /Customer ID не совпадает с call_list этого звонка/);
assert.ok(validate.indexOf('authoritativeCustomerId') < validate.indexOf('callCaseFromState'));

console.log('call_cross_card_authoritative_target_contract_test: PASS');
