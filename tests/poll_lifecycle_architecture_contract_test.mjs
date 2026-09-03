import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const billing = read('src/readers/billing.js');
const guards = read('src/core/interaction-guards.js');
const background = read('src/background.js');
const rail = read('src/ui/rail.js');
const diagnostic = read('src/workflows/diagnostic.js');

assert.match(billing, /pollRequestMatches\(pollMatch\)/, 'reader must correlate through the durable attempt');
assert.doesNotMatch(
  billing,
  /const requestObserved = Boolean\(\s*params\.get\('act'\) === 'askolt'/,
  'requestObserved must not depend on act=askolt surviving native Billing navigation'
);
assert.match(billing, /\? rawPollResponded && !wrongPollTab\s*\? 'observed'/, 'manual terminal page output must be representable without ActionSession');

assert.match(guards, /function pollResponseWatchRoot\(/);
assert.match(guards, /pollResponseObserver\.observe\(watchRoot,/);
assert.doesNotMatch(guards, /pollResponseObserver\.observe\(document\.body,/, 'active poll watcher must be scoped through the resolved poll surface root');
assert.match(guards, /The durable Case wins over a stale content-script\/session copy/);

assert.match(background, /reconcileCurrentPollAttemptWithFacts\(caseData\);\s*caseData\.diagnostic = computeDiagnosticDecision/, 'poll attempt must be normalized before recommendation recompute');
assert.match(background, /caseData\.diagnostic = computeDiagnosticDecision\(caseData\);\s*refreshProgress\(caseData\);/, 'attempt update must recompute diagnostic immediately');
assert.doesNotMatch(background, /responseUrl\?\.searchParams\.get\('act'\) === 'askolt'/, 'late terminal response must survive stripped act=askolt query');
assert.match(background, /source: trackedConfirmed \? 'correlated-poll' : 'billing-poll-page'/, 'manual terminal page evidence must have an explicit source');

assert.match(rail, /String\(currentCase\?\.diagnostic\?\.pollState \|\| ''\) === 'pending'/, 'LIVE pending must consume the workflow poll projection');
assert.match(rail, /Presentation never finishes a poll/, 'LIVE timer must not mutate lifecycle state');
assert.match(diagnostic, /conflictCount: ponWorkflow\.applicable\s*\? Number\(ponWorkflow\.conflicts/, 'current conflict count must not include historical fact changes');

console.log('poll_lifecycle_architecture_contract_test: PASS');
