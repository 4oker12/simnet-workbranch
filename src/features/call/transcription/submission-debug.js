const DEBUG_KEY = 'simnet_workbench_call_submit_debug_v1';
const TARGET_ORIGIN = 'https://userside.simnet.kiev.ua';
const TARGET_PATH = '/message/save_call';
const MAX_BODY_CHARS = 6000;

const originalFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input) {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input));
    if (input && typeof input.url === 'string') return new URL(input.url);
  } catch {}
  return null;
}

function compactBody(value) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .slice(0, MAX_BODY_CHARS);
}

async function persist(snapshot) {
  try {
    await chrome.storage.local.set({ [DEBUG_KEY]: snapshot });
  } catch (error) {
    console.warn('[SIMNET WB][CALL SUBMIT DEBUG] storage failed', error);
  }
}

globalThis.fetch = async (...args) => {
  const url = requestUrl(args[0]);
  const watched = Boolean(url && url.origin === TARGET_ORIGIN && url.pathname === TARGET_PATH);
  const startedAt = Date.now();

  try {
    const response = await originalFetch(...args);
    if (watched) {
      let body = '';
      let bodyReadError = '';
      try {
        body = await response.clone().text();
      } catch (error) {
        bodyReadError = error instanceof Error ? error.message : String(error || '');
      }
      const snapshot = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
        request: {
          method: String(args[1]?.method || (args[0] && typeof args[0] === 'object' ? args[0].method : '') || 'GET').toUpperCase(),
          path: `${url.pathname}${url.search}`
        },
        response: {
          ok: Boolean(response.ok),
          status: Number(response.status || 0),
          statusText: String(response.statusText || ''),
          redirected: Boolean(response.redirected),
          url: String(response.url || ''),
          contentType: String(response.headers.get('content-type') || ''),
          bodyChars: body.length,
          body: compactBody(body),
          bodyReadError
        }
      };
      console.log('[SIMNET WB][CALL SUBMIT DEBUG]', snapshot);
      await persist(snapshot);
    }
    return response;
  } catch (error) {
    if (watched) {
      const snapshot = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
        request: {
          method: String(args[1]?.method || (args[0] && typeof args[0] === 'object' ? args[0].method : '') || 'GET').toUpperCase(),
          path: `${url.pathname}${url.search}`
        },
        error: error instanceof Error ? error.message : String(error || '')
      };
      console.error('[SIMNET WB][CALL SUBMIT DEBUG] fetch failed', snapshot);
      await persist(snapshot);
    }
    throw error;
  }
};
