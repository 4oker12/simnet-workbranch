import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  analyzeCallSearchForCase,
  scoreCallAgainstTimeline
} from '../src/features/call/visit-timeline.js';

const start = Date.parse('2026-08-28T10:00:00');
const call = {
  startedAtMs: start,
  timeSemantics: 'start',
  durationSeconds: 180,
  source: 'userside:call_list'
};
const identity = { customerId: '14087', billingId: '36328', contractId: '110418' };

// Address may be corrected multiple times. Only the completed SUBMIT -> INFO -> CARD
// chain should identify the current subscriber, while prior attempts remain attempts.
const addressSearches = [
  { ts: start + 10_000, source: 'billing', kind: 'submit', searchKind: 'address', query: 'dopfield_5=вул. Метрологічна; dopfield_6=107; dopfield_11=а; dopfield_8=46', searchId: 's1', tabId: 7 },
  { ts: start + 35_000, source: 'billing', kind: 'submit', searchKind: 'address', query: 'dopfield_5=вул. Метрологічна; dopfield_6=107; dopfield_11=а; dopfield_8=43', searchId: 's2', tabId: 7 },
  { ts: start + 60_000, source: 'billing', kind: 'submit', searchKind: 'address', query: 'dopfield_5=вул. Метрологічна; dopfield_6=107; dopfield_11=а; dopfield_8=42', searchId: 's3', tabId: 7 },
  { ts: start + 64_000, source: 'billing', kind: 'result-open', searchKind: 'address', query: 'dopfield_5=вул. Метрологічна; dopfield_6=107; dopfield_11=а; dopfield_8=42', targetSubscriberId: '36328', searchId: 's3', parentSearchTs: start + 60_000, tabId: 7 }
];
const visits = [
  { ts: start + 65_000, source: 'billing', subscriberId: '36328', contractId: '110418', pageType: 'billing_user' }
];
let audit = analyzeCallSearchForCase(call, visits, addressSearches, identity);
assert.equal(audit.status, 'confirmed');
assert.equal(audit.confirmed, true);
assert.equal(audit.searchKind, 'address');
assert.equal(audit.attempts, 3);
assert.equal(audit.targetSubscriberId, '36328');
assert.match(audit.query, /dopfield_8=42/);

let scored = scoreCallAgainstTimeline(call, visits, { searches: addressSearches });
assert.ok(scored.reasons.includes('search-result-opened'));
assert.equal(scored.searchEvidence?.targetSubscriberId, '36328');
assert.equal(scored.searchEvidence?.searchKind, 'address');

// Contract search uses the same causal chain.
const contractSearches = [
  { ts: start + 20_000, source: 'billing', kind: 'submit', searchKind: 'contract', query: 'name=abon110418', searchId: 'c1', tabId: 8 },
  { ts: start + 23_000, source: 'billing', kind: 'result-open', searchKind: 'contract', query: 'name=abon110418', targetSubscriberId: '36328', searchId: 'c1', parentSearchTs: start + 20_000, tabId: 8 }
];
audit = analyzeCallSearchForCase(call, [
  { ts: start + 24_000, source: 'billing', subscriberId: '36328', contractId: '110418', pageType: 'billing_user' }
], contractSearches, identity);
assert.equal(audit.status, 'confirmed');
assert.equal(audit.searchKind, 'contract');
assert.equal(audit.attempts, 1);

// UserSide may resolve one exact autocomplete customer before the operator opens
// the customer card. Keep it as soft canonical evidence, not as a confirmed card visit.
const uniqueResolved = [
  { ts: start + 30_000, source: 'userside', kind: 'submit', searchKind: 'global', query: '167173', searchId: 'u1', tabId: 11 },
  { ts: start + 30_050, source: 'userside', kind: 'resolved', searchKind: 'global', query: '167173', targetSubscriberId: '21009', searchId: 'u1', parentSearchTs: start + 30_000, tabId: 11, resolution: 'unique-autocomplete', resultCount: 1 }
];
audit = analyzeCallSearchForCase(call, [], uniqueResolved, { customerId: '21009', billingId: '', contractId: '167173' });
assert.equal(audit.status, 'resolved');
assert.equal(audit.confirmed, false);
assert.equal(audit.resultResolved, true);
assert.equal(audit.targetSubscriberId, '21009');
scored = scoreCallAgainstTimeline(call, [], { searches: uniqueResolved });
assert.equal(scored.bestSubscriberId, '21009');
assert.ok(scored.reasons.includes('search-unique-resolved'));
assert.ok(scored.score >= 50 && scored.score < 90, 'unique autocomplete should be supporting, not hard-confirmed by itself');

// A submit from another system must never boost a visit merely because it happened
// shortly before it. Causal fallback is same-source only.
const crossSource = [
  { ts: start + 40_000, source: 'userside', kind: 'submit', searchKind: 'global', query: 'other', searchId: 'x1', tabId: 12 }
];
scored = scoreCallAgainstTimeline(call, [
  { ts: start + 45_000, source: 'billing', subscriberId: '36328', contractId: '110418', pageType: 'billing_user' }
], { searches: crossSource });
assert.ok(!scored.reasons.includes('search-then-open'), 'cross-source submit must not create search→open evidence');

// A search performed before call start must never become evidence for this call,
// even if INFO/card opening happens during the call.
const staleSearches = [
  { ts: start - 5_000, source: 'billing', kind: 'submit', searchKind: 'contract', query: 'name=abon110418', searchId: 'old', tabId: 9 },
  { ts: start + 2_000, source: 'billing', kind: 'result-open', searchKind: 'contract', query: 'name=abon110418', targetSubscriberId: '36328', searchId: 'old', parentSearchTs: start - 5_000, tabId: 9 }
];
audit = analyzeCallSearchForCase(call, [
  { ts: start + 3_000, source: 'billing', subscriberId: '36328', contractId: '110418', pageType: 'billing_user' }
], staleSearches, identity);
assert.equal(audit.status, 'none');

// INFO may complete just after hangup, but only if its SUBMIT was made during the call.
const afterHangup = [
  { ts: start + 175_000, source: 'billing', kind: 'submit', searchKind: 'address', query: 'dopfield_5=street; dopfield_6=1; dopfield_8=2', searchId: 'late', tabId: 10 },
  { ts: start + 187_000, source: 'billing', kind: 'result-open', searchKind: 'address', query: 'dopfield_5=street; dopfield_6=1; dopfield_8=2', targetSubscriberId: '36328', searchId: 'late', parentSearchTs: start + 175_000, tabId: 10 }
];
audit = analyzeCallSearchForCase(call, [
  { ts: start + 188_000, source: 'billing', subscriberId: '36328', contractId: '110418', pageType: 'billing_user' }
], afterHangup, identity);
assert.equal(audit.status, 'confirmed');

const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
assert.match(bootstrap, /billingSearchSnapshot/);
assert.match(bootstrap, /searchKind: snapshot\?\.searchKind/);
assert.match(bootstrap, /targetSubscriberId: billingId/);
assert.match(bootstrap, /uniqueUsersideAutocompleteResult/);
assert.match(bootstrap, /kind: 'resolved'/);
assert.match(background, /parentSearchTs/);
assert.match(background, /currentCaseSearch: clone\(currentCaseSearch\)/);
assert.match(ui, /Поиск этого абонента во время звонка: ДА/);
assert.match(ui, /search-audit-tip/);

console.log('call_search_session_correlation_test: PASS');
