"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_RAIL_SHELL__) return;

  const HOST_ID = "simnet-workbench-rail-shell";
  const SETTINGS_KEY = "dp_rail_shell_ui_v1";
  const PANEL_SELECTOR = "#dp-panel";
  const DEFAULT_STATE = Object.freeze({
    side: "right",
    open: true,
    hidden: false,
    activeView: "diagnostic"
  });

  const runtime = {
    host: null,
    root: null,
    panel: null,
    observer: null,
    frame: 0,
    installTimer: 0,
    statusObserver: null,
    state: { ...DEFAULT_STATE }
  };

  globalThis.__SIMNET_RAIL_SHELL__ = {
    version: "0.1.0",
    runtime,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!runtime.state.open)
  };

  const icons = Object.freeze({
    panel: "M4 5h16v14H4zM9 5v14M12 9h5M12 13h5",
    diagnostic: "M3 12h4l2.2-6 4.2 12L16 12h5",
    mentor: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4",
    results: "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5",
    journal: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
    side: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
    close: "M6 6l12 12M18 6 6 18",
    wake: "M4 6h16v12H4zM8 10h8M8 14h5"
  });

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.panel}"></path></svg>`;
  }

  function safeText(value, max = 180) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function readSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_STATE }, result => {
          if (chrome.runtime.lastError) return resolve({ ...DEFAULT_STATE });
          const saved = result && result[SETTINGS_KEY];
          resolve({
            side: saved?.side === "left" ? "left" : "right",
            open: saved?.open !== false,
            hidden: saved?.hidden === true,
            activeView: ["diagnostic", "mentor", "results", "journal"].includes(saved?.activeView)
              ? saved.activeView
              : "diagnostic"
          });
        });
      } catch (_) {
        resolve({ ...DEFAULT_STATE });
      }
    });
  }

  function persistSettings() {
    try {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...runtime.state } });
    } catch (_) {}
  }

  function setImportant(node, name, value) {
    if (!node) return;
    if (node.style.getPropertyValue(name) === value && node.style.getPropertyPriority(name) === "important") return;
    node.style.setProperty(name, value, "important");
  }

  function removeInline(node, name) {
    if (!node || !node.style.getPropertyValue(name)) return;
    node.style.removeProperty(name);
  }

  function releaseLegacyDock() {
    const html = document.documentElement;
    const body = document.body;
    html?.classList.remove("dp-workbench-dock-reserved");
    for (const node of [html, body]) {
      removeInline(node, "width");
      removeInline(node, "max-width");
      removeInline(node, "padding-right");
      removeInline(node, "box-sizing");
      removeInline(node, "overflow-x");
      removeInline(node, "--dp-workbench-dock-space");
    }
  }

  function applyPanelBridge() {
    const panel = runtime.panel;
    if (!panel || !panel.isConnected) return;

    panel.dataset.dpRailShell = "1";
    panel.slot = "workbench";
    panel.classList.remove("collapsed", "overlay-mode", "compact-layout", "random-wide-layout", "resizing");

    setImportant(panel, "position", "relative");
    setImportant(panel, "inset", "auto");
    setImportant(panel, "top", "auto");
    setImportant(panel, "right", "auto");
    setImportant(panel, "bottom", "auto");
    setImportant(panel, "left", "auto");
    setImportant(panel, "width", "100%");
    setImportant(panel, "min-width", "0");
    setImportant(panel, "max-width", "none");
    setImportant(panel, "height", "100%");
    setImportant(panel, "min-height", "0");
    setImportant(panel, "max-height", "none");
    setImportant(panel, "margin", "0");
    setImportant(panel, "transform", "none");
    setImportant(panel, "border-radius", "12px");
    setImportant(panel, "border", "0");
    setImportant(panel, "box-shadow", "none");

    for (const selector of ["#dp-panel-resize", "#dp-reset-panel", "#dp-minimize"]) {
      const node = panel.querySelector(selector);
      if (node) setImportant(node, "display", "none");
    }

    releaseLegacyDock();
  }

  function scheduleBridgeSync() {
    if (runtime.frame) return;
    runtime.frame = window.requestAnimationFrame(() => {
      runtime.frame = 0;
      applyPanelBridge();
      renderStatus();
    });
  }

  function shellMarkup() {
    const actions = [
      ["panel", "Панель", "panel"],
      ["diagnostic", "Диагностика", "diagnostic"],
      ["mentor", "Обучение", "mentor"],
      ["results", "Результаты", "results"],
      ["journal", "Журнал", "journal"]
    ];
    return `
      <div class="shell" data-side="right" data-open="true" data-hidden="false">
        <section class="card" aria-label="SIMNET Diagnostic Workbench">
          <header class="card-head">
            <div>
              <strong>SIMNET Workbench</strong>
              <span class="status-text">Загрузка…</span>
            </div>
            <button type="button" class="icon-button" data-action="close" aria-label="Закрыть карточку">${icon("close")}</button>
          </header>
          <div class="card-body"><slot name="workbench"></slot></div>
        </section>
        <nav class="rail" aria-label="Workbench rail">
          <button type="button" class="rail-logo" data-action="panel" aria-label="Открыть Workbench">
            <span class="status-dot" data-tone="idle"></span>${icon("wake")}
          </button>
          <div class="rail-actions">
            ${actions.map(([id, label, iconName]) => `
              <button type="button" data-action="${id}" aria-label="${label}" title="${label}">
                ${icon(iconName)}<span class="tooltip">${label}</span>
              </button>`).join("")}
          </div>
          <button type="button" data-action="side" aria-label="Переместить rail" title="Переместить rail">
            ${icon("side")}<span class="tooltip">Переместить</span>
          </button>
        </nav>
      </div>`;
  }

  function shellStyles() {
    return `
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        top: 12px;
        bottom: 12px;
        width: min(590px, calc(100vw - 12px));
        pointer-events: none;
        font: 12px/1.35 "Segoe UI", Arial, sans-serif;
      }
      :host([data-side="right"]) { right: 8px; left: auto; }
      :host([data-side="left"]) { left: 8px; right: auto; }
      *, *::before, *::after { box-sizing: border-box; }
      button { font: inherit; }
      svg {
        width: 21px;
        height: 21px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .shell {
        position: relative;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .rail {
        position: absolute;
        top: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 50px;
        max-height: calc(100vh - 24px);
        padding: 7px 5px;
        color: #dce7f5;
        background: rgba(13, 22, 36, .96);
        border: 1px solid rgba(129, 151, 181, .42);
        border-radius: 15px;
        box-shadow: 0 18px 50px rgba(3, 8, 18, .38);
        transform: translateY(-50%);
        pointer-events: auto;
        backdrop-filter: blur(14px);
      }
      .shell[data-side="right"] .rail { right: 0; }
      .shell[data-side="left"] .rail { left: 0; }
      .rail-actions {
        display: grid;
        gap: 5px;
        width: 100%;
        margin: 7px 0;
        padding: 7px 0;
        border-top: 1px solid rgba(129, 151, 181, .24);
        border-bottom: 1px solid rgba(129, 151, 181, .24);
      }
      .rail button, .icon-button {
        position: relative;
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        padding: 0;
        color: #c6d4e6;
        background: transparent;
        border: 0;
        border-radius: 10px;
        cursor: pointer;
      }
      .rail button:hover, .rail button:focus-visible, .rail button.active {
        color: #ffffff;
        background: #253650;
        outline: none;
      }
      .rail-logo { color: #75ead8 !important; }
      .status-dot {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        background: #7890ad;
        border: 2px solid #0d1624;
        border-radius: 50%;
      }
      .status-dot[data-tone="ok"] { background: #54d991; }
      .status-dot[data-tone="warning"] { background: #ffd166; }
      .status-dot[data-tone="error"] { background: #ff7b86; }
      .status-dot[data-tone="loading"] { background: #77b8ff; animation: pulse 1.1s infinite ease-in-out; }
      .tooltip {
        position: absolute;
        top: 50%;
        width: max-content;
        max-width: 220px;
        padding: 6px 8px;
        color: #f6f9fd;
        background: #111c2b;
        border: 1px solid #435674;
        border-radius: 7px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-50%);
        transition: opacity .12s ease;
        pointer-events: none;
        white-space: nowrap;
      }
      .shell[data-side="right"] .tooltip { right: 46px; }
      .shell[data-side="left"] .tooltip { left: 46px; }
      .rail button:hover .tooltip, .rail button:focus-visible .tooltip { opacity: 1; visibility: visible; }
      .card {
        position: absolute;
        top: 0;
        bottom: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        width: min(520px, calc(100vw - 76px));
        overflow: hidden;
        color: #f4f7fb;
        background: #111827;
        border: 1px solid #43536c;
        border-radius: 14px;
        box-shadow: 0 22px 72px rgba(3, 8, 18, .42);
        opacity: 0;
        visibility: hidden;
        transform: translateX(14px) scale(.985);
        transition: opacity .16s ease, transform .16s ease, visibility .16s ease;
        pointer-events: none;
      }
      .shell[data-side="right"] .card { right: 60px; }
      .shell[data-side="left"] .card { left: 60px; transform: translateX(-14px) scale(.985); }
      .shell[data-open="true"] .card {
        opacity: 1;
        visibility: visible;
        transform: translateX(0) scale(1);
        pointer-events: auto;
      }
      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 48px;
        padding: 8px 10px 8px 14px;
        color: #edf4fd;
        background: linear-gradient(135deg, #23334d, #172239);
        border-bottom: 1px solid #40506a;
      }
      .card-head > div { display: grid; gap: 2px; min-width: 0; }
      .card-head strong { font-size: 13px; letter-spacing: .02em; }
      .card-head span { color: #aebed2; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .icon-button { flex: 0 0 auto; color: #d3dfed; background: #2d3d56; border: 1px solid #526783; }
      .icon-button:hover { color: #fff; background: #3a4e6d; }
      .card-body { min-height: 0; overflow: hidden; }
      ::slotted(#dp-panel) { width: 100% !important; height: 100% !important; min-width: 0 !important; max-width: none !important; }
      .shell[data-hidden="true"] .rail { opacity: .28; }
      @keyframes pulse { 0%,100% { opacity: .45; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
      @media (max-width: 760px) {
        :host { top: 6px; bottom: 6px; width: calc(100vw - 6px); }
        :host([data-side="right"]) { right: 3px; }
        :host([data-side="left"]) { left: 3px; }
        .card { width: calc(100vw - 66px); }
        .shell[data-side="right"] .card { right: 56px; }
        .shell[data-side="left"] .card { left: 56px; }
      }
    `;
  }

  function createHost() {
    if (runtime.host?.isConnected) return runtime.host;
    const stale = document.getElementById(HOST_ID);
    if (stale) stale.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.side = runtime.state.side;
    host.setAttribute("aria-label", "SIMNET Workbench rail shell");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${shellStyles()}</style>${shellMarkup()}`;
    (document.body || document.documentElement).appendChild(host);

    runtime.host = host;
    runtime.root = root;
    root.addEventListener("click", handleClick);
    applyShellState();
    return host;
  }

  function applyShellState() {
    const shell = runtime.root?.querySelector(".shell");
    if (!shell || !runtime.host) return;
    shell.dataset.side = runtime.state.side;
    shell.dataset.open = String(runtime.state.open && !runtime.state.hidden);
    shell.dataset.hidden = String(runtime.state.hidden);
    runtime.host.dataset.side = runtime.state.side;
    runtime.root.querySelectorAll("[data-action]").forEach(button => {
      const action = button.dataset.action;
      button.classList.toggle("active", action === runtime.state.activeView || (action === "panel" && runtime.state.open));
      if (action === "panel") button.setAttribute("aria-expanded", runtime.state.open ? "true" : "false");
    });
  }

  function setOpen(open) {
    runtime.state.open = Boolean(open);
    runtime.state.hidden = false;
    applyShellState();
    persistSettings();
    if (runtime.state.open) scheduleBridgeSync();
  }

  function setSide(side) {
    runtime.state.side = side === "left" ? "left" : "right";
    applyShellState();
    persistSettings();
  }

  function revealTarget(selector, activeView) {
    setOpen(true);
    runtime.state.activeView = activeView;
    applyShellState();
    persistSettings();
    window.requestAnimationFrame(() => {
      const target = runtime.panel?.querySelector(selector) || document.querySelector(selector);
      if (!target) return;
      try { target.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (_) { target.scrollIntoView(); }
    });
  }

  function activateMentor() {
    setOpen(true);
    runtime.state.activeView = "mentor";
    const panel = runtime.panel;
    if (panel?.dataset.operationMode !== "mentor") {
      panel?.querySelector('[data-dp-operation-mode="mentor"]')?.click();
    }
    applyShellState();
    persistSettings();
    window.requestAnimationFrame(() => revealTarget("#dp-mentor-workspace", "mentor"));
  }

  function emitAction(action) {
    const detail = { action, state: { ...runtime.state }, source: "rail-shell" };
    try { window.dispatchEvent(new CustomEvent("simnet-workbench-rail-action", { detail })); } catch (_) {}
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    emitAction(action);

    switch (action) {
      case "panel":
        setOpen(!runtime.state.open);
        break;
      case "close":
        setOpen(false);
        break;
      case "diagnostic":
        revealTarget("#dp-form", "diagnostic");
        break;
      case "mentor":
        activateMentor();
        break;
      case "results":
        revealTarget("#dp-results", "results");
        break;
      case "journal":
        revealTarget("#dp-journal-list", "journal");
        break;
      case "side":
        setSide(runtime.state.side === "right" ? "left" : "right");
        break;
      default:
        break;
    }
  }

  function statusTone(status) {
    const value = safeText(status?.textContent || "").toLowerCase();
    const classes = status?.classList;
    if (classes?.contains("error") || /ошиб|error|не удалось/.test(value)) return "error";
    if (classes?.contains("warning") || classes?.contains("stopped") || /предуп|warning|останов/.test(value)) return "warning";
    if (classes?.contains("loading") || /ищу|загрузка|опрос|собираю/.test(value)) return "loading";
    if (classes?.contains("ok") || /готов|заверш|успеш|online/.test(value)) return "ok";
    return "idle";
  }

  function renderStatus() {
    if (!runtime.root) return;
    const status = runtime.panel?.querySelector("#dp-status") || document.querySelector("#dp-status");
    const text = safeText(status?.textContent || "Workbench готов", 160) || "Workbench готов";
    const tone = statusTone(status);
    const label = runtime.root.querySelector(".status-text");
    const dot = runtime.root.querySelector(".status-dot");
    if (label && label.textContent !== text) label.textContent = text;
    if (dot && dot.dataset.tone !== tone) dot.dataset.tone = tone;
  }

  function observeRuntime() {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();

    runtime.observer = new MutationObserver(scheduleBridgeSync);
    for (const node of [runtime.panel, document.documentElement, document.body]) {
      if (node) runtime.observer.observe(node, { attributes: true, attributeFilter: ["style", "class"] });
    }

    const status = runtime.panel?.querySelector("#dp-status");
    if (status) {
      runtime.statusObserver = new MutationObserver(renderStatus);
      runtime.statusObserver.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    }
  }

  function attachPanel(panel) {
    if (!panel || !runtime.host) return false;
    runtime.panel = panel;
    panel.slot = "workbench";
    if (panel.parentElement !== runtime.host) runtime.host.appendChild(panel);
    applyPanelBridge();
    observeRuntime();
    renderStatus();
    return true;
  }

  function findAndAttachPanel() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return false;
    return attachPanel(panel);
  }

  async function install() {
    runtime.state = await readSettings();
    createHost();
    if (findAndAttachPanel()) return;

    let attempts = 0;
    runtime.installTimer = window.setInterval(() => {
      attempts += 1;
      if (findAndAttachPanel() || attempts >= 120) {
        window.clearInterval(runtime.installTimer);
        runtime.installTimer = 0;
      }
    }, 250);
  }

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && runtime.state.open) setOpen(false);
  }, true);
  window.addEventListener("resize", scheduleBridgeSync);
  window.addEventListener("pagehide", () => {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
    if (runtime.frame) window.cancelAnimationFrame(runtime.frame);
  });

  install();
})();
