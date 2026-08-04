"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__) return;

  const HOST_ID = "simnet-workbench-dock";
  const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
  const RAIL_WIDTH = 48;
  const state = { basePaddingRight: "0px", observer: null };
  const icons = {
    live: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z"
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"></path></svg>`;
  const open = mode => chrome.runtime.sendMessage({ type: OPEN_PANEL, mode: mode === "quick" ? "quick" : "live" }).catch(() => {});

  function reserveRailSpace() {
    if (!document.body) return;
    document.body.style.setProperty("padding-right", `calc(${state.basePaddingRight} + ${RAIL_WIDTH}px)`, "important");
    document.body.style.setProperty("box-sizing", "border-box", "important");
  }

  function hideLegacyRuntime() {
    document.getElementById("simnet-mentor-shell")?.remove();
    for (const selector of [
      "#simnet-map-investigation-launcher-v3",
      "#simnet-map-investigation-panel-v3",
      "#simnet-map-investigation-launcher",
      "#simnet-map-investigation-panel"
    ]) {
      const node = document.querySelector(selector);
      if (node) node.style.setProperty("display", "none", "important");
    }

    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    panel.dataset.sidepanelRuntime = "hidden";
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("left", "-100000px", "important");
    panel.style.setProperty("top", "-100000px", "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");
    panel.style.setProperty("width", "1px", "important");
    panel.style.setProperty("height", "1px", "important");
    panel.style.setProperty("min-width", "0", "important");
    panel.style.setProperty("max-width", "1px", "important");
    panel.style.setProperty("max-height", "1px", "important");
    panel.style.setProperty("overflow", "hidden", "important");
    panel.style.setProperty("opacity", "0", "important");
    panel.style.setProperty("pointer-events", "none", "important");
    panel.style.setProperty("clip-path", "inset(100%)", "important");
    panel.style.setProperty("transform", "none", "important");
  }

  function installRail() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;z-index:2147483647;right:0;top:0;width:${RAIL_WIDTH}px;height:100vh}
      *{box-sizing:border-box}nav{display:flex;flex-direction:column;align-items:center;gap:7px;width:${RAIL_WIDTH}px;height:100%;padding:8px 5px;background:#090f17;border-left:1px solid #27364a;box-shadow:-5px 0 18px rgba(0,0,0,.24)}
      button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8492a6;background:transparent;border:0;border-radius:9px;cursor:pointer}
      button:hover,button:focus-visible{color:#fff;background:#192638;outline:none}button.primary{color:#d7c2ff;background:#2a2040;border:1px solid #5a4680}.spacer{flex:1}
      svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .tip{position:absolute;right:46px;top:50%;padding:5px 7px;color:#fff;background:#101826;border:1px solid #34465e;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;font:11px "Segoe UI",Arial,sans-serif;pointer-events:none}
      button:hover .tip{opacity:1;visibility:visible}
      .live-dot{position:absolute;right:5px;bottom:5px;width:6px;height:6px;background:#58d690;border:1px solid #0b1510;border-radius:50%}
    </style><nav aria-label="Workbench Live Assistant">
      <button class="primary" data-mode="live">${svg("live")}<span class="live-dot"></span><span class="tip">Live Assistant</span></button>
      <button data-mode="quick">${svg("quick")}<span class="tip">Быстрые факты</span></button>
      <span class="spacer"></span>
    </nav>`;
    root.addEventListener("click", event => {
      const button = event.target.closest("button[data-mode]");
      if (button) open(button.dataset.mode);
    });
    (document.body || document.documentElement).appendChild(host);
  }

  function install() {
    if (document.body) state.basePaddingRight = getComputedStyle(document.body).paddingRight || "0px";
    installRail();
    reserveRailSpace();
    hideLegacyRuntime();
    state.observer = new MutationObserver(() => {
      hideLegacyRuntime();
      reserveRailSpace();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__ = { version: "0.2.0", open };
  window.addEventListener("pagehide", () => state.observer?.disconnect(), { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
