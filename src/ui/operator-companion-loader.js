(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.operatorCompanion) return;

  let loadPromise = null;

  function injectFeature() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'INJECT_FEATURE_SCRIPTS', payload: { feature: 'companion' } },
          response => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message || String(err)));
            if (!response?.success) return reject(new Error(response?.error || 'companion injection failed'));
            resolve(response.data || {});
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  function waitForOperatorCompanion(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (WB.__operatorCompanionLoaded && typeof WB.operatorCompanion?.open === 'function' && !WB.operatorCompanion.__lazy) {
          return resolve(WB.operatorCompanion);
        }
        if (Date.now() - started > timeoutMs) return reject(new Error('Operator Companion did not register'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  function ensure() {
    if (WB.__operatorCompanionLoaded && typeof WB.operatorCompanion?.open === 'function' && !WB.operatorCompanion.__lazy) {
      return Promise.resolve(WB.operatorCompanion);
    }
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await injectFeature();
      return waitForOperatorCompanion();
    })().catch(error => {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  WB.operatorCompanion = Object.freeze({
    __lazy: true,
    ensure,
    open: async options => (await ensure()).open(options),
    close: async () => {
      if (!WB.__operatorCompanionLoaded) return;
      return (await ensure()).close?.();
    },
    isOpen: () => WB.__operatorCompanionLoaded ? Boolean(WB.operatorCompanion?.isOpen?.()) : false
  });
})();
