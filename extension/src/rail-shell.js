"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_RAIL_SHELL__) return;

  const HOST_ID = "simnet-workbench-rail-shell";
  const SETTINGS_KEY = "dp_rail_shell_ui_v2";
  const PANEL_SELECTOR = "#dp-panel";
  const MODES = new Set(["diagnostic", "mentor"]);
  const DEFAULT_STATE = Object.freeze({ side: "right", open: true, mode: "diagnostic" });

  const runtime = {
    host: null,
    root: null,
    panel: null,
    observer: null,
    statusObserver: null,
    installTimer: 0,
    frame: 0,
    state: { ...DEFAULT_STATE }
  };

  const icons = Object.freeze({
    wake: "M4 6h16v12H4zM8 10h8M8 14h5",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    side: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
    close: "M6 6l12 12M18 6 6 18"
  });

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.wake}"></path></svg>`;
  }

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return MODES.has(mode) ? mode : "diagnostic";
  }

  function safeText(value, max = 160) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function readSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_STATE }, result => {
          if (chrome.runtime.lastError) return resolve({ ...DEFAULT_STATE });
          const saved = result?.[SETTINGS_KEY] || DEFAULT_STATE;
          resolve({
            side: saved.side === "left" ? "left" : "right",
            open: saved.open !== false,
            mode: normalizeMode(saved.mode)
          });
        });
      } catch (_) {
        resolve({ ...DEFAULT_STATE });
      }
    });
  }

  function persistSettings() {
    try { chrome.storage.local.set({ [SETTINGS_KEY]: { ...runtime.state } }); } catch (_) {}
  }

  function setImportant(node, name, value) {
    if (!node) return;
    if (node.style.getPropertyValue(name) === value && node.style.getPropertyPriority(name) === "important") return;
    node.style.setProperty(name, value, "important");
  }

  function removeInline(node, name) {
    if (!node?.style?.getPropertyValue(name)) return;
    node.style.removeProperty(name);
  }

  function releaseLegacyDock() {
    const html = document.documentElement;
    const body = document.body;
    const reserved = html?.classList.contains("dp-workbench-dock-reserved");
    html?.classList.remove("dp-workbench-dock-reserved");
    if (!reserved) return;
    for (const node of [html, body]) {
      removeInline(node, "width");
      removeInline(node, "max-width");
      removeInline(node, "padding-right");
      removeInline(node, "box-sizing");
      removeInline(node, "overflow-x");
      removeInline(node, "--dp-workbench-dock-space");
    }
  }

  function currentPanelMode() {
    return normalizeMode(runtime.panel?.dataset.operationMode || runtime.state.mode);
  }

  function patchLegacyLabels() {
    const panel = runtime.panel;
    if (!panel) return;

    const oldModeRow = panel.querySelector("#dp-operation-mode");
    if (oldModeRow) {
      oldModeRow.setAttribute("aria-hidden", "true");
      setImportant(oldModeRow, "display", "none");
    }

    const mentorTitle = panel.querySelector("#dp-mentor-workspace .dp-mentor-header b");
    if (mentorTitle && mentorTitle.textContent !== "Диагност-наставник") mentorTitle.textContent = "Диагност-наставник";

    const routeLabel = panel.querySelector("#dp-mentor-workspace .dp-mentor-progress span");
    if (routeLabel && routeLabel.textContent !== "Диагностический маршрут") routeLabel.textContent = "Диагностический маршрут";

    const reset = panel.querySelector("#dp-mentor-reset");
    if (reset) {
      reset.textContent = "Сбросить";
      reset.title = "Сбросить маршрут проверок для текущего контекста";
    }
  }

  function applyPanelBridge() {
    const panel = runtime.panel;
    if (!panel?.isConnected) return;

    panel.dataset.dpRailShell = "1";
    panel.dataset.dpRailMode = currentPanelMode();
    panel.slot = "workbench";
    panel.classList.remove("collapsed", "overlay-mode", "compact-layout", "random-wide-layout", "resizing");

    const styles = {
      position: "relative", inset: "auto", top: "auto", right: "auto", bottom: "auto", left: "auto",
      width: "100%", "min-width": "0", "max-width": "none", height: "100%", "min-height": "0",
      "max-height": "none", margin: "0", transform: "none", border: "0", "border-radius": "12px", "box-shadow": "none"
    };
    for (const [name, value] of Object.entries(styles)) setImportant(panel, name, value);

    for (const selector of ["#dp-panel-resize", "#dp-reset-panel", "#dp-minimize"]) {
      const node = panel.querySelector(selector);
      if (node) setImportant(node, "display", "none");
    }

    patchLegacyLabels();
    releaseLegacyDock();
  }

  function scheduleSync() {
    if (runtime.frame) return;
    runtime.frame = window.requestAnimationFrame(() => {
      runtime.frame = 0;
      const mode = currentPanelMode();
      if (runtime.state.mode !== mode) {
        runtime.state.mode = mode;
        persistSettings();
      }
      applyPanelBridge();
      applyShellState();
      renderStatus();
    });
  }

  function shellMarkup() {
    return `
      <div class="shell" data-side="right" data-open="true" data-mode="diagnostic">
        <section class="card" aria-label="SIMNET Diagnostic Workbench">
          <header class="modebar">
            <div class="mode-tabs" role="tablist" aria-label="Режим работы">
              <button type="button" data-action="diagnostic" role="tab" aria-label="Быстрая диагностика">
                ${icon("quick")}<span><b>Быстрая</b><small>автоматический разбор</small></span>
              </button>
              <button type="button" data-action="mentor" role="tab" aria-label="Диагност-наставник">
                ${icon("mentor")}<span><b>Наставник</b><small>проверки и объяснения</small></span>
              </button>
            </div>
            <button type="button" class="close-button" data-action="close" aria-label="Свернуть Workbench">${icon("close")}</button>
          </header>
          <div class="card-body"><slot name="workbench"></slot></div>
        </section>

        <nav class="rail" aria-label="Workbench">
          <button type="button" class="rail-logo" data-action="panel" aria-label="Открыть или свернуть Workbench">
            <span class="status-dot" data-tone="idle"></span>${icon("wake")}<span class="tooltip">Workbench</span>
          </button>
          <div class="rail-primary">
            <button type="button" data-action="diagnostic" aria-label="Быстрая диагностика">
              ${icon("quick")}<span class="tooltip">Быстрая диагностика</span>
            </button>
            <button type="button" data-action="mentor" aria-label="Диагност-наставник">
              ${icon("mentor")}<span class="tooltip">Диагност-наставник</span>
            </button>
          </div>
          <div class="rail-secondary">
            <button type="button" data-action="history" aria-label="История абонента">
              ${icon("history")}<span class="tooltip">История абонента</span>
            </button>
            <button type="button" data-action="side" aria-label="Переместить панель">
              ${icon("side")}<span class="tooltip">Переместить панель</span>
            </button>
          </div>
        </nav>
      </div>`;
  }

  function shellStyles() {
    return `
      :host { all:initial; position:fixed; z-index:2147483647; top:10px; bottom:10px; width:min(590px,calc(100vw - 10px)); pointer-events:none; font:12px/1.35 "Segoe UI",Arial,sans-serif; }
      :host([data-side="right"]) { right:6px; left:auto; }
      :host([data-side="left"]) { left:6px; right:auto; }
      *,*::before,*::after { box-sizing:border-box; }
      button { font:inherit; }
      svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .shell { position:relative; width:100%; height:100%; pointer-events:none; }
      .rail { position:absolute; top:50%; display:flex; flex-direction:column; align-items:center; width:50px; padding:7px 5px; color:#c7d4e6; background:rgba(13,22,36,.97); border:1px solid rgba(129,151,181,.42); border-radius:15px; box-shadow:0 18px 48px rgba(3,8,18,.38); transform:translateY(-50%); pointer-events:auto; backdrop-filter:blur(14px); }
      .shell[data-side="right"] .rail { right:0; }
      .shell[data-side="left"] .rail { left:0; }
      .rail-primary,.rail-secondary { display:grid; gap:5px; width:100%; }
      .rail-primary { margin:7px 0; padding:7px 0; border-top:1px solid rgba(129,151,181,.22); border-bottom:1px solid rgba(129,151,181,.22); }
      .rail-secondary { padding-top:1px; }
      .rail button,.close-button { position:relative; display:grid; place-items:center; width:38px; height:38px; padding:0; color:inherit; background:transparent; border:0; border-radius:10px; cursor:pointer; }
      .rail button:hover,.rail button:focus-visible,.rail button.active { color:#fff; background:#253650; outline:none; }
      .rail button.active { color:#79ead9; background:#213849; box-shadow:inset 0 0 0 1px rgba(121,234,217,.22); }
      .rail-logo { color:#79ead9 !important; }
      .status-dot { position:absolute; top:4px; right:4px; width:8px; height:8px; background:#7890ad; border:2px solid #0d1624; border-radius:50%; }
      .status-dot[data-tone="ok"] { background:#54d991; }
      .status-dot[data-tone="warning"] { background:#ffd166; }
      .status-dot[data-tone="error"] { background:#ff7b86; }
      .status-dot[data-tone="loading"] { background:#77b8ff; animation:pulse 1.1s infinite ease-in-out; }
      .tooltip { position:absolute; top:50%; z-index:3; width:max-content; max-width:220px; padding:6px 8px; color:#f6f9fd; background:#111c2b; border:1px solid #435674; border-radius:7px; box-shadow:0 8px 24px rgba(0,0,0,.28); opacity:0; visibility:hidden; transform:translateY(-50%); transition:opacity .12s ease; pointer-events:none; white-space:nowrap; }
      .shell[data-side="right"] .tooltip { right:46px; }
      .shell[data-side="left"] .tooltip { left:46px; }
      .rail button:hover .tooltip,.rail button:focus-visible .tooltip { opacity:1; visibility:visible; }
      .card { position:absolute; top:0; bottom:0; display:grid; grid-template-rows:auto minmax(0,1fr); width:min(520px,calc(100vw - 74px)); overflow:hidden; color:#f4f7fb; background:#f6f8fb; border:1px solid #43536c; border-radius:15px; box-shadow:0 22px 72px rgba(3,8,18,.42); opacity:0; visibility:hidden; transform:translateX(12px) scale(.988); transition:opacity .16s ease,transform .16s ease,visibility .16s ease; pointer-events:none; }
      .shell[data-side="right"] .card { right:60px; }
      .shell[data-side="left"] .card { left:60px; transform:translateX(-12px) scale(.988); }
      .shell[data-open="true"] .card { opacity:1; visibility:visible; transform:translateX(0) scale(1); pointer-events:auto; }
      .modebar { display:flex; align-items:stretch; gap:8px; min-height:58px; padding:7px; color:#dce7f5; background:#111c2d; border-bottom:1px solid #3d4e67; }
      .mode-tabs { display:grid; grid-template-columns:1fr 1fr; gap:6px; min-width:0; flex:1; }
      .mode-tabs button { display:grid; grid-template-columns:24px minmax(0,1fr); align-items:center; gap:8px; min-width:0; padding:6px 9px; color:#aebed2; text-align:left; background:transparent; border:1px solid transparent; border-radius:9px; cursor:pointer; }
      .mode-tabs button:hover,.mode-tabs button:focus-visible { color:#fff; background:#1d2a3d; outline:none; }
      .mode-tabs button.active { color:#f6fbff; background:#22354a; border-color:#3f6572; box-shadow:inset 3px 0 0 #70e0d0; }
      .mode-tabs span { display:grid; min-width:0; }
      .mode-tabs b { font-size:11.5px; line-height:1.2; }
      .mode-tabs small { margin-top:2px; overflow:hidden; color:#91a4bb; font-size:9.5px; text-overflow:ellipsis; white-space:nowrap; }
      .close-button { flex:0 0 auto; align-self:center; color:#cbd8e7; background:#223148; border:1px solid #40536d; }
      .close-button:hover { color:#fff; background:#30445f; }
      .card-body { min-height:0; overflow:hidden; }
      ::slotted(#dp-panel) { width:100% !important; height:100% !important; min-width:0 !important; max-width:none !important; }
      @keyframes pulse { 0%,100% { opacity:.45; transform:scale(.8); } 50% { opacity:1; transform:scale(1.15); } }
      @media (max-width:760px) { :host { top:5px; bottom:5px; width:calc(100vw - 5px); } :host([data-side="right"]) { right:2px; } :host([data-side="left"]) { left:2px; } .card { width:calc(100vw - 64px); } .shell[data-side="right"] .card { right:55px; } .shell[data-side="left"] .card { left:55px; } .mode-tabs small { display:none; } }
    `;
  }

  function createHost() {
    if (runtime.host?.isConnected) return runtime.host;
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.side = runtime.state.side;
    host.setAttribute("aria-label", "SIMNET Workbench");
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
    const mode = currentPanelMode();
    runtime.state.mode = mode;
    shell.dataset.side = runtime.state.side;
    shell.dataset.open = String(runtime.state.open);
    shell.dataset.mode = mode;
    runtime.host.dataset.side = runtime.state.side;

    runtime.root.querySelectorAll("[data-action]").forEach(button => {
      const action = button.dataset.action;
      const selectedMode = action === mode && MODES.has(action);
      button.classList.toggle("active", selectedMode || (action === "panel" && runtime.state.open));
      if (MODES.has(action)) {
        button.setAttribute("aria-selected", selectedMode ? "true" : "false");
        button.setAttribute("aria-pressed", selectedMode ? "true" : "false");
      }
      if (action === "panel") button.setAttribute("aria-expanded", runtime.state.open ? "true" : "false");
    });
  }

  function setOpen(open) {
    runtime.state.open = Boolean(open);
    applyShellState();
    persistSettings();
    if (runtime.state.open) scheduleSync();
  }

  function setSide(side) {
    runtime.state.side = side === "left" ? "left" : "right";
    applyShellState();
    persistSettings();
  }

  function scrollToTarget(selector) {
    window.requestAnimationFrame(() => {
      const target = runtime.panel?.querySelector(selector) || document.querySelector(selector);
      if (!target) return;
      try { target.scrollIntoView({ block: "start", behavior: "smooth" }); }
      catch (_) { target.scrollIntoView(); }
    });
  }

  function requestMode(mode) {
    const wanted = normalizeMode(mode);
    setOpen(true);
    const panel = runtime.panel;
    const current = currentPanelMode();
    const toggle = panel?.querySelector('[data-dp-operation-mode="mentor"]');
    if (wanted !== current && toggle) toggle.click();
    runtime.state.mode = wanted;
    applyShellState();
    persistSettings();

    window.setTimeout(() => {
      const actual = currentPanelMode();
      runtime.state.mode = actual;
      applyShellState();
      persistSettings();
      scrollToTarget(actual === "mentor" ? "#dp-mentor-workspace" : "#dp-form");
    }, 30);
  }

  function clickHistoryAction() {
    setOpen(true);
    const buttons = [...(runtime.panel?.querySelectorAll("button, a") || [])];
    const action = buttons.find(node => /разобрать\s+историю|история\s+абонента/i.test(safeText(node.textContent, 80)));
    if (action) { action.click(); return; }
    scrollToTarget("#dp-history-result, #dp-history, [data-dp-history]");
  }

  function emitAction(action) {
    try {
      window.dispatchEvent(new CustomEvent("simnet-workbench-rail-action", {
        detail: { action, state: { ...runtime.state }, source: "rail-shell" }
      }));
    } catch (_) {}
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    emitAction(action);
    switch (action) {
      case "panel": setOpen(!runtime.state.open); break;
      case "close": setOpen(false); break;
      case "diagnostic": requestMode("diagnostic"); break;
      case "mentor": requestMode("mentor"); break;
      case "history": clickHistoryAction(); break;
      case "side": setSide(runtime.state.side === "right" ? "left" : "right"); break;
      default: break;
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
    const status = runtime.panel?.querySelector("#dp-status") || document.querySelector("#dp-status");
    const dot = runtime.root?.querySelector(".status-dot");
    const tone = statusTone(status);
    if (dot && dot.dataset.tone !== tone) dot.dataset.tone = tone;
    const panelButton = runtime.root?.querySelector('[data-action="panel"]');
    if (panelButton) panelButton.title = safeText(status?.textContent || "Workbench готов", 110) || "Workbench готов";
  }

  function observeRuntime() {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    runtime.observer = new MutationObserver(scheduleSync);
    for (const node of [runtime.panel, document.documentElement, document.body]) {
      if (node) runtime.observer.observe(node, { attributes: true, attributeFilter: ["style", "class", "data-operation-mode"] });
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
    runtime.state.mode = currentPanelMode();
    applyPanelBridge();
    observeRuntime();
    applyShellState();
    renderStatus();
    return true;
  }

  function findAndAttachPanel() {
    const panel = document.querySelector(PANEL_SELECTOR);
    return panel ? attachPanel(panel) : false;
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

  globalThis.__SIMNET_RAIL_SHELL__ = {
    version: "0.2.0",
    runtime,
    open: () => setOpen(true),
    close: () => setOpen(false),
    setMode: requestMode,
    toggle: () => setOpen(!runtime.state.open)
  };

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && runtime.state.open) setOpen(false);
  }, true);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("pagehide", () => {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
    if (runtime.frame) window.cancelAnimationFrame(runtime.frame);
  });

  install();
})();
