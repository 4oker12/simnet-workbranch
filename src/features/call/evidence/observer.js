(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.callEvidenceObserver) return;
  let enabled = true;
  const api = {
    enable() { enabled = true; return true; },
    disable() { enabled = false; return true; },
    open() { enabled = true; return true; },
    destroy() { enabled = false; },
    enabled() { return enabled && !WB.runtime?.destroyed; }
  };
  WB.callEvidenceObserver = Object.freeze(api);
})();
