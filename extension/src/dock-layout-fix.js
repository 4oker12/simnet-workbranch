"use strict";

(() => {
  const OPEN_DOCK = "SIMNET_WB_OPEN_DOCK";
  const PANEL_VISIBILITY = "SIMNET_WB_PANEL_VISIBILITY";
  const HOST_ID = "simnet-workbench-dock";
  const PAGE_FIX_STYLE_ID = "simnet-workbench-dock-page-fix";
  const SHADOW_FIX_STYLE_ID = "simnet-workbench-dock-density-fix";

  function launcher() {
    return globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__ || null;
  }

  function ensurePageFixStyle() {
    let style = document.getElementById(PAGE_FIX_STYLE_ID);
    if (style) return style;

    style = document.createElement("style");
    style.id = PAGE_FIX_STYLE_ID;
    style.textContent = `
      html.simnet-wb-dock-reserved body {
        width: calc(100vw - var(--simnet-wb-dock-reserve, 0px)) !important;
        max-width: calc(100vw - var(--simnet-wb-dock-reserve, 0px)) !important;
        min-width: 0 !important;
        margin-right: var(--simnet-wb-dock-reserve, 0px) !important;
        padding-right: 0 !important;
        box-sizing: border-box !important;
        transition: width .2s ease, max-width .2s ease, margin-right .2s ease !important;
      }

      html.simnet-wb-dock-reserved #maindiv,
      html.simnet-wb-dock-reserved body > center,
      html.simnet-wb-dock-reserved body > div[align="center"] {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin-right: 0 !important;
        box-sizing: border-box !important;
        transition: width .2s ease, max-width .2s ease !important;
      }

      html.simnet-wb-dock-reserved #maindiv {
        overflow-x: auto !important;
        overflow-y: visible !important;
      }

      html.simnet-wb-dock-reserved #maindiv > table,
      html.simnet-wb-dock-reserved #maindiv table.width100 {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function ensureShadowDensity() {
    const host = document.getElementById(HOST_ID);
    const root = host?.shadowRoot;
    if (!root || root.getElementById(SHADOW_FIX_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = SHADOW_FIX_STYLE_ID;
    style.textContent = `
      .flyout {
        width: min(280px, calc(100vw - 48px)) !important;
        grid-template-rows: 36px minmax(0, 1fr) 30px !important;
        overflow: hidden !important;
      }

      .flyout-head {
        min-height: 36px !important;
        padding: 4px 6px !important;
      }

      .module-stage {
        padding: 4px !important;
        overflow: hidden !important;
      }

      .module-pane {
        gap: 4px !important;
        overflow: hidden !important;
      }

      .identity-row {
        height: 22px !important;
        padding: 0 !important;
      }

      .active-task {
        min-height: 76px !important;
        gap: 4px !important;
        padding: 6px !important;
        border-radius: 7px !important;
      }

      .task-heading {
        font-size: 7px !important;
      }

      .active-task > strong {
        font-size: 10px !important;
        line-height: 1.2 !important;
        -webkit-line-clamp: 1 !important;
      }

      .task-actions {
        gap: 3px !important;
      }

      .action-btn,
      .wide-action {
        height: 24px !important;
        padding: 0 5px !important;
        font-size: 7px !important;
        border-radius: 6px !important;
      }

      .mini-steps {
        gap: 1px !important;
      }

      .mini-step {
        grid-template-columns: 16px 58px minmax(0, 1fr) !important;
        min-height: 22px !important;
        gap: 3px !important;
        padding: 2px 3px !important;
      }

      .mini-step > span {
        width: 15px !important;
        height: 15px !important;
      }

      .mini-step strong,
      .mini-step small {
        font-size: 7px !important;
      }

      .module-intro {
        display: none !important;
      }

      .metric-grid,
      .script-list,
      .category-grid {
        gap: 4px !important;
      }

      .metric-card {
        min-height: 46px !important;
        padding: 5px !important;
      }

      .script-btn,
      .category-btn {
        min-height: 36px !important;
        padding: 5px 6px !important;
      }

      .script-btn span {
        -webkit-line-clamp: 1 !important;
      }

      .dock-footer {
        min-height: 30px !important;
        padding: 3px 5px !important;
      }

      .footer-chip {
        height: 21px !important;
        padding: 0 4px !important;
        font-size: 7px !important;
      }
    `;
    root.appendChild(style);
  }

  function forceDockVisible() {
    const api = launcher();
    api?.setRailVisible?.(true);
    ensurePageFixStyle();
    ensureShadowDensity();
  }

  function openDock(module = "active") {
    forceDockVisible();
    launcher()?.open?.(module);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === PANEL_VISIBILITY && message.visible === false) {
      queueMicrotask(forceDockVisible);
      return false;
    }

    if (message?.type === OPEN_DOCK) {
      openDock(message.module || "active");
      sendResponse?.({ ok: true });
      return false;
    }

    return false;
  });

  const observer = new MutationObserver(() => {
    ensurePageFixStyle();
    ensureShadowDensity();
  });

  function install() {
    forceDockVisible();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
