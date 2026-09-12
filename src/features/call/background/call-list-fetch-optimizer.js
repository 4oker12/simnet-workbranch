'use strict';

const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const CALL_LIST_PATH = '/message/call_list';
const OPERATOR_EXTENSION = '6047';

export function optimizedCallListUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { return String(rawUrl || ''); }
  if (url.origin !== USERSIDE_ORIGIN || url.pathname !== CALL_LIST_PATH) return url.href;

  const selectors = [];
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^filter_selector(\d+)$/);
    if (match) selectors.push({ index: Number(match[1]), value: String(value || '') });
  }
  if (selectors.some(item => item.value === 'employee_ipphone_number')) return url.href;

  let index = 0;
  while (selectors.some(item => item.index === index) && index < 20) index += 1;
  url.searchParams.set(`filter_selector${index}`, 'employee_ipphone_number');
  url.searchParams.set(`employee_ipphone_number${index}_value`, OPERATOR_EXTENSION);
  if (!url.searchParams.has('page')) url.searchParams.set('page', '1');
  return url.href;
}

const nativeFetch = globalThis.fetch?.bind(globalThis);
if (nativeFetch && !globalThis.__SIMNET_WB_CALL_LIST_FETCH_OPTIMIZED__) {
  globalThis.__SIMNET_WB_CALL_LIST_FETCH_OPTIMIZED__ = true;
  globalThis.fetch = function simnetCallListFilteredFetch(input, init) {
    try {
      const originalUrl = input instanceof Request ? input.url : String(input || '');
      const nextUrl = optimizedCallListUrl(originalUrl);
      if (!nextUrl || nextUrl === originalUrl) return nativeFetch(input, init);
      if (input instanceof Request) {
        return nativeFetch(new Request(nextUrl, input), init);
      }
      return nativeFetch(nextUrl, init);
    } catch {
      return nativeFetch(input, init);
    }
  };
}
