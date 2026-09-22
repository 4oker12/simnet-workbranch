'use strict';

import { isAddressSpecificAvailabilityQuestion, isGeneralProductQuestion } from './dialogue-policy.js';

export const DISCOURSE_ACT = Object.freeze({
  NEW_INTENT: 'NEW_INTENT', CONTINUE: 'CONTINUE', REFINE: 'REFINE', CORRECT: 'CORRECT',
  CONFIRM: 'CONFIRM', REJECT: 'REJECT', CANCEL: 'CANCEL', CHANGE_TOPIC: 'CHANGE_TOPIC',
  JOKE: 'JOKE', IRONY: 'IRONY', FRUSTRATION: 'FRUSTRATION'
});

const ACT_ALIASES = Object.freeze({
  new: DISCOURSE_ACT.NEW_INTENT, new_intent: DISCOURSE_ACT.NEW_INTENT,
  follow_up: DISCOURSE_ACT.CONTINUE, continue: DISCOURSE_ACT.CONTINUE,
  refine: DISCOURSE_ACT.REFINE, correct: DISCOURSE_ACT.CORRECT, correction: DISCOURSE_ACT.CORRECT,
  confirm: DISCOURSE_ACT.CONFIRM, deny: DISCOURSE_ACT.REJECT, reject: DISCOURSE_ACT.REJECT,
  cancel: DISCOURSE_ACT.CANCEL, change_topic: DISCOURSE_ACT.CHANGE_TOPIC,
  joke: DISCOURSE_ACT.JOKE, irony: DISCOURSE_ACT.IRONY, frustration: DISCOURSE_ACT.FRUSTRATION
});

function text(value, max = 800) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function unique(values = [], max = 24) {
  const out = []; const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = text(raw, 500); const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key); out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function explicitAct(probe = {}) {
  const raw = text(probe.discourseAct || probe.discourse_act || probe.speechAct || probe.speech_act, 40).toLowerCase();
  return ACT_ALIASES[raw] || '';
}

export function isConsumptionStartQuestion(requestText = '') {
  const request = text(requestText, 700).toLowerCase();
  return /(?:день|дата).{0,35}(?:начала|початку).{0,35}(?:потреблен|споживан|услуг|послуг)/iu.test(request)
    || /(?:начала|початку).{0,35}(?:потреблен|споживан)/iu.test(request);
}

export function deriveDiscourseAct({ analysis = {}, requestText = '' } = {}) {
  const probe = analysis?.probe || analysis || {};
  const explicit = explicitAct(probe);
  if (explicit) return explicit;
  const semantic = [probe.latestMessageMeans, probe.whatUserWants, probe.refersTo, probe.underlyingGoal]
    .map(v => text(v, 700).toLowerCase()).filter(Boolean).join(' | ');
  const request = text(requestText, 700).toLowerCase();
  // Important: never use the bare substring "оговор" here — it also matches "договор".
  const correctionSignal = /(?:исправ|поправ|корректир|перепут|оговор(?:ил|илась|ился|ка)|имел[аи]?\s+в\s+виду|виправ|помил|мав\s+на\s+увазі)/iu;
  if (correctionSignal.test(`${semantic} ${request}`)) return DISCOURSE_ACT.CORRECT;
  if (/(?:отмен|отзыва|не\s+надо|забудь|скасов|відмін)/iu.test(semantic)) return DISCOURSE_ACT.CANCEL;
  if (/(?:смен|другая\s+тема|другой\s+вопрос|інше\s+питан|змінює\s+тему)/iu.test(semantic)) return DISCOURSE_ACT.CHANGE_TOPIC;
  if (/(?:сарказ|ирони|ірон)/iu.test(semantic)) return DISCOURSE_ACT.IRONY;
  if (/(?:шут|жарт|подкол)/iu.test(semantic)) return DISCOURSE_ACT.JOKE;
  if (/(?:раздраж|недовол|возмущ|драту|обур)/iu.test(semantic)) return DISCOURSE_ACT.FRUSTRATION;
  if (/^(?:да|так|ага|угу|верно|правильно)[.!?\s]*$/iu.test(request)) return DISCOURSE_ACT.CONFIRM;
  if (/^(?:нет|ні|неа|неверно|неправильно)[.!?\s]*$/iu.test(request)) return DISCOURSE_ACT.REJECT;
  if (probe.refersTo) return DISCOURSE_ACT.CONTINUE;
  return DISCOURSE_ACT.NEW_INTENT;
}

export function readDialogueMemory(labState = {}) {
  const raw = labState?.domainContext?.dialogue;
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    version: 1,
    activeRequests: unique(source.activeRequests, 12),
    activeRequiredFacts: unique(source.activeRequiredFacts, 16),
    alreadyExplainedFacts: unique(source.alreadyExplainedFacts, 32),
    offeredActions: unique(source.offeredActions, 12),
    lastDiscourseAct: text(source.lastDiscourseAct, 40),
    lastRequest: text(source.lastRequest, 700)
  };
}

export function requiredFactsForDialogueTurn({ analysis = {}, requestText = '', labState = {} } = {}) {
  const current = unique(analysis?.probe?.requiredFacts || analysis?.probe?.required_facts || [], 16);
  const previous = readDialogueMemory(labState);
  const discourseAct = deriveDiscourseAct({ analysis, requestText });
  if (discourseAct === DISCOURSE_ACT.CANCEL || discourseAct === DISCOURSE_ACT.CHANGE_TOPIC) return current;
  if (discourseAct === DISCOURSE_ACT.CORRECT && current.length === 0) return previous.activeRequiredFacts;
  return current;
}

