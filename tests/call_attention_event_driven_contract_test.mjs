import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.match(messages, /CALL_ATTENTION_EVIDENCE/);
assert.match(bootstrap, /visibilitychange/);
assert.match(bootstrap, /submitCallAttention\('stop'\)/);
assert.match(bootstrap, /window\.addEventListener\('blur'/);
assert.match(bootstrap, /window\.addEventListener\('focus'/);
assert.doesNotMatch(bootstrap, /setInterval\([^)]*submitCallAttention/);
assert.match(callModule, /ATTENTION_INTERVAL/);
assert.match(callModule, /closeAttentionInterval/);
console.log('PASS call_attention_event_driven_contract_test');
