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

function isUk(value) {
  return /[іїєґ]|\b(?:скільки|рахунк|місяц|тариф|оплатити|договір)\b/i.test(String(value || ''));
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
      ? (uk ? `Наступний місяць — ${monthly}: ${breakdown.join(' + ')}.` : `На следующий месяц — ${monthly}: ${breakdown.join(' + ')}.`)
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

export function routeBasicCase({ customerText = '', labState = {}, toolResults = [] } = {}) {
  const text = normalized(customerText);
  if (!text || !String(labState?.confirmedCaseId || '').trim()) return null;
  const uk = isUk(customerText);

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

  if (/\b(?:баланс|на\s+счету|на\s+рахунку|сколько\s+денег|скільки\s+грошей)\b/i.test(text)) {
    const existing = latestToolResult(toolResults, 'billing.balance');
    if (!existing) return decision('tool_required', 'balance', '', 'billing.balance', {}, 'Basic balance question.');
    const amount = money(existing?.data?.accountBalance);
    const reply = amount
      ? (uk ? `На рахунку зараз ${amount}.` : `На счёте сейчас ${amount}.`)
      : (uk ? 'Поточний баланс у Billing не знайдено.' : 'Текущий баланс в Billing не найден.');
    return decision('reply', 'balance', reply, '', {}, 'Deterministic balance answer.');
  }

  if (/\b(?:какой|який|мой|мій)\b.{0,30}\bтариф\b|\bтариф\s*(?:сейчас|зараз|у\s+меня|у\s+мене)\b/i.test(text)) {
    const existing = latestToolResult(toolResults, 'billing.tariff');
    if (!existing) return decision('tool_required', 'current_tariff', '', 'billing.tariff', {}, 'Basic tariff question.');
    const tariff = String(existing?.data?.currentTariff || '').trim();
    const reply = tariff
      ? (uk ? `Ваш поточний тариф — «${tariff}».` : `Ваш текущий тариф — «${tariff}».`)
      : (uk ? 'Поточний тариф у Billing не знайдено.' : 'Текущий тариф в Billing не найден.');
    return decision('reply', 'current_tariff', reply, '', {}, 'Deterministic tariff answer.');
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
