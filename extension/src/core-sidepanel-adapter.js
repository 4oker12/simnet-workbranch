"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__) return;
  const CORE_STATE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!core?.getState || !core?.subscribe) return;

  function publish(state = core.getState()) {
    chrome.runtime.sendMessage({ type: CORE_STATE, state }).catch(() => {});
  }

  function highlight(target) {
    const selectors = {
      subscriber: ["#customer-card-customer-id", "#ref_adr", "#dp-input", "a[href*='gotouser.php']"],
      session: ["#ref_ip_mac", "#dp-session", "[data-field='session']", "iframe[src*='juniper']"],
      line: ["#tableListData", ".table_port", "[data-field='onu']", "[id*='onu']", "[class*='onu']"]
    }[target] || [];
    const element = selectors.map(selector => document.querySelector(selector)).find(Boolean);
    if (!element) return false;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const previousOutline = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    element.style.setProperty("outline", "3px solid #b894ff", "important");
    element.style.setProperty("outline-offset", "4px", "important");
    window.setTimeout(() => {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOffset;
    }, 2600);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CORE_COMMAND) return false;
    try {
      if (message.action === "run") core.runDiagnostic();
      else if (message.action === "stop") core.stopDiagnostic();
      else if (message.action === "refresh") core.refresh();
      else if (message.action === "highlight") {
        sendResponse({ ok: highlight(message.target) });
        return false;
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return false;
  });

  const unsubscribe = core.subscribe(publish);
  window.addEventListener("pagehide", unsubscribe, { once: true });
  publish();
  globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__ = { version: "0.2.0", publish };
})();
