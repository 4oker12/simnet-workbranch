import { basicConfirmationValue } from './basic-case-router.js';
import { FACT_RECIPES } from './fact-catalog.js';

export const QUESTION_PAIRS = Object.freeze([...Object.keys(FACT_RECIPES),
  'contract.info', 'network.info', 'payment.instructions', 'static_ip.info', 'static_ip.change', 'service.change', 'unknown.info']);

export function normalizeInterpretation(raw = {}) {
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 4).map(q => ({
    entity: String(q?.entity || ''), relation: String(q?.relation || ''),
    period: ['current', 'next', 'year_end'].includes(q?.period) ? q.period : 'current',
    year: Number.isInteger(q?.year) && q.year >= 2000 && q.year <= 2100 ? q.year : null
  })).filter(q => QUESTION_PAIRS.includes(`${q.entity}.${q.relation}`));
  const ids = raw.ids && typeof raw.ids === 'object' ? raw.ids : {};
  const login = String(ids.login || '').replace(/\s/g, '').toLowerCase();
  const contract = String(ids.contract || '').trim();
  const loginContract = login.match(/^abon(\d{3,12})$/i)?.[1] || '';
  const contractFromAbon = contract.match(/^abon\s*(\d{3,12})$/i)?.[1] || '';
  return {
    questions, language: raw.language === 'uk' ? 'uk' : 'ru',
    speechAct: ['new', 'follow_up', 'confirm', 'deny', 'correct', 'request_human'].includes(raw.speechAct) ? raw.speechAct : 'new',
    confirmation: raw.confirmation === true ? true : raw.confirmation === false ? false : null,
    refresh: ['finance', 'network', 'all'].includes(raw.refresh) ? raw.refresh : '',
    // In SIMNET abonNNN and NNN identify the same subscriber contract. Canonicalize both to contract.
    ids: loginContract ? { contract: loginContract }
      : /^\d{3,12}$/.test(contract) ? { contract }
        : contractFromAbon ? { contract: contractFromAbon }
          : typeof ids.address === 'string' && ids.address.trim() ? { address: ids.address.trim().slice(0, 260) } : {}
  };
}

export function newConversationState(raw = {}) {
  return {
    version: 2, confirmedCaseId: String(raw.confirmedCaseId || ''),
    confirmedSubscriber: raw.confirmedSubscriber || null, pendingCandidate: raw.pendingCandidate || null,
    facts: raw.facts && typeof raw.facts === 'object' ? { ...raw.facts } : {},
    reads: raw.reads && typeof raw.reads === 'object' ? { ...raw.reads } : {},
    topic: Array.isArray(raw.topic) ? raw.topic.slice(0, 4) : [],
    language: raw.language === 'uk' ? 'uk' : 'ru', invalidatedAt: Number(raw.invalidatedAt || 0),
    derived: []
  };
}

// Only unambiguous conversational controls bypass NLU. Business requests are interpreted compositionally.
export function localDialogueControl(text, state) {
  const clean = String(text || '').trim();
  const confirmation = basicConfirmationValue(clean);
  if (confirmation !== null) return { questions: [], ids: {}, language: state.language,
    speechAct: confirmation ? 'confirm' : 'deny', confirmation, refresh: '' };
  if (/^(?:а\s+)?(?:следующий|наступний)[?!.,\s]*$/iu.test(clean) && state.topic.length === 1 &&
    ['recurring_charge', 'tariff'].includes(state.topic[0].entity)) {
    return { questions: [{ ...state.topic[0], period: 'next' }], ids: {}, language: state.language, speechAct: 'follow_up', refresh: '' };
  }
  if (/^(?:ну\s+)?(?:так\s+)?(?:сколько|скільки)[?!.,\s]*$/iu.test(clean) && state.topic.length === 1 && state.topic[0].relation === 'amount') {
    return { questions: state.topic, ids: {}, language: state.language, speechAct: 'follow_up', refresh: '' };
  }
  return null;
}

export function lookupFromText(ids, text) {
  // An LLM cannot supply an identifier which the customer never supplied.
  const source = String(text || '').toLowerCase().replace(/\s/g, '');
  if (ids.contract) {
    const explicitContracts = source.match(/\d{3,12}/g) || [];
    if (explicitContracts.includes(ids.contract)) return { contract: ids.contract };
  }
  if (ids.address && source.includes(ids.address.toLowerCase().replace(/\s/g, ''))) return { address: ids.address };
  return null;
}
