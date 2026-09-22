'use strict';

/**
 * Dialogue Policy / «Dialogue Police» — deterministic guardrail layer.
 * Does NOT replace reasoning. Runs after fact resolution, before or after synthesis.
 *
 * Violation codes are developer diagnostics, not customer-facing text.
 * Detection targets semantic classes, not a blacklist of fixture phrases.
 */

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

function lower(value) {
  return text(value).toLowerCase();
}

export function isGeneralProductQuestion(requestText = '') {
  const request = lower(requestText);
  if (!request) return false;
  const subscriberSpecific = /(?:у\s+меня|у\s+мене|мой|мій|по\s+моему|по\s+моєму|мне\s+дома|мені\s+вдома)/iu.test(request);
  if (subscriberSpecific) return false;
  return (
    /(?:какие|які|какой|який).{0,40}(?:тариф|пакет|услуг|послуг)/iu.test(request)
    || /(?:как\s+подключ|як\s+підключ|условия|умови|оплат)/iu.test(request)
  );
}

export function isAddressSpecificAvailabilityQuestion(requestText = '') {
  const request = lower(requestText);
  return /(?:у\s+меня\s+дома|у\s+мене\s+вдома|по\s+адресу|по\s+моєму\s+адресу|на\s+моей\s+улице).{0,40}(?:gpon|epon|оптик|гигабит|гігабіт|доступн)/iu.test(request)
    || /(?:есть\s+ли|чи\s+є).{0,30}(?:gpon|оптик).{0,30}(?:дом|адрес|вул)/iu.test(request);
}

function hasConfirmedServiceAddress(labState = {}) {
  const subscriber = labState?.confirmedSubscriber || {};
  const domain = labState?.domainContext || {};
  return Boolean(
    text(subscriber.address, 200)
    || text(domain.activeServiceAddress?.fullAddress, 200)
    || text(domain.activeBuildingAddress, 200)
  );
}

function userRequestedAction(requestText = '') {
  const request = lower(requestText);
  return /(?:зарегистрир|оформ|передайте|перезвон|заявк|зафиксир|підключ(ить|іть)|включите|увімкніть)/iu.test(request);
}

