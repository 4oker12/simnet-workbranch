const FUTURE_PAYMENT_RE = /(?:следующ(?:ий|его|ем|ую)|наступн(?:ий|ого|ому|ий)|до\s+конц[аы]|до\s+кінц[яю]|до\s+кінця|майбутн|будущ|вперед|наперед).{0,60}(?:месяц|місяц|год|рік|202\d)|(?:сколько|скільки).{0,80}(?:следующ|наступн|до\s+конц|до\s+кінц)/i;

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestToolResult(toolResults = [], toolName = '') {
  return [...(Array.isArray(toolResults) ? toolResults : [])]
    .reverse()
    .find(item => String(item?.tool || '') === toolName) || null;
}

function money(value) {
  const number = asNumber(value);
  if (number === null) return '';
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} грн`;
}

function isUkrainian(decision = {}, customerText = '') {
  if (String(decision?.language || '').toLowerCase() === 'uk') return true;
  return /[іїєґ]/i.test(String(customerText || ''));
}

export function isFuturePaymentQuestion(value) {
  return FUTURE_PAYMENT_RE.test(String(value || '').replace(/\s+/g, ' ').trim());
}

export function hasConfirmedFutureAmount(toolResults = []) {
  const result = latestToolResult(toolResults, 'billing.next_charge');
  if (!result?.ok) return false;
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  return [data.amount, data.nextCharge, data.projectedAmount, data.requiredTopUp]
    .some(value => asNumber(value) !== null);
}

export function guardFuturePaymentDecision({ customerText = '', decision = {}, toolResults = [] } = {}) {
  if (!isFuturePaymentQuestion(customerText)) return decision;
  if (!decision || typeof decision !== 'object') return decision;
  if (decision.action === 'tool_required' || decision.action === 'ask' || decision.intent === 'confirm_identity') return decision;
  if (hasConfirmedFutureAmount(toolResults)) return decision;

  const nextCharge = latestToolResult(toolResults, 'billing.next_charge');
  const tariff = latestToolResult(toolResults, 'billing.tariff');
  const tariffData = tariff?.data && typeof tariff.data === 'object' ? tariff.data : {};
  const currentTariff = String(tariffData.currentTariff || '').trim();
  const currentPrice = money(tariffData.price);
  const uk = isUkrainian(decision, customerText);

  const known = [];
  if (currentTariff) known.push(uk ? `Поточний тариф — «${currentTariff}»` : `Текущий тариф — «${currentTariff}»`);
  if (currentPrice) known.push(uk ? `поточне поле ціни в Billing — ${currentPrice}` : `текущее поле цены в Billing — ${currentPrice}`);

  const unavailable = nextCharge && nextCharge.ok === false;
  const reply = uk
    ? [
        unavailable
          ? 'Точну суму оплати за майбутній період зараз підтвердити не можу: Billing не повернув окремий розрахунок наступного нарахування.'
          : 'Для точної суми оплати за майбутній період потрібен підтверджений розрахунок наступного нарахування.',
        known.length ? `${known.join('; ')}. Це не є прогнозом суми на наступний місяць.` : ''
      ].filter(Boolean).join(' ')
    : [
        unavailable
          ? 'Точную сумму оплаты за будущий период сейчас подтвердить не могу: Billing не вернул отдельный расчёт следующего начисления.'
          : 'Для точной суммы оплаты за будущий период нужен подтверждённый расчёт следующего начисления.',
        known.length ? `${known.join('; ')}. Это не является прогнозом суммы на следующий месяц.` : ''
      ].filter(Boolean).join(' ');

  return {
    ...decision,
    action: 'reply',
    intent: 'future_payment_unconfirmed',
    tool: '',
    toolArgs: {},
    reply,
    reason: 'Future payment guard: current price/totalDue are not a confirmed future charge; billing.next_charge did not provide an explicit amount.',
    confidence: Math.min(Number(decision.confidence || 0.9) || 0.9, 0.95)
  };
}
