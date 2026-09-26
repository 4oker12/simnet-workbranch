function numeric(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateRequiredTopUp({ futureCharges, availableBalance } = {}) {
  const charges = numeric(futureCharges);
  const balance = numeric(availableBalance);
  if (charges === null || charges < 0 || balance === null) {
    return {
      status: 'unknown',
      futureCharges: charges,
      availableBalance: balance,
      requiredTopUp: null,
      formula: ''
    };
  }
  const normalizedCharges = roundMoney(charges);
  const normalizedBalance = roundMoney(balance);
  return {
    status: 'known',
    futureCharges: normalizedCharges,
    availableBalance: normalizedBalance,
    requiredTopUp: roundMoney(Math.max(0, normalizedCharges - normalizedBalance)),
    formula: `max(0, ${normalizedCharges} - ${normalizedBalance})`
  };
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
  if (/(?:следующ(?:ий|его|ем|ую)\s+месяц|наступн(?:ий|ого|ому)\s+місяц|на\s+след\.?\s+месяц)/i.test(text)) {
    return { kind: 'next_month', year: null };
  }
  if (/(?:сколько|скільки).{0,40}(?:в\s+месяц|за\s+месяц|на\s+місяць|за\s+місяць)|(?:абонплат|щомісяч|ежемесяч)/i.test(text)) {
    return { kind: 'monthly', year: null };
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
  const activeServicesComplete = activeServices.every(item => item.amount !== null);
  const addOnsTotalFromList = activeServicesComplete
    ? roundMoney(activeServices.reduce((sum, item) => sum + item.amount, 0))
    : null;
  const storedAddOnsTotal = numeric(service.activeServicesTotal);
  const addOnsTotal = storedAddOnsTotal !== null ? storedAddOnsTotal : addOnsTotalFromList;
  const currentTotal = numeric(finance.totalDue);
  const derivedBase = numeric(service.derivedBaseTariffAmount);
  const baseTariffAmount = derivedBase !== null
    ? derivedBase
    : currentTotal !== null && addOnsTotal !== null
      ? roundMoney(Math.max(0, currentTotal - addOnsTotal))
      : null;

  return {
    currentTariff: String(service.currentTariff || '').trim(),
    baseTariffAmount,
    activeServices,
    addOnsTotal,
    monthlyRecurringTotal: currentTotal,
    compositionComplete: currentTotal !== null && baseTariffAmount !== null && addOnsTotal !== null
  };
}

export function calculateFuturePayment({ service = {}, finance = {}, horizon = {}, now = new Date() } = {}) {
  const current = kyivYearMonth(now);
  const kind = String(horizon?.kind || '');
  const targetYear = Number(horizon?.year || current.year);
  const composition = recurringComposition({ service, finance });
  const accountBalance = numeric(finance.accountBalance);
  const balanceAfterTariff = numeric(finance.balanceAfterTariff);
  const currentPeriodCovered = balanceAfterTariff === null ? null : balanceAfterTariff >= 0;
  const nextTariff = String(service.nextTariff || '').trim();

  if (!['monthly', 'next_month', 'year_end'].includes(kind)) {
    return { ok: false, code: 'UNSUPPORTED_HORIZON', message: 'Не удалось определить период оплаты.' };
  }
  if ((kind === 'next_month' || kind === 'year_end') && nextTariff) {
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
      message: 'В Billing не найден текущий общий ежемесячный итог.',
      ...composition
    };
  }

  let months = 1;
  let periodLabel = kind;
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
  const usePostCurrentPeriodBalance = kind === 'next_month' || kind === 'year_end';
  const availableBalanceForFuture = usePostCurrentPeriodBalance && balanceAfterTariff !== null
    ? balanceAfterTariff
    : accountBalance;
  const balanceBasis = usePostCurrentPeriodBalance && balanceAfterTariff !== null
    ? 'balanceAfterTariff'
    : accountBalance !== null
      ? 'accountBalance'
      : 'none';
  const topUp = calculateRequiredTopUp({
    futureCharges,
    availableBalance: availableBalanceForFuture
  });
  const requiredTopUpNow = topUp.requiredTopUp;

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
    balanceAfterTariff,
    currentPeriodCovered,
    availableBalanceForFuture,
    balanceBasis,
    requiredTopUpNow,
    calculation: {
      formula: `${months} × ${composition.monthlyRecurringTotal}`,
      balanceApplied: availableBalanceForFuture !== null,
      balanceBasis,
      requiredTopUpFormula: topUp.formula
    }
  };
}
