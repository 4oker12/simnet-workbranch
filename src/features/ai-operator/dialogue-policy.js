'use strict';

/** Dialogue Policy / «Dialogue Police» deterministic guardrail. */
export const DIALOGUE_VIOLATION = Object.freeze({
  UNSOLICITED_ACTION_OFFER: 'UNSOLICITED_ACTION_OFFER',
  CAPABILITY_OVERCLAIM: 'CAPABILITY_OVERCLAIM',
  UNNECESSARY_CLARIFICATION: 'UNNECESSARY_CLARIFICATION',
  UNNECESSARY_ADDRESS_REQUEST: 'UNNECESSARY_ADDRESS_REQUEST',
  REPEATED_INFORMATION: 'REPEATED_INFORMATION',
  NON_ANSWER: 'NON_ANSWER',
  RAW_KNOWLEDGE_LEAK: 'RAW_KNOWLEDGE_LEAK',
  EXCESSIVE_EXPLANATION: 'EXCESSIVE_EXPLANATION',
  CORPORATE_BOT_PHRASE: 'CORPORATE_BOT_PHRASE'
});

function text(value, max = 4000) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function lower(value) { return text(value).toLowerCase(); }

export function isGeneralProductQuestion(requestText = '') {
  const request = lower(requestText);
  if (!request) return false;
  const subscriberSpecific = /(?:у\s+меня|у\s+мене|мой|мій|по\s+моему|по\s+моєму|мне\s+дома|мені\s+вдома)/iu.test(request);
  if (subscriberSpecific) return false;
  return /(?:какие|які|какой|який).{0,40}(?:тариф|пакет|услуг|послуг)/iu.test(request)
    || /(?:как\s+подключ|як\s+підключ|условия|умови|оплат)/iu.test(request);
}

export function isAddressSpecificAvailabilityQuestion(requestText = '') {
  const request = lower(requestText);
  return /(?:у\s+меня\s+дома|у\s+мене\s+вдома|по\s+адресу|по\s+моєму\s+адресу|на\s+моей\s+улице).{0,40}(?:gpon|epon|оптик|гигабит|гігабіт|доступн)/iu.test(request)
    || /(?:есть\s+ли|чи\s+є).{0,30}(?:gpon|оптик).{0,30}(?:дом|адрес|вул)/iu.test(request);
}

function hasConfirmedServiceAddress(labState = {}) {
  const subscriber = labState?.confirmedSubscriber || {};
  const domain = labState?.domainContext || {};
  return Boolean(text(subscriber.address, 200) || text(domain.activeServiceAddress?.fullAddress, 200) || text(domain.activeBuildingAddress, 200));
}
function userRequestedAction(requestText = '') {
  const request = lower(requestText);
  return /(?:зарегистрируйте|зарегистрировать|оформите|оформить|создайте|создать|створіть|створити|оставьте|оставить|залишіть|залишити|откройте|открыть|відкрийте|відкрити|передайте|передать|передати|направьте|направить|скерувати|перезвоните|перезвонить|зателефонуйте|зателефонувати|зафиксируйте|зафиксировать|зафіксуйте|зафіксувати|подключите|подключить|підключіть|підключити|включите|включить|увімкніть|увімкнути)/iu.test(request);
}
function isQuestionLike(requestText = '') {
  const request = lower(requestText);
  return /\?/.test(requestText)
    || /^(?:а\s+)?(?:сколько|скільки|какой|який|какие|які|когда|коли|где|де|почему|чому|можно|можна|есть\s+ли|чи\s+є|что|що|как|як)(?=$|\s|[?.!,;:])/iu.test(request);
}
function safeLeakFallback(requestText = '') {
  return isQuestionLike(requestText)
    ? 'Сейчас не могу подтвердить ответ на этот вопрос по имеющимся данным.'
    : 'Понял.';
}

