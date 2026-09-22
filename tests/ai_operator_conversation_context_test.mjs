import assert from 'node:assert/strict';
import {
  buildConversationContext,
  projectConversationTranscript
} from '../src/features/ai-operator/conversation-context.js';
import {
  compactRuntimeTranscript,
  projectRuntimeConversationContext
} from '../src/features/ai-operator/runtime-projection.js';

function customer(text) { return { role: 'customer', text }; }
function operator(text) { return { role: 'agent', text }; }

// Raw conversational continuity must survive: no telecom diagnosis is hard-coded here.
const continuity = [
  customer('abon140163'),
  operator('Проверяю.'),
  customer('Скорость у него 100, хотя тариф гигабит.'),
  operator('Напрямую проверяли?'),
  customer('Напрямую 940.'),
  customer('А через роутер 95.'),
  customer('Он говорит, вчера всё было нормально.'),
  customer('А почему тогда?')
];
const continuityContext = buildConversationContext(continuity);
assert.equal(continuityContext.activeEntity?.key, 'login:abon140163');
assert.equal(continuityContext.continuity.likelyFollowUp, true);
assert.deepEqual(
  continuityContext.selectedTranscript.map(row => row.text).slice(-5),
  ['Напрямую проверяли?', 'Напрямую 940.', 'А через роутер 95.', 'Он говорит, вчера всё было нормально.', 'А почему тогда?']
);

// Switching subscriber parks the old thread instead of blending subscriber-specific dialogue.
const switched = [
  customer('abon140163'),
  customer('баланс какой?'),
  operator('По этому договору есть финансовый контекст.'),
  customer('abon140040'),
  customer('а скорость?')
];
const switchedContext = buildConversationContext(switched);
assert.equal(switchedContext.activeEntity?.key, 'login:abon140040');
assert.equal(switchedContext.continuity.entitySwitch, true);
assert.ok(switchedContext.parkedEntities.some(entity => entity.key === 'login:abon140163'));
assert.deepEqual(
  switchedContext.selectedTranscript.map(row => row.text),
  ['abon140040', 'а скорость?'],
  'old subscriber dialogue must not remain active after an explicit switch'
);
const switchedRuntime = compactRuntimeTranscript(switched, { maxTurns: 10, maxChars: 500 });
assert.ok(switchedRuntime.some(row => row.text === 'abon140040'));
assert.ok(switchedRuntime.some(row => row.text === 'а скорость?'));
assert.ok(!switchedRuntime.some(row => row.text === 'баланс какой?'));

// Explicit return to a parked subscriber restores that subscriber's earlier raw thread.
const returned = [
  customer('abon140163'),
  customer('скорость 100'),
  operator('Принял.'),
  customer('abon140040'),
  customer('баланс какой?'),
  operator('Проверил.'),
  customer('вернемся к abon140163'),
  customer('а почему тогда?')
];
const returnedContext = buildConversationContext(returned);
assert.equal(returnedContext.activeEntity?.key, 'login:abon140163');
assert.equal(returnedContext.continuity.entitySwitch, true);
assert.equal(returnedContext.continuity.explicitReturn, true);
assert.ok(returnedContext.selectedTranscript.some(row => row.text === 'скорость 100'));
assert.ok(returnedContext.selectedTranscript.some(row => row.text === 'вернемся к abon140163'));
assert.ok(!returnedContext.selectedTranscript.some(row => row.text === 'баланс какой?'));

// A correction can switch the active entity without merging both subscriber branches.
const corrected = [
  customer('abon140163'),
  customer('у него пропадает интернет'),
  operator('Понял.'),
  customer('нет, я про другого — abon142222'),
  customer('у него вчера тоже было')
];
const correctedContext = buildConversationContext(corrected);
assert.equal(correctedContext.activeEntity?.key, 'login:abon142222');
assert.equal(correctedContext.continuity.correctionLikely, false, 'latest turn itself is a continuation; correction remains in selected raw context');
assert.deepEqual(
  correctedContext.selectedTranscript.map(row => row.text),
  ['нет, я про другого — abon142222', 'у него вчера тоже было']
);

// Without an explicit subscriber identity, preserve normal recent dialogue rather than inventing a scope.
const general = [
  customer('Интернет вечером нестабильный.'),
  operator('Это на всех устройствах?'),
  customer('Да, на всех.'),
  customer('А что дальше проверить?')
];
const generalContext = buildConversationContext(general);
assert.equal(generalContext.activeEntity, null);
assert.equal(generalContext.selectedTranscript.length, 4);
assert.deepEqual(projectConversationTranscript(general), generalContext.selectedTranscript);

const diagnostics = projectRuntimeConversationContext(returned);
assert.equal(diagnostics.activeEntity?.key, 'login:abon140163');
assert.equal(diagnostics.continuity.explicitReturn, true);
assert.ok(diagnostics.parkedEntities.some(entity => entity.key === 'login:abon140040'));

console.log('ai_operator_conversation_context_test: PASS', {
  active: returnedContext.activeEntity,
  parked: returnedContext.parkedEntities,
  selectedTurns: returnedContext.diagnostics.selectedTurns
});
