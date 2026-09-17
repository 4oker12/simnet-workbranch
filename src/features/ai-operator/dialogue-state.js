import { basicConfirmationValue } from './basic-case-router.js';
import { FACT_RECIPES } from './fact-catalog.js';
import { extractStandaloneSubscriberIdentity, identityToolArgs } from './subscriber-identity.js';

export const QUESTION_PAIRS = Object.freeze([...Object.keys(FACT_RECIPES),
  'contract.info', 'network.info', 'payment.instructions', 'static_ip.info', 'static_ip.change', 'service.change',
  'tariff.upgrade', 'tariff.downgrade', 'tariff.change', 'equipment.compatibility', 'unknown.info']);

function canonicalContract(value) {
  const source = String(value == null ? '' : value).trim().replace(/\s/g, '');
  const abon = source.match(/^abon(\d{3,12})$/i)?.[1] || '';
  return abon || (/^\d{3,12}$/.test(source) ? source : '');
}

export function explicitContractFromText(value = '') {
  const source = String(value == null ? '' : value).replace(/\u00a0/g, ' ');
  const abon = source.match(/\babon\s*[-:#№]?\s*(\d{3,12})\b/i)?.[1] || '';
  if (abon) return abon;

  // Labels are intentionally multilingual/colloquial: HelpCrunch users often type transliterated "dogovir".
  const labelled = source.match(/(?:\b(?:договор|договір|договіром|договора|договору|дог\.?|contract|account|login|логин|dogovir|dogovor)\b)\s*(?:№|#|:|-)?\s*(?:abon\s*)?(\d{3,12})\b/iu)?.[1] || '';
  if (labelled) return labelled;

  const clean = source.trim();
  if (/^\d{3,12}$/.test(clean)) return clean;

  // A standalone numeric line at the end of a normal message is a common way subscribers append the contract.
  // Keep long phone-like values out unless the line was explicitly labelled above.
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^\d{3,8}$/.test(line)) return line;
  }
  return '';
}

export function normalizeInterpretation(raw = {}) {
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 4).map(q => ({
    entity: String(q?.entity || ''), relation: String(q?.relation || ''),
    period: ['current', 'next', 'year_end'].includes(q?.period) ? q.period : 'current',
    year: Number.isInteger(q?.year) && q.year >= 2000 && q.year <= 2100 ? q.year : null
  })).filter(q => QUESTION_PAIRS.includes(`${q.entity}.${q.relation}`));
  const ids = raw.ids && typeof raw.ids === 'object' ? raw.ids : {};
  const loginContract = canonicalContract(ids.login);
  const contract = canonicalContract(ids.contract);
  const freeLogin = String(ids.login || '').trim();
  return {
    questions, language: raw.language === 'uk' ? 'uk' : 'ru',
    speechAct: ['new', 'follow_up', 'confirm', 'deny', 'correct', 'request_human'].includes(raw.speechAct) ? raw.speechAct : 'new',
    confirmation: raw.confirmation === true ? true : raw.confirmation === false ? false : null,
    refresh: ['finance', 'network', 'all'].includes(raw.refresh) ? raw.refresh : '',
    // In SIMNET abonNNN and NNN identify the same subscriber contract. Free-text login is preserved as supplied.
    ids: loginContract ? { contract: loginContract }
      : contract ? { contract }
        : freeLogin && /^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(freeLogin) ? { login: freeLogin }
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

  // "да/так" can answer an operator's previous diagnostic question. Only short-circuit it when
  // we are actually waiting for identity confirmation; otherwise NLU must resolve it from dialogue context.
  if (confirmation !== null && state.pendingCandidate) return { questions: [], ids: {}, language: state.language,
    speechAct: confirmation ? 'confirm' : 'deny', confirmation, refresh: '' };

  // Pure acknowledgement/courtesy must not restart identification or repeat the previous business answer.
  // Keep yes/no and "не знаю" out of this bucket: they may answer the immediately preceding operator question.
  if (/^(?:угу|ага|ок|окей|понял(?:а)?|ясно|зрозуміло|дякую|спасибо|спасибі|благодарю|добре,?\s*дякую|ок(?:ей)?,?\s*дякую|вже\s+є,?\s*дякую)[!.)\s]*$/iu.test(clean)) {
    return { questions: [], ids: {}, language: state.language, speechAct: 'confirm', confirmation: true, refresh: '' };
  }

  if (/^(?:а\s+)?(?:следующий|наступний)[?!.,\s]*$/iu.test(clean) && state.topic.length === 1 &&
    ['recurring_charge', 'tariff'].includes(state.topic[0].entity)) {
    return { questions: [{ ...state.topic[0], period: 'next' }], ids: {}, language: state.language, speechAct: 'follow_up', refresh: '' };
  }
  if (/^(?:ну\s+)?(?:так\s+)?(?:сколько|скільки)[?!.,\s]*$/iu.test(clean) && state.topic.length === 1 && state.topic[0].relation === 'amount') {
    return { questions: state.topic, ids: {}, language: state.language, speechAct: 'follow_up', refresh: '' };
  }

  // Replies such as "не знаю", "нет", "да" may answer the immediately preceding operator question.
  // Do not blindly reuse the previous customer topic here: NLU must resolve their referent from dialogue context.
  return null;
}

export function lookupFromText(ids = {}, text = '') {
  // One deterministic parser is shared by Lab and legacy/fact-runtime paths. Literal user text wins over LLM guesses.
  const literalIdentity = identityToolArgs(extractStandaloneSubscriberIdentity([{ role: 'customer', text }]));
  if (Object.keys(literalIdentity).length) return literalIdentity;

  // Retain the older numeric/address safety net for compatibility with historical replay data.
  const deterministicContract = explicitContractFromText(text);
  if (deterministicContract) return { contract: deterministicContract };

  const source = String(text || '').toLowerCase().replace(/\s/g, '');
  const modelContract = canonicalContract(ids.contract || ids.login);
  if (modelContract) {
    const explicitContracts = source.match(/\d{3,12}/g) || [];
    if (explicitContracts.includes(modelContract)) return { contract: modelContract };
  }
  const modelLogin = String(ids.login || '').trim();
  if (modelLogin && /^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(modelLogin) && source.includes(modelLogin.toLowerCase())) {
    return { login: modelLogin };
  }
  if (ids.address && source.includes(String(ids.address).toLowerCase().replace(/\s/g, ''))) return { address: String(ids.address).trim().slice(0, 260) };
  return null;
}
