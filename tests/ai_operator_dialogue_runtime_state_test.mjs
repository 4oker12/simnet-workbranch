import assert from 'node:assert/strict';
import { buildDialoguePolicyContext, deriveDiscourseAct, DISCOURSE_ACT, readDialogueMemory, recordDialogueReply, requiredFactsForDialogueTurn, updateDialogueMemory } from '../src/features/ai-operator/dialogue-runtime-state.js';

const correction = { probe: { latestMessageMeans: 'клиент исправляет термин из прошлого сообщения', refersTo: 'предыдущий вопрос', requiredFacts: [], unresolvedRequests: [] } };
const initial = { domainContext: { activeServiceAddress: { fullAddress: 'Тестовая 1' }, dialogue: { activeRequests: ['узнать технологию подключения'], activeRequiredFacts: ['subscriber.access.connectionFamily'], alreadyExplainedFacts: ['subscriber.finance.balance.account'] } } };
assert.equal(deriveDiscourseAct({ analysis: correction, requestText: 'ой, я слово перепутал' }), DISCOURSE_ACT.CORRECT);
assert.deepEqual(requiredFactsForDialogueTurn({ analysis: correction, requestText: 'исправляю термин', labState: initial }), ['subscriber.access.connectionFamily']);
const corrected = updateDialogueMemory({ labState: initial, analysis: correction, requestText: 'исправляю термин' });
assert.deepEqual(readDialogueMemory(corrected).activeRequests, ['узнать технологию подключения']);
assert.deepEqual(readDialogueMemory(corrected).activeRequiredFacts, ['subscriber.access.connectionFamily']);
const context = buildDialoguePolicyContext({ analysis: correction, requestText: 'какие у вас тарифы?', labState: initial });
assert.equal(context.addressKnown, true); assert.equal(context.generalProductQuestion, true);
assert.ok(context.constraints.some(item => /do not ask for it again/i.test(item)));
console.log('ai_operator_dialogue_runtime_state_test: ok');


const communicated = recordDialogueReply({
  labState: corrected,
  reply: 'По адресу Тестовая 1 уже есть найденное подключение. Текущий тариф — SIMNET 500. Если хотите, могу ещё раз проверить адрес?'
});
const communicatedMemory = readDialogueMemory(communicated);
assert.ok(communicatedMemory.alreadyExplainedFacts.includes('По адресу Тестовая 1 уже есть найденное подключение.'));
assert.ok(communicatedMemory.alreadyExplainedFacts.includes('Текущий тариф — SIMNET 500.'));
assert.ok(!communicatedMemory.alreadyExplainedFacts.some(item => /если хотите|проверить адрес/i.test(item)), 'offers/questions are not dialogue fact memory');
const followUpContext = buildDialoguePolicyContext({
  analysis: { probe: { refersTo: 'предыдущее подключение', requiredFacts: [] } },
  requestText: 'А скорость?',
  labState: communicated
});
assert.equal(followUpContext.responseMode, 'DELTA');
assert.ok(followUpContext.alreadyExplainedFacts.includes('Текущий тариф — SIMNET 500.'));
