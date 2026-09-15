import { futurePaymentHorizonFromText } from './future-payment-calculator.js';

const FUTURE_PAYMENT_RE = /(?:следующ(?:ий|его|ем|ую)|наступн(?:ий|ого|ому|ий)|до\s+конц[аы]|до\s+кінц[яю]|до\s+кінця|майбутн|будущ|вперед|наперед).{0,60}(?:месяц|місяц|год|рік|202\d)|(?:сколько|скільки).{0,80}(?:следующ|наступн|до\s+конц|до\s+кінц)/i;

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestToolResult(toolResults = [], toolName = '') {
  return [...(Array.isArray(toolResults) ? toolResults : [])]
    .reverse()
    .find(item => String(item?.tool || '') === toolName) || null;
}

function isUkrainian(decision = {}, customerText = '') {
  if (String(decision?.language || '').toLowerCase() === 'uk') return true;
  return /[іїєґ]/i.test(String(customerText || ''));
}

function money(value) {
  const number = asNumber(value);
  if (number === null) return '';
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} грн`;
}

function decisionRequestsFutureAmount(decision = {}) {
  const intent = String(decision?.intent || '').toLowerCase();
  return /(?:next|future).*(?:payment|charge|amount)|(?:payment|charge|amount).*(?:next|future)/i.test(intent);
}

export function isFuturePaymentQuestion(value) {
  return FUTURE_PAYMENT_RE.test(String(value || '').replace(/\s+/g, ' ').trim());
}

export function hasConfirmedFutureAmount(toolResults = []) {
  const deterministic = latestToolResult(toolResults, 'billing.future_payment');
  if (deterministic?.ok) {
    const data = deterministic?.data && typeof deterministic.data === 'object' ? deterministic.data : {};
    if ([data.futureCharges, data.monthlyRecurringTotal, data.requiredTopUpNow]
      .some(value => asNumber(value) !== null)) return true;
  }

  const nextCharge = latestToolResult(toolResults, 'billing.next_charge');
  if (!nextCharge?.ok) return false;
  const data = nextCharge?.data && typeof nextCharge.data === 'object' ? nextCharge.data : {};
  return [data.amount, data.nextCharge, data.projectedAmount, data.requiredTopUp]
    .some(value => asNumber(value) !== null);
}

export function guardFuturePaymentDecision({ customerText = '', decision = {}, toolResults = [] } = {}) {
  if (!decision || typeof decision !== 'object') return decision;

  const futureQuestion = isFuturePaymentQuestion(customerText) || decisionRequestsFutureAmount(decision);
  if (!futureQuestion) return decision;

  if (decision.action === 'tool_required' && String(decision.tool || '') === 'billing.next_charge') {
    const horizon = futurePaymentHorizonFromText(customerText) || { kind: 'next_month', year: null };
    return {
      ...decision,
      intent: 'future_payment',
      tool: 'billing.future_payment',
      toolArgs: { horizon, query: customerText },
      reason: 'Future-payment tool routing: the model identified a future amount request; deterministic Billing calculation must provide the amount.'
    };
  }

  if (decision.action === 'tool_required' || decision.action === 'ask' || decision.intent === 'confirm_identity') return decision;
  if (hasConfirmedFutureAmount(toolResults)) return decision;

  const nextCharge = latestToolResult(toolResults, 'billing.next_charge');
  const tariff = latestToolResult(toolResults, 'billing.tariff');
  const currentTariffPrice = money(tariff?.data?.price);
  const uk = isUkrainian(decision, customerText);
  const unavailable = nextCharge && nextCharge.ok === false;

  let reply = '';
  if (uk) {
    reply = unavailable
      ? 'Billing не повернув окремий розрахунок наступного нарахування.'
      : 'Точну суму за майбутній період зараз порахувати не вдалося — підтверджених даних недостатньо.';
    if (currentTariffPrice) {
      reply += ` Поточна ціна тарифу — ${currentTariffPrice}, але сама по собі вона не підтверджує суму майбутнього періоду.`;
    }
  } else {
    reply = unavailable
      ? 'Billing не вернул отдельный расчёт следующего начисления.'
      : 'Точную сумму за будущий период сейчас посчитать не удалось — подтверждённых данных недостаточно.';
    if (currentTariffPrice) {
      reply += ` Текущая цена тарифа — ${currentTariffPrice}, но сама по себе она не подтверждает сумму будущего периода.`;
    }
  }

  return {
    ...decision,
    action: 'reply',
    intent: 'future_payment_unconfirmed',
    tool: '',
    toolArgs: {},
    reply,
    reason: 'Future payment guard: only explicit next-charge data or deterministic billing.future_payment calculation may support a future amount.',
    confidence: Math.min(Number(decision.confidence || 0.9) || 0.9, 0.95)
  };
}
