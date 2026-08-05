"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_ROUTE__) return;

  const ROUTE_GET = "SIMNET_WB_MENTOR_ROUTE_GET";
  const ROUTE_COMMAND = "SIMNET_WB_MENTOR_ROUTE_COMMAND";
  const ROUTE_STATE = "SIMNET_WB_MENTOR_ROUTE_STATE";
  const HIGHLIGHT_ACK_KEY = "simnet_wb_route_highlight_ack_v1";
  const HIGHLIGHT_CLEARED_EVENT = "SIMNET_WB_HIGHLIGHT_CLEARED";
  const subscribers = new Set();
  let route = null;
  let lastAutoHighlightSignature = "";
  let currentHighlightSignature = "";
  let highlightTimer = 0;
  let acknowledgements = {};

  const ackReady = chrome.storage.session.get({ [HIGHLIGHT_ACK_KEY]: {} })
    .then(result => { acknowledgements = result?.[HIGHLIGHT_ACK_KEY] || {}; })
    .catch(() => { acknowledgements = {}; });

  function notify() {
    for (const listener of [...subscribers]) {
      try { listener(route); } catch (_) {}
    }
  }

  function routeSignature(value) {
    if (!value?.active) return "";
    return [
      value.subscriberKey || "",
      value.management?.routeId || "",
      value.management?.stage || "",
      value.management?.currentPage || "",
      value.action?.target || ""
    ].join(":");
  }

  function stageSignature(value) {
    if (!value?.active) return "";
    return [value.subscriberKey || "", value.management?.routeId || "", value.management?.stage || ""].join(":");
  }

  async function acknowledge(signature) {
    if (!signature) return;
    await ackReady;
    acknowledgements = {
      ...acknowledgements,
      [signature]: { acknowledgedAt: Date.now() }
    };
    try { await chrome.storage.session.set({ [HIGHLIGHT_ACK_KEY]: acknowledgements }); } catch (_) {}
  }

  async function autoHighlight(next) {
    window.clearTimeout(highlightTimer);
    if (!next?.active || !next.ui?.autoHighlight || !next.action?.pageMatched || !next.action?.target) return;
    await ackReady;
    const signature = routeSignature(next);
    if (!signature || acknowledgements[signature] || signature === lastAutoHighlightSignature) return;
    lastAutoHighlightSignature = signature;
    currentHighlightSignature = signature;
    highlightTimer = window.setTimeout(() => {
      const adapter = globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__;
      if (!adapter?.highlight) return;
      const current = route;
      if (!current?.active || routeSignature(current) !== signature) return;
      adapter.highlight(current.action.target);
    }, 520);
  }

  function setRoute(next) {
    const previousStage = stageSignature(route);
    const nextStage = stageSignature(next);
    if (previousStage && previousStage !== nextStage) {
      globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__?.clearHighlight?.("route-change");
      lastAutoHighlightSignature = "";
      currentHighlightSignature = "";
    }
    if (!next?.active && route?.active) {
      globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__?.clearHighlight?.("route-inactive");
      lastAutoHighlightSignature = "";
      currentHighlightSignature = "";
    }
    route = next || null;
    void autoHighlight(route);
    notify();
  }

  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({ type: ROUTE_GET });
      if (response?.ok) setRoute(response.route || null);
      return response?.route || null;
    } catch (_) {
      return null;
    }
  }

  async function execute(command = "") {
    const response = await chrome.runtime.sendMessage({ type: ROUTE_COMMAND, command });
    if (!response?.ok) throw new Error(response?.error || "Действие маршрута не выполнено");
    await refresh();
    return response;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    try { listener(route); } catch (_) {}
    return () => subscribers.delete(listener);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== ROUTE_STATE) return false;
    setRoute(message.route || null);
    return false;
  });

  window.addEventListener(HIGHLIGHT_CLEARED_EVENT, event => {
    const reason = event?.detail?.reason || "";
    if (!currentHighlightSignature || !["pointer", "escape"].includes(reason)) return;
    void acknowledge(currentHighlightSignature);
  });

  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  const unsubscribe = core?.subscribe?.(() => {
    window.setTimeout(refresh, 80);
  });

  globalThis.__SIMNET_MENTOR_ROUTE__ = {
    version: "0.2.0",
    getState: () => route,
    refresh,
    execute,
    highlight: () => execute("highlight"),
    subscribe,
    signature: routeSignature
  };

  window.addEventListener("pagehide", () => {
    window.clearTimeout(highlightTimer);
    unsubscribe?.();
    subscribers.clear();
  }, { once: true });

  void refresh();
})();
