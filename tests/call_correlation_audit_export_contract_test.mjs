import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EVIDENCE_RETENTION_MS
} from '../src/features/call/config.js';
import { createEvidenceState, appendEvidenceEvent } from '../src/features/call/evidence/repository.js';

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/store-client.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const caseAudit = fs.readFileSync(new URL('../src/features/call/export/case-audit.js', import.meta.url), 'utf8');

assert.equal(EVIDENCE_RETENTION_MS, 48 * 60 * 60 * 1000, 'CALL evidence ledger should survive a full workday / next-day audit');
assert.match(messages, /CALL_CORRELATION_AUDIT_GET/);
assert.match(store, /getCallCorrelationAudit/);
assert.match(background, /callModule\.caseAudit/);
assert.match(caseAudit, /simnet-call-case-audit-v2/);
assert.match(caseAudit, /searchResolved/);
assert.match(caseAudit, /relevantCalls/);
assert.match(caseAudit, /evaluatedCalls/);
assert.match(rail, /callAudit/);
assert.match(rail, /getCallCorrelationAudit/);
assert.match(rail, /CALL-аудит/);

// A duplicate reload/pageshow must not move the original evidence timestamp.
const base = Date.parse('2026-08-28T10:00:00Z');
const buffer = createEvidenceState();
let first = appendEvidenceEvent(buffer, {
  type: 'SUBSCRIBER_VISIT', source: 'userside', identity: { customerId: '21009', contract: '167173' }, pageType: 'userside_customer', ts: base, tabId: 1
}, { nowMs: base, nowIso: new Date(base).toISOString() });
let duplicate = appendEvidenceEvent(buffer, {
  type: 'SUBSCRIBER_VISIT', source: 'userside', identity: { customerId: '21009', contract: '167173' }, pageType: 'userside_customer', ts: base + 500, tabId: 1
}, { nowMs: base + 500, nowIso: new Date(base + 500).toISOString() });
assert.equal(duplicate.added, false);
assert.equal(buffer.events[0].ts, base, 'dedupe must preserve first event time for call-window audit');

// Rejected/stale contexts must not be recorded before correlation validation.
const applyContextStart = background.indexOf('async function applyContext');
const rejectGuard = background.indexOf('if (!correlation.canMutate)', applyContextStart);
const acceptedRecord = background.indexOf('recordOperatorVisitFromContext(state, { ...nextContext', applyContextStart);
assert.ok(rejectGuard > applyContextStart && acceptedRecord > rejectGuard, 'CALL visit recording must happen only after accepted correlation');

console.log('call_correlation_audit_export_contract_test: PASS');
