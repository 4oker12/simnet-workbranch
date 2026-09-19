'use strict';

function oneLine(value, max = 600) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 2600) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function requestFrom({ analysis = {}, latestCustomer = {} } = {}) {
  const probe = analysis?.probe || {};
  const unresolved = Array.isArray(probe?.unresolvedRequests) ? probe.unresolvedRequests : [];
  return oneLine(unresolved.join(' ') || probe?.whatUserWants || latestCustomer?.text || '', 800);
}

function successfulTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => item?.ok);
}

function failedTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => !item?.ok);
}

function nonIdentityTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => !['customer.lookup', 'customer.confirm'].includes(String(item?.tool || '')));
}

function requestedText(item = {}) {
  return `${oneLine(item?.requestedBy?.field || '', 320)} ${oneLine(item?.requestedBy?.why || '', 420)}`.toLowerCase();
}

function hasOwn(data = {}, key = '', { allowEmpty = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.prototype.hasOwnProperty.call(data, key)) return false;
  const value = data[key];
  if (allowEmpty) return value !== undefined && value !== null;
  if (Array.isArray(value)) return true;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function hasAny(data = {}, keys = [], options = {}) {
  return keys.some(key => hasOwn(data, key, options));
}

function meaningfulGenericData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.entries(data).some(([key, value]) => {
    if (/^(?:source|observedAt|evidence|message|warning|warnings)$/i.test(key)) return false;
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return true;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

function tariffText(data = {}) {
  return oneLine(data?.currentTariff || data?.tariffDisplay || '', 420);
}

function requestedFactCovered(item = {}) {
  if (!item?.ok) return false;
  const tool = String(item?.tool || '');
  if (['customer.lookup', 'customer.confirm'].includes(tool)) return true;

  const data = item?.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  const request = requestedText(item);

  if (tool === 'billing.balance') {
    const asksPaymentMoment = /(?:дата|когда|коли|последн|останн).{0,40}(?:плат[её]ж|платіж|оплат|payment)|(?:плат[её]ж|платіж|оплат|payment).{0,40}(?:дата|когда|коли|последн|останн)/iu.test(request);
    if (asksPaymentMoment) return false;
    if (/долг|борг|задолж|заборг|к\s+оплат|до\s+сплат|total\s*due/iu.test(request)) return hasOwn(data, 'totalDue');
    if (/временн.*плат|тимчасов.*плат|temporary/iu.test(request)) return hasOwn(data, 'temporaryPayment', { allowEmpty: true });
    if (/цен|стоим|варт|абонплат|price/iu.test(request)) return hasOwn(data, 'price');
    if (/баланс|balance|на\s+сч[её]т|на\s+рахунк/iu.test(request)) return hasOwn(data, 'accountBalance');
    return hasAny(data, ['accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment', 'totalDue', 'price']);
  }

  if (tool === 'billing.tariff') {
    if (/скорост|швидк|speed/iu.test(request)) {
      return hasAny(data, ['speed', 'tariffSpeed', 'speedMbit', 'speedMbps'])
        || /\b\d+(?:[.,]\d+)?\s*(?:m(?:bit|bps)|мб(?:ит|іт)(?:\/с)?|гб(?:ит|іт)(?:\/с)?)/iu.test(tariffText(data));
    }
    if (/цен|стоим|варт|абонплат|price|сколько\s+стоит|скільки\s+кошту/iu.test(request)) {
      return hasOwn(data, 'price') || /^\s*тариф\s+\d+(?:[.,]\d+)?\b/iu.test(tariffText(data));
    }
    if (/следующ|наступн|next|future/iu.test(request)) return hasOwn(data, 'nextTariff', { allowEmpty: true });
    if (/тариф|tariff|пакет/iu.test(request)) return hasAny(data, ['currentTariff', 'tariffDisplay']);
    return hasAny(data, ['currentTariff', 'tariffDisplay', 'price', 'nextTariff'], { allowEmpty: true });
  }

  if (tool === 'billing.payments') {
    return Array.isArray(data.payments) || hasOwn(data, 'count', { allowEmpty: true });
  }

  if (tool === 'building.snapshot') {
    if (/gpon|epon|\bpon\b|оптик|fiber|покрыт|покрит|coverage/iu.test(request)) {
      const fields = data?.fields && typeof data.fields === 'object' && !Array.isArray(data.fields) ? data.fields : {};
      if (Object.keys(fields).some(key => /^(?:gpon|epon|pon|оптика)$/iu.test(String(key).trim()))) return true;
      return (Array.isArray(data?.fieldList) ? data.fieldList : []).some(item => /^(?:gpon|epon|pon|оптика)$/iu.test(oneLine(item?.key || item?.label, 80)));
    }
    return meaningfulGenericData(data);
  }

  if (tool === 'network.session') {
    if (/\bip\b/iu.test(request)) return hasAny(data, ['subscriberIp', 'ip']);
    if (/\bmac\b/iu.test(request)) return hasAny(data, ['subscriberMac', 'mac']);
    if (/\bvlan\b/iu.test(request)) return hasOwn(data, 'vlan', { allowEmpty: true });
    if (/сесс|сесі|онлайн|online|статус|авторизац/iu.test(request)) return hasAny(data, ['status', 'isOnline', 'isActive', 'authorizationType'], { allowEmpty: true });
    return meaningfulGenericData(data);
  }

  if (tool === 'pon.signal') {
    if (/\brx\b|прием|прийом/iu.test(request)) return hasAny(data, ['onuRx', 'oltRx', 'rx']);
    if (/\btx\b|передач/iu.test(request)) return hasAny(data, ['onuTx', 'tx']);
    return hasAny(data, ['onuRx', 'onuTx', 'oltRx', 'rx', 'tx']);
  }

  if (tool === 'pon.onu') {
    if (/\bolt\b/iu.test(request)) return hasAny(data, ['oltName', 'oltIp', 'oltDeviceId', 'olt']);
    if (/порт|interface/iu.test(request)) return hasAny(data, ['interface', 'port']);
    if (/\bonu\b|\bont\b|serial|серийн/iu.test(request)) return hasAny(data, ['serial', 'onuSerial', 'onu', 'ont']);
    return meaningfulGenericData(data);
  }

  return meaningfulGenericData(data);
}

function confirmedTrace(toolTrace = []) {
  return successfulTrace(toolTrace).filter(requestedFactCovered);
}

function uncoveredSuccessfulTrace(toolTrace = []) {
  return successfulTrace(toolTrace).filter(item => !requestedFactCovered(item));
}

function injectedKnowledgePrefixes(analysis = {}) {
  const relevant = Array.isArray(analysis?.knowledge?.relevantInternalKnowledge)
    ? analysis.knowledge.relevantInternalKnowledge
    : [];
  const prefixes = [];
  for (const item of relevant) {
    const raw = String(item || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    prefixes.push(raw);
    prefixes.push(raw.slice(0, 600).trim());
  }
  return [...new Set(prefixes.filter(Boolean))].sort((a, b) => b.length - a.length);
}

function stripAutoInjectedKnowledgePrefix(reply = '', analysis = {}, toolTrace = []) {
  let text = block(reply, 2200);
  if (!text || !successfulTrace(toolTrace).length) return text;

  for (const prefix of injectedKnowledgePrefixes(analysis)) {
    if (!text.startsWith(prefix)) continue;
    text = text.slice(prefix.length).replace(/^\s+/, '').trim();
    break;
  }
  return text;
}

function keptItems(toolTrace = []) {
  return confirmedTrace(toolTrace).slice(0, 12).map(item => {
    const field = oneLine(item?.requestedBy?.field || '', 240);
    const why = oneLine(item?.requestedBy?.why || '', 360);
    const tool = oneLine(item?.tool || '', 120);
    return {
      fact: field ? `${field} подтверждено возвращённым READ-полем` : `${tool || 'READ'} вернул данные по запросу`,
      source: tool ? `tool:${tool}` : 'tool',
      reason: why || 'Запрошенный факт реально присутствует в результате READ.'
    };
  });
}

function droppedItems(toolTrace = []) {
  const failed = failedTrace(toolTrace).slice(0, 8).map(item => ({
    fact: oneLine(item?.requestedBy?.field || item?.tool || 'неполученный READ-факт', 300),
    source: item?.tool ? `tool:${oneLine(item.tool, 120)}` : 'tool',
    reason: `READ не подтвердил факт (${oneLine(item?.code || 'ERROR', 120)}); ошибка источника не превращается в отрицательный факт.`
  }));
  const uncovered = uncoveredSuccessfulTrace(toolTrace).slice(0, Math.max(0, 8 - failed.length)).map(item => ({
    fact: oneLine(item?.requestedBy?.field || item?.tool || 'неполученный READ-факт', 300),
    source: item?.tool ? `tool:${oneLine(item.tool, 120)}` : 'tool',
    reason: 'READ выполнился успешно, но конкретно запрошенный факт отсутствует в возвращённых полях; ok=true не считается подтверждением этого факта.'
  }));
  return [...failed, ...uncovered];
}

function completeness(toolTrace = [], reply = '') {
  if (!block(reply, 2200)) return 'unknown';
  const requested = nonIdentityTrace(toolTrace);
  if (!requested.length) return 'unknown';
  const covered = requested.filter(requestedFactCovered).length;
  if (covered === requested.length) return 'complete';
  if (covered > 0) return 'partial';
  return 'unknown';
}

function currentBalanceTrace(toolTrace = []) {
  return confirmedTrace(toolTrace).find(item => {
    if (item?.tool !== 'billing.balance') return false;
    const field = oneLine(item?.requestedBy?.field || '', 240).toLowerCase();
    return /баланс|balance/.test(field) && !/долг|задолж|борг|к\s+оплат|до\s+сплат|after|due/.test(field);
  }) || null;
}

function currentTariffTrace(toolTrace = []) {
  return confirmedTrace(toolTrace).find(item => {
    if (item?.tool !== 'billing.tariff') return false;
    const field = oneLine(item?.requestedBy?.field || '', 240).toLowerCase();
    return /тариф|tariff|пакет/.test(field) && !/скорост|швидк|цен|стоим|варт|абонплат|next|future|следующ|наступн/.test(field);
  }) || null;
}

function tariffPriceTrace(toolTrace = []) {
  return confirmedTrace(toolTrace).find(item => {
    if (item?.tool !== 'billing.tariff') return false;
    const field = oneLine(item?.requestedBy?.field || '', 280).toLowerCase();
    return /цен|стоим|варт|абонплат|price|сколько\s+стоит|скільки\s+кошту/.test(field);
  }) || null;
}

function clientTariffName(value) {
  return oneLine(value, 240)
    .replace(/\s*-\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/u, '')
    .trim();
}

function tariffPrice(data = {}) {
  if (hasOwn(data, 'price')) {
    const numeric = Number(data.price);
    if (Number.isFinite(numeric)) return Math.round(numeric * 100) / 100;
  }
  const match = tariffText(data).match(/^\s*тариф\s+(\d+(?:[.,]\d+)?)\b/iu);
  if (!match?.[1]) return null;
  const numeric = Number(match[1].replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function deterministicConfirmedFactsRecovery({ analysis = {}, latestCustomer = {}, toolTrace = [] } = {}) {
  const request = requestFrom({ analysis, latestCustomer }).toLowerCase();
  const wantsBalance = /баланс|balance|рахун/.test(request);
  const wantsTariffPrice = /(?:тариф|пакет).{0,40}(?:цен|стоим|варт|абонплат|сколько\s+стоит|скільки\s+кошту)|(?:цен|стоим|варт|абонплат).{0,40}(?:тариф|пакет)/iu.test(request);
  const wantsTariffName = /(?:какой|який|мой|мій|текущ|поточн).{0,40}(?:тариф|пакет)|(?:тариф|пакет).{0,30}(?:сейчас|зараз|у\s+меня|у\s+мене)|(?:что|що).{0,20}по\s+(?:тариф|пакет)/iu.test(request)
    || (/(?:тариф|tariff|пакет)/iu.test(request) && !wantsTariffPrice && !/скорост|швидк|speed/iu.test(request));
  if (!wantsBalance && !wantsTariffName && !wantsTariffPrice) return null;

  const balanceTrace = wantsBalance ? currentBalanceTrace(toolTrace) : null;
  const tariffTrace = wantsTariffName ? currentTariffTrace(toolTrace) : null;
  const priceTrace = wantsTariffPrice ? tariffPriceTrace(toolTrace) : null;
  if (wantsBalance && !balanceTrace) return null;
  if (wantsTariffName && !tariffTrace) return null;
  if (wantsTariffPrice && !priceTrace) return null;

  const parts = [];
  if (balanceTrace) {
    const raw = balanceTrace?.data?.accountBalance;
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) return null;
    parts.push(`Текущий баланс: ${Math.round(Number(raw) * 100) / 100} грн.`);
  }
  if (tariffTrace) {
    const tariff = clientTariffName(tariffTrace?.data?.currentTariff || tariffTrace?.data?.tariffDisplay);
    if (!tariff) return null;
    parts.push(`Текущий тариф: ${tariff}.`);
  }
  if (priceTrace) {
    const price = tariffPrice(priceTrace?.data || {});
    if (price === null) return null;
    parts.push(`Стоимость тарифа: ${price} грн.`);
  }

  return parts.length ? parts.join(' ') : null;
}

export async function applyAnswerRelevanceGate({
  reply = '',
  analysis = {},
  toolTrace = [],
  latestCustomer = {}
} = {}) {
  const request = requestFrom({ analysis, latestCustomer });
  const cleanedReply = stripAutoInjectedKnowledgePrefix(reply, analysis, toolTrace) || block(reply, 2200);
  const recoveryCandidate = deterministicConfirmedFactsRecovery({ analysis, latestCustomer, toolTrace });
  const recovered = Boolean(recoveryCandidate && oneLine(recoveryCandidate, 2200) !== oneLine(cleanedReply, 2200));
  const finalReply = recovered ? recoveryCandidate : cleanedReply;
  const kept = keptItems(toolTrace);
  const dropped = droppedItems(toolTrace);

  return {
    reply: finalReply,
    answerRelevance: {
      request,
      kept,
      dropped,
      completeness: completeness(toolTrace, finalReply),
      conclusion: recovered
        ? 'Запрошенные и реально возвращённые READ-факты восстановлены локально без соседних Billing-полей.'
        : 'Локальная relevance-проверка: semantic frame не переосмысляется отдельной LLM; ok=true считается evidence только когда конкретно запрошенный факт присутствует в результате READ.'
    },
    gate: {
      skipped: true,
      reason: recovered ? 'deterministic_confirmed_facts_recovery' : 'deterministic_local_relevance_boundary',
      degraded: false,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }
  };
}