function hasAffirmativeActionOffer(value = '') {
  const source = text(value, 4000);
  const modal = /(?:^|[^\p{L}\p{N}_])((?:могу|можем|можу|можемо)\s+(?:зарегистрир[\p{L}\p{M}]*|оформ[\p{L}\p{M}]*|созда[\p{L}\p{M}]*|створ[\p{L}\p{M}]*|остав[\p{L}\p{M}]*|залиш[\p{L}\p{M}]*|откр[\p{L}\p{M}]*|відкр[\p{L}\p{M}]*|сформир[\p{L}\p{M}]*|переда[\p{L}\p{M}]*|направ[\p{L}\p{M}]*|скерув[\p{L}\p{M}]*|зафиксир[\p{L}\p{M}]*|зафіксу[\p{L}\p{M}]*|заказ[\p{L}\p{M}]*|замов[\p{L}\p{M}]*|постав[\p{L}\p{M}]*))/giu;
  for (const match of source.matchAll(modal)) {
    const phrase = String(match[1] || '');
    const start = Number(match.index || 0) + String(match[0] || '').length - phrase.length;
    const prefix = source.slice(Math.max(0, start - 12), start).toLowerCase();
    if (!/не\s*$/.test(prefix)) return true;
  }
  return /(?:^|[^\p{L}\p{N}_])(?:давайте\s+я|если\s+хотите[, ]+я|при\s+необходимости[, ]+я)\s+(?:зарегистрир[\p{L}\p{M}]*|оформ[\p{L}\p{M}]*|создам|створю|оставлю|залишу|передам|направлю|зафиксирую|зафіксую|закажу|замовлю)/iu.test(source);
}

function hasActionCommitment(value = '') {
  const source = text(value, 4000);
  return /(?:^|[^\p{L}\p{N}_])я\s+(?:зарегистрирую|оформлю|создам|створю|оставлю|залишу|открою|відкрию|сформирую|передам|направлю|скерую|зафиксирую|зафіксую|закажу|замовлю|поставлю)(?=$|[^\p{L}\p{N}_])/iu.test(source)
    || /(?:^|[^\p{L}\p{N}_])вам\s+(?:перезвонят|зателефонують)(?=$|[^\p{L}\p{N}_])/iu.test(source);
}

function hasCorporateBotPhrase(value = '') {
  return /(?:извините,?\s+я\s+не\s+совсем\s+понял|уточните,?\s+пожалуйста|я\s+могу\s+передать\s+информацию|могу\s+зафиксировать\s+обращение)/iu.test(text(value, 4000));
}

function danglingOfferLead(value = '') {
  return /^(?:(?:а\s+)?(?:если\s+хотите|при\s+необходимости|заодно)|да|так|ага|угу|конечно|звісно)[,;]?$/iu.test(text(value, 300));
}

function stripForbiddenActionSentences(value = '') {
  const sentences = text(value, 4000).split(/(?<=[.!?])\s+/u).filter(Boolean);
  const kept = [];
  for (const sentence of sentences) {
    const forbidden = hasAffirmativeActionOffer(sentence) || hasActionCommitment(sentence) || hasCorporateBotPhrase(sentence);
    if (!forbidden) {
      kept.push(sentence);
      continue;
    }
    const clauses = sentence.split(/(?<=[,;])\s+/u).filter(Boolean);
    const remainder = clauses
      .filter(clause => !danglingOfferLead(clause))
      .filter(clause => !hasAffirmativeActionOffer(clause) && !hasActionCommitment(clause) && !hasCorporateBotPhrase(clause))
      .join(' ')
      .replace(/[,;]\s*$/u, '')
      .trim();
    if (remainder) kept.push(remainder);
  }
  return kept.join(' ').trim();
}