function unresolvedRequestedFacts(factResolution = {}, fallback = []) {
  if (!factResolution) return unique(fallback, 16);
  const evidence = new Map((Array.isArray(factResolution?.evidence) ? factResolution.evidence : []).map(item => [item?.path, item]));
  return unique((factResolution?.requestedFacts || fallback || []).filter(path => {
    const status = String(evidence.get(path)?.status || 'unknown');
    return status !== 'known' && status !== 'absent';
  }), 16);
}

export function buildDialoguePolicyContext({ analysis = {}, requestText = '', labState = {}, factResolution = null } = {}) {
  const memory = readDialogueMemory(labState);
  const discourseAct = deriveDiscourseAct({ analysis, requestText });
  const requiredFacts = requiredFactsForDialogueTurn({ analysis, requestText, labState });
  const addressKnown = Boolean(text(labState?.confirmedSubscriber?.address, 260)
    || text(labState?.domainContext?.activeServiceAddress?.fullAddress, 260)
    || text(labState?.domainContext?.activeBuildingAddress, 260));
  const followUp = [DISCOURSE_ACT.CONTINUE, DISCOURSE_ACT.REFINE, DISCOURSE_ACT.CORRECT, DISCOURSE_ACT.CONFIRM, DISCOURSE_ACT.REJECT, DISCOURSE_ACT.FRUSTRATION].includes(discourseAct);
  const consumptionStartQuestion = isConsumptionStartQuestion(requestText);
  return {
    discourseAct,
    responseMode: followUp ? 'DELTA' : 'NORMAL',
    activeRequests: memory.activeRequests,
    activeRequiredFacts: memory.activeRequiredFacts,
    requiredFacts,
    alreadyExplainedFacts: memory.alreadyExplainedFacts,
    offeredActions: memory.offeredActions,
    addressKnown,
    generalProductQuestion: isGeneralProductQuestion(requestText),
    addressSpecificAvailability: isAddressSpecificAvailabilityQuestion(requestText),
    consumptionStartQuestion,
    unresolvedFacts: unresolvedRequestedFacts(factResolution, requiredFacts),
    constraints: [
      'Answer the active request directly; do not replace an answer with a generic handoff.',
      'Do not offer registration, transfer, callback or ticket creation unless the user requested it and a real action capability exists.',
      addressKnown ? 'The service address is already known; do not ask for it again.' : '',
      followUp ? 'Use shared dialogue context and answer only the new delta; do not repeat background already explained.' : '',
      discourseAct === DISCOURSE_ACT.CORRECT ? 'This is a correction: preserve the parent unresolved intent unless the user explicitly cancels it.' : '',
      [DISCOURSE_ACT.JOKE, DISCOURSE_ACT.IRONY].includes(discourseAct) ? 'A light human reaction is allowed, but still answer the underlying request.' : '',
      consumptionStartQuestion ? 'Service-consumption start day/date is NOT the contract-signing date. Never substitute subscriber.contract.date for this fact; if no dedicated source-backed fact exists, say it is not confirmed.' : ''
    ].filter(Boolean)
  };
}

export function updateDialogueMemory({ labState = {}, analysis = {}, requestText = '', factResolution = null } = {}) {
  const state = labState && typeof labState === 'object' && !Array.isArray(labState) ? JSON.parse(JSON.stringify(labState)) : {};
  const domain = state.domainContext && typeof state.domainContext === 'object' && !Array.isArray(state.domainContext) ? state.domainContext : {};
  const previous = readDialogueMemory(state);
  const discourseAct = deriveDiscourseAct({ analysis, requestText });
  const requiredFacts = requiredFactsForDialogueTurn({ analysis, requestText, labState: state });
  const currentRequests = unique(analysis?.probe?.unresolvedRequests || [], 12);
  let activeRequests = previous.activeRequests;
  if (discourseAct === DISCOURSE_ACT.CANCEL) activeRequests = [];
  else if (discourseAct === DISCOURSE_ACT.CHANGE_TOPIC) activeRequests = currentRequests;
  else if (discourseAct === DISCOURSE_ACT.CORRECT && currentRequests.length === 0) activeRequests = previous.activeRequests;
  else if (currentRequests.length) activeRequests = currentRequests;
  const activeRequiredFacts = discourseAct === DISCOURSE_ACT.CANCEL ? [] : unresolvedRequestedFacts(factResolution, requiredFacts);
  // Resolving a fact is not the same thing as telling it to the customer.
  // Until post-reply tracking explicitly marks rendered facts, preserve only
  // facts that were already known to have been communicated on prior turns.
  const explained = unique(previous.alreadyExplainedFacts, 32);
  state.domainContext = { ...domain, dialogue: {
    version: 1, activeRequests, activeRequiredFacts, alreadyExplainedFacts: explained,
    offeredActions: previous.offeredActions, lastDiscourseAct: discourseAct, lastRequest: text(requestText, 700)
  }};
  state.alreadyExplainedFacts = explained;
  state.offeredActions = previous.offeredActions;
  return state;
}
