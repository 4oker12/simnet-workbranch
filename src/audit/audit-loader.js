(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.auditLauncher || WB.__auditLauncherLoaded) return;
  let loadPromise = null;
  function isBillingListUrl(raw = location.href) {
    try {
      const url = new URL(raw, location.href);
      return url.hostname === 'admin.simnet.kiev.ua' && url.searchParams.get('a') === 'listuser';
    } catch { return false; }
  }
  function injectFeature(feature) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'INJECT_FEATURE_SCRIPTS', payload: { feature, force: Boolean(typeof force !== "undefined" && force) } },
          response => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message || String(err)));
            if (!response?.success) return reject(new Error(response?.error || 'inject failed'));
            resolve(response.data || {});
          }
        );
      } catch (e) { reject(e); }
    });
  }
  function waitForLauncher(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (WB.__auditLauncherLoaded && WB.auditLauncher && !WB.auditLauncher.__lazy) return resolve(WB.auditLauncher);
        if (Date.now() - started > timeoutMs) return reject(new Error('Audit launcher did not register'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }
  function ensure() {
    if (WB.__auditLauncherLoaded && WB.auditLauncher && !WB.auditLauncher.__lazy) return Promise.resolve(WB.auditLauncher);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => { await injectFeature('audit'); return waitForLauncher(); })()
      .catch(err => { loadPromise = null; throw err; });
    return loadPromise;
  }
  WB.auditLauncher = Object.freeze({
    __lazy: true, ensure,
    open: async (...a) => (await ensure()).open?.(...a),
    close: async (...a) => { if (!WB.__auditLauncherLoaded) return; return (await ensure()).close?.(...a); }
  });
  if (isBillingListUrl()) {
    const schedule = globalThis.requestIdleCallback || (fn => setTimeout(fn, 600));
    schedule(() => { void ensure().catch(() => {}); });  /* silent: optional warm-up */
  }
})();
