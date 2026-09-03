import assert from 'node:assert/strict';
import fs from 'node:fs';
import { callTimeBounds, scoreCallAgainstTimeline } from '../src/features/call/visit-timeline.js';

const start = Date.parse('2026-08-28T13:00:00');
const call = {
  startedAtMs: start,
  timeSemantics: 'start',
  durationSeconds: 600,
  source: 'userside:call_list',
  customerId: '222'
};
const visits = [
  // Before the call: must not become a candidate when preWindowMs=0.
  { ts: start - 20_000, source: 'billing', subscriberId: '999', contractId: '999999', pageType: 'billing_user' },
  // Two subscribers actually touched inside the focused call window.
  { ts: start + 30_000, source: 'billing', subscriberId: '111', contractId: '111111', pageType: 'billing_user' },
  { ts: start + 45_000, source: 'userside', subscriberId: '222', contractId: '222222', pageType: 'userside_customer' },
  { ts: start + 90_000, source: 'billing', subscriberId: '333', contractId: '333333', pageType: 'billing_user' },
  { ts: start + 110_000, source: 'userside', subscriberId: '222', contractId: '222222', pageType: 'userside_customer' },
  // After the call and grace: must not appear.
  { ts: start + 650_000, source: 'billing', subscriberId: '444', contractId: '444444', pageType: 'billing_user' }
];
const scored = scoreCallAgainstTimeline(call, visits, { searches: [], preWindowMs: 0, postWindowMs: 15_000 });
assert.ok(scored.candidates.length >= 2);
assert.equal(scored.candidates.some(c => c.subscriberId === '999999'), false);
assert.equal(scored.candidates.some(c => c.subscriberId === '444444'), false);
const customerCandidate = scored.candidates.find(c => c.aliases?.includes('222'));
assert.ok(customerCandidate, 'unique call_list customer that was visited must remain a candidate');
assert.ok(customerCandidate.reasons.includes('customer-match'));
assert.equal(scored.candidates[0].subscriberId, customerCandidate.subscriberId, 'direct customer evidence should strengthen the interacted subscriber');

const live = {
  startedAtMs: start,
  timeSemantics: 'start',
  durationSeconds: 0,
  ongoing: true,
  liveUntilMs: start + 5 * 60_000,
  observedAt: new Date(start + 5 * 60_000).toISOString()
};
const liveBounds = callTimeBounds(live);
assert.equal(liveBounds.callStartMs, start);
assert.equal(liveBounds.callEndMs, start + 5 * 60_000);

const bg = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const callSource = fs.readFileSync(new URL('../src/features/call/source/userside-call-list.js', import.meta.url), 'utf8');
assert.match(callModule, /focusCandidates/);
assert.match(callModule, /currentCaseCandidate/);
assert.match(callSource, /completedOnly:\s*false/);
assert.match(callModule, /focusCall:/);
assert.match(callModule, /dayCalls/);
assert.doesNotMatch(callModule, /relative-to-best/);
assert.match(ui, /Звонок в фокусе/);
assert.match(ui, /call-live-chip/);
assert.match(ui, /Абонент не установлен|Нужен subscriber evidence/);
assert.match(ui, /focus-history-call/);
assert.doesNotMatch(ui, /data-action="pick-call"/);

console.log('call_focus_subscriber_candidates_test: PASS');
