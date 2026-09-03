import assert from 'node:assert/strict';
import fs from 'node:fs';

const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');

assert.match(callModule, /const eventScoreDeltas = \{\}/);
assert.match(callModule, /scoreSnapshotCandidates\(syntheticCall, prefix, scoreOptions\)/);
assert.match(callModule, /eventScoreDeltas: cloneJson\(eventScoreDeltas\)/);
assert.match(ui, /liveEventScoreDelta\(event = \{\}, events = \[\], eventScoreDeltas = \{\}\)/);
assert.match(ui, /Изменение raw score этим действием/);
assert.match(ui, /deltaText = delta > 0 \? `\+\$\{delta\}` : String\(delta \|\| 0\)/);
console.log('call_live_score_delta_contract_test: PASS');
