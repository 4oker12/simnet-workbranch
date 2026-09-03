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
        method: options.method || 'GET', headers: options.headers || {}, body: options.body || null,
        credentials: 'include', cache: 'no-store', redirect: 'follow', signal: controller.signal
      });
      const data = await response.text();
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
