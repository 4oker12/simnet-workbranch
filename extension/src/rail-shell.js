"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_RAIL_SHELL__) return;

  const HOST_ID = "simnet-workbench-side-rail";
  const BRIDGE_STYLE_ID = "simnet-workbench-side-rail-bridge";
  const SETTINGS_KEY = "dp_side_rail_ui_v1";
  const PANEL_SELECTOR = "#dp-panel";
  const EXPANDED_WIDTH = 352;
  const COLLAPSED_WIDTH = 52;
  const MODES = new Set(["diagnostic", "mentor"]);
  const DEFAULT_STATE = Object.freeze({ expanded: true, mode: "diagnostic" });

  const runtime = {
    host: null,
    root: null,
    panel: null,
    observer: null,
    statusObserver: null,
    installTimer: 0,
    frame: 0,
    state: { ...DEFAULT_STATE },
    context: null,
    pageBase: null
  };

  const icons = Object.freeze({
    brand: "M4 5h16v14H4zM8 9h8M8 13h5M8 17h7",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    collapse: "M15 5 8 12l7 7",
    expand: "m9 5 7 7-7 7"
  });

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.brand}"></path></svg>`;
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
            expanded: saved.expanded !== false,
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
    if (!node?.style) return;
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

  function capturePageBase() {
    if (runtime.pageBase || !document.body) return;
    const body = document.body;
    const computed = getComputedStyle(body);
    runtime.pageBase = {
      paddingRight: computed.paddingRight || "0px",
      inlinePaddingRight: body.style.getPropertyValue("padding-right"),
      inlinePaddingPriority: body.style.getPropertyPriority("padding-right"),
      inlineBoxSizing: body.style.getPropertyValue("box-sizing"),
      inlineBoxPriority: body.style.getPropertyPriority("box-sizing")
    };
  }

  function applyPageReserve() {
    if (!document.body) return;
    capturePageBase();
    const width = runtime.state.expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const expectedPadding = `calc(${runtime.pageBase.paddingRight} + ${width}px)`;
    setImportant(document.body, "padding-right", expectedPadding);
    setImportant(document.body, "box-sizing", "border-box");
    document.documentElement.dataset.simnetWorkbenchSideRail = "1";
    document.documentElement.style.setProperty("--simnet-workbench-side-rail-width", `${width}px`);
  }

  function restorePageReserve() {
    const base = runtime.pageBase;
    const body = document.body;
    if (!base || !body) return;
    if (base.inlinePaddingRight) body.style.setProperty("padding-right", base.inlinePaddingRight, base.inlinePaddingPriority);
    else body.style.removeProperty("padding-right");
    if (base.inlineBoxSizing) body.style.setProperty("box-sizing", base.inlineBoxSizing, base.inlineBoxPriority);
    else body.style.removeProperty("box-sizing");
    document.documentElement.removeAttribute("data-simnet-workbench-side-rail");
    document.documentElement.style.removeProperty("--simnet-workbench-side-rail-width");
  }

  function currentPanelMode() {
    return normalizeMode(runtime.panel?.dataset.operationMode || runtime.state.mode);
  }

  function installBridgeStyle() {
    let style = document.getElementById(BRIDGE_STYLE_ID);
    if (style) return style;
    style = document.createElement("style");
    style.id = BRIDGE_STYLE_ID;
    style.textContent = `
      #dp-panel[data-dp-side-rail="1"] {
        --dp-rail-bg:#f5f7fa !important;
        --dp-rail-surface:#ffffff !important;
        --dp-rail-line:#d9e0e8 !important;
        --dp-rail-text:#172033 !important;
        --dp-rail-muted:#667085 !important;
        color:var(--dp-rail-text) !important;
        background:var(--dp-rail-bg) !important;
        border:0 !important;
        border-radius:0 !important;
        box-shadow:none !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-head,
      #dp-panel[data-dp-side-rail="1"] #dp-role-banner,
      #dp-panel[data-dp-side-rail="1"] #dp-operation-mode,
      #dp-panel[data-dp-side-rail="1"] #dp-panel-resize,
      #dp-panel[data-dp-side-rail="1"] #dp-reset-panel,
      #dp-panel[data-dp-side-rail="1"] #dp-minimize { display:none !important; }

      #dp-panel[data-dp-side-rail="1"] #dp-billing-provider {
        margin:0 !important;
        padding:6px 10px !important;
        color:var(--dp-rail-muted) !important;
        background:var(--dp-rail-surface) !important;
        border:0 !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
        border-radius:0 !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-billing-provider label,
      #dp-panel[data-dp-side-rail="1"] #dp-billing-provider small { font-size:10px !important; }

      #dp-panel[data-dp-side-rail="1"] #dp-form {
        display:flex !important;
        align-items:center !important;
        gap:6px !important;
        min-height:0 !important;
        padding:6px 8px !important;
        background:var(--dp-rail-surface) !important;
        border:0 !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-input,
      #dp-panel[data-dp-side-rail="1"] #dp-run,
      #dp-panel[data-dp-side-rail="1"] #dp-random-toggle { display:none !important; }
      #dp-panel[data-dp-side-rail="1"] #dp-port-run,
      #dp-panel[data-dp-side-rail="1"] #dp-stop {
        min-width:0 !important;
        height:28px !important;
        padding:0 9px !important;
        border-radius:5px !important;
        font-size:10px !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-port-run:disabled,
      #dp-panel[data-dp-side-rail="1"] #dp-stop:disabled { display:none !important; }
      #dp-panel[data-dp-side-rail="1"] #dp-form:not(:has(#dp-port-run:not(:disabled),#dp-stop:not(:disabled))) { display:none !important; }

      #dp-panel[data-dp-side-rail="1"] #dp-status {
        position:sticky !important;
        top:0 !important;
        z-index:8 !important;
        min-height:30px !important;
        margin:0 !important;
        padding:7px 10px !important;
        color:#344054 !important;
        background:rgba(255,255,255,.97) !important;
        border:0 !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
        border-radius:0 !important;
        box-shadow:none !important;
        font-size:10.5px !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-results,
      #dp-panel[data-dp-side-rail="1"] #dp-mentor-workspace,
      #dp-panel[data-dp-side-rail="1"] #dp-random-panel,
      #dp-panel[data-dp-side-rail="1"] #dp-journal-wrap {
        min-width:0 !important;
        border-radius:0 !important;
        box-shadow:none !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-results {
        padding:7px !important;
        background:var(--dp-rail-bg) !important;
      }
      #dp-panel[data-dp-side-rail="1"] details {
        margin:0 0 6px !important;
        color:var(--dp-rail-text) !important;
        background:var(--dp-rail-surface) !important;
        border:1px solid var(--dp-rail-line) !important;
        border-radius:6px !important;
        box-shadow:none !important;
        overflow:hidden !important;
      }
      #dp-panel[data-dp-side-rail="1"] details > summary {
        min-height:34px !important;
        padding:8px 10px !important;
        color:#344054 !important;
        background:#ffffff !important;
        border:0 !important;
        cursor:pointer !important;
        font-size:10.5px !important;
        font-weight:650 !important;
      }
      #dp-panel[data-dp-side-rail="1"] details[open] > summary {
        color:#175cd3 !important;
        background:#f7faff !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
      }
      #dp-panel[data-dp-side-rail="1"] details > :not(summary) { margin-left:0 !important; margin-right:0 !important; }
      #dp-panel[data-dp-side-rail="1"] button,
      #dp-panel[data-dp-side-rail="1"] input,
      #dp-panel[data-dp-side-rail="1"] select { border-radius:5px !important; }
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-header,
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-progress,
      #dp-panel[data-dp-side-rail="1"] #dp-mentor-inspections,
      #dp-panel[data-dp-side-rail="1"] #dp-mentor-rules { border-radius:0 !important; box-shadow:none !important; }
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-header { padding:9px 10px !important; }
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-rule,
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-inspection { margin:0 0 6px !important; border-radius:6px !important; box-shadow:none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function patchLegacyLabels() {
    const panel = runtime.panel;
    if (!panel) return;
    const oldModeRow = panel.querySelector("#dp-operation-mode");
    if (oldModeRow) oldModeRow.setAttribute("aria-hidden", "true");
    const mentorTitle = panel.querySelector("#dp-mentor-workspace .dp-mentor-header b");
    if (mentorTitle && mentorTitle.textContent !== "Диагност-наставник") mentorTitle.textContent = "Диагност-наставник";
    const routeLabel = panel.querySelector("#dp-mentor-workspace .dp-mentor-progress span");
    if (routeLabel && routeLabel.textContent !== "Диагностический маршрут") routeLabel.textContent = "Диагностический маршрут";
  }

  function applyPanelBridge() {
    const panel = runtime.panel;
    if (!panel?.isConnected) return;
    panel.dataset.dpSideRail = "1";
    panel.dataset.dpRailMode = currentPanelMode();
    panel.slot = "workbench";
    panel.classList.remove("collapsed", "overlay-mode", "compact-layout", "random-wide-layout", "resizing");

    const styles = {
      position: "relative",
      inset: "auto",
      top: "auto",
      right: "auto",
      bottom: "auto",
      left: "auto",
      width: "100%",
      "min-width": "0",
      "max-width": "none",
      height: "100%",
      "min-height": "0",
      "max-height": "none",
      margin: "0",
      transform: "none",
      border: "0",
      "border-radius": "0",
      "box-shadow": "none"
    };
    for (const [name, value] of Object.entries(styles)) setImportant(panel, name, value);
    patchLegacyLabels();
    releaseLegacyDock();
    applyPageReserve();
  }

  function shellMarkup() {
    return `
      <div class="shell" data-expanded="true" data-mode="diagnostic">
        <nav class="rail" aria-label="Workbench">
          <button type="button" class="brand" data-action="toggle" aria-label="Свернуть или развернуть Workbench">
            <span class="status-dot" data-tone="idle"></span>${icon("brand")}<span class="tooltip">Workbench</span>
          </button>
          <div class="rail-modes">
            <button type="button" data-action="diagnostic" aria-label="Быстрая диагностика">
              ${icon("quick")}<span class="tooltip">Быстрая диагностика</span>
            </button>
            <button type="button" data-action="mentor" aria-label="Диагност-наставник">
              ${icon("mentor")}<span class="tooltip">Диагност-наставник</span>
            </button>
          </div>
          <div class="rail-bottom">
            <button type="button" data-action="history" aria-label="История абонента">
              ${icon("history")}<span class="tooltip">История абонента</span>
            </button>
            <button type="button" data-action="collapse" aria-label="Свернуть панель">
              <span class="collapse-icon">${icon("collapse")}</span><span class="tooltip">Свернуть панель</span>
            </button>
          </div>
        </nav>

        <section class="workspace" aria-label="SIMNET Diagnostic Workbench">
          <header class="topbar">
            <div class="context">
              <strong class="context-title">Ожидаю карточку абонента</strong>
              <span class="context-meta">Контекст определится автоматически</span>
            </div>
            <button type="button" class="top-collapse" data-action="collapse" aria-label="Свернуть панель">${icon("collapse")}</button>
          </header>
          <div class="modebar" role="tablist" aria-label="Режим работы">
            <button type="button" data-action="diagnostic" role="tab">
              <b>Быстрая диагностика</b><small>автоматический итог</small>
            </button>
            <button type="button" data-action="mentor" role="tab">
              <b>Диагност-наставник</b><small>проверки и объяснения</small>
            </button>
          </div>
          <div class="workspace-body"><slot name="workbench"></slot></div>
        </section>
      </div>`;
  }

  function shellStyles() {
    return `
      :host {
        all:initial;
        position:fixed;
        z-index:2147483647;
        top:0;
        right:0;
        bottom:0;
        width:${EXPANDED_WIDTH}px;
        height:100vh;
        color:#172033;
        background:#f5f7fa;
        border-left:1px solid #cfd7e2;
        font:12px/1.35 "Segoe UI",Arial,sans-serif;
        transition:width .16s ease;
      }
      :host([data-expanded="false"]) { width:${COLLAPSED_WIDTH}px; }
      *,*::before,*::after { box-sizing:border-box; }
      button { font:inherit; }
      svg { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .shell { display:grid; grid-template-columns:${COLLAPSED_WIDTH}px minmax(0,1fr); width:100%; height:100%; overflow:hidden; background:#f5f7fa; }
      .rail { display:flex; flex-direction:column; align-items:center; min-width:0; height:100%; padding:8px 6px; color:#98a2b3; background:#172033; border-right:1px solid #29364a; }
      .rail button,.top-collapse { position:relative; display:grid; place-items:center; width:38px; height:38px; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; }
      .rail button:hover,.rail button:focus-visible,.rail button.active { color:#fff; background:#29384e; outline:none; }
      .rail button.active { color:#72e3d3; background:#213b43; }
      .brand { color:#72e3d3 !important; }
      .rail-modes { display:grid; gap:5px; width:100%; margin-top:14px; padding-top:10px; border-top:1px solid #2d3a4e; }
      .rail-bottom { display:grid; gap:5px; width:100%; margin-top:auto; padding-top:10px; border-top:1px solid #2d3a4e; }
      .status-dot { position:absolute; top:3px; right:3px; width:8px; height:8px; background:#7b8ba1; border:2px solid #172033; border-radius:50%; }
      .status-dot[data-tone="ok"] { background:#32c88a; }
      .status-dot[data-tone="warning"] { background:#f5b942; }
      .status-dot[data-tone="error"] { background:#ef6673; }
      .status-dot[data-tone="loading"] { background:#5aa9ff; animation:pulse 1.1s infinite ease-in-out; }
      .tooltip { position:absolute; top:50%; right:45px; z-index:20; width:max-content; max-width:220px; padding:5px 7px; color:#f8fafc; background:#111827; border:1px solid #344054; border-radius:5px; opacity:0; visibility:hidden; transform:translateY(-50%); pointer-events:none; white-space:nowrap; }
      .rail button:hover .tooltip,.rail button:focus-visible .tooltip { opacity:1; visibility:visible; }
      .workspace { display:grid; grid-template-rows:auto auto minmax(0,1fr); min-width:0; height:100%; overflow:hidden; background:#f5f7fa; }
      :host([data-expanded="false"]) .workspace { display:none; }
      .topbar { display:flex; align-items:center; gap:8px; min-height:48px; padding:7px 8px 7px 11px; background:#fff; border-bottom:1px solid #d9e0e8; }
      .context { display:grid; gap:1px; min-width:0; flex:1; }
      .context-title { overflow:hidden; color:#172033; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .context-meta { overflow:hidden; color:#667085; font-size:9.5px; text-overflow:ellipsis; white-space:nowrap; }
      .top-collapse { flex:0 0 auto; color:#667085; background:#f2f4f7; border:1px solid #d0d5dd; }
      .top-collapse:hover { color:#172033; background:#e9edf2; }
      .modebar { display:grid; grid-template-columns:1fr 1fr; gap:0; min-height:45px; padding:0 8px; background:#fff; border-bottom:1px solid #d9e0e8; }
      .modebar button { display:grid; align-content:center; gap:1px; min-width:0; padding:6px 8px; color:#667085; text-align:left; background:transparent; border:0; border-bottom:2px solid transparent; cursor:pointer; }
      .modebar button:hover,.modebar button:focus-visible { color:#344054; background:#f8fafc; outline:none; }
      .modebar button.active { color:#175cd3; border-bottom-color:#2e90fa; }
      .modebar b { overflow:hidden; font-size:10.5px; text-overflow:ellipsis; white-space:nowrap; }
      .modebar small { overflow:hidden; color:#98a2b3; font-size:8.8px; text-overflow:ellipsis; white-space:nowrap; }
      .workspace-body { min-height:0; overflow:hidden; background:#f5f7fa; }
      ::slotted(#dp-panel) { width:100% !important; height:100% !important; min-width:0 !important; max-width:none !important; }
      @keyframes pulse { 0%,100% { opacity:.45; transform:scale(.8); } 50% { opacity:1; transform:scale(1.15); } }
      @media (max-width:900px) {
        :host { width:320px; }
        :host([data-expanded="false"]) { width:${COLLAPSED_WIDTH}px; }
        .shell { grid-template-columns:${COLLAPSED_WIDTH}px minmax(0,1fr); }
      }
    `;
  }

  function createHost() {
    if (runtime.host?.isConnected) return runtime.host;
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.expanded = String(runtime.state.expanded);
    host.setAttribute("aria-label", "SIMNET Workbench side rail");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${shellStyles()}</style>${shellMarkup()}`;
    (document.body || document.documentElement).appendChild(host);
    runtime.host = host;
    runtime.root = root;
    root.addEventListener("click", handleClick);
    applyShellState();
    renderContext();
    return host;
  }

  function applyShellState() {
    if (!runtime.host || !runtime.root) return;
    const mode = currentPanelMode();
    runtime.state.mode = mode;
    runtime.host.dataset.expanded = String(runtime.state.expanded);
    const shell = runtime.root.querySelector(".shell");
    if (shell) {
      shell.dataset.expanded = String(runtime.state.expanded);
      shell.dataset.mode = mode;
    }
    runtime.root.querySelectorAll("[data-action]").forEach(button => {
      const action = button.dataset.action;
      const selected = MODES.has(action) && action === mode;
      button.classList.toggle("active", selected);
      if (MODES.has(action)) {
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      }
    });
    runtime.root.querySelectorAll('[data-action="collapse"]').forEach(button => {
      button.setAttribute("aria-label", runtime.state.expanded ? "Свернуть панель" : "Развернуть панель");
      button.title = runtime.state.expanded ? "Свернуть панель" : "Развернуть панель";
    });
    applyPageReserve();
  }

  function setExpanded(expanded) {
    runtime.state.expanded = Boolean(expanded);
    applyShellState();
    persistSettings();
    if (runtime.state.expanded) scheduleSync();
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
    setExpanded(true);
    const current = currentPanelMode();
    const toggle = runtime.panel?.querySelector('[data-dp-operation-mode="mentor"]');
    if (wanted !== current && toggle) toggle.click();
    runtime.state.mode = wanted;
    applyShellState();
    persistSettings();
    window.setTimeout(() => {
      runtime.state.mode = currentPanelMode();
      applyShellState();
      persistSettings();
      scrollToTarget(runtime.state.mode === "mentor" ? "#dp-mentor-workspace" : "#dp-status, #dp-results");
    }, 40);
  }

  function clickHistoryAction() {
    setExpanded(true);
    const buttons = [...(runtime.panel?.querySelectorAll("button, a") || [])];
    const action = buttons.find(node => /разобрать\s+историю|история\s+абонента/i.test(safeText(node.textContent, 80)));
    if (action) { action.click(); return; }
    scrollToTarget("#dp-history-result, #dp-history, [data-dp-history]");
  }

  function emitAction(action) {
    try {
      window.dispatchEvent(new CustomEvent("simnet-workbench-rail-action", {
        detail: { action, state: { ...runtime.state }, context: runtime.context, source: "side-rail" }
      }));
    } catch (_) {}
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    emitAction(action);
    switch (action) {
      case "toggle": setExpanded(!runtime.state.expanded); break;
      case "collapse": setExpanded(!runtime.state.expanded); break;
      case "diagnostic": requestMode("diagnostic"); break;
      case "mentor": requestMode("mentor"); break;
      case "history": clickHistoryAction(); break;
      default: break;
    }
  }

  function statusTone(status) {
    const value = safeText(status?.textContent || "").toLowerCase();
    const classes = status?.classList;
    if (classes?.contains("error") || /ошиб|error|не удалось/.test(value)) return "error";
    if (classes?.contains("warning") || classes?.contains("stopped") || /предуп|warning|останов/.test(value)) return "warning";
    if (classes?.contains("loading") || /ищу|загрузка|опрос|собираю|анализ/.test(value)) return "loading";
    if (classes?.contains("ok") || /готов|заверш|успеш|online/.test(value)) return "ok";
    return "idle";
  }

  function renderStatus() {
    const status = runtime.panel?.querySelector("#dp-status") || document.querySelector("#dp-status");
    const tone = statusTone(status);
    const dot = runtime.root?.querySelector(".status-dot");
    if (dot && dot.dataset.tone !== tone) dot.dataset.tone = tone;
    const brand = runtime.root?.querySelector('[data-action="toggle"]');
    if (brand) brand.title = safeText(status?.textContent || "Workbench готов", 110) || "Workbench готов";
  }

  function renderContext() {
    if (!runtime.root) return;
    const context = runtime.context || globalThis.__SIMNET_AUTO_CONTEXT__?.current?.() || null;
    const title = runtime.root.querySelector(".context-title");
    const meta = runtime.root.querySelector(".context-meta");
    if (!title || !meta) return;
    if (!context) {
      title.textContent = "Ожидаю карточку абонента";
      meta.textContent = "Контекст определится автоматически";
      return;
    }
    const primary = context.contract ? `abon${context.contract}` : context.userId ? `ID ${context.userId}` : context.ip || "Абонент";
    const system = context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : location.hostname;
    const extras = [system, context.ip && context.ip !== primary ? context.ip : "", context.autoStarted ? "диагностика запущена" : ""].filter(Boolean);
    title.textContent = primary;
    meta.textContent = extras.join(" · ") || "Контекст страницы";
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
      renderContext();
    });
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
    renderContext();
    return true;
  }

  function findAndAttachPanel() {
    const panel = document.querySelector(PANEL_SELECTOR);
    return panel ? attachPanel(panel) : false;
  }

  async function install() {
    runtime.state = await readSettings();
    releaseLegacyDock();
    capturePageBase();
    installBridgeStyle();
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
    version: "0.3.0",
    runtime,
    open: () => setExpanded(true),
    close: () => setExpanded(false),
    setMode: requestMode,
    toggle: () => setExpanded(!runtime.state.expanded)
  };

  window.addEventListener("simnet-workbench-context", event => {
    runtime.context = event.detail || null;
    renderContext();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && runtime.state.expanded) setExpanded(false);
  }, true);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("pagehide", () => {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
    if (runtime.frame) window.cancelAnimationFrame(runtime.frame);
    restorePageReserve();
  });

  install();
})();
