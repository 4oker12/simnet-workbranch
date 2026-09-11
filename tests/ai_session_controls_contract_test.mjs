import fs from 'node:fs';
import assert from 'node:assert/strict';

const controls = fs.readFileSync(new URL('../src/ui/operator-companion-session-controls.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/infrastructure/feature-loader.js', import.meta.url), 'utf8');

assert.doesNotThrow(() => new Function(controls),
  'session controls source must remain valid browser JavaScript');

assert.match(loader, /operator-companion-session-controls\.js/,
  'companion feature pack must inject the session controls after the chat UI');

assert.match(controls, /Начать сессию/,
  'AI chat must expose an explicit start-session action');
assert.match(controls, /Завершить сессию/,
  'AI chat must expose an explicit end-session action');
assert.match(controls, /Выгрузить сессию/,
  'AI chat must expose an explicit export-session action');

assert.match(controls, /simnet_workbench_ai_session_control_v1/,
  'session lifecycle state must persist independently from the rendered chat DOM');
assert.match(controls, /AI_CHAT_STATE_GET/,
  'export must read the canonical background AI session instead of scraping bubbles');
assert.match(controls, /operatorCompanion\?\.reset/,
  'starting a new session must reuse the canonical AI reset path');
assert.match(controls, /status:\s*'ended'/,
  'ending a session must persist an ended lifecycle state');
assert.match(controls, /input\.disabled\s*=\s*true/,
  'ended sessions must block further messages until a new session starts');
assert.match(controls, /simnet-ai-dialog-export-v1/,
  'exported JSON must carry an explicit stable schema');

assert.doesNotMatch(controls, /simnet_workbench_ai_runtime_v1/,
  'session export/control code must never read the AI runtime secret store');

console.log('AI session controls contract passed');