export function evaluateDialoguePolicy({
  reply = '',
  requestText = '',
  labState = {},
  alreadyExplainedFacts = [],
  offeredActions = [],
  actionToolsCalled = [],
  hasWriteCapability = false
} = {}) {
  const violations = [];
  let body = text(reply, 4000);
  const request = text(requestText, 800);
  const offered = Array.isArray(offeredActions) ? offeredActions : [];
  const explained = Array.isArray(alreadyExplainedFacts) ? alreadyExplainedFacts.map(item => lower(item)) : [];
  const actionsCalled = new Set((Array.isArray(actionToolsCalled) ? actionToolsCalled : []).map(item => String(item || '')));

  const actionOffer = /(?:могу\s+)?(?:зарегистрир\w*|оформ\w*|передать\s+(?:вопрос|информац|в\s+отдел)|передати\s+|заказать\s+звонок|замовити\s+дзвінок|зафиксир\w*|зафіксу\w*|создам\s+заявк|створю\s+заявк)/iu.test(body);
  if (actionOffer && !userRequestedAction(request)) {
    violations.push({
      code: DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER,
      reason: 'Reply offers registration/transfer/callback without user requesting an action'
    });
  }
  if (actionOffer && offered.some(item => /register|transfer|callback|ticket|заявк/i.test(String(item)))) {
    violations.push({
      code: DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER,
      reason: 'Same action class was already offered earlier in the dialogue'
    });
  }

  const overclaim = /(?:я\s+зарегистрирую|я\s+оформлю|я\s+передам|вам\s+перезвон|я\s+поставлю\s+заявк|я\s+створю\s+заявк|я\s+включу\s+вам)/iu.test(body);
  if (overclaim && (!hasWriteCapability || actionsCalled.size === 0)) {
    violations.push({
      code: DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM,
      reason: 'Reply promises an action without write capability or successful action tool'
    });
  }

  const asksAddress = /(?:уточн[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,40}адрес|назов[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,40}адрес|нужен\s+ваш\s+адрес|потрібн[а-яА-ЯіІїЇєЄґҐa-z]*\s+.{0,20}адрес|скажите\s+адрес|вкажіть\s+адрес|ваш\s+адрес)/iu.test(body);
  if (asksAddress) {
    if (isGeneralProductQuestion(request) && !isAddressSpecificAvailabilityQuestion(request)) {
      violations.push({
        code: DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST,
        reason: 'General product question does not require subscriber address'
      });
    } else if (hasConfirmedServiceAddress(labState)) {
      violations.push({
        code: DIALOGUE_VIOLATION.UNNECESSARY_ADDRESS_REQUEST,
        reason: 'Service address already present in confirmed subscriber context'
      });
    }
  }

  if (explained.length && body.length > 180) {
    const hits = explained.filter(fact => fact && lower(body).includes(fact)).length;
    if (hits >= 2 && /(?:как\s+я\s+(?:уже\s+)?(?:говорил|писал)|напомню|повторю|як\s+я\s+(?:вже\s+)?(?:казав|писав))/iu.test(body)) {
      violations.push({
        code: DIALOGUE_VIOLATION.REPEATED_INFORMATION,
        reason: 'Reply re-explains multiple already shared facts on a short follow-up path'
      });
    }
  }

  if (/(?:извините,?\s+я\s+не\s+совсем\s+понял|уточните,?\s+пожалуйста|я\s+могу\s+передать\s+информацию|могу\s+зафиксировать\s+обращение)/iu.test(body)
    && !/^\s*(?:да|нет|так|ні)\b/iu.test(request)) {
    violations.push({
      code: DIALOGUE_VIOLATION.CORPORATE_BOT_PHRASE,
      reason: 'Unnecessary corporate clarification/offer phrasing'
    });
  }

  if (/(?:договор\s*=\s*лицевой|login\s*abon\+\d|внутренняя\s+статья|KB\s*article|encyclopedia-v)/iu.test(body)
    || /(?:^|\n)\s*#{1,3}\s+\w/.test(reply)) {
    violations.push({
      code: DIALOGUE_VIOLATION.RAW_KNOWLEDGE_LEAK,
      reason: 'Reply looks like raw internal knowledge text'
    });
  }

  if (request.length > 0 && request.length < 40 && body.length > 700
    && /(?:сколько|скільки|какой|який|баланс|тариф)/iu.test(request)) {
    violations.push({
      code: DIALOGUE_VIOLATION.EXCESSIVE_EXPLANATION,
      reason: 'Simple factual question received a very long reply'
    });
  }

  let cleaned = false;
  if (violations.some(item => item.code === DIALOGUE_VIOLATION.UNSOLICITED_ACTION_OFFER
    || item.code === DIALOGUE_VIOLATION.CAPABILITY_OVERCLAIM
    || item.code === DIALOGUE_VIOLATION.CORPORATE_BOT_PHRASE)) {
    const stripped = body
      .replace(/(?:^|\.\s+)(?:[^.]*?(?:зарегистрир\w*|оформ\w*|зафиксир\w*|зафіксу\w*|передать\s+(?:вопрос|информац)|заказать\s+звонок|вам\s+перезвон)[^.]*\.?)/giu, '. ')
      .replace(/(?:извините,?\s+я\s+не\s+совсем\s+понял[^.]*\.?|уточните,?\s+пожалуйста[^.]*\.?)/giu, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+\./g, '.')
      .trim();
    if (stripped && stripped.length + 20 < body.length) {
      body = stripped;
      cleaned = true;
    }
  }

  return { violations, reply: body, cleaned };
}

export function applyDialoguePolicy(input = {}) {
  const evaluated = evaluateDialoguePolicy(input);
  return {
    reply: evaluated.reply,
    dialoguePolice: {
      violations: evaluated.violations.map(item => item.code),
      details: evaluated.violations,
      cleaned: evaluated.cleaned
    }
  };
}
