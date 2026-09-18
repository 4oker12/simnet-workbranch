'use strict';

function line(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeNeed(item = {}) {
  return {
    system: line(item?.system, 80),
    field: line(item?.field, 180),
    why: line(item?.why, 320)
  };
}

function requestList(analysis = {}) {
  const probe = analysis?.probe || {};
  const unresolved = (Array.isArray(probe.unresolvedRequests) ? probe.unresolvedRequests : [])
    .map(item => line(item, 500))
    .filter(Boolean);
  if (unresolved.length) return unresolved;
  const fallback = line(probe.whatUserWants || probe.latestMessageMeans, 500);
  return fallback ? [fallback] : [];
}

function explicitNeed(tool, system, request, why) {
  return {
    system,
    field: `${tool}: ${line(request, 150)}`,
    why: line(why, 300)
  };
}

function toolFromField(field = '') {
  return line(field, 220).match(/^([a-z]+(?:\.[a-z_]+)+)\s*:/i)?.[1]?.toLowerCase() || '';
}

function derivedNeedsForRequest(request = '') {
  const text = line(request, 600).toLowerCase();
  if (!text) return [];
  const needs = [];
  const add = (tool, system, why) => needs.push(explicitNeed(tool, system, request, why));

  // Availability/coverage is a building fact, not an ONU signal measurement.
  const accessTechnology = /оптик|fiber|gpon|epon|\bpon\b/i.test(text);
  const availability = /подключ|підключ|можно|можна|возмож|можлив|доступн|покрыт|покрит|coverage/i.test(text);
  if (accessTechnology && availability) {
    add('building.snapshot', 'UserSide', 'Нужно проверить доступность технологии по уже известному адресу абонента/дома.');
    return needs;
  }

  const futurePeriod = /следующ|наступн|до\s+конц|до\s+кінц|будущ|майбутн|в\s+месяц|за\s+месяц|на\s+місяць|за\s+місяць/i.test(text);
  const paymentAmount = /сколько.*плат|скільки.*плат|сумм.*оплат|сума.*оплат|абонплат/i.test(text);
  if (futurePeriod && paymentAmount) {
    add('billing.tariff', 'Billing', 'Для расчёта будущего периода нужно подтвердить текущий/следующий тариф и его цену, а затем можно выполнить обычный расчёт.');
    if (/доплат|баланс|рахун|сч[её]т/i.test(text)) add('billing.balance', 'Billing', 'Если вопрос о доплате, нужен текущий подтверждённый финансовый остаток.');
    return needs;
  }

  if (/баланс|рахун|сч[её]т|задолж|заборг|долг|сколько.*(?:платить|оплатить)|скільки.*(?:платити|сплатити)|сумм.*(?:к\s+оплат|до\s+сплат)|сума.*(?:до\s+сплат)/i.test(text)) {
    add('billing.balance', 'Billing', 'Запрос зависит от текущих финансовых данных конкретного абонента.');
  }
  if (/текущ.*тариф|поточн.*тариф|какой.*тариф|який.*тариф|мой.*тариф|мій.*тариф|тариф.*(?:абон|договор|договір)|пакет.*(?:абон|договор|договір)|тарифн.*скорост|тарифн.*швидк|какой.*скорост|яка.*швидк/i.test(text)) {
    add('billing.tariff', 'Billing', 'Запрос зависит от текущего тарифа конкретного абонента.');
  }
  if (/плат[её]ж|платіж|пополн|поповнен|зачисл|зарахув|истори.*оплат|істор.*оплат/i.test(text)) {
    add('billing.payments', 'Billing', 'Нужно проверить подтверждённые операции Billing, а не предполагать факт платежа.');
  }
  if (/сесс|сесі|авторизац|dhcp|bras|juniper|\bvlan\b|текущ.*\bip\b|поточн.*\bip\b|\bmac\b/i.test(text)) {
    add('network.session', 'Network', 'Нужен текущий сетевой факт по подтверждённому абоненту.');
  }
  if (/\brx\b|\btx\b|dbm|сигнал|сигналу|затух/i.test(text)) {
    add('pon.signal', 'UserSide', 'Нужны текущие оптические показатели конкретной PON-линии.');
  } else if (/\bonu\b|\bont\b|\bolt\b|порт.*(?:pon|onu|olt)|(?:pon|gpon|epon).*порт/i.test(text)) {
    add('pon.onu', 'UserSide', 'Нужны ONU/OLT/портовые данные конкретного подключения.');
  }
  if (/точк.*подключ|точк.*підключ|коммут|ethernet|userside|user\s*side|тмц|tmc/i.test(text)) {
    add('userside.snapshot', 'UserSide', 'Нужен технический снимок конкретного подключения в UserSide.');
  }
  if (/по\s+договор|за\s+договор|данн.*договор|дані.*договор|карточк.*абон|картк.*абон/i.test(text)) {
    add('customer.snapshot', 'Billing', 'Нужны текущие данные карточки уже идентифицированного договора.');
  }

  return needs;
}

export function recoverLiveDataNeeds({ analysis = {}, draft = {} } = {}) {
  const existing = (Array.isArray(draft?.subscriberDataNeeded) ? draft.subscriberDataNeeded : [])
    .map(normalizeNeed)
    .filter(item => item.system || item.field || item.why);
  const liveNeed = line(analysis?.probe?.liveDataNeed || analysis?.probe?.live_data_need, 20).toLowerCase();
  const requests = requestList(analysis);
  const derived = requests.flatMap(derivedNeedsForRequest);
  const recoveryAllowed = liveNeed === 'needed' || derived.length > 0;
  if (!recoveryAllowed) return existing;

  const merged = [];
  const seen = new Set();
  for (const need of [...existing, ...derived]) {
    const normalized = normalizeNeed(need);
    const key = toolFromField(normalized.field) || `${normalized.system.toLowerCase()}|${normalized.field.toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  if (!merged.length && liveNeed === 'needed') {
    const request = requests[0] || 'текущие данные абонента';
    merged.push(explicitNeed(
      'customer.snapshot',
      'Billing',
      request,
      'Semantic understanding пометил запрос как зависящий от live-данных; нужен общий подтверждённый snapshot текущего абонента.'
    ));
  }

  return merged.slice(0, 6);
}

export const LIVE_NEED_RECOVERY_VERSION = 3;
