import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const assistant = fs.readFileSync(new URL('../src/ui/call-transcription-assistant.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.equal(manifest.background.service_worker, 'src/background-entry.js');
assert.ok(manifest.host_permissions.includes('https://pbx.simnet.kiev.ua/*'));
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
assert.ok(manifest.content_scripts[0].js.includes('src/ui/call-transcription-assistant.js'));

assert.match(entry, /import '\.\/background\.js'/);
assert.match(entry, /transcription\/background\.js/);

assert.match(messages, /CALL_TRANSCRIBER_HEALTH/);
assert.match(messages, /CALL_TRANSCRIBE_RECORD/);
assert.match(messages, /CALL_TRANSCRIPT_GET/);

assert.match(background, /PBX_ORIGIN = 'https:\/\/pbx\.simnet\.kiev\.ua'/);
assert.match(background, /PBX_RECORD_PATH = '\/fop2\/getrec\.php'/);
assert.match(background, /127\.0\.0\.1/);
assert.match(background, /localhost/);
assert.match(background, /CALL_TRANSCRIPT/);
assert.match(background, /audioSha256/);
assert.match(background, /analysis: null/);
assert.doesNotMatch(background, /save_call|USERSIDE_API_URL|Cookie:/i);

assert.match(assistant, /selectedPbxCall/);
assert.match(assistant, /CALL_TRANSCRIBE_RECORD/);
assert.match(assistant, /textarea\[name="comment"\]/);
assert.match(assistant, /Проверь комментарий и регистрируй штатной кнопкой UserSide/);
assert.doesNotMatch(assistant, /requestSubmit\(|\.submit\(\)/);

console.log('call transcription orchestration contract: ok');
