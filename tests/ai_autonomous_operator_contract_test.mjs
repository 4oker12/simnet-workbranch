import assert from 'node:assert/strict';
import fs from 'node:fs';
import { latestCustomerTurn, normalizeHelpCrunchTranscript } from '../src/features/ai-operator/message-normalizer.js';

const messages = [
  { id: 5, from: 'agent', type: 'tech', text: 'chat_status_changed', createdAt: '5' },
  { id: 4, from: 'agent', type: 'message', text: 'Вітаю!', createdAt: '4' },
  { id: 3, from: 'customer', type: 'message', text: 'Який баланс?', createdAt: '3' },
  { id: 2, from: 'customer', type: 'dataCollectionReply', text: null, parameters: { value: '394895' }, createdAt: '2' },
  { id: 1, from: 'agent', type: 'private', text: 'internal note', createdAt: '1' }
];

const transcript = normalizeHelpCrunchTranscript(messages, 20);
assert.deepEqual(transcript.map(item => item.id), [2, 3, 4], 'tech/private messages must not enter conversational transcript');
assert.equal(transcript[0].text, '394895', 'workflow dataCollectionReply must remain meaningful customer evidence');
assert.equal(latestCustomerTurn(messages)?.id, 3, 'latest customer semantic turn must be detected independently of tech events');

const background = fs.readFileSync(new URL('../src/features/ai-operator/background.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/features/ai-operator/helpcrunch-client.js', import.meta.url), 'utf8');
const planner = fs.readFileSync(new URL('../src/features/ai-operator/groq-planner.js', import.meta.url), 'utf8');
const settingsHtml = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const settingsJs = fs.readFileSync(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(background, /shadowMode:\s*true/, 'first autonomous runtime must be locked to shadow mode');
assert.match(background, /blocked_shadow_mode/, 'outbound send must stay blocked until a captured send contract exists');
assert.match(background, /AI_OPERATOR_FEEDBACK_ADD/, 'runtime must accept explicit operator corrections');
assert.match(background, /learnFromCorrections/, 'runtime must support enabling/disabling correction learning');
assert.doesNotMatch(client, /method:\s*['"]POST['"]/, 'HelpCrunch client must be read-only in the first stage');
assert.match(client, /credentials:\s*['"]include['"]/, 'HelpCrunch read must reuse authenticated session safely');
assert.match(planner, /полностью автономный оператор/i, 'Groq prompt must address subscriber as an autonomous operator');
assert.match(planner, /action=tool_required/i, 'unknown internal facts must request a read tool rather than hallucinate');
assert.match(planner, /ПРИМЕРЫ РАНЕЕ ИСПРАВЛЕННОГО ПОВЕДЕНИЯ/, 'saved corrections must be included in the next AI decisions');
assert.match(planner, /ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОПЕРАТОРА/, 'operator custom behavior instructions must be part of the prompt');
assert.match(settingsHtml, /Автономный оператор · Test Lab/, 'settings must expose the autonomous operator test lab');
assert.match(settingsHtml, /aiOperatorCustomInstructions/, 'settings must expose editable behavior instructions');
assert.match(settingsJs, /Запомнить исправление/, 'settings must expose per-case correction action');
assert.match(entry, /features\/ai-operator\/background\.js/, 'service worker must load autonomous operator runtime');
assert.ok(manifest.permissions.includes('alarms'), 'poll scheduler permission must be present');
assert.ok(manifest.host_permissions.includes('https://stargroup.helpcrunch.com/*'), 'HelpCrunch host must be explicitly allowlisted');
const hcScript = manifest.content_scripts.find(item => item.matches?.includes('https://stargroup.helpcrunch.com/*'));
assert.ok(hcScript?.js?.includes('src/features/ai-operator/helpcrunch-page-bridge.js'), 'authenticated HelpCrunch page bridge must be installed');

console.log('ai_autonomous_operator_contract_test: PASS');
