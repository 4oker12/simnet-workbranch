import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const bridge = fs.readFileSync(new URL('../src/ui/call-attention-bridge.js', import.meta.url), 'utf8');
const jobs = fs.readFileSync(new URL('../src/features/call/transcription/jobs.js', import.meta.url), 'utf8');

const scripts = manifest.content_scripts
  .flatMap(entry => Array.isArray(entry.js) ? entry.js : []);

assert.ok(scripts.includes('src/ui/call-attention-bridge.js'));
assert.ok(!scripts.includes('src/ui/call-transcription-jobs.js'));
assert.match(bridge, /CALL_TRANSCRIPTION_JOB_CANCEL/);
assert.match(bridge, /needsAttention/);
assert.match(bridge, /Звонки · последние/);
assert.match(jobs, /WAIT_PBX_ATTENTION_MS/);
assert.match(jobs, /AbortController/);
assert.match(jobs, /CALL_TRANSCRIPTION_JOB_CANCEL/);
assert.match(jobs, /CANCELLED/);

console.log('call_attention_bell_contract_test: PASS');
