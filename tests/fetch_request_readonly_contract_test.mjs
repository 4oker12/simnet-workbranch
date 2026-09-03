import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
assert.match(source, /FETCH_REQUEST is read-only/);
assert.match(source, /\['GET', 'HEAD'\]\.includes\(method\)/);
console.log('fetch_request_readonly_contract_test: PASS');
