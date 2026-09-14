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
const labBackground = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
const toolRuntime = fs.readFileSync(new URL('../src/features/ai-operator/tool-runtime.js', import.meta.url), 'utf8');
const billingSnapshot = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/features/ai-operator/helpcrunch-client.js', import.meta.url), 'utf8');
const planner = fs.readFileSync(new URL('../src/features/ai-operator/groq-planner.js', import.meta.url), 'utf8');
const supportCorpus = fs.readFileSync(new URL('../src/features/ai-operator/support-corpus-guidance.js', import.meta.url), 'utf8');
const settingsHtml = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const settingsJs = fs.readFileSync(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
const labJs = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
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
assert.match(planner, /customer\.confirm/, 'planner must explicitly confirm a located subscriber before account reads');
assert.match(planner, /customer\.snapshot/, 'planner must know the rich subscriber snapshot tool');
assert.match(planner, /confirmedCaseId пуст/i, 'manual lab prompt must enforce identity before account-specific reads');
assert.match(planner, /номер договора ИЛИ полный адрес/i, 'manual lab must ask for one useful subscriber identifier');
assert.match(planner, /balanceWithoutTemporary/, 'planner must understand temporary-payment-aware Billing balances');
assert.match(planner, /ПРИМЕРЫ РАНЕЕ ИСПРАВЛЕННОГО ПОВЕДЕНИЯ/, 'saved corrections must be included in the next AI decisions');
assert.match(planner, /ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ОПЕРАТОРА/, 'operator custom behavior instructions must be part of the prompt');

assert.match(supportCorpus, /accountBalance: это текущее значение поля Billing «На счету, грн»/i, 'support guidance must treat accountBalance as the current balance');
assert.match(supportCorpus, /balanceAfterTariff — НЕ текущий баланс/i, 'support guidance must keep projected post-tariff balance secondary');
assert.match(supportCorpus, /сначала прямо ответь тарифную скорость/i, 'support guidance must answer tariff speed before Wi-Fi diagnostics when evidence already contains it');
assert.doesNotMatch(supportCorpus, /GOOD: «Після поточного нарахування на рахунку 411 грн/i, 'support corpus must not teach projected balance as current balance');

assert.match(toolRuntime, /simnet_workbench_state_v5/, 'tool runtime must read the canonical Workbench case store');
assert.match(toolRuntime, /simnet_ai_operator_billing_snapshots_v1/, 'tool runtime must read captured Billing snapshots');
assert.match(toolRuntime, /customer\.lookup/, 'tool runtime must implement subscriber lookup');
assert.match(toolRuntime, /customer\.snapshot/, 'tool runtime must expose full confirmed subscriber context');
assert.match(toolRuntime, /billing\.balance/, 'tool runtime must expose real stored balance evidence');
assert.match(toolRuntime, /balanceWithoutTemporary/, 'balance tool must expose balance without temporary payment');
assert.match(toolRuntime, /temporaryPayment/, 'balance tool must expose temporary payment evidence');
assert.match(toolRuntime, /nextTariff/, 'tariff tool must expose scheduled tariff changes');
assert.match(toolRuntime, /billing\.payments/, 'tool runtime must expose captured recent payments');
assert.match(toolRuntime, /network\.session/, 'tool runtime must expose session evidence');
assert.match(toolRuntime, /pon\.signal/, 'tool runtime must expose PON evidence');
assert.match(toolRuntime, /IDENTITY_REQUIRED/, 'account tools must reject unconfirmed subscribers');
assert.match(toolRuntime, /DATA_NOT_AVAILABLE/, 'missing read adapters must fail explicitly instead of fabricating data');
assert.doesNotMatch(toolRuntime, /method:\s*['"]POST['"]/, 'manual operator tools must stay read-only');

assert.match(billingSnapshot, /dopfield_5/, 'Billing snapshot must read the exact street field from supplied Billing markup');
assert.match(billingSnapshot, /dopfield_29/, 'Billing snapshot must read the exact OLT field from supplied Billing markup');
assert.match(billingSnapshot, /next_paket/, 'Billing snapshot must read scheduled tariff changes');
assert.match(billingSnapshot, /balanceWithoutTemporary/, 'Billing snapshot must capture balance excluding temporary payments');
assert.match(billingSnapshot, /#my_x_16/, 'Billing snapshot must capture the last payment events already rendered by Billing');
assert.doesNotMatch(billingSnapshot, /method:\s*['"]POST['"]/, 'Billing snapshot capture must remain read-only');

assert.match(labBackground, /AI_OPERATOR_LAB_SEND/, 'lab runtime must accept manual subscriber messages');
assert.match(labBackground, /MAX_TOOL_TURNS\s*=\s*6/, 'agent tool loop must be bounded');
assert.match(labBackground, /executeOperatorTool/, 'lab must actually execute planned READ tools');
assert.match(labBackground, /REPEATED_TOOL_CALL/, 'lab must stop repeated tool loops');
assert.match(settingsHtml, /Автономный оператор · Test Lab/, 'settings must expose the autonomous operator test lab');
assert.match(settingsHtml, /Ручной диалог · ты = абонент/, 'settings must expose the manual subscriber chat');
assert.match(settingsHtml, /aiLabTranscript/, 'manual lab transcript must be rendered in settings');
assert.match(settingsHtml, /aiOperatorCustomInstructions/, 'settings must expose editable behavior instructions');
assert.match(settingsJs, /Запомнить исправление/, 'settings must expose per-case correction action');
assert.match(labJs, /AI_OPERATOR_LAB_SEND/, 'manual lab UI must call its runtime');
assert.match(labJs, /TOOL →/, 'manual lab UI must show tool calls visibly');
assert.match(entry, /features\/ai-operator\/background\.js/, 'service worker must load autonomous operator runtime');
assert.match(entry, /features\/ai-operator\/lab-background\.js/, 'service worker must load manual operator lab runtime');
assert.ok(manifest.permissions.includes('alarms'), 'poll scheduler permission must be present');
assert.ok(manifest.host_permissions.includes('https://stargroup.helpcrunch.com/*'), 'HelpCrunch host must be explicitly allowlisted');
const crmScript = manifest.content_scripts.find(item => item.matches?.includes('https://admin.simnet.kiev.ua/*'));
assert.ok(crmScript?.js?.includes('src/features/ai-operator/billing-snapshot-capture.js'), 'Billing rich snapshot reader must be loaded on Billing pages');
const hcScript = manifest.content_scripts.find(item => item.matches?.includes('https://stargroup.helpcrunch.com/*'));
assert.ok(hcScript?.js?.includes('src/features/ai-operator/helpcrunch-page-bridge.js'), 'authenticated HelpCrunch page bridge must be installed');

console.log('ai_autonomous_operator_contract_test: PASS');