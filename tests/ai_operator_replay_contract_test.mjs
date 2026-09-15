import assert from 'node:assert/strict';
import fs from 'node:fs';

const replayBackground = fs.readFileSync(new URL('../src/features/ai-operator/replay-background.js', import.meta.url), 'utf8');
const replayCases = fs.readFileSync(new URL('../src/features/ai-operator/replay-cases.js', import.meta.url), 'utf8');
const replayUi = fs.readFileSync(new URL('../src/ui/ai-operator-replay.js', import.meta.url), 'utf8');
const settingsHtml = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

assert.match(replayCases, /extractReplayCases/, 'replay case extractor must be present');
assert.match(replayCases, /skippedAutomation/, 'automation-only responses must be tracked and excluded by default');
assert.match(replayCases, /normalizeHelpCrunchTranscript/, 'replay must reuse the production HelpCrunch normalizer');

assert.match(replayBackground, /AI_OPERATOR_REPLAY_EVALUATE/, 'replay runtime must expose evaluation');
assert.match(replayBackground, /AI_OPERATOR_REPLAY_RECORD/, 'replay runtime must persist verdicts');
assert.match(replayBackground, /simnet_ai_operator_replay_results_v1/, 'replay results need a dedicated local store');
assert.match(replayBackground, /planAutonomousTurn/, 'replay must execute the same planner as the live operator');
assert.doesNotMatch(replayBackground, /executeOperatorTool/, 'historical replay must not execute current subscriber READ tools');
assert.doesNotMatch(replayBackground, /method:\s*['"]POST['"]/, 'replay runtime must not perform outbound writes');

assert.match(settingsHtml, /Replay реальных обращений/, 'settings must expose stage 2 replay lab');
assert.match(settingsHtml, /id="aiReplayFile"/, 'replay lab must accept a HelpCrunch JSON export');
assert.match(settingsHtml, /PASS/, 'replay lab must expose PASS verdict');
assert.match(settingsHtml, /GAP · сохранить правило/, 'replay lab must expose rule-gap verdict');
assert.match(settingsHtml, /tool_required/, 'UI must explain that historical CRM facts are not fabricated');
assert.match(settingsHtml, /type="module" src="ai-operator-replay\.js"/, 'replay UI must load as a module');

assert.match(replayUi, /extractReplayCases/, 'replay UI must use the shared extractor');
assert.match(replayUi, /AI_OPERATOR_REPLAY_EVALUATE/, 'replay UI must call the replay planner runtime');
assert.match(replayUi, /AI_OPERATOR_REPLAY_RECORD/, 'replay UI must persist verdicts');
assert.match(replayUi, /AI_OPERATOR_FEEDBACK_ADD/, 'GAP notes must feed the existing correction-learning channel');
assert.match(replayUi, /verdict === 'gap'/, 'only a gap should create a learned correction note');

assert.match(entry, /features\/ai-operator\/replay-background\.js/, 'service worker must load replay runtime');

console.log('ai_operator_replay_contract_test: PASS');
