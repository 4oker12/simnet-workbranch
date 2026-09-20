'use strict';

function clean(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

const EMPTY_SELECTION_PATTERNS = Object.freeze([
  /^-+$/,
  /^0$/,
  /^(?:нет|ні|none|null|n\/a)$/i,
  /^(?:не\s*(?:выбран[оа]?|обран[оа]?|задан[оа]?|встановлен[оа]?))$/i,
  /^(?:выберите|оберіть)(?:\s+.+)?$/i,
  /^(?:без\s+изменени[йя]|без\s+змін|не\s+менять|не\s+змінювати)$/i
]);

export function isMeaningfulBillingSelection(value) {
  const text = clean(value, 260);
  if (!text) return false;
  return !EMPTY_SELECTION_PATTERNS.some(pattern => pattern.test(text));
}

function finiteMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function inferTariffNumbers(label) {
  const text = clean(label, 260);
  let priceUAH = null;
  let speedMbps = null;

  const coded = text.match(/\bBZL\b\s*[,;:\-]?\s*(\d{2,4}(?:[.,]\d{1,2})?)\s*[,;:\-]?\s*(\d{2,4})\s*(?:M(?:B|BIT)(?:\/S)?|МБ(?:І|И)?Т(?:\/С)?|МБ)\b/i);
  if (coded) {
    priceUAH = finiteMoney(String(coded[1]).replace(',', '.'));
    speedMbps = Number(coded[2]);
    return { priceUAH, speedMbps, serviceCode: 'BZL' };
  }

  const speed = text.match(/\b(\d{2,4})\s*(?:M(?:B|BIT)(?:\/S)?|МБ(?:І|И)?Т(?:\/С)?|МБ)\b/i);
  if (speed) speedMbps = Number(speed[1]);
  const price = text.match(/\b(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:грн|uah)\b/i);
  if (price) priceUAH = finiteMoney(String(price[1]).replace(',', '.'));
  return { priceUAH, speedMbps, serviceCode: /^\s*BZL\b/i.test(text) ? 'BZL' : '' };
}

export function normalizeTariffLabel(value) {
  const rawName = clean(value, 260);
  if (!rawName) return { rawName: '', displayName: '', priceUAH: null, speedMbps: null, serviceCode: '' };

  const withoutNumericId = rawName.replace(/^\s*\[\d+\]\s*/, '').trim();
  const inferred = inferTariffNumbers(withoutNumericId);
  let displayName = withoutNumericId
    .replace(/^\s*BZL\b\s*[,;:\-]?\s*/i, '')
    .replace(/\b(\d{2,4})\s*(?:M(?:B|BIT)(?:\/S)?|МБ(?:І|И)?Т(?:\/С)?|МБ)\b/gi, '$1 Мбит/с')
    .replace(/\s*,\s*/g, ', ')
    .trim();

  if (inferred.serviceCode === 'BZL' && Number.isFinite(inferred.speedMbps) && Number.isFinite(inferred.priceUAH)) {
    displayName = `${inferred.speedMbps} Мбит/с — ${inferred.priceUAH} грн/мес`;
  }

  return {
    rawName,
    displayName: displayName || withoutNumericId || rawName,
    priceUAH: inferred.priceUAH,
    speedMbps: Number.isFinite(inferred.speedMbps) ? inferred.speedMbps : null,
    serviceCode: inferred.serviceCode
  };
}

function nextCalendarMonth(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeEffectivePeriod(value, now = new Date()) {
  const raw = clean(value, 260);
  if (!raw) return null;
  if (/(?:в|на)\s+(?:следующ\w*|наступн\w*)\s+(?:месяц\w*|місяц\w*)/i.test(raw)) {
    return { kind: 'next_month', month: nextCalendarMonth(now), raw };
  }
  return { kind: 'billing_schedule', month: null, raw };
}

export function normalizeScheduledTariff({ nextTariff, nextTariffDelay, now = new Date() } = {}) {
  const rawName = clean(nextTariff, 260);
  const rawDelay = clean(nextTariffDelay, 260);
  const hasChange = isMeaningfulBillingSelection(rawName) && isMeaningfulBillingSelection(rawDelay);
  if (!hasChange) {
    return {
      hasChange: false,
      currentTariffTemporary: false,
      nextTariff: null,
      effective: null,
      rawName,
      rawDelay
    };
  }

  return {
    hasChange: true,
    currentTariffTemporary: true,
    nextTariff: normalizeTariffLabel(rawName),
    effective: normalizeEffectivePeriod(rawDelay, now),
    rawName,
    rawDelay
  };
}

export function normalizeActiveServices(values = []) {
  return (Array.isArray(values) ? values : []).map(item => {
    const rawName = clean(item?.rawName || item?.name, 220);
    let kind = 'additional_service';
    let displayName = rawName;
    if (/\b(?:ктв|ktv)\b|кабельн\w*\s+(?:телевид|тв|тб)/i.test(rawName)) {
      kind = 'cable_tv';
      displayName = 'Кабельное телевидение';
    } else if (/omega\s*tv|омега\s*(?:тв|тб)/i.test(rawName)) {
      kind = 'omega_tv';
      displayName = 'Omega TV';
    }
    return {
      ...item,
      rawName,
      name: displayName || rawName,
      displayName: displayName || rawName,
      kind,
      amount: finiteMoney(item?.amount)
    };
  });
}

export function calculateRecurringTotal(internetPrice, services = []) {
  const base = finiteMoney(internetPrice);
  if (!Number.isFinite(base)) return null;
  const list = Array.isArray(services) ? services : [];
  const amounts = list.map(item => finiteMoney(item?.amount));
  if (amounts.some(value => !Number.isFinite(value))) return null;
  return Math.round((base + amounts.reduce((sum, value) => sum + value, 0)) * 100) / 100;
}

export function normalizeBillingTariffSnapshot(snapshot = {}, { now = new Date() } = {}) {
  const service = { ...(snapshot?.service || {}) };
  const finance = { ...(snapshot?.finance || {}) };
  const current = normalizeTariffLabel(service.currentTariffRaw || service.currentTariff || service.current?.rawName || service.current?.name || '');
  const scheduled = normalizeScheduledTariff({
    nextTariff: service.nextTariffRaw ?? service.nextTariff,
    nextTariffDelay: service.nextTariffDelayRaw ?? service.nextTariffDelay,
    now
  });
  const activeServices = normalizeActiveServices(service.activeServices);
  const priceSemantics = String(finance.priceSemantics || '');
  const internetPriceIsAuthoritative = !/^generic_price_row_not_guaranteed/i.test(priceSemantics);
  const recurringTotal = internetPriceIsAuthoritative ? calculateRecurringTotal(finance.price, activeServices) : null;

  service.currentTariffRaw = current.rawName;
  service.currentTariffDisplay = current.displayName;
  service.currentTariffPriceUAH = current.priceUAH;
  service.currentTariffSpeedMbps = current.speedMbps;
  service.current = {
    ...(service.current || {}),
    rawName: current.rawName,
    name: current.displayName,
    priceUAH: current.priceUAH,
    speedMbps: current.speedMbps
  };
  service.nextTariffRaw = scheduled.rawName;
  service.nextTariffDelayRaw = scheduled.rawDelay;
  service.nextTariff = scheduled.hasChange ? scheduled.rawName : null;
  service.nextTariffDisplay = scheduled.hasChange ? scheduled.nextTariff.displayName : null;
  service.nextTariffDelay = scheduled.hasChange ? scheduled.rawDelay : null;
  service.hasScheduledTariffChange = scheduled.hasChange;
  service.currentTariffTemporary = scheduled.currentTariffTemporary;
  service.scheduledChange = scheduled.hasChange ? {
    rawName: scheduled.nextTariff.rawName,
    name: scheduled.nextTariff.displayName,
    priceUAH: scheduled.nextTariff.priceUAH,
    speedMbps: scheduled.nextTariff.speedMbps,
    effective: scheduled.effective
  } : null;
  service.activeServices = activeServices;
  service.activeServicesTotal = activeServices.length && activeServices.every(item => Number.isFinite(item.amount))
    ? Math.round(activeServices.reduce((sum, item) => sum + item.amount, 0) * 100) / 100
    : activeServices.length ? null : 0;

  finance.recurringTotal = recurringTotal;
  finance.recurringTotalSemantics = !internetPriceIsAuthoritative
    ? 'unknown_because_source_price_is_not_confirmed_as_internet_tariff_price'
    : recurringTotal == null
      ? 'unknown_when_internet_or_additional_service_amount_is_missing'
      : 'exact_internet_tariff_price_plus_active_additional_services';

  return { ...snapshot, service, finance };
}
