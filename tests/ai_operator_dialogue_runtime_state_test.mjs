import assert from 'node:assert/strict';
import { buildDialoguePolicyContext, deriveContractRelationshipClaim, CONTRACT_RELATIONSHIP, deriveDiscourseAct, DISCOURSE_ACT, readDialogueMemory, requiredFactsForDialogueTurn, updateDialogueMemory } from '../src/features/ai-operator/dialogue-runtime-state.js';

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

const newOccupantAnalysis = { probe: { whatUserWants: 'Недавно заехал в квартиру, хозяин оставил старый номер договора, хочу подключить интернет на себя.' } };
assert.equal(
  deriveContractRelationshipClaim({ analysis: newOccupantAnalysis, requestText: 'недавно заехал, старый номер оставил хозяин' }),
  CONTRACT_RELATIONSHIP.NEW_OCCUPANT
);
const newOccupantContext = buildDialoguePolicyContext({ analysis: newOccupantAnalysis, requestText: 'недавно заехал, хочу интернет на себя', labState: {} });
assert.equal(newOccupantContext.contractRelationshipClaim, CONTRACT_RELATIONSHIP.NEW_OCCUPANT);
assert.ok(newOccupantContext.constraints.some(item => /address\/line context only/i.test(item)));
assert.ok(newOccupantContext.constraints.some(item => /do not transfer its negative balance/i.test(item)));

const persistedOccupant = updateDialogueMemory({ labState: {}, analysis: newOccupantAnalysis, requestText: 'недавно заехал в квартиру' });
assert.equal(readDialogueMemory(persistedOccupant).contractRelationshipClaim, CONTRACT_RELATIONSHIP.NEW_OCCUPANT);
const followUpOccupant = buildDialoguePolicyContext({ analysis: { probe: { refersTo: 'предыдущий вопрос' } }, requestText: 'а сколько платить?', labState: persistedOccupant });
assert.equal(followUpOccupant.contractRelationshipClaim, CONTRACT_RELATIONSHIP.NEW_OCCUPANT);

assert.equal(
  deriveContractRelationshipClaim({ requestText: 'хозяйка сказала оставить договор на ней, она не против' }),
  CONTRACT_RELATIONSHIP.OWNER_RETAINED
);
assert.equal(
  deriveContractRelationshipClaim({ requestText: 'мой договор, два года отсутствовал, хочу восстановить интернет' }),
  CONTRACT_RELATIONSHIP.RETURNING_SUBSCRIBER
);

console.log('ai_operator_dialogue_runtime_state_test: ok');
