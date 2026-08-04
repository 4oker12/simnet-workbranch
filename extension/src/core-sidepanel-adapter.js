"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__) return;

  const CORE_STATE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
  const HIGHLIGHT_ROOT_ID = "simnet-wb-highlight-overlay";
  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!core?.getState || !core?.subscribe) return;

  function publish(state = core.getState()) {
    chrome.runtime.sendMessage({ type: CORE_STATE, state }).catch(() => {});
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function smallestVisible(candidates) {
    return candidates
      .filter(isVisible)
      .sort((left, right) => {
        const a = left.getBoundingClientRect();
        const b = right.getBoundingClientRect();
        return (a.width * a.height) - (b.width * b.height);
      })[0] || null;
  }

  function findByText(pattern) {
    const candidates = [];
    for (const element of document.querySelectorAll("a,button,[onclick],[role='button'],td,th,div,span,b,strong")) {
      if (!isVisible(element)) continue;
      const text = cleanText(element.textContent);
      if (!text || !pattern.test(text)) continue;
      candidates.push(element);
    }
    return smallestVisible(candidates);
  }

  function uniqueElements(items) {
    const seen = new Set();
    return items.filter(element => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function targetsFor(kind) {
    const context = core.getState()?.context || {};

    if (kind === "subscriber") {
      const login = cleanText(context.login);
      return uniqueElements([
        login ? findByText(new RegExp(`^${login}$`, "i")) : null,
        document.querySelector("a[href*='gotouser.php']"),
        document.querySelector("#customer-card-customer-id"),
        document.querySelector("#ref_adr")
      ]).filter(isVisible).slice(0, 3);
    }

    if (kind === "session") {
      return uniqueElements([
        findByText(/^Juniper$/i),
        findByText(/^Juniper\s*\(NEW\)$/i),
        document.querySelector("#ref_ip_mac"),
        document.querySelector("iframe[src*='juniper']")
      ]).filter(isVisible).slice(0, 4);
    }

    if (kind === "line") {
      return uniqueElements([
        findByText(/^Технические данные$/i),
        findByText(/BDCOM\s+EPON/i),
        findByText(/BDCOM\s+GPON/i),
        findByText(/^GCOM(?:\s|\(|$)/i),
        findByText(/HUAWEI\s+OLT/i),
        document.querySelector("#tableListData"),
        document.querySelector(".table_port")
      ]).filter(isVisible).slice(0, 7);
    }

    return [];
  }

  function clearHighlight() {
    document.getElementById(HIGHLIGHT_ROOT_ID)?.remove();
  }

  function createFrame(element, root, index) {
    const rect = element.getBoundingClientRect();
    const frame = document.createElement("div");
    frame.className = "simnet-wb-highlight-frame";
    Object.assign(frame.style, {
      position: "fixed",
      left: `${Math.max(2, rect.left - 4)}px`,
      top: `${Math.max(2, rect.top - 4)}px`,
      width: `${Math.max(12, rect.width + 8)}px`,
      height: `${Math.max(12, rect.height + 8)}px`,
      border: "3px solid #a8ee24",
      borderRadius: "8px",
      boxShadow: "0 0 0 3px rgba(168,238,36,.22), 0 0 24px rgba(168,238,36,.45)",
      zIndex: "2147483646",
      pointerEvents: "none"
    });
    frame.dataset.index = String(index);
    root.appendChild(frame);
  }

  function highlight(target) {
    clearHighlight();
    const elements = targetsFor(target);
    if (!elements.length) return { ok: false, count: 0 };

    elements[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

    window.setTimeout(() => {
      clearHighlight();
      const root = document.createElement("div");
      root.id = HIGHLIGHT_ROOT_ID;
      Object.assign(root.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483644",
        pointerEvents: "none"
      });

      const shade = document.createElement("div");
      Object.assign(shade.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(3,7,12,.56)",
        backdropFilter: "brightness(.72)",
        pointerEvents: "none"
      });
      root.appendChild(shade);

      elements.filter(isVisible).forEach((element, index) => createFrame(element, root, index));
      document.documentElement.appendChild(root);

      const clear = () => clearHighlight();
      window.setTimeout(clear, 4600);
      window.addEventListener("keydown", event => {
        if (event.key === "Escape") clear();
      }, { once: true, capture: true });
      window.addEventListener("pointerdown", clear, { once: true, capture: true });
    }, 260);

    return { ok: true, count: elements.length };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CORE_COMMAND) return false;
    try {
      if (message.action === "run") core.runDiagnostic();
      else if (message.action === "stop") core.stopDiagnostic();
      else if (message.action === "refresh") core.refresh();
      else if (message.action === "highlight") {
        sendResponse(highlight(message.target));
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
  globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__ = { version: "0.3.0", publish, highlight, clearHighlight };
})();
