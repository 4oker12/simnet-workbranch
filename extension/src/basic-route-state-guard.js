"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_BASIC_ROUTE_STATE_GUARD__) return;

  const VERSION = "0.1.0";
  const STORAGE_KEY = "simnet_wb_basic_diagnostic_route_v1";
  const BASIC_OVERLAY_ID = "simnet-wb-basic-route-overlay";
  const FOREIGN_OVERLAY_IDS = ["simnet-wb-highlight-overlay", "dp-mentor-spotlight"];
  const MONOTONIC_FLAGS = [
    "sessionReviewed",
    "technicalReviewed",
    "pollerOpened",
    "askStarted",
    "resultReviewed",
    "completed"
  ];

  let restoring = false;
  let resetAllowedUntil = 0;

  const clone = value => {
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value || {})); }
  };

  function mergeOlt(previous = {}, incoming = {}) {
    if (incoming.present) {
      return {
        ...previous,
        ...incoming,
        present: true,
        confirmedAt: Number(incoming.confirmedAt || previous.confirmedAt || Date.now())
      };
    }

    // A temporarily missing Selectize control or an empty partial DOM is not
    // evidence that a previously confirmed Billing OLT disappeared.
    if (previous.present) {
      return {
        ...incoming,
        ...previous,
        present: true
      };
    }

    return { ...previous, ...incoming, present: false };
  }

  function mergeSubscriberState(previous, incoming) {
    if (!previous) return clone(incoming);
    if (!incoming) return clone(previous);

    const merged = { ...previous, ...incoming };
    for (const flag of MONOTONIC_FLAGS) {
      merged[flag] = Boolean(previous[flag] || incoming[flag]);
    }

    merged.sessionStatus = incoming.sessionStatus && incoming.sessionStatus !== "unknown"
      ? incoming.sessionStatus
      : previous.sessionStatus || incoming.sessionStatus || "unknown";
    merged.sessionSummary = incoming.sessionSummary || previous.sessionSummary || "";
    merged.olt = mergeOlt(previous.olt, incoming.olt);
    merged.updatedAt = Math.max(Number(previous.updatedAt || 0), Number(incoming.updatedAt || 0));
    return merged;
  }

  function mergeStateMaps(previous = {}, incoming = {}) {
    const merged = { ...incoming };
    for (const key of new Set([...Object.keys(previous || {}), ...Object.keys(incoming || {})])) {
      merged[key] = mergeSubscriberState(previous?.[key], incoming?.[key]);
    }
    return merged;
  }

  function stableJson(value) {
    try { return JSON.stringify(value); }
    catch (_) { return ""; }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session" || restoring || Date.now() < resetAllowedUntil) return;
    const change = changes?.[STORAGE_KEY];
    if (!change) return;

    const previous = change.oldValue || {};
    const incoming = change.newValue || {};
    const merged = mergeStateMaps(previous, incoming);
    if (stableJson(merged) === stableJson(incoming)) return;

    restoring = true;
    chrome.storage.session.set({ [STORAGE_KEY]: merged })
      .catch(() => {})
      .finally(() => { restoring = false; });
  });

  function basicRouteActive() {
    return Boolean(document.getElementById(BASIC_OVERLAY_ID));
  }

  function clearForeignHighlights() {
    if (!basicRouteActive()) return;
    for (const id of FOREIGN_OVERLAY_IDS) document.getElementById(id)?.remove();
    document.querySelectorAll(".dp-mentor-highlight").forEach(element => {
      element.classList.remove("dp-mentor-highlight");
    });
  }

  function wrapExplicitReset() {
    const route = globalThis.__SIMNET_BASIC_DIAGNOSTIC_ROUTE__;
    if (!route || route.__stateGuardWrapped) return false;
    const originalReset = typeof route.reset === "function" ? route.reset.bind(route) : null;
    if (originalReset) {
      route.reset = async (...args) => {
        resetAllowedUntil = Date.now() + 1500;
        return originalReset(...args);
      };
    }
    route.isActive = basicRouteActive;
    route.__stateGuardWrapped = true;
    return true;
  }

  const observer = new MutationObserver(() => {
    clearForeignHighlights();
    wrapExplicitReset();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  globalThis.__SIMNET_BASIC_ROUTE_STATE_GUARD__ = {
    version: VERSION,
    mergeSubscriberState,
    mergeStateMaps,
    isActive: basicRouteActive
  };

  wrapExplicitReset();
  clearForeignHighlights();
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();
