import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
assert.match(src, /data-action="choose-real-mode"/);
assert.match(src, /data-action="choose-test-mode"/);
assert.match(src, /TEST ничего не регистрирует/);
assert.match(src, /this\.modeChoice = 'test'/);
assert.match(src, /this\.testMode = true/);
assert.match(src, /this\.renderTestMode\(\)/);
assert.match(src, /if \(this\.realReady && this\.model\) this\.renderForm\(\)/);
assert.match(src, /Текущая открытая карточка может быть отмечена в списке, но не получает баллы/);

const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
assert.match(callModule, /const rawCandidates = scoreSnapshotCandidates\(syntheticCall, events,/);
assert.match(callModule, /isCurrentCase: overlap\(identity, currentIdentity\)/);
assert.doesNotMatch(callModule, /rawScore\s*\+=\s*.*isCurrentCase/);
console.log('call_mode_picker_contract_test: PASS');
