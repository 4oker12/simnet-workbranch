"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_HIGHLIGHT_LIFECYCLE_FIX__) return;

  const ROOT_ID = "simnet-wb-highlight-overlay";
  const CLEARED_EVENT = "SIMNET_WB_HIGHLIGHT_CLEARED";
  const adapter = globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__;
  if (!adapter?.highlight || !adapter?.clearHighlight) return;

  const baseHighlight = adapter.highlight.bind(adapter);
  const nativeSetTimeout = window.setTimeout;
  let suppressExpiryUntil = 0;
  let restoreTimer = 0;
  let detachLifecycle = null;

  function patchedTimeout(callback, delay, ...args) {
    if (Number(delay) === 6800 && Date.now() < suppressExpiryUntil) return 0;
    return nativeSetTimeout.call(window, callback, delay, ...args);
  }

  function restoreTimerApi() {
    if (Date.now() < suppressExpiryUntil) {
      restoreTimer = nativeSetTimeout.call(window, restoreTimerApi, Math.max(40, suppressExpiryUntil - Date.now() + 20));
      return;
    }
    window.setTimeout = nativeSetTimeout;
    restoreTimer = 0;
  }

  function suppressLegacyExpiry() {
    suppressExpiryUntil = Math.max(suppressExpiryUntil, Date.now() + 760);
    window.setTimeout = patchedTimeout;
    if (!restoreTimer) restoreTimer = nativeSetTimeout.call(window, restoreTimerApi, 800);
  }

  function dispatchCleared(reason) {
    window.dispatchEvent(new CustomEvent(CLEARED_EVENT, { detail: { reason } }));
  }

  function clearHighlight(reason = "programmatic") {
    detachLifecycle?.();
    detachLifecycle = null;
    const root = document.getElementById(ROOT_ID);
    if (!root) return false;
    root.remove();
    dispatchCleared(reason);
    return true;
  }

  function applyWhiteHighlight(root) {
    if (!root) return;
    const style = document.createElement("style");
    style.dataset.whiteHighlight = "true";
    style.textContent = `
      @keyframes simnetWbPulse {
        0%,100% { transform:scale(1); opacity:.98; box-shadow:0 0 0 2px rgba(255,255,255,.68),0 0 20px rgba(255,255,255,.72); }
        50% { transform:scale(1.025); opacity:1; box-shadow:0 0 0 8px rgba(255,255,255,.20),0 0 40px rgba(255,255,255,.98); }
      }
      @keyframes simnetWbGroupPulse {
        0%,100% { box-shadow:0 0 0 2px rgba(255,255,255,.72),0 0 24px rgba(255,255,255,.72); }
        50% { box-shadow:0 0 0 8px rgba(255,255,255,.20),0 0 42px rgba(255,255,255,1); }
      }
      .simnet-wb-highlight-frame,
      .simnet-wb-blocked-group {
        border-color:#fff!important;
        background:rgba(255,255,255,.34)!important;
        backdrop-filter:brightness(2.15) contrast(1.08) saturate(.85)!important;
      }
    `;
    root.appendChild(style);
  }

  function attachLifecycle(root) {
    detachLifecycle?.();
    let closed = false;
    const finish = reason => {
      if (closed) return;
      closed = true;
      detachLifecycle?.();
      detachLifecycle = null;
      dispatchCleared(reason);
    };
    const onPointer = () => finish("pointer");
    const onKey = event => {
      if (event.key === "Escape") finish("escape");
    };
    window.addEventListener("pointerdown", onPointer, { once: true, capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    detachLifecycle = () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
    root.dataset.persistentHighlight = "true";
  }

  function highlight(target) {
    clearHighlight("replace");
    suppressLegacyExpiry();
    const result = baseHighlight(target);

    nativeSetTimeout.call(window, () => {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      applyWhiteHighlight(root);
      attachLifecycle(root);
    }, 330);

    return result;
  }

  adapter.highlight = highlight;
  adapter.clearHighlight = clearHighlight;
  adapter.version = "0.5.1";

  globalThis.__SIMNET_HIGHLIGHT_LIFECYCLE_FIX__ = {
    version: "0.1.1",
    highlight,
    clearHighlight
  };
})();
