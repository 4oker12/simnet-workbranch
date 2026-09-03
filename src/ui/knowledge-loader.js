(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || (WB.knowledge && !WB.knowledge.__lazy)) return;

  let loadPromise = null;

  function injectFeature(feature, force = false) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'INJECT_FEATURE_SCRIPTS', payload: { feature, force: Boolean(force) } },
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

  function waitFor(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (WB.__knowledgeLoaded && WB.knowledge && !WB.knowledge.__lazy) return resolve(WB.knowledge);
        if (Date.now() - started > timeoutMs) return reject(new Error('knowledge-base did not register'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  function ensure() {
    if (WB.__knowledgeLoaded && WB.knowledge && !WB.knowledge.__lazy) return Promise.resolve(WB.knowledge);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        await injectFeature('knowledge', false);
        return await waitFor(4000);
      } catch {
        await injectFeature('knowledge', true);
        return waitFor(8000);
      }
    })().catch(err => { loadPromise = null; throw err; });
    return loadPromise;
  }

  WB.knowledge = {
    __lazy: true,
    ensure,
    resolve(plan) {
      if (WB.__knowledgeLoaded && WB.knowledge && !WB.knowledge.__lazy) {
        return WB.knowledge.resolve?.(plan);
      }
      // Soft warm-up when LIVE first asks for tips; return empty until loaded.
      void ensure().catch(() => {});
      return null;
    }
  };
})();
