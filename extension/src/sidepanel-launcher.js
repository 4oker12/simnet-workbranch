"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__) return;

  const HOST_ID = "simnet-workbench-dock";
  const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
  const PANEL_VISIBILITY = "SIMNET_WB_PANEL_VISIBILITY";
  const RAIL_WIDTH = 48;
  const USERSIDE_HEADER_HEIGHT = 48;
  const state = {
    basePaddingRight: "0px",
    observer: null,
    host: null,
    root: null,
    visible: true,
    layout: "compact",
    opening: false,
    errorTimer: 0,
    lastHref: ""
  };

  const icons = {
    live: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z"
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"></path></svg>`;

  function isSubscriberWorkspace() {
    const host = location.hostname;
    const path = location.pathname;
    const params = new URLSearchParams(location.search);

    if (host === "userside.simnet.kiev.ua") {
      return /^\/customer\/\d+/.test(path)
        || /^\/script\/(?:gotouser|bill)\.php/.test(path);
    }

    if (/^admin\.(?:simnet|looknet)\.kiev\.ua$/.test(host)) {
      const action = params.get("a") || "";
      return (path.endsWith("/adm.pl") && ["user", "dopdata"].includes(action))
        || (path.endsWith("/stat.pl") && ["310", "311", "312", "313"].includes(action));
    }

    return false;
  }

  function launcherTop() {
    return location.hostname === "userside.simnet.kiev.ua" ? USERSIDE_HEADER_HEIGHT : 0;
  }

  function applyPageSpacing() {
    if (!document.body) return;
    if (state.visible && state.layout === "full") {
      document.body.style.setProperty("padding-right", `calc(${state.basePaddingRight} + ${RAIL_WIDTH}px)`, "important");
      document.body.style.setProperty("box-sizing", "border-box", "important");
      return;
    }
    document.body.style.setProperty("padding-right", state.basePaddingRight, "important");
    document.body.style.removeProperty("box-sizing");
  }

  function applyGeometry() {
    if (!state.host || !state.root) return;
    const offset = launcherTop();
    state.host.dataset.layout = state.layout;
    state.host.style.setProperty("top", `${offset}px`, "important");
    state.host.style.setProperty("right", state.layout === "full" ? "0" : "8px", "important");
    state.host.style.setProperty("width", `${RAIL_WIDTH}px`, "important");
    state.host.style.setProperty("height", state.layout === "full" ? `calc(100vh - ${offset}px)` : "auto", "important");
    const nav = state.root.querySelector("nav");
    if (nav) nav.dataset.layout = state.layout;
    applyPageSpacing();
  }

  function syncLayout() {
    const next = isSubscriberWorkspace() ? "full" : "compact";
    if (next === state.layout && state.lastHref === location.href) return;
    state.layout = next;
    state.lastHref = location.href;
    applyGeometry();
  }

  function setRailVisible(visible) {
    state.visible = Boolean(visible);
    if (state.host) state.host.style.setProperty("display", state.visible ? "block" : "none", "important");
    applyPageSpacing();
  }

  function showError(message) {
    clearTimeout(state.errorTimer);
    const node = state.root?.querySelector(".error");
    if (!node) return;
    node.textContent = String(message || "Не удалось открыть панель").slice(0, 140);
    node.hidden = false;
    state.errorTimer = window.setTimeout(() => { node.hidden = true; }, 3500);
  }

  async function open(mode, button) {
    if (state.opening) return;
    state.opening = true;
    button?.classList.add("opening");
    button?.setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({
        type: OPEN_PANEL,
        mode: mode === "quick" ? "quick" : "live"
      });
      if (!response?.ok) throw new Error(response?.error || "Chrome Side Panel не открылся");
    } catch (error) {
      showError(error?.message || error);
    } finally {
      state.opening = false;
      button?.classList.remove("opening");
      button?.removeAttribute("aria-busy");
    }
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
    for (const [property, value] of Object.entries({
      position: "fixed",
      left: "-100000px",
      top: "-100000px",
      right: "auto",
      bottom: "auto",
      width: "1px",
      height: "1px",
      "min-width": "0",
      "max-width": "1px",
      "max-height": "1px",
      overflow: "hidden",
      opacity: "0",
      "pointer-events": "none",
      "clip-path": "inset(100%)",
      transform: "none"
    })) panel.style.setProperty(property, value, "important");
  }

  function installRail() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;z-index:2147483647;right:0;top:0;width:${RAIL_WIDTH}px;height:100vh}
      *{box-sizing:border-box}
      nav{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;width:${RAIL_WIDTH}px;height:100%;padding:8px 5px;background:#090f17;border-left:1px solid #27364a;box-shadow:-5px 0 18px rgba(0,0,0,.24)}
      nav[data-layout="compact"]{height:auto;padding:5px;background:#0b121c;border:1px solid #314158;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.28)}
      nav[data-layout="compact"] .spacer,nav[data-layout="compact"] button[data-mode="quick"]{display:none}
      button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8492a6;background:transparent;border:0;border-radius:9px;cursor:pointer;touch-action:manipulation}
      button:hover,button:focus-visible{color:#fff;background:#192638;outline:none}
      button.primary{color:#d7c2ff;background:#2a2040;border:1px solid #5a4680}
      button.opening{color:#58d690;animation:pulse .75s ease-in-out infinite alternate}
      .spacer{flex:1}
      svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
      .tip{position:absolute;right:46px;top:50%;padding:5px 7px;color:#fff;background:#101826;border:1px solid #34465e;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;font:11px "Segoe UI",Arial,sans-serif;pointer-events:none}
      button:hover .tip{opacity:1;visibility:visible}
      .live-dot{position:absolute;right:5px;bottom:5px;width:6px;height:6px;background:#58d690;border:1px solid #0b1510;border-radius:50%;pointer-events:none}
      .error{position:absolute;right:52px;top:4px;width:220px;padding:8px 9px;color:#ffd8dc;background:#301820;border:1px solid #74313f;border-radius:8px;font:11px/1.35 "Segoe UI",Arial,sans-serif;box-shadow:0 10px 24px rgba(0,0,0,.28)}
      @keyframes pulse{from{transform:scale(.94)}to{transform:scale(1.04)}}
    </style><nav aria-label="Workbench Live Assistant" data-layout="compact">
      <button type="button" class="primary" data-mode="live" aria-label="Открыть Live Assistant">${svg("live")}<span class="live-dot"></span><span class="tip">Live Assistant</span></button>
      <button type="button" data-mode="quick" aria-label="Открыть быстрые факты">${svg("quick")}<span class="tip">Быстрые факты</span></button>
      <span class="spacer"></span>
      <div class="error" hidden></div>
    </nav>`;

    root.addEventListener("click", event => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      void open(button.dataset.mode, button);
    });

    (document.body || document.documentElement).appendChild(host);
    state.host = host;
    state.root = root;
    syncLayout();
    setRailVisible(state.visible);
  }

  function install() {
    if (document.body) state.basePaddingRight = getComputedStyle(document.body).paddingRight || "0px";
    installRail();
    hideLegacyRuntime();
    state.observer = new MutationObserver(() => {
      hideLegacyRuntime();
      syncLayout();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", syncLayout);
    window.addEventListener("hashchange", syncLayout);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== PANEL_VISIBILITY) return false;
    setRailVisible(message.visible);
    return false;
  });

  globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__ = {
    version: "0.4.0",
    open: mode => open(mode, null),
    setRailVisible,
    syncLayout
  };

  window.addEventListener("pagehide", () => {
    state.observer?.disconnect();
    clearTimeout(state.errorTimer);
  }, { once: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
