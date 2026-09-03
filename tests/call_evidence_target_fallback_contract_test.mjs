import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const start = ui.indexOf('callTargetCandidate() {');
const end = ui.indexOf('\n    callTargetIdentity()', start);
assert.ok(start >= 0 && end > start, 'callTargetCandidate block missing');
const block = ui.slice(start, end);

assert.match(block, /const authoritativeCustomerId = customerIdOf\(this\.focusCall\?\.customerId\)/);
assert.match(block, /if \(authoritativeCustomerId\) return authoritative/);
assert.match(block, /candidate\?\.hardConflict !== true/);
assert.match(block, /Number\(candidate\?\.confidence \|\| candidate\?\.rawScore \|\| 0\) >= 80/);
assert.match(block, /return confirmed\.length === 1 \? confirmed\[0\] : null/);

console.log('call_evidence_target_fallback_contract_test: PASS');
