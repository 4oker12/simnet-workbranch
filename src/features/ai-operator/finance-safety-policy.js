import { futurePaymentHorizonFromText } from './future-payment-calculator.js';

const FUTURE_PAYMENT_RE = /(?:следующ(?:ий|его|ем|ую)|наступн(?:ий|ого|ому|ий)|до\s+конц[аы]|до\s+кінц[яю]|до\s+кінця|майбутн|будущ|вперед|наперед).{0,60}(?:месяц|місяц|год|рік|202\d)|(?:сколько|скільки).{0,80}(?:следующ|наступн|до\s+конц|до\s+кінц)/i;

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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

function kyivYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  return {
    year: Number(parts.find(part => part.type === 'year')?.value || 0),
    month: Number(parts.find(part => part.type === 'month')?.value || 0)
  };
}

function horizonMonths(horizon = {}, now = new Date()) {
  const kind = String(horizon?.kind || '');
  if (kind === 'monthly' || kind === 'next_month') return 1;
  if (kind !== 'year_end') return null;

  const current = kyivYearMonth(now);
  const targetYear = Number(horizon?.year || current.year);
  if (!targetYear || targetYear < current.year) return null;
  if (targetYear === current.year) return Math.max(0, 12 - current.month);
  return (12 - current.month) + ((targetYear - current.year - 1) * 12) + 12;
}

function replyMoneyAmounts(reply = '') {
  const amounts = [];
  const source = String(reply || '');
  const re = /(-?\d[\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*(?:грн|₴)/giu;
  for (const match of source.matchAll(re)) {
    const normalized = String(match[1] || '').replace(/[\s\u00a0]/g, '').replace(',', '.');
    const number = asNumber(normalized);
    if (number !== null) amounts.push(roundMoney(number));
  }
  return amounts;
}

function confirmedRecurringPrice(toolResults = []) {
  const tariff = latestToolResult(toolResults, 'billing.tariff');
  if (!tariff?.ok) return null;
  const data = tariff?.data && typeof tariff.data === 'object' ? tariff.data : {};
  if (String(data.nextTariff || '').trim()) return null;
  return asNumber(data.price);
}

function confirmedBalanceAfterCurrentPeriod(toolResults = []) {
  const candidates = [
    latestToolResult(toolResults, 'billing.balance'),
    latestToolResult(toolResults, 'customer.snapshot'),
    latestToolResult(toolResults, 'billing.tariff')
  ].filter(item => item?.ok);

  for (const item of candidates) {
    const data = item?.data && typeof item.data === 'object' ? item.data : {};
    const nested = data.finance && typeof data.finance === 'object' ? data.finance : {};
    const value = asNumber(data.balanceAfterTariff ?? nested.balanceAfterTariff);
    if (value !== null) return value;
  }
  return null;
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

export function hasDerivableFutureAmount({ customerText = '', decision = {}, toolResults = [], now = new Date() } = {}) {
  const amounts = replyMoneyAmounts(decision?.reply);
  if (!amounts.length) return true;

  const horizon = futurePaymentHorizonFromText(customerText);
  const months = horizonMonths(horizon, now);
  const price = confirmedRecurringPrice(toolResults);
  if (price === null || months === null) return false;

  const allowed = new Set([
    roundMoney(price),
    roundMoney(price * months)
  ]);

  const balanceAfterTariff = confirmedBalanceAfterCurrentPeriod(toolResults);
  if (balanceAfterTariff !== null) {
    allowed.add(roundMoney(Math.max(0, (price * months) - balanceAfterTariff)));
  }

  return amounts.every(amount => allowed.has(roundMoney(amount)));
}

export function guardFuturePaymentDecision({ customerText = '', decision = {}, toolResults = [], now = new Date() } = {}) {
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
      reason: 'Future-payment compatibility routing: the planner requested a future-payment READ, so use the deterministic Billing calculator. This READ is not required when already confirmed facts are sufficient for the answer.'
    };
  }

  if (decision.action === 'tool_required' || decision.action === 'ask' || decision.intent === 'confirm_identity') return decision;
  if (hasConfirmedFutureAmount(toolResults)) return decision;

  // REASON FIRST: a future date does not make ordinary arithmetic unsafe. If every money
  // amount in the reply is derivable from confirmed recurring price / period / balance,
  // keep the model answer. The guard only blocks money claims that need a new live fact.
  if (hasDerivableFutureAmount({ customerText, decision, toolResults, now })) return decision;

  const nextCharge = latestToolResult(toolResults, 'billing.next_charge');
  const tariff = latestToolResult(toolResults, 'billing.tariff');
  const currentTariffPrice = money(tariff?.data?.price);
  const uk = isUkrainian(decision, customerText);
  const unavailable = nextCharge && nextCharge.ok === false;

  let reply = '';
  if (uk) {
    reply = unavailable
      ? 'Billing не повернув окремий розрахунок наступного нарахування.'
      : 'Точну суму за майбутній період зараз порахувати не вдалося — для заявленої суми бракує конкретного підтвердженого факту.';
    if (currentTariffPrice) {
      reply += ` Поточна ціна тарифу — ${currentTariffPrice}; її можна використовувати для звичайного розрахунку, але вона не підтверджує інші вигадані майбутні нарахування.`;
    }
  } else {
    reply = unavailable
      ? 'Billing не вернул отдельный расчёт следующего начисления.'
      : 'Точную сумму за будущий период сейчас посчитать не удалось — для заявленной суммы не хватает конкретного подтверждённого факта.';
    if (currentTariffPrice) {
      reply += ` Текущая цена тарифа — ${currentTariffPrice}; её можно использовать для обычного расчёта, но она не подтверждает другие придуманные будущие начисления.`;
    }
  }

  return {
    ...decision,
    action: 'reply',
    intent: 'future_payment_unconfirmed',
    tool: '',
    toolArgs: {},
    reply,
    reason: 'Future payment guard: block only unsupported future/live money claims; ordinary derivations from confirmed facts are allowed.',
    confidence: Math.min(Number(decision.confidence || 0.9) || 0.9, 0.95)
  };
}
