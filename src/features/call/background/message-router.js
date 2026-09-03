'use strict';

/** CALL-only router. The root service worker owns Chrome transport; this router
 * owns CALL command dispatch and lifecycle gating. */
export function createCallMessageRouter({ module, handlers = {} }) {
  if (!module) throw new Error('CALL message router requires module');
  const routes = new Map(Object.entries(handlers));
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
      return route(payload, sender);
    },
    enable() { return module.enable(); },
    disable() { return module.disable(); },
    open() { return module.open(); },
    destroy() { routes.clear(); module.destroy(); }
  });
}
