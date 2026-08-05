"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_ROUTE__) return;

  const ROUTE_GET = "SIMNET_WB_MENTOR_ROUTE_GET";
  const ROUTE_COMMAND = "SIMNET_WB_MENTOR_ROUTE_COMMAND";
  const ROUTE_STATE = "SIMNET_WB_MENTOR_ROUTE_STATE";
  const subscribers = new Set();
  let route = null;
  let lastAutoHighlightSignature = "";
  let highlightTimer = 0;

  function notify() {
    for (const listener of [...subscribers]) {
      try { listener(route); } catch (_) {}
    }
  }

  function autoHighlight(next) {
    window.clearTimeout(highlightTimer);
    if (!next?.active || !next.ui?.autoHighlight || !next.action?.pageMatched || !next.action?.target) return;
    const signature = `${next.subscriberKey}:${next.revision}:${next.management?.currentPage}:${next.action.target}`;
    if (signature === lastAutoHighlightSignature) return;
    lastAutoHighlightSignature = signature;
    highlightTimer = window.setTimeout(() => {
      const adapter = globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__;
      if (!adapter?.highlight) return;
      const current = route;
      if (!current?.active || !current.action?.pageMatched || current.action?.target !== next.action.target) return;
      adapter.highlight(current.action.target);
    }, 520);
  }

  function setRoute(next) {
    route = next || null;
    autoHighlight(route);
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

  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  const unsubscribe = core?.subscribe?.(() => {
    window.setTimeout(refresh, 80);
  });

  globalThis.__SIMNET_MENTOR_ROUTE__ = {
    version: "0.1.0",
    getState: () => route,
    refresh,
    execute,
    highlight: () => execute("highlight"),
    subscribe
  };

  window.addEventListener("pagehide", () => {
    window.clearTimeout(highlightTimer);
    unsubscribe?.();
    subscribers.clear();
  }, { once: true });

  void refresh();
})();
