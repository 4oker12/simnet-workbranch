import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createCallModule } from '../src/features/call/index.js';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const scorer = fs.readFileSync(new URL('../src/features/call/correlation/scorer.js', import.meta.url), 'utf8');

assert.doesNotMatch(ui, /replay\.candidates\)\s*\?\s*replay\.candidates\.slice\(0,\s*3\)/, 'LIVE must not hide candidates after top-3');
assert.match(ui, /\.score\{[^}]*max-height:[^}]*overflow:auto/, 'all LIVE candidates remain accessible in a bounded scroll area');
assert.doesNotMatch(scorer, /\.slice\(0,\s*12\)\s*;/, 'scorer must not silently drop low-score observed candidates');

let now = 2_030_000_000_000;
const mod = createCallModule({ nowMs: () => now, nowIso: () => new Date(now).toISOString() });
const start = now;
const state = { cases: {} };
mod.ensure(state);

// More than the old UI/scorer limits. Every direct UserSide customer opening is
// weak evidence, but it must still be independently visible/auditable.
for (let i = 0; i < 14; i += 1) {
  const customerId = String(50000 + i);
  now = start + 1_000 + i * 1_000;
  mod.recordVisit(state, {
    pageKind: 'userside_customer',
    entityId: customerId,
    identity: { customerId, fullName: `US Candidate ${i + 1}` },
    meta: { pageInstanceId: `us-${customerId}`, pageInstanceStartedAt: now - 100 }
  }, { tab: { id: 100 + i, windowId: 1 } }, { accepted: true, caseId: '' });
}

now = start + 30_000;
const replay = mod.previewRange(state, { caseId: '', startAtMs: start, endAtMs: start + 20_000 });
assert.equal(replay.candidates.length, 14, 'every visited UserSide subscriber must become a candidate');
for (let i = 0; i < 14; i += 1) {
  const customerId = String(50000 + i);
  const candidate = replay.candidates.find(item => item.customerId === customerId);
  assert.ok(candidate, `UserSide /customer/${customerId} must be present`);
  assert.ok(candidate.rawScore > 0 && candidate.rawScore < 50, 'direct opening stays weak, not identification-grade');
}

console.log('PASS call_all_userside_candidates_live_test');
