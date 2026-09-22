'use strict';

/**
 * Deterministic checks for L2/L3 finance behavior fixtures.
 * Does not call LLM. Inspects reply text + evidence + toolTrace against expect flags.
 */

function text(value) {
  return String(value == null ? '' : value);
}

function evidenceStatus(evidence = {}, path) {
  const row = evidence?.[path];
  if (!row || typeof row !== 'object') return 'missing';
  return String(row.status || 'unknown');
}

function evidenceValue(evidence = {}, path) {
  return evidence?.[path]?.value;
}

function moneyMentions(reply) {
  const amounts = [];
  const re = /(-?\d[\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*(?:грн|₴)?/giu;
  for (const match of text(reply).matchAll(re)) {
    const normalized = String(match[1] || '').replace(/[\s\u00a0]/g, '').replace(',', '.');
    const number = Number(normalized);
    if (Number.isFinite(number)) amounts.push(Math.round(number * 100) / 100);
  }
  return amounts;
}

function claimsDebt(reply) {
  const body = text(reply);

  // Explicit "you owe N" is an affirmative debt claim even without the noun "debt".
  if (/(?:^|[^\p{L}\p{N}_])(?:вы\s+должны|ви\s+винні)\s+(?:оплатить\s+|сплатити\s+)?-?\d/iu.test(body)) {
    return true;
  }

  // JS \b / \w are ASCII-centric. Use Unicode boundaries for RU/UA debt words.
  const debtRe = /(?:^|[^\p{L}\p{N}_])(?:долг\p{L}*|задолженност\p{L}*|борг\p{L}*|заборгован\p{L}*|винен|повинен|owe|debt)(?=$|[^\p{L}\p{N}_])/giu;
  for (const match of body.matchAll(debtRe)) {
    const index = Number(match.index || 0);
    const prefix = body.slice(Math.max(0, index - 70), index);

    // Allow explanatory negation such as "это не долг" or
    // "нельзя автоматически считать долгом".
    const negated = /(?:^|[^\p{L}\p{N}_])(?:не\s+(?:является\s+|означает\s+|обязательно\s+)?|нельзя(?:\s+\p{L}+){0,3}\s+считать\s+|не\s+следует\s+считать\s+|не\s+могу\s+подтвердить\s+|не\s+подтвержден\p{L}*\s*)$/iu.test(prefix);
    if (negated) continue;
    return true;
  }
  return false;
}

function mentionsTemporary(reply) {
  return /(?:временн\p{L}*|тимчасов\p{L}*)\s*плат\p{L}*|temporary\s*payment/iu.test(text(reply));
}

function toolSources(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : [])
    .map(item => String(item?.source || item?.tool || '').trim())
    .filter(Boolean);
}

function toolFamilyAllowed(item, allowed = []) {
  const set = new Set((Array.isArray(allowed) ? allowed : []).map(value => String(value).trim()).filter(Boolean));
  if (!set.size) return true;
  const candidates = [item?.source, item?.tool]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return candidates.some(value => set.has(value));
}

function containsForbiddenClaim(reply, claims = []) {
  const body = text(reply).toLocaleLowerCase();
  return (Array.isArray(claims) ? claims : []).find(claim => {
    const needle = String(claim || '').trim().toLocaleLowerCase();
    return needle && body.includes(needle);
  }) || null;
}

/**
 * @param {object} input
 * @param {object} input.caseExpect - fixture.expect
 * @param {object} [input.evidence]
 * @param {string} [input.reply]
 * @param {object[]} [input.toolTrace]
 * @param {string[]} [input.priorAssistantTexts]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function evaluateFinanceBehavior({
  caseExpect = {},
  evidence = {},
  reply = '',
  toolTrace = [],
  priorAssistantTexts = []
} = {}) {
  const failures = [];
  const body = text(reply);
  const amounts = moneyMentions(body);
  const afterTariff = evidenceValue(evidence, 'subscriber.finance.balance.afterTariff');
  const account = evidenceValue(evidence, 'subscriber.finance.balance.account');
  const temporaryStatus = evidenceStatus(evidence, 'subscriber.finance.temporaryPayment');
  const temporaryValue = evidenceValue(evidence, 'subscriber.finance.temporaryPayment');

  if (caseExpect.mustNotPresentAsCurrentBalance?.includes('subscriber.finance.balance.afterTariff')) {
    if (Number.isFinite(Number(afterTariff)) && amounts.includes(Number(afterTariff))) {
      if (/(?:на\s+счету|на\s+рахунку|сейчас\s+на\s+счете|по\s+балансу\s+сейчас).{0,40}/i.test(body)
        && new RegExp(String(afterTariff).replace('.', '[,.]')).test(body)
        && !/после\s+(?:учёта|учета|тариф)|з\s+урахуванням|после\s+списан/i.test(body)) {
        failures.push('balanceAfterTariff presented like current account balance');
      }
    }
  }

  for (const path of Array.isArray(caseExpect.mustReferenceFields) ? caseExpect.mustReferenceFields : []) {
    const value = evidenceValue(evidence, path);
    if (Number.isFinite(Number(value)) && !amounts.includes(Number(value))) {
      failures.push(`${path} value not reflected in reply`);
    }
  }

  const forbiddenClaim = containsForbiddenClaim(body, caseExpect.mustNotClaim);
  if (forbiddenClaim) {
    failures.push(`forbidden claim present: ${forbiddenClaim}`);
  }

  if (caseExpect.mustNotClaimDebtWithoutEvidence || caseExpect.mustNotConfirmDebtFromAfterTariffAlone) {
    if (claimsDebt(body)) {
      const onlyAfterTariffNegative = Number(afterTariff) < 0 && !(Number(account) < 0);
      if (onlyAfterTariffNegative || caseExpect.mustNotConfirmDebtFromAfterTariffAlone) {
        failures.push('debt wording without sufficient evidence');
      }
    }
  }

  if (caseExpect.mustNotInventTemporaryPayment || caseExpect.mayUseTemporaryPaymentInExplanation === false) {
    if (mentionsTemporary(body) && temporaryStatus !== 'known') {
      failures.push('temporaryPayment mentioned without known evidence');
    }
  }

  if (caseExpect.mayUseTemporaryPaymentInExplanation && caseExpect.temporaryPaymentRequiredInEvidence) {
    if (temporaryStatus !== 'known' || temporaryValue == null) {
      failures.push('fixture requires known temporaryPayment evidence');
    }
  }

  if (caseExpect.mustNotTreatTemporaryAsOwnMoney && mentionsTemporary(body)) {
    if (/(?:ваши|твои|власн\p{L}*)\s+деньг|(?:ваши|твои|ваші)\s+грош|own\s+money/iu.test(body)) {
      failures.push('temporaryPayment treated as subscriber own money');
    }
  }

  if (caseExpect.customerClaimAsFact === false) {
    if (/в\s+Billing\s+подтверждено,?\s+что\s+вы\s+оплатили/i.test(body)
      || /платёж\s+точно\s+зачислен\s+по\s+вашим\s+словам/i.test(body)) {
      failures.push('customer claim treated as verified Billing fact');
    }
  }

  if (caseExpect.priorAssistantIsNotEvidence) {
    for (const prior of priorAssistantTexts || []) {
      const snippet = text(prior).slice(0, 80);
      if (snippet && body.includes(snippet) && /как\s+я\s+говорил|ранее\s+я\s+указал|мы\s+уже\s+установили/i.test(body)) {
        failures.push('prior assistant reply used as authoritative evidence');
      }
    }
  }

  if (Number.isFinite(Number(caseExpect.maxToolSources))) {
    const sources = new Set(toolSources(toolTrace));
    if (sources.size > Number(caseExpect.maxToolSources)) {
      failures.push(`too many tool sources: ${sources.size} > ${caseExpect.maxToolSources}`);
    }
  }

  if (Array.isArray(caseExpect.allowedToolFamilies) && caseExpect.allowedToolFamilies.length) {
    for (const item of Array.isArray(toolTrace) ? toolTrace : []) {
      if (!toolFamilyAllowed(item, caseExpect.allowedToolFamilies)) {
        failures.push(`disallowed tool source: ${String(item?.source || item?.tool || 'unknown')}`);
      }
    }
  }

  if (caseExpect.replyMode === 'simple' && body.length > 420) {
    failures.push('simple reply mode but reply is long');
  }

  return { ok: failures.length === 0, failures };
}

export function loadFinanceL2Cases(json) {
  const cases = Array.isArray(json?.cases) ? json.cases : [];
  return cases.map(item => ({
    id: item.id,
    customerTexts: item.customerTexts || [],
    taskClass: item.taskClass,
    evidence: item.evidence || {},
    expect: item.expect || {}
  }));
}