export function evaluateDialoguePolicy({ reply = '', requestText = '', labState = {}, alreadyExplainedFacts = [], offeredActions = [], actionToolsCalled = [], hasWriteCapability = false } = {}) {
  const violations = [];
  let body = text(reply, 4000);
  const request = text(requestText, 800);
  const offered = Array.isArray(offeredActions) ? offeredActions : [];
  const explained = Array.isArray(alreadyExplainedFacts) ? alreadyExplainedFacts.map(item => lower(item)) : [];
  const actionsCalled = new Set((Array.isArray(actionToolsCalled) ? actionToolsCalled : []).map(item => String(item || '')));

  const actionOffer = hasAffirmativeActionOffer(body) || hasActionCommitment(body);
  if (actionOffer && !userRequestedAction(request)) violations.push({ code: DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER, reason: 'Reply offers registration/transfer/callback without user requesting an action' });
  if (actionOffer && offered.some(item => /register|transfer|callback|ticket|заявк/i.test(String(item)))) violations.push({ code: DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER, reason: 'Same action class was already offered earlier in the dialogue' });

  const capabilityClaim = hasAffirmativeActionOffer(body) || hasActionCommitment(body);
  if (capabilityClaim && (!hasWriteCapability || actionsCalled.size === 0)) violations.push({ code: DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM, reason: 'Reply claims an operational action without write capability and successful action tool' });

  const asksAddress = /(?:уточн[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,40}адрес|назов[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,40}адрес|нужен\s+ваш\s+адрес|потрібн[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,20}адрес|скажите\s+адрес|вкажіть\s+адрес|ваш\s+адрес)/iu.test(body);
  if (asksAddress) {
    if (isGeneralProductQuestion(request) && !isAddressSpecificAvailabilityQuestion(request)) violations.push({ code: DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST, reason: 'General product question does not require subscriber address' });
    else if (hasConfirmedServiceAddress(labState)) violations.push({ code: DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST, reason: 'Service address already present in confirmed subscriber context' });
  }

  if (explained.length && body.length > 180) {
    const hits = explained.filter(fact => fact && lower(body).includes(fact)).length;
    if (hits >= 2 && /(?:как\s+я\s+(?:уже\s+)?(?:говорил|писал)|напомню|повторю|як\s+я\s+(?:вже\s+)?(?:казав|писав))/iu.test(body)) violations.push({ code: DIALOGUE_VIOLATION.REPEATED_INFORMATION, reason: 'Reply re-explains multiple already shared facts on a short follow-up path' });
  }

  const corporateBotPhrase = hasCorporateBotPhrase(body);
  if (corporateBotPhrase && !/^\s*(?:да|нет|так|ні)(?=$|\s|[?.!,;:])/iu.test(request)) violations.push({ code: DIALOGUE_VIOLATION.CORPORATE_BOT_PHRASE, reason: 'Unnecessary corporate clarification/offer phrasing' });

  const rawKnowledgeLeak = /(?:договор\s*=\s*лицевой|login\s*abon\+\d|внутренняя\s+статья|KB\s*article|encyclopedia-v|канон\s+финансовых\s+полей)/iu.test(body)
    || /(?:^|\n)\s*#{1,3}\s+\w/.test(reply);
  if (rawKnowledgeLeak) violations.push({ code: DIALOGUE_VIOLATION.RAW_KNOWLEDGE_LEAK, reason: 'Reply looks like raw internal knowledge text' });

  if (request.length > 0 && request.length < 40 && body.length > 700 && /(?:сколько|скільки|какой|який|баланс|тариф)/iu.test(request)) violations.push({ code: DIALOGUE_VIOLATION.EXCESSIVE_EXPLANATION, reason: 'Simple factual question received a very long reply' });

  let cleaned = false;
  if (rawKnowledgeLeak) {
    body = safeLeakFallback(request);
    cleaned = true;
    if (isQuestionLike(request)) violations.push({ code: DIALOGUE_VIOLATION.NON_ANSWER, reason: 'Raw internal text was blocked; no source-backed customer answer remained' });
  }

  if (!rawKnowledgeLeak && violations.some(item => item.code === DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER || item.code === DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM || item.code === DIALOGUE_VIOLATION.CORPORATE_BOT_PHRASE)) {
    const stripped = stripForbiddenActionSentences(body);
    if (stripped !== body) cleaned = true;
    if (stripped) {
      body = stripped;
    } else if (userRequestedAction(request)) {
      body = 'Сейчас я не могу выполнить это действие из чата.';
    } else {
      body = safeLeakFallback(request);
      if (isQuestionLike(request) && !violations.some(item => item.code === DIALOGUE_VIOLATION.NON_ANSWER)) {
        violations.push({ code: DIALOGUE_VIOLATION.NON_ANSWER, reason: 'Only an unsolicited/capability-overclaim action sentence remained after cleanup' });
      }
    }
  }

  return { violations, reply: body, cleaned };
}

export function applyDialoguePolicy(input = {}) {
  const evaluated = evaluateDialoguePolicy(input);
  return { reply: evaluated.reply, dialoguePolice: { violations: evaluated.violations.map(item => item.code), details: evaluated.violations, cleaned: evaluated.cleaned } };
}
