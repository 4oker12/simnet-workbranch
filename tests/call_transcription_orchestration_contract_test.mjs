import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const processing = fs.readFileSync(new URL('../src/features/call/transcription/call-processing.js', import.meta.url), 'utf8');
const callRecord = fs.readFileSync(new URL('../src/features/call/domain/call-record.js', import.meta.url), 'utf8');
const callStore = fs.readFileSync(new URL('../src/features/call/storage/call-state-store.js', import.meta.url), 'utf8');
const executionRegistry = fs.readFileSync(new URL('../src/features/call/runtime/call-execution-registry.js', import.meta.url), 'utf8');
const pbxDiagnostic = fs.readFileSync(new URL('../src/features/call/transcription/pbx-diagnostic.js', import.meta.url), 'utf8');
const callListDebug = fs.readFileSync(new URL('../src/features/call/transcription/call-list-debug.js', import.meta.url), 'utf8');
const assistant = fs.readFileSync(new URL('../src/ui/call-transcription-assistant.js', import.meta.url), 'utf8');
const pbxDiagnosticUi = fs.readFileSync(new URL('../src/ui/call-pbx-diagnostic.js', import.meta.url), 'utf8');
const attention = fs.readFileSync(new URL('../src/ui/call-attention-bridge.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.equal(manifest.background.service_worker, 'src/background-entry.js');
assert.ok(manifest.host_permissions.includes('https://pbx.simnet.kiev.ua/*'));
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-transcription-assistant.js'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-pbx-diagnostic.js'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-attention-bridge.js'));
assert.ok(!manifest.content_scripts[0].js.includes('src/ui/call-transcription-jobs.js'));

assert.ok(entry.includes("import './background.js';"));
assert.ok(entry.includes("import './features/call/transcription/background.js';"));
assert.ok(entry.includes("import './features/call/transcription/call-processing.js';"));
assert.ok(!entry.includes("transcription/jobs.js"));

assert.ok(messages.includes('CALL_TRANSCRIBER_HEALTH'));
assert.ok(messages.includes('CALL_TRANSCRIBE_RECORD'));
assert.ok(messages.includes('CALL_TRANSCRIPT_GET'));
assert.ok(messages.includes('CALL_PROCESSING_LIST'));
assert.ok(messages.includes('CALL_PROCESSING_RETRY'));
assert.ok(messages.includes('CALL_PROCESSING_CANCEL'));
assert.ok(messages.includes('CALL_PROCESSING_CHANGED'));
assert.ok(!messages.includes('CALL_TRANSCRIPTION_JOB_LIST'));

assert.ok(background.includes("const PBX_ORIGIN = 'https://pbx.simnet.kiev.ua';"));
assert.ok(background.includes("const PBX_RECORD_PATH = '/fop2/getrec.php';"));
assert.ok(background.includes("'127.0.0.1'"));
assert.ok(background.includes("'localhost'"));
assert.ok(background.includes("kind: 'CALL_TRANSCRIPT'"));
assert.ok(background.includes('audioSha256'));
assert.ok(background.includes("progress(onProgress, 'AUDIO_FETCHING'"));
assert.ok(background.includes("progress(onProgress, 'TRANSCRIBING'"));
assert.ok(background.includes("progress(onProgress, 'TRANSCRIPT_READY'"));
assert.doesNotMatch(background, /save_call|USERSIDE_API_URL|Cookie:/i);

assert.match(callRecord, /class CallRecord/);
assert.match(callRecord, /startStage\(/);
assert.match(callRecord, /completeStage\(/);
assert.match(callRecord, /dismissAttention\(/);
assert.match(callRecord, /setTranscript\(/);
assert.match(callRecord, /setAi\(/);
assert.match(callStore, /WORKBENCH_STATE_KEY = 'simnet_workbench_state_v5'/);

assert.ok(processing.includes('AUTO_LOCK_WINDOW_MS'));
assert.ok(processing.includes('isFreshRegisteredBinding(binding, atMs)'));
assert.ok(processing.includes('CallStateStore.mutate'));
assert.ok(processing.includes('callExecutionRegistry'));
assert.ok(processing.includes('migrateLegacyJobs'));
assert.ok(processing.includes('recoverInterruptedCalls'));
assert.ok(processing.includes('chrome.storage.local.remove(LEGACY_JOB_STORE_KEY)'));
assert.doesNotMatch(processing, /const JOB_STORE_KEY\s*=/);
assert.doesNotMatch(processing, /save_call|Cookie:/i);

assert.match(executionRegistry, /this\.queue = \[\]/);
assert.match(executionRegistry, /this\.active = null/);
assert.match(executionRegistry, /state: 'queued'/);
assert.match(executionRegistry, /_drain\(\)/);
assert.match(executionRegistry, /if \(this\.active\) return/);

assert.ok(pbxDiagnostic.includes("const PBX_RECORD_PATH = '/fop2/getrec.php';"));
assert.ok(pbxDiagnostic.includes("Range: 'bytes=0-65535'"));
assert.ok(pbxDiagnostic.includes("credentials: 'include'"));
assert.doesNotMatch(pbxDiagnostic, /\/transcribe|save_call|USERSIDE_API_URL/i);

assert.ok(callListDebug.includes("const CALL_LIST_PATH = '/message/call_list';"));
assert.ok(callListDebug.includes("credentials: 'include'"));
assert.ok(callListDebug.includes('CALL_LIST_DEBUG'));
assert.doesNotMatch(callListDebug, /\/transcribe|save_call|Cookie:/i);

assert.ok(assistant.includes('selectedPbxCall'));
assert.ok(assistant.includes("PBX_RECENT_CALLS_QUERY"));
assert.ok(assistant.includes('CALL_TRANSCRIBE_RECORD'));
assert.ok(assistant.includes('textarea[name="comment"]'));
assert.ok(!assistant.includes('requestSubmit('));
assert.ok(!assistant.includes('.submit('));

assert.ok(pbxDiagnosticUi.includes('CALL_PBX_RECORD_PROBE'));
assert.ok(pbxDiagnosticUi.includes('PBX_RECENT_CALLS_QUERY'));
assert.ok(!pbxDiagnosticUi.includes('CALL_TRANSCRIBE_RECORD'));

assert.ok(attention.includes('CALL_PROCESSING_LIST'));
assert.ok(attention.includes('CALL_PROCESSING_RETRY'));
assert.ok(attention.includes('CALL_PROCESSING_CHANGED'));
assert.ok(attention.includes('CALL закреплён'));
assert.ok(attention.includes('Транскрибация'));
assert.ok(attention.includes('UserSide'));
assert.ok(attention.includes('WORK_STATUSES'));
assert.ok(attention.includes('sortQueue'));
assert.ok(attention.includes('historyCalls'));

console.log('call transcription orchestration contract: ok');
