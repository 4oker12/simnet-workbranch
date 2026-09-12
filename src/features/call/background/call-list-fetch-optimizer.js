'use strict';

const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const CALL_LIST_PATH = '/message/call_list';

/**
 * Keep CALL authoritative refresh on the native UserSide URL.
 *
 * We previously injected an employee_ipphone_number filter here. That filter was
 * inferred, not confirmed by UserSide, and could make the server return a page
 * without the active 6047 row. The parser already filters rows to extension 6047
 * locally, so correctness must win here.
 *
 * Page 1 is sufficient for the current/most recent call and avoids walking old
 * history. Existing query parameters are preserved.
 */
export function optimizedCallListUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { return String(rawUrl || ''); }
  if (url.origin !== USERSIDE_ORIGIN || url.pathname !== CALL_LIST_PATH) return url.href;
  if (!url.searchParams.has('page')) url.searchParams.set('page', '1');
  return url.href;
}

const nativeFetch = globalThis.fetch?.bind(globalThis);
if (nativeFetch && !globalThis.__SIMNET_WB_CALL_LIST_FETCH_OPTIMIZED__) {
  globalThis.__SIMNET_WB_CALL_LIST_FETCH_OPTIMIZED__ = true;
  globalThis.fetch = function simnetCallListFirstPageFetch(input, init) {
    try {
      const originalUrl = input instanceof Request ? input.url : String(input || '');
      const nextUrl = optimizedCallListUrl(originalUrl);
      if (!nextUrl || nextUrl === originalUrl) return nativeFetch(input, init);
      if (input instanceof Request) return nativeFetch(new Request(nextUrl, input), init);
      return nativeFetch(nextUrl, init);
    } catch {
      return nativeFetch(input, init);
    }
  };
}
