import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const bridge = fs.readFileSync(new URL('../src/ui/call-attention-bridge.js', import.meta.url), 'utf8');
const processing = fs.readFileSync(new URL('../src/features/call/transcription/call-processing.js', import.meta.url), 'utf8');
const stateStore = fs.readFileSync(new URL('../src/features/call/storage/call-state-store.js', import.meta.url), 'utf8');

const scripts = manifest.content_scripts.flatMap(entry => Array.isArray(entry.js) ? entry.js : []);

assert.ok(scripts.includes('src/ui/call-attention-bridge.js'));
assert.ok(!scripts.includes('src/ui/call-transcription-jobs.js'));
assert.match(bridge, /CALL_PROCESSING_CANCEL/);
assert.match(bridge, /needsAttention/);
assert.match(bridge, /Требу(?:ет|ют) внимания/);
assert.match(bridge, /В работе/);
assert.match(bridge, /История/);
assert.match(bridge, /WORK_STATUSES/);
assert.match(processing, /WAIT_PBX_ATTENTION_MS/);
assert.match(processing, /callExecutionRegistry/);
assert.match(processing, /CALL_PROCESSING_CANCEL/);
assert.match(processing, /CallStateStore/);
assert.match(processing, /recoverInterruptedCalls/);
assert.match(stateStore, /simnet_workbench_state_v5/);
assert.doesNotMatch(processing, /const JOB_STORE_KEY\s*=/);

console.log('call_attention_bell_contract_test: PASS');
