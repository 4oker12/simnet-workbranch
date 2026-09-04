import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const pbxDiagnostic = fs.readFileSync(new URL('../src/features/call/transcription/pbx-diagnostic.js', import.meta.url), 'utf8');
const callListDebug = fs.readFileSync(new URL('../src/features/call/transcription/call-list-debug.js', import.meta.url), 'utf8');
const assistant = fs.readFileSync(new URL('../src/ui/call-transcription-assistant.js', import.meta.url), 'utf8');
const pbxDiagnosticUi = fs.readFileSync(new URL('../src/ui/call-pbx-diagnostic.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.equal(manifest.background.service_worker, 'src/background-entry.js');
assert.ok(manifest.host_permissions.includes('https://pbx.simnet.kiev.ua/*'));
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-transcription-assistant.js'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-pbx-diagnostic.js'));

assert.ok(entry.includes("import './background.js';"));
assert.ok(entry.includes("import './features/call/transcription/background.js';"));
assert.ok(entry.includes("import './features/call/transcription/pbx-diagnostic.js';"));
assert.ok(entry.includes("import './features/call/transcription/call-list-debug.js';"));

assert.ok(messages.includes('CALL_TRANSCRIBER_HEALTH'));
assert.ok(messages.includes('CALL_TRANSCRIBE_RECORD'));
assert.ok(messages.includes('CALL_TRANSCRIPT_GET'));
assert.ok(messages.includes('CALL_PBX_RECORD_PROBE'));
assert.ok(messages.includes('CALL_LIST_DEBUG'));

assert.ok(background.includes("const PBX_ORIGIN = 'https://pbx.simnet.kiev.ua';"));
assert.ok(background.includes("const PBX_RECORD_PATH = '/fop2/getrec.php';"));
assert.ok(background.includes("'127.0.0.1'"));
assert.ok(background.includes("'localhost'"));
assert.ok(background.includes("kind: 'CALL_TRANSCRIPT'"));
assert.ok(background.includes('audioSha256'));
assert.ok(background.includes('analysis: null'));
assert.doesNotMatch(background, /save_call|USERSIDE_API_URL|Cookie:/i);

assert.ok(pbxDiagnostic.includes("const PBX_RECORD_PATH = '/fop2/getrec.php';"));
assert.ok(pbxDiagnostic.includes("Range: 'bytes=0-65535'"));
assert.ok(pbxDiagnostic.includes("credentials: 'include'"));
assert.ok(pbxDiagnostic.includes("verdict: 'DIRECT_AUDIO'"));
assert.ok(pbxDiagnostic.includes("verdict: rangeAudio ? 'RANGE_AUDIO_ONLY' : 'NOT_AUDIO'"));
assert.doesNotMatch(pbxDiagnostic, /\/transcribe|save_call|USERSIDE_API_URL/i);

assert.ok(callListDebug.includes("const CALL_LIST_PATH = '/message/call_list';"));
assert.ok(callListDebug.includes("credentials: 'include'"));
assert.ok(callListDebug.includes('CALL_LIST_DEBUG'));
assert.ok(callListDebug.includes('targetRows'));
assert.ok(callListDebug.includes('latestRaw'));
assert.doesNotMatch(callListDebug, /\/transcribe|save_call|Cookie:/i);

assert.ok(assistant.includes('selectedPbxCall'));
assert.ok(assistant.includes("PBX_RECENT_CALLS_QUERY"));
assert.ok(assistant.includes('fresh: true'));
assert.ok(assistant.includes('forceRefresh: true'));
assert.ok(assistant.includes('CALL_TRANSCRIBE_RECORD'));
assert.ok(assistant.includes('textarea[name="comment"]'));
assert.ok(assistant.includes('Проверь комментарий и регистрируй штатной кнопкой UserSide'));
assert.ok(!assistant.includes('requestSubmit('));
assert.ok(!assistant.includes('.submit('));

assert.ok(pbxDiagnosticUi.includes('CALL_PBX_RECORD_PROBE'));
assert.ok(pbxDiagnosticUi.includes('PBX_RECENT_CALLS_QUERY'));
assert.ok(pbxDiagnosticUi.includes('CALL_LIST_DEBUG'));
assert.ok(pbxDiagnosticUi.includes('fresh: true'));
assert.ok(pbxDiagnosticUi.includes('forceRefresh: true'));
assert.ok(pbxDiagnosticUi.includes('Проверить PBX'));
assert.ok(pbxDiagnosticUi.includes('CALL RESOLVE'));
assert.ok(!pbxDiagnosticUi.includes('window.prompt('));
assert.ok(!pbxDiagnosticUi.includes('CALL_TRANSCRIBE_RECORD'));
assert.ok(!pbxDiagnosticUi.includes('requestSubmit('));
assert.ok(!pbxDiagnosticUi.includes('.submit('));

console.log('call transcription orchestration contract: ok');
