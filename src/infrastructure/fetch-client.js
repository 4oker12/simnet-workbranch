'use strict';

export function createFetchClient({ allowedHosts = [], timeoutMs = 15000, fetchFn = fetch, nowMs = () => Date.now() } = {}) {
  const hosts = new Set(allowedHosts);

  function isUrlAllowed(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.protocol === 'https:' && hosts.has(url.hostname);
    } catch {
      return false;
    }
  }

  function isUsersideCallFormUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.hostname === 'userside.simnet.kiev.ua' && url.pathname === '/message/tab';
    } catch {
      return false;
    }
  }

  function headersForTextResponse(rawUrl, provided = {}) {
    const headers = new Headers(provided || {});
    // New UserSide renders /message/tab as an AJAX fragment. Without the
    // native XHR marker the route can return the surrounding page instead of
    // the call-registration form, which makes the CALL parser report that
    // the native form is missing.
    if (isUsersideCallFormUrl(rawUrl)) {
      if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'XMLHttpRequest');
      if (!headers.has('accept')) headers.set('accept', 'text/html, */*; q=0.01');
    }
    return headers;
  }

  async function request({ url, method = 'GET', headers = {}, body = null } = {}) {
    if (!isUrlAllowed(url)) throw new Error(`Blocked URL: ${String(url || '')}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestHeaders = new Headers(headers);
      let requestBody = body;
      if (body && typeof body === 'object' && !(body instanceof FormData)) {
        if (!requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
        requestBody = JSON.stringify(body);
      }
      const response = await fetchFn(url, {
        method,
        headers: requestHeaders,
        body: ['GET', 'HEAD'].includes(String(method).toUpperCase()) ? null : requestBody,
        credentials: 'include',
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      let data = text;
      if (contentType.includes('application/json')) {
        try { data = JSON.parse(text || 'null'); } catch { data = text; }
      }
      return { status: response.status, contentType, url: response.url || String(url || ''), redirected: Boolean(response.redirected), data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function textResponse(url, options = {}) {
    if (!isUrlAllowed(url)) throw new Error(`Blocked URL: ${String(url || '')}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = nowMs();
    try {
      const response = await fetchFn(url, {
        method: options.method || 'GET',
        headers: headersForTextResponse(url, options.headers || {}),
        body: options.body || null,
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal
      });
      const data = await response.text();
      if (isUsersideCallFormUrl(url)) {
        console.log('[SIMNET WB][CALL_FORM_FETCH]', {
          status: response.status,
          finalUrl: response.url || String(url || ''),
          redirected: Boolean(response.redirected),
          bytes: new TextEncoder().encode(data).byteLength,
          hasSaveCall: /\/message\/save_call/i.test(data),
          hasStandardComment: /name=["']standart_comment["']/i.test(data),
          hasCustomerId: /name=["']customer_id["']/i.test(data),
          hasCustomerUuid: /name=["']customer_uuid["']/i.test(data),
          hasPhoneField: /name=["']dopf_(?:\d+|[0-9a-f-]{36})["']/i.test(data)
        });
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || '',
        contentType: response.headers.get('content-type') || '',
        url: response.url || String(url || ''),
        redirected: Boolean(response.redirected),
        data,
        durationMs: Math.max(0, nowMs() - startedAt),
        responseBytes: new TextEncoder().encode(data).byteLength,
        message: response.ok ? '' : `UserSide вернул HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ''}`
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return Object.freeze({ isUrlAllowed, request, textResponse });
}
