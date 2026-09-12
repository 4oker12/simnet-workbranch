'use strict';

const RECENT_CALLS_QUERY = 'PBX_RECENT_CALLS_QUERY';
const RECENT_CALLS_OBSERVED = 'PBX_RECENT_CALLS_OBSERVED';
const CANONICAL_REFRESH_COOLDOWN_MS = 60000;

function hasCompletedRealtimeCall(payload = {}) {
  const calls = Array.isArray(payload?.calls) ? payload.calls : [];
  return calls.some(call => {
    const durationSeconds = Number(call?.durationSeconds ?? call?.duration ?? 0);
    const lifecycle = String(call?.status || call?.type || call?.state || '').trim().toLowerCase();
    return durationSeconds > 0 || /^(?:completed|ended|finished|hangup|hungup|done)$/.test(lifecycle);
  });
}

/** CALL-only router. The root service worker owns Chrome transport; this router
 * owns CALL command dispatch and lifecycle gating. */
export function createCallMessageRouter({ module, handlers = {} }) {
  if (!module) throw new Error('CALL message router requires module');
  const routes = new Map(Object.entries(handlers));
  let canonicalRefreshPromise = null;
  let lastCanonicalRefreshStartedAt = 0;

  function scheduleCanonicalRefresh(payload = {}, sender = {}, reason = 'background') {
    const queryRoute = routes.get(RECENT_CALLS_QUERY);
    if (!queryRoute || canonicalRefreshPromise) return canonicalRefreshPromise;
    const now = Date.now();
    if (now - lastCanonicalRefreshStartedAt < CANONICAL_REFRESH_COOLDOWN_MS) return null;
    lastCanonicalRefreshStartedAt = now;

    const refreshPayload = {
      ...payload,
      fresh: true,
      forceRefresh: true,
      backgroundRefresh: true,
      backgroundRefreshReason: reason
    };
    canonicalRefreshPromise = Promise.resolve()
      .then(() => queryRoute(refreshPayload, sender))
      .catch(error => {
        console.warn('[SIMNET WB][CALL] background call_list refresh failed', error);
        return null;
      })
      .finally(() => { canonicalRefreshPromise = null; });
    return canonicalRefreshPromise;
  }

  return Object.freeze({
    canHandle(type = '') { return routes.has(String(type || '')); },
    handle(type = '', payload = {}, sender = {}) {
      const key = String(type || '');
      const route = routes.get(key);
      if (!route) return undefined;
      if (module.status().destroyed) throw new Error('CALL module is destroyed');
      if (!module.status().enabled && !['CALL_FEATURE_SET_ENABLED', 'CALL_FEATURE_STATUS_GET'].includes(key)) {
        throw new Error('CALL module is disabled');
      }

      if (key === RECENT_CALLS_QUERY && (payload?.fresh === true || payload?.forceRefresh === true)) {
        // Explicit operator request is authoritative again. Opening the
        // registration dialog waits for one fresh UserSide /message/call_list
        // GET before rendering the call focus, matching the previously proven
        // behavior. This intentionally trades modal-open latency for correct,
        // current call identity.
        return route(payload, sender);
      }

      if (key === RECENT_CALLS_OBSERVED) {
        const result = route(payload, sender);
        return Promise.resolve(result).then(value => {
          if (Number(value?.stored || 0) > 0 && hasCompletedRealtimeCall(payload)) {
            scheduleCanonicalRefresh({}, sender, 'pbx-ended');
          }
          return value;
        });
      }

      return route(payload, sender);
    },
    enable() { return module.enable(); },
    disable() { return module.disable(); },
    open() { return module.open(); },
    destroy() { routes.clear(); module.destroy(); }
  });
}
