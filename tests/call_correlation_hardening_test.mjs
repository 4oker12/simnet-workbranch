import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pbxCallMatch,
  pbxCallIdentitySignature
} from '../src/features/call/pbx-match.js';
import { scoreCallAgainstTimeline } from '../src/features/call/visit-timeline.js';

const fact = value => ({ value, source: 'test', confidence: 1 });
const caseData = {
  identity: {
    customerId: fact('14087'),
    login: fact('abon110418'),
    contract: fact('110418')
  },
  network: {},
  profile: {}
};

// Unique UserSide call_list CUSTOMER is hard identity evidence.
let match = pbxCallMatch({ customerId: '14087' }, caseData);
assert.equal(match.level, 'strong');
assert.ok(match.matchedBy.includes('customer'));
match = pbxCallMatch({ customerId: '99999' }, caseData);
assert.equal(match.level, 'conflict');
assert.ok(match.conflicts.includes('customer'));

// An operator override signature must become stale if UserSide later resolves
// the same call to a concrete/different customer.
const sigUnknown = pbxCallIdentitySignature({
  callKey: 'pbx:1787856966.210849',
  recordId: '1787856966.210849',
  callerId: '0631234578',
  date: '2026-08-27',
  time: '21:56',
  agentExtension: '6047'
});
const sigResolved = pbxCallIdentitySignature({
  callKey: 'pbx:1787856966.210849',
  recordId: '1787856966.210849',
  callerId: '0631234578',
  customerId: '14087',
  date: '2026-08-27',
  time: '21:56',
  agentExtension: '6047'
});
assert.notEqual(sigUnknown, sigResolved);

// UserSide DATEADD is START, so a card opened 98 s later during a 5:50 call
// must be inside the correlation interval, not after it.
const start = Date.parse('2026-08-27T21:56:00');
const timeline = [
  { ts: start + 98_000, source: 'billing', subscriberId: '11041', contractId: '110418', pageType: 'billing_user' },
  { ts: start + 115_000, source: 'userside', subscriberId: '14087', contractId: '110418', pageType: 'userside_customer' }
];
const searches = [
  { ts: start + 80_000, source: 'billing', kind: 'submit', query: 'address=Юлії Здановської 36/В; apart=98' }
];
const scored = scoreCallAgainstTimeline({
  startedAtMs: start,
  timeSemantics: 'start',
  durationSeconds: 350,
  source: 'userside:call_list'
}, timeline, { searches });
assert.equal(scored.callStartMs, start);
assert.equal(scored.callEndMs, start + 350_000);
assert.equal(scored.bestSubscriberId, '110418');
assert.ok(scored.reasons.includes('userside+billing'));
assert.ok(scored.reasons.includes('search-then-open'));
assert.equal(scored.searchEvidence?.query, searches[0].query);

// Exact UserSide search-result click carries stronger intent evidence.
const targeted = scoreCallAgainstTimeline({
  startedAtMs: start,
  timeSemantics: 'start',
  durationSeconds: 350,
  source: 'userside:call_list'
}, [
  { ts: start + 30_000, source: 'userside', subscriberId: '14087', contractId: '110418', pageType: 'userside_customer' }
], {
  searches: [
    { ts: start + 28_000, source: 'userside', kind: 'result-open', query: 'Здановської 36/В', targetCustomerId: '14087' }
  ]
});
assert.ok(targeted.reasons.includes('search-result-opened'));
assert.equal(targeted.searchEvidence?.targetCustomerId, '14087');

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/ui/call-registration-loader.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8');
const callModule = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const callConfig = fs.readFileSync(new URL('../src/features/call/config.js', import.meta.url), 'utf8');
const callNormalizer = fs.readFileSync(new URL('../src/features/call/evidence/normalizer.js', import.meta.url), 'utf8');
const callSource = fs.readFileSync(new URL('../src/features/call/source/userside-call-list.js', import.meta.url), 'utf8');

assert.doesNotMatch(background, /agent-own/);
assert.match(background, /createCallMessageRouter/);
assert.match(background, /callModule\.recordSearch/);
assert.match(background, /callModule\.recordVisit/);
assert.match(background, /callModule\.bind/);
assert.match(callModule, /freezeEligibleCalls/);
assert.match(callModule, /getSnapshot/);
assert.match(callConfig, /CALL_WINDOW_GRACE_MS\s*=\s*15_000/);
assert.match(callNormalizer, /SEARCH_RESOLVED/);
assert.match(callNormalizer, /SUBSCRIBER_VISIT/);
assert.match(callSource, /USERSIDE_CALL_LIST_PATH\s*=\s*'\/message\/call_list'/);
assert.match(callSource, /callKey:\s*`call:\$\{String\(latest\.usersideCallId\)/);
assert.doesNotMatch(manifest, /pbx\.vnet/);

// CALL refresh starts before the native form request and is not gated by Customer ID resolution.
const openStart = ui.indexOf('async open(caseData');
const refreshAt = ui.indexOf('const pbx = await extensionRequest(PBX_QUERY_MESSAGE', openStart);
const formAt = ui.indexOf('await this.loadNativeModelForCurrentCase', openStart);
assert.ok(refreshAt > openStart && formAt > refreshAt, 'call_list refresh must start before native form resolution');
assert.doesNotMatch(ui, /operatorOverride:\s*needsSoft/);
assert.match(ui, /window\.confirm\(/);
assert.match(ui, /hasExplicitOverride/);
assert.match(ui, /overrideConfirmedCallKey/);
assert.match(ui, /exact\.has\('customer'\).*return 100/s);

assert.match(loader, /function injectFeature\(feature, force = false, timeoutMs = 6000\)/);
assert.match(loader, /Call feature injection timed out/);
assert.match(loader, /forceNextLoad = true/);

assert.match(bootstrap, /form\.id === 'top_search'/);
assert.match(bootstrap, /source: 'billing', kind: 'submit'/);
assert.match(bootstrap, /kind: 'result-open'/);
assert.match(bootstrap, /lastAddressSearch/);
assert.doesNotMatch(manifest, /src\/readers\/userside-call-list\.js/);

console.log('call_correlation_hardening_test: PASS');
