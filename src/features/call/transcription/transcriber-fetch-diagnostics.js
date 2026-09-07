const PATCH_KEY = Symbol.for('simnet.workbench.transcriberFetchDiagnostics.v1');

if (!globalThis[PATCH_KEY]) {
  const originalFetch = globalThis.fetch.bind(globalThis);

  function requestUrl(input) {
    try {
      if (typeof input === 'string' || input instanceof URL) return new URL(String(input));
      if (input?.url) return new URL(String(input.url));
    } catch {}
    return null;
  }

  function errorText(error) {
    return String(error?.message || error || 'unknown network error').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function localTranscriber(url) {
    return Boolean(
      url
      && url.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.pathname === '/transcribe'
    );
  }

  async function probeHealth(url) {
    const healthUrl = new URL('/health', url.origin);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('diagnostic-timeout'), 3500);
    try {
      const response = await originalFetch(healthUrl.href, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      const body = await response.text().catch(() => '');
      return {
        reachable: true,
        ok: response.ok,
        status: response.status,
        detail: body.replace(/\s+/g, ' ').trim().slice(0, 300)
      };
    } catch (error) {
      return {
        reachable: false,
        ok: false,
        status: 0,
        detail: errorText(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  globalThis.fetch = async function simnetWorkbenchDiagnosticFetch(input, init = undefined) {
    const url = requestUrl(input);
    if (!localTranscriber(url)) return originalFetch(input, init);

    try {
      return await originalFetch(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw error;

      const original = errorText(error);
      const health = await probeHealth(url);
      if (!health.reachable) {
        const enriched = new Error(
          `Transcriber network: POST ${url.origin}/transcribe не получил HTTP-ответ (${original}); `
          + `/health также недоступен (${health.detail || 'network failure'}). `
          + 'Локальный SSH-туннель/listener/backend недоступен.'
        );
        enriched.name = 'TranscriberNetworkError';
        enriched.cause = error;
        throw enriched;
      }

      if (!health.ok) {
        const enriched = new Error(
          `Transcriber network: POST ${url.origin}/transcribe не получил HTTP-ответ (${original}); `
          + `/health доступен, но вернул HTTP ${health.status}${health.detail ? ` — ${health.detail}` : ''}.`
        );
        enriched.name = 'TranscriberHealthError';
        enriched.cause = error;
        throw enriched;
      }

      const enriched = new Error(
        `Transcriber POST: ${url.origin}/health отвечает OK, но POST /transcribe оборвался до HTTP-ответа (${original}). `
        + 'Туннель и backend доступны; проверять upload/request обработчик /transcribe.'
      );
      enriched.name = 'TranscriberPostError';
      enriched.cause = error;
      throw enriched;
    }
  };

  globalThis[PATCH_KEY] = Object.freeze({ installed: true });
}
