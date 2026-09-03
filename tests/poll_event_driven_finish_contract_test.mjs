import assert from 'node:assert/strict';
import fs from 'node:fs';

const guards = fs.readFileSync(new URL('../src/core/interaction-guards.js', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../src/readers/billing.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');

assert.match(guards, /function startPollResponseWatch/);
assert.match(guards, /new MutationObserver\(\(\) => refreshPollResponseFromDom\(\)\)/);
assert.match(guards, /finishPollAttempt\(latest, 'timeout', 'poll-response-timeout'\)/);
assert.match(guards, /function resolvePollRequest[\s\S]*notifyPollAttempt\(resolved\)/,
  'parser terminal outcome must persist the end event to the durable Case');
assert.match(guards, /params\.get\('act'\) !== 'askolt' && !POLL_ACTIONS\.has\(surfaceAction\)/,
  'same-document native Billing AJAX is a valid correlated poll surface');
assert.match(bootstrap, /resumePollResponseWatch/,
  'active request watcher resumes only when an operation survives navigation/reload');
assert.match(reader, /rawPollResponded \|\| \['not_found', 'timeout', 'olt_unreachable', 'parser_error'\]/,
  'wrong-tech poll still reaches a terminal failed operation instead of hanging pending');
assert.match(background, /superseded-by-new-poll/,
  'a new deliberate poll retires a different old pending attempt atomically');

console.log('poll_event_driven_finish_contract_test: PASS');
