import assert from 'node:assert/strict';
import { buildFrozenSnapshot } from '../src/features/call/correlation/snapshot-service.js';

const start = Date.parse('2026-08-30T10:00:00Z');
const call = {
  callKey: 'call:910001',
  usersideCallId: '910001',
  startedAtMs: start,
  durationSeconds: 60,
  status: 'completed'
};
const identity = {
  caseId: 'login:abon12345', customerId: '111', billingId: '222',
  contract: '12345', login: 'abon12345', fullName: 'Тест Абонент'
};
const evidenceBuffer = {
  events: [
    {
      id: 'e2', type: 'HANDOFF', source: 'billing', ts: start + 20_000,
      identity, from: 'billing', to: 'userside'
    },
    {
      id: 'e1', type: 'IDENTIFIED_BY_SEARCH', source: 'billing', ts: start + 10_000,
      searchedAtMs: start + 8_000, openedAtMs: start + 10_000,
      query: 'abon12345', searchKind: 'contract', identity
    },
    {
      id: 'e3', type: 'TECH_ACTION', source: 'billing', ts: start + 30_000,
      action: 'onu_poll', identity
    }
  ]
};

const built = buildFrozenSnapshot(call, evidenceBuffer, {
  atMs: start + 60_000,
  nowIso: '2026-08-30T10:01:00.000Z'
});
assert.equal(built.frozen, true);
assert.equal(built.snapshot.eventCount, 3);
assert.deepEqual(built.snapshot.events.map(event => event.id), ['e1', 'e2', 'e3']);
assert.equal(built.snapshot.events[0].query, 'abon12345');
assert.equal(built.snapshot.events[1].from, 'billing');
assert.equal(built.snapshot.events[2].action, 'onu_poll');
assert.ok(built.snapshot.candidates.length >= 1);
assert.equal(built.snapshot.candidates[0].identity.contract, '12345');

console.log('call_snapshot_events_test: PASS');
