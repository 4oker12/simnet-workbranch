import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/parsers/billing/poll-result.js', import.meta.url), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'src/parsers/billing/poll-result.js' });
const parser = sandbox.SIMNET_WB.parsers.billing.pollResult;

const result = parser.classifyPollText('[16:39:49 10-09-2026] ====== OLT 172.16.1.50 ======= ONU не знайден', {}, { action: '313' });
assert.equal(result.result, 'not_found');
assert.equal(result.pending, false);
assert.equal(result.ready, true);

const feminine = parser.classifyPollText('ONU не знайдена на OLT 172.16.1.50', {}, { action: '313' });
assert.equal(feminine.result, 'not_found');

console.log('huawei_not_found_parser_regression_test: PASS');
