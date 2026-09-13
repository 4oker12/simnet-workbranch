'use strict';

const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const CALL_LIST_PATH = '/message/call_list';

export function kyivCalendarDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(value);
  const byType = Object.fromEntries(parts
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return `${byType.day}.${byType.month}.${byType.year}`;
}

/**
 * Build the proven native UserSide filter used by the operator UI: only today's
 * calls in Europe/Kyiv and only the current internal extension. This keeps the
 * authoritative refresh, but avoids downloading/parsing the unfiltered history.
 */
export function optimizedCallListUrl(rawUrl, {
  operatorExtension = '6047',
  now = new Date()
} = {}) {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { return String(rawUrl || ''); }
  if (url.origin !== USERSIDE_ORIGIN || url.pathname !== CALL_LIST_PATH) return url.href;
  const extension = String(operatorExtension || '').replace(/\D+/g, '').slice(0, 6);
  const date = kyivCalendarDate(now);

  // Rebuild the query exactly as the current native UserSide form emits it.
  // The duplicated extension values and the non-contiguous filter index are
  // intentional: UserSide expects the period in slot 0 and the phone filter in
  // slot 2, while also submitting employee_ipphone_number0_value.
  url.search = '';
  if (extension) url.searchParams.set('employee_ipphone_number0_value', extension);
  url.searchParams.set('filter_selector0', 'period');
  url.searchParams.set('period0_date1', date);
  url.searchParams.set('period0_date2', date);
  url.searchParams.set('filter_selector2', 'employee_ipphone_number');
  if (extension) url.searchParams.set('employee_ipphone_number2_value', extension);
  return url.href;
}
