const DEBUG_KEY = 'simnet_workbench_call_submit_debug_v1';
const TARGET_ORIGIN = 'https://userside.simnet.kiev.ua';
const TARGET_PATH = '/message/save_call';
const SUCCESS_REDIRECT_PATH = '/dashboard';
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

function nativeDashboardSuccess(response) {
  try {
    const finalUrl = new URL(String(response?.url || ''));
    return Boolean(
      response?.ok
      && response?.redirected
      && finalUrl.origin === TARGET_ORIGIN
      && finalUrl.pathname === SUCCESS_REDIRECT_PATH
    );
  } catch {
    return false;
  }
}

function normalizeNativeSaveResponse(response) {
  if (!nativeDashboardSuccess(response)) return response;

  // UserSide's current native /message/save_call success path redirects the POST
  // to /dashboard and returns the full dashboard HTML. The CALL UI classifier
  // historically expected a customer redirect or an explicit success banner,
  // so a real successful save was falling into `unknown`/`review_required`.
  // Preserve the original Response metadata/body, but expose a synthetic success
  // marker through text() so the existing classifier can recognize the observed
  // native success protocol. Native-form/error detection still runs first and wins.
  return new Proxy(response, {
    get(target, property) {
      if (property === 'text') {
        return async () => {
          const body = await target.text();
          return '<div class="success" data-simnet-wb-native-save="dashboard-redirect">Звонок зарегистрирован</div>' + body;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
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
      const dashboardSuccess = nativeDashboardSuccess(response);
      const snapshot = {
        schemaVersion: 2,
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
          bodyReadError,
          nativeSuccessProtocol: dashboardSuccess ? 'dashboard-redirect' : ''
        }
      };
      console.log('[SIMNET WB][CALL SUBMIT DEBUG]', snapshot);
      await persist(snapshot);
      return normalizeNativeSaveResponse(response);
    }
    return response;
  } catch (error) {
    if (watched) {
      const snapshot = {
        schemaVersion: 2,
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
