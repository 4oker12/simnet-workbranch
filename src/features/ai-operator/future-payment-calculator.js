function numeric(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function kyivYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value || 0);
  const month = Number(parts.find(part => part.type === 'month')?.value || 0);
  return { year, month };
}

export function futurePaymentHorizonFromText(value = '') {
  const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/(?:до\s+конц[аы]|до\s+кінця|до\s+кінц[яю]).{0,30}(?:года|року|202\d)|(?:до\s+конца\s+202\d|до\s+кінця\s+202\d)/i.test(text)) {
    const year = Number(text.match(/\b(20\d{2})\b/)?.[1] || 0);
    return { kind: 'year_end', year: year || null };
  }
  if (/(?:следующ(?:ий|его|ем|ую)\s+месяц|наступн(?:ий|ого|ому)\s+місяц)/i.test(text)) {
    return { kind: 'next_month', year: null };
  }
  return null;
}

function recurringComposition({ service = {}, finance = {} } = {}) {
  const activeServices = Array.isArray(service.activeServices)
    ? service.activeServices
        .map(item => ({
          name: String(item?.name || '').trim(),
          amount: numeric(item?.amount),
          amountText: String(item?.amountText || '').trim()
        }))
        .filter(item => item.name || item.amount !== null || item.amountText)
    : [];
  const activeServicesComplete = activeServices.length > 0
    && activeServices.every(item => item.amount !== null);
  const addOnsTotal = activeServicesComplete
    ? roundMoney(activeServices.reduce((sum, item) => sum + item.amount, 0))
    : numeric(service.activeServicesTotal);
  const currentTotal = numeric(finance.totalDue);
  const derivedBase = numeric(service.derivedBaseTariffAmount);
  const baseTariffAmount = derivedBase !== null
    ? derivedBase
    : currentTotal !== null && addOnsTotal !== null
      ? roundMoney(Math.max(0, currentTotal - addOnsTotal))
      : null;
  const monthlyRecurringTotal = currentTotal !== null && baseTariffAmount !== null && addOnsTotal !== null
    ? currentTotal
    : null;

  return {
    currentTariff: String(service.currentTariff || '').trim(),
    baseTariffAmount,
    activeServices,
    addOnsTotal,
    monthlyRecurringTotal
  };
}

export function calculateFuturePayment({ service = {}, finance = {}, horizon = {}, now = new Date() } = {}) {
  const current = kyivYearMonth(now);
  const kind = String(horizon?.kind || '');
  const targetYear = Number(horizon?.year || current.year);
  const composition = recurringComposition({ service, finance });
  const accountBalance = numeric(finance.accountBalance);
  const nextTariff = String(service.nextTariff || '').trim();

  if (!['next_month', 'year_end'].includes(kind)) {
    return { ok: false, code: 'UNSUPPORTED_HORIZON', message: 'Не удалось определить период будущей оплаты.' };
  }
  if (nextTariff) {
    return {
      ok: false,
      code: 'FUTURE_TARIFF_CHANGE',
      message: 'В Billing запланирована смена тарифа; без подтверждённой цены будущего тарифа точную сумму считать нельзя.',
      nextTariff,
      nextTariffDelay: String(service.nextTariffDelay || '').trim(),
      ...composition
    };
  }
  if (composition.monthlyRecurringTotal === null) {
    return {
      ok: false,
      code: 'RECURRING_TOTAL_NOT_AVAILABLE',
      message: 'Не удалось надёжно собрать ежемесячный итог из основного тарифа и активных допуслуг.',
      ...composition
    };
  }

  let months = 1;
  let periodLabel = 'next_month';
  if (kind === 'year_end') {
    if (!targetYear || targetYear < current.year) {
      return { ok: false, code: 'PAST_TARGET_YEAR', message: 'Указанный год уже завершён.' };
    }
    if (targetYear === current.year) {
      months = Math.max(0, 12 - current.month);
    } else {
      months = (12 - current.month) + ((targetYear - current.year - 1) * 12) + 12;
    }
    periodLabel = `through_${targetYear}_year_end`;
  }

  const futureCharges = roundMoney(months * composition.monthlyRecurringTotal);
  const usableBalance = accountBalance === null ? null : accountBalance;
  const requiredTopUpNow = usableBalance === null
    ? null
    : roundMoney(Math.max(0, futureCharges - usableBalance));

  return {
    ok: true,
    code: 'OK',
    period: periodLabel,
    currentYear: current.year,
    currentMonth: current.month,
    targetYear: kind === 'year_end' ? targetYear : null,
    months,
    ...composition,
    futureCharges,
    accountBalance,
    requiredTopUpNow,
    calculation: {
      formula: `${months} × ${composition.monthlyRecurringTotal}`,
      balanceApplied: accountBalance !== null,
      requiredTopUpFormula: accountBalance !== null
        ? `max(0, ${futureCharges} - ${accountBalance})`
        : ''
    }
  };
}
