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
  if (!isFuturePaymentQuestion(customerText)) return decision;
  if (!decision || typeof decision !== 'object') return decision;
  if (decision.action === 'tool_required' || decision.action === 'ask' || decision.intent === 'confirm_identity') return decision;
  if (hasConfirmedFutureAmount(toolResults)) return decision;

  const deterministic = latestToolResult(toolResults, 'billing.future_payment');
  const nextCharge = latestToolResult(toolResults, 'billing.next_charge');
  const uk = isUkrainian(decision, customerText);
  const message = String(deterministic?.data?.message || nextCharge?.data?.message || '').trim();

  const reply = message || (uk
    ? 'Точну суму за майбутній період зараз порахувати не вдалося — підтверджених даних недостатньо.'
    : 'Точную сумму за будущий период сейчас посчитать не удалось — подтверждённых данных недостаточно.');

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
