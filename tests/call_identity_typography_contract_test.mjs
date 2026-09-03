import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
assert.match(source, /subscriber-name[^}]*font-weight:800/);
assert.match(source, /subscriber-contract[^}]*font-weight:400/);
assert.match(source, /const fullName = hasCase \? String\(valueOf\(caseData\.profile\?\.fullName\)/);
console.log('call_identity_typography_contract_test: PASS');
