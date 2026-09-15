import { futurePaymentHorizonFromText } from './future-payment-calculator.js';

function normalized(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function latestToolResult(toolResults = [], tool = '') {
  return [...(Array.isArray(toolResults) ? toolResults : [])]
    .reverse()
    .find(item => String(item?.tool || '') === tool) || null;
}

function money(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} грн`;
}

function numeric(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isUk(value) {
  return /[іїєґ]|(?:скільки|рахунк|місяц|оплатити|договір)/i.test(String(value || ''));
}

function decision(action, intent, reply = '', tool = '', toolArgs = {}, reason = '') {
  return {
    action,
    domain: ['balance', 'monthly_payment', 'future_payment'].includes(intent) ? 'finance' : 'account',
    intent,
    language: '',
    tool,
    toolArgs,
    reply,
    reason,
    confidence: 1,
    model: 'deterministic-basic-router'
  };
}

function explicitLookup(text) {
  const login = String(text || '').match(/abon\s*\d{3,12}/i)?.[0]?.replace(/\s+/g, '').toLowerCase();
  if (login) return { query: login };

  const source = String(text || '');
  const contractAfter = source.match(/(?:договор|договір|контракт)(?:\s*(?:№|номер))?\s*[:#№-]?\s*(\d{3,12})/i)?.[1];
  const contractBefore = source.match(/(\d{3,12}).{0,20}(?:мой\s+договор|мій\s+договір|это\s+договор|це\s+договір)/i)?.[1];
  const contract = contractAfter || contractBefore || '';
  return contract ? { contract } : null;
}

function confirmationValue(value) {
  const text = normalized(value).replace(/[.!?]+$/g, '').trim();
  if (/^(?:да|так|верно|вірно|yes|ага|угу)$/.test(text)) return true;
  if (/^(?:нет|ні|no|не\s+мой|не\s+мій)$/.test(text)) return false;
  return null;
}

function confirmationReply(candidate = {}, uk = false) {
  const contract = String(candidate.contract || '').trim();
  const address = String(candidate.address || '').trim();
  const target = [
    contract ? (uk ? `договір ${contract}` : `договор ${contract}`) : '',
    address ? (uk ? `за адресою ${address}` : `по адресу ${address}`) : ''
  ].filter(Boolean).join(' ');
  return uk
    ? `Знайшов ${target || 'підключення'}. Це ваше підключення?`
    : `Нашёл ${target || 'подключение'}. Это ваше подключение?`;
}

function serviceBreakdown(data = {}, uk = false) {
  const parts = [];
  const base = money(data.baseTariffAmount);
  if (base) parts.push(uk ? `інтернет ${base}` : `интернет ${base}`);
  for (const item of Array.isArray(data.activeServices) ? data.activeServices : []) {
    const amount = money(item?.amount);
    if (!amount) continue;
    const name = String(item?.name || '').replace(/\s+/g, ' ').trim() || (uk ? 'додаткова послуга' : 'доп. услуга');
    parts.push(`${name} ${amount}`);
  }
  return parts;
}

function stripInternalTariffDate(value) {
  return String(value || '')
    .replace(/\s*-\s*\(\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*\)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tariffHumanSummary(rawTariff, uk = false) {
  const tariff = stripInternalTariffDate(rawTariff);
  if (!tariff) return '';

  const pricedSpeed = tariff.match(/^тариф\s+(\d+(?:[.,]\d+)?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:mbit|мбит(?:\/с)?)\s*\)$/iu);
  if (pricedSpeed) {
    const price = pricedSpeed[1].replace(',', '.');
    const speed = pricedSpeed[2].replace(',', '.');
    return uk
      ? `У вас тариф ${price} грн, швидкість до ${speed} Мбіт/с.`
      : `У вас тариф ${price} грн, скорость до ${speed} Мбит/с.`;
  }

  return uk
    ? `Ваш поточний тариф — «${tariff}».`
    : `Ваш текущий тариф — «${tariff}».`;
}

function tariffPaymentContext(balanceResult, uk = false) {
  if (!balanceResult?.ok) return '';
  const afterTariff = numeric(balanceResult?.data?.balanceAfterTariff);
  if (afterTariff === null || afterTariff < 0) return '';
  return uk
    ? ' Поточний місяць за тарифом оплачено.'
    : ' Текущий месяц по тарифу оплачен.';
}

function tariffReply(tariffResult, balanceResult, uk = false) {
  const summary = tariffHumanSummary(tariffResult?.data?.currentTariff, uk);
  if (!summary) {
    return uk ? 'Поточний тариф у Billing не знайдено.' : 'Текущий тариф в Billing не найден.';
  }
  return `${summary}${tariffPaymentContext(balanceResult, uk)}`.trim();
}

function futurePaymentReply(result, horizon, uk) {
  const data = result?.data || {};
  if (!result?.ok) {
    const message = String(data.message || result?.warnings?.[0] || '').trim();
    if (message) return message;
    return uk ? 'Точний розрахунок зараз недоступний.' : 'Точный расчёт сейчас недоступен.';
  }

  const monthly = money(data.monthlyRecurringTotal);
  const charges = money(data.futureCharges);
  const balance = money(data.accountBalance);
  const topUp = money(data.requiredTopUpNow);
  const breakdown = serviceBreakdown(data, uk);

  if (horizon?.kind === 'monthly') {
    if (breakdown.length >= 2) {
      return uk
        ? `Зараз щомісячно ${monthly}: ${breakdown.join(' + ')}.`
        : `Сейчас в месяц ${monthly}: ${breakdown.join(' + ')}.`;
    }
    return uk ? `Зараз щомісячна сума — ${monthly}.` : `Сейчас ежемесячная сумма — ${monthly}.`;
  }

  if (horizon?.kind === 'next_month') {
    const base = breakdown.length >= 2
      ? (uk ? `На наступний місяць — ${monthly}: ${breakdown.join(' + ')}.` : `На следующий месяц — ${monthly}: ${breakdown.join(' + ')}.`)
      : (uk ? `На наступний місяць — ${monthly}.` : `На следующий месяц — ${monthly}.`);
    if (balance && topUp) {
      return uk
        ? `${base} На рахунку зараз ${balance}, тому поповнити потрібно на ${topUp}.`
        : `${base} На счёте сейчас ${balance}, поэтому пополнить нужно на ${topUp}.`;
    }
    return base;
  }

  const months = Number(data.months || 0);
  const year = Number(data.targetYear || data.currentYear || 0);
  const formula = `${months} × ${monthly} = ${charges}`;
  let text = uk
    ? `До кінця ${year} року залишилось ${months} міс. За поточної вартості: ${formula}.`
    : `До конца ${year} года осталось ${months} мес. При текущей стоимости: ${formula}.`;
  if (balance && topUp) {
    text += uk
      ? ` На рахунку зараз ${balance}, тому поповнити потрібно на ${topUp}.`
      : ` На счёте сейчас ${balance}, поэтому доплатить нужно ${topUp}.`;
  }
  return text;
}

export function routeBasicCase({ customerText = '', latestCustomerText = '', labState = {}, toolResults = [] } = {}) {
  const text = normalized(customerText);
  if (!text) return null;
  const uk = isUk(customerText || latestCustomerText);
  const confirmed = Boolean(String(labState?.confirmedCaseId || '').trim());
  const pending = labState?.pendingCandidate && typeof labState.pendingCandidate === 'object'
    ? labState.pendingCandidate
    : null;

  if (!confirmed && pending) {
    const confirmation = confirmationValue(latestCustomerText);
    if (confirmation !== null) {
      return decision(
        'tool_required',
        'confirm_identity',
        '',
        'customer.confirm',
        { confirmed: confirmation },
        'Deterministic subscriber confirmation.'
      );
    }
    return decision('ask', 'confirm_identity', confirmationReply(pending, uk), '', {}, 'One candidate requires confirmation.');
  }

  if (!confirmed) {
    const lookup = explicitLookup(customerText);
    if (lookup) {
      return decision('tool_required', 'identify_subscriber', '', 'customer.lookup', lookup, 'Explicit subscriber identifier in a basic request.');
    }
    return null;
  }

  const horizon = futurePaymentHorizonFromText(customerText);
  if (horizon) {
    const existing = latestToolResult(toolResults, 'billing.future_payment');
    if (!existing) {
      return decision(
        'tool_required',
        'future_payment',
        '',
        'billing.future_payment',
        { horizon, query: customerText },
        'Basic finance question: calculate recurring payment deterministically.'
      );
    }
    return decision('reply', 'future_payment', futurePaymentReply(existing, horizon, uk), '', {}, 'Deterministic future-payment result.');
  }

  if (/(?:баланс|на\s+счету|на\s+рахунку|сколько\s+денег|скільки\s+грошей)/i.test(text)) {
    const existing = latestToolResult(toolResults, 'billing.balance');
    if (!existing) return decision('tool_required', 'balance', '', 'billing.balance', {}, 'Basic balance question.');
    const amount = money(existing?.data?.accountBalance);
    const reply = amount
      ? (uk ? `На рахунку зараз ${amount}.` : `На счёте сейчас ${amount}.`)
      : (uk ? 'Поточний баланс у Billing не знайдено.' : 'Текущий баланс в Billing не найден.');
    return decision('reply', 'balance', reply, '', {}, 'Deterministic balance answer.');
  }

  if (/(?:какой|який|мой|мій).{0,30}тариф|тариф\s*(?:сейчас|зараз|у\s+меня|у\s+мене)|(?:что|що).{0,18}по\s+тариф/i.test(text)) {
    const tariffResult = latestToolResult(toolResults, 'billing.tariff');
    if (!tariffResult) return decision('tool_required', 'current_tariff', '', 'billing.tariff', {}, 'Basic tariff question.');

    const balanceResult = latestToolResult(toolResults, 'billing.balance');
    if (!balanceResult) {
      return decision(
        'tool_required',
        'current_tariff_context',
        '',
        'billing.balance',
        {},
        'Enrich basic tariff answer with current payment context when Billing exposes it.'
      );
    }

    return decision(
      'reply',
      'current_tariff',
      tariffReply(tariffResult, balanceResult, uk),
      '',
      {},
      'Deterministic client-facing tariff summary without internal tariff metadata.'
    );
  }

  if (/(?:номер|№).{0,20}(?:договора|договору)|(?:мой|мій).{0,15}(?:договор|договір)/i.test(text)) {
    const contract = String(labState?.confirmedSubscriber?.contract || '').trim();
    if (contract) {
      return decision('reply', 'contract_number', uk ? `Номер вашого договору — ${contract}.` : `Номер вашего договора — ${contract}.`, '', {}, 'Confirmed subscriber contract.');
    }
  }

  if (/(?:как|як).{0,25}(?:оплатить|оплатити|пополнить|поповнити)/i.test(text)) {
    const contract = String(labState?.confirmedSubscriber?.contract || '').trim();
    const suffix = contract
      ? (uk ? ` Вкажіть номер договору ${contract}.` : ` Укажите номер договора ${contract}.`)
      : '';
    const reply = uk
      ? `Можна оплатити через онлайн-банкінг: Платежі/Послуги → Інтернет → SIMNET.${suffix}`
      : `Можно оплатить через онлайн-банкинг: Платежи/Услуги → Интернет → SIMNET.${suffix}`;
    return decision('reply', 'payment_method', reply, '', {}, 'Basic payment instructions.');
  }

  return null;
}
