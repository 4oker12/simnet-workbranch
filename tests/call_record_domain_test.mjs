import assert from 'node:assert/strict';
import { CallRecord } from '../src/features/call/domain/call-record.js';

const call = CallRecord.from({
  callKey: 'call:24808891',
  usersideCallId: '24808891',
  startedAtMs: Date.now(),
  legacyAliases: []
});

call
  .bindSubscriber({ customerId: '26809', caseId: 'case-26809' })
  .setRegistration('registered', 'userside')
  .attachPbx('178868208.233531')
  .startStage('whisper')
  .completeStage('whisper', { processingSeconds: 31.92 })
  .startStage('ai')
  .fail('ai', new Error('Groq timeout'));

let raw = call.toJSON();
assert.equal(raw.callKey, 'call:24808891');
assert.equal(raw.subscriber.customerId, '26809');
assert.equal(raw.registration.state, 'registered');
assert.equal(raw.pbxRecordId, '178868208.233531');
assert.ok(raw.legacyAliases.includes('pbx:178868208.233531'));
assert.equal(raw.processing.state, 'failed');
assert.equal(raw.processing.stage, 'ai');
assert.equal(call.needsAttention(), true);
assert.equal(call.canRetry(), true);
assert.equal(call.nextStage(), 'ai');

call.cancel();
raw = call.toJSON();
assert.equal(raw.processing.state, 'cancelled');
assert.equal(call.needsAttention(), false);
assert.equal(call.canRetry(), true);
assert.ok(raw.timeline.some(row => row.type === 'stage_failed'));
assert.ok(raw.timeline.some(row => row.type === 'cancelled'));

console.log('call_record_domain_test: PASS');
