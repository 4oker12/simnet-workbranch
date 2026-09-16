import assert from 'node:assert/strict';
import fs from 'node:fs';

const replayBackground = fs.readFileSync(new URL('../src/features/ai-operator/replay-background.js', import.meta.url), 'utf8');
const replayCases = fs.readFileSync(new URL('../src/features/ai-operator/replay-cases.js', import.meta.url), 'utf8');
const replayUi = fs.readFileSync(new URL('../src/ui/ai-operator-replay.js', import.meta.url), 'utf8');
const settingsHtml = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');

assert.match(replayCases, /extractReplayCases/, 'replay case extractor must be present');
assert.match(replayCases, /selectReplayBatchCases/, 'bounded batch selection must be shared and testable');
assert.match(replayCases, /skippedAutomation/, 'automation-only responses must be tracked and excluded by default');
assert.match(replayCases, /normalizeHelpCrunchTranscript/, 'replay must reuse the production HelpCrunch normalizer');
assert.match(replayCases, /chatTurnIndex/, 'replay cases must retain chronological position inside a chat');

assert.match(replayBackground, /AI_OPERATOR_REPLAY_EVALUATE/, 'replay runtime must expose evaluation');
assert.match(replayBackground, /AI_OPERATOR_REPLAY_RECORD/, 'replay runtime must persist verdicts');
assert.match(replayBackground, /simnet_ai_operator_replay_results_v1/, 'replay results need a dedicated local store');
assert.match(replayBackground, /planAutonomousTurn/, 'replay must execute the same interpreter as the live operator');
assert.match(replayBackground, /payload\?\.state/, 'batch replay must be able to carry AI state across turns of one chat');
assert.match(replayBackground, /verdict.*unreviewed/s, 'batch evaluations must be persistable before manual review');
assert.match(replayBackground, /filter\(existing => existing\?\.caseId !== item\.caseId\)/, 'manual verdict must replace the unreviewed result for the same case');
assert.doesNotMatch(replayBackground, /executeOperatorTool/, 'historical replay must not execute current subscriber READ tools');
assert.doesNotMatch(replayBackground, /method:\s*['"]POST['"]/, 'replay runtime must not perform outbound writes');

assert.match(settingsHtml, /Replay реальных обращений/, 'settings must expose stage 2 replay lab');
assert.match(settingsHtml, /id="aiReplayFile"/, 'replay lab must accept a HelpCrunch JSON export');
assert.match(settingsHtml, /PASS/, 'replay lab must expose PASS verdict');
assert.match(settingsHtml, /GAP · сохранить правило/, 'replay lab must expose rule-gap verdict');
assert.match(settingsHtml, /tool_required/, 'UI must explain that historical CRM facts are not fabricated');
assert.match(settingsHtml, /type="module" src="ai-operator-replay\.js"/, 'replay UI must load as a module');

assert.match(replayUi, /selectReplayBatchCases/, 'replay UI must build a bounded chat batch');
assert.match(replayUi, /aiReplayStartCase/, 'batch replay must allow starting from an arbitrary replay case number');
assert.match(replayUi, /cases\.slice\(startIndex\)/, 'batch selection must begin from the requested replay case');
assert.match(replayUi, /simnet_ai_replay_resume_v1/, 'batch replay must persist a resume checkpoint');
assert.match(replayUi, /saveResumeCheckpoint/, 'successful turns must advance the resume checkpoint');
assert.match(replayUi, /aiReplayMaxChats/, 'batch replay must expose a chat limit');
assert.match(replayUi, /aiReplayMaxTurns/, 'batch replay must expose a turn limit');
assert.match(replayUi, /aiReplayTokenBudget/, 'batch replay must expose a total token budget');
assert.match(replayUi, /aiReplayDelayMs/, 'batch replay must pace requests');
assert.match(replayUi, /aiReplayStart/, 'batch replay must have a start control');
assert.match(replayUi, /aiReplayStop/, 'batch replay must have a stop control');
assert.match(replayUi, /tokensUsed >= settings\.tokenBudget/, 'batch replay must stop at its token budget');
assert.match(replayUi, /diagnosticStatus === 429/, 'batch replay must detect Groq rate limits');
assert.match(replayUi, /waitForRateLimit/, 'batch replay must wait through the rate-limit cooldown');
assert.match(replayUi, /продолжу автоматически/, 'rate-limit UI must explain automatic continuation');
assert.match(replayUi, /MAX_RATE_LIMIT_RETRIES/, 'rate-limit retries must be bounded');
assert.match(replayUi, /replayCase\.chatId !== activeChatId/, 'AI state must reset between chats');
assert.match(replayUi, /state: chatState/, 'AI state must be carried to the next turn of the same chat');
assert.match(replayUi, /AI_OPERATOR_REPLAY_EVALUATE/, 'replay UI must call the replay planner runtime');
assert.match(replayUi, /AI_OPERATOR_REPLAY_RECORD/, 'replay UI must persist verdicts');
assert.match(replayUi, /AI_OPERATOR_FEEDBACK_ADD/, 'GAP notes must feed the existing correction-learning channel');
assert.match(replayUi, /verdict === 'gap'/, 'only a gap should create a learned correction note');

assert.match(entry, /features\/ai-operator\/replay-background\.js/, 'service worker must load replay runtime');

console.log('ai_operator_replay_contract_test: PASS');
