"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_RAIL_SHELL__) return;

  const HOST_ID = "simnet-workbench-side-rail";
  const BRIDGE_STYLE_ID = "simnet-workbench-side-rail-bridge";
  const SETTINGS_KEY = "dp_side_rail_ui_v2";
  const PANEL_SELECTOR = "#dp-panel";
  const MAIN_WIDTH = 280;
  const COLLAPSED_WIDTH = 48;
  const FLYOUT_WIDTH = 540;
  const MODES = new Set(["diagnostic", "mentor"]);
  const FLYOUTS = new Set(["details", "mentor", "history"]);
  const DEFAULT_STATE = Object.freeze({ expanded: true, mode: "diagnostic", flyout: "" });

  const runtime = {
    host: null,
    root: null,
    panel: null,
    observer: null,
    statusObserver: null,
    installTimer: 0,
    frame: 0,
    copyTimer: 0,
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
    expand: "m9 5 7 7-7 7",
    close: "M6 6l12 12M18 6 6 18",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
    pin: "M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
    contract: "M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6",
    ip: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.6 5.5 3.6 9S14.5 18.5 12 21M12 3c-2.5 2.5-3.6 5.5-3.6 9S9.5 18.5 12 21",
    mac: "M5 5h14v14H5zM9 9h6v6H9zM2 9h3M2 15h3M19 9h3M19 15h3M9 2v3M15 2v3M9 19v3M15 19v3",
    copy: "M9 9h10v10H9zM5 5h10v4M5 5v10h4",
    stop: "M7 7h10v10H7z",
    session: "M4 12h4l2-5 4 10 2-5h4",
    external: "M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"
  });

  function icon(name, className = "") {
    return `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.brand}"></path></svg>`;
  }

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return MODES.has(mode) ? mode : "diagnostic";
  }

  function normalizeFlyout(value) {
    return FLYOUTS.has(value) ? value : "";
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
            mode: normalizeMode(saved.mode),
            flyout: ""
          });
        });
      } catch (_) {
        resolve({ ...DEFAULT_STATE });
      }
    });
  }

  function persistSettings() {
    try {
      chrome.storage.local.set({
        [SETTINGS_KEY]: {
          expanded: runtime.state.expanded,
          mode: runtime.state.mode
        }
      });
    } catch (_) {}
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
    const width = runtime.state.expanded ? MAIN_WIDTH : COLLAPSED_WIDTH;
    setImportant(document.body, "padding-right", `calc(${runtime.pageBase.paddingRight} + ${width}px)`);
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
        --dp-rail-bg:#f4f6f8 !important;
        --dp-rail-surface:#ffffff !important;
        --dp-rail-line:#d8dee7 !important;
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
        padding:4px 7px !important;
        color:var(--dp-rail-muted) !important;
        background:var(--dp-rail-surface) !important;
        border:0 !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
        border-radius:0 !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-billing-provider label,
      #dp-panel[data-dp-side-rail="1"] #dp-billing-provider small { font-size:9.5px !important; }

      #dp-panel[data-dp-side-rail="1"] #dp-form {
        display:flex !important;
        align-items:center !important;
        gap:4px !important;
        min-height:0 !important;
        padding:4px 6px !important;
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
        height:26px !important;
        padding:0 7px !important;
        border-radius:4px !important;
        font-size:9.5px !important;
      }
      #dp-panel[data-dp-side-rail="1"] #dp-port-run:disabled,
      #dp-panel[data-dp-side-rail="1"] #dp-stop:disabled { display:none !important; }
      #dp-panel[data-dp-side-rail="1"] #dp-form:not(:has(#dp-port-run:not(:disabled),#dp-stop:not(:disabled))) { display:none !important; }

      #dp-panel[data-dp-side-rail="1"] #dp-status {
        position:sticky !important;
        top:0 !important;
        z-index:8 !important;
        min-height:27px !important;
        margin:0 !important;
        padding:5px 7px !important;
        color:#344054 !important;
        background:rgba(255,255,255,.98) !important;
        border:0 !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
        border-radius:0 !important;
        box-shadow:none !important;
        font-size:10px !important;
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
        padding:4px !important;
        background:var(--dp-rail-bg) !important;
      }
      #dp-panel[data-dp-side-rail="1"] details {
        margin:0 0 4px !important;
        color:var(--dp-rail-text) !important;
        background:var(--dp-rail-surface) !important;
        border:1px solid var(--dp-rail-line) !important;
        border-radius:4px !important;
        box-shadow:none !important;
        overflow:hidden !important;
      }
      #dp-panel[data-dp-side-rail="1"] details > summary {
        min-height:29px !important;
        padding:5px 7px !important;
        color:#344054 !important;
        background:#ffffff !important;
        border:0 !important;
        cursor:pointer !important;
        font-size:10px !important;
        font-weight:650 !important;
      }
      #dp-panel[data-dp-side-rail="1"] details[open] > summary {
        color:#175cd3 !important;
        background:#f7faff !important;
        border-bottom:1px solid var(--dp-rail-line) !important;
      }
      #dp-panel[data-dp-side-rail="1"] details > :not(summary) {
        margin-left:0 !important;
        margin-right:0 !important;
        padding-top:4px !important;
        padding-bottom:4px !important;
      }
      #dp-panel[data-dp-side-rail="1"] button,
      #dp-panel[data-dp-side-rail="1"] input,
      #dp-panel[data-dp-side-rail="1"] select { border-radius:4px !important; }

      #dp-panel[data-dp-side-rail="1"] .dp-mentor-header,
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-progress,
      #dp-panel[data-dp-side-rail="1"] #dp-mentor-inspections,
      #dp-panel[data-dp-side-rail="1"] #dp-mentor-rules { border-radius:0 !important; box-shadow:none !important; }
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-header { padding:6px 7px !important; }
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-rule,
      #dp-panel[data-dp-side-rail="1"] .dp-mentor-inspection {
        margin:0 0 4px !important;
        padding:5px 6px !important;
        border-radius:4px !important;
        box-shadow:none !important;
      }

      #dp-panel[data-dp-side-rail="1"] .dp-rail-skeleton-field {
        position:relative !important;
        min-width:72px !important;
        min-height:16px !important;
        color:transparent !important;
        user-select:none !important;
      }
      #dp-panel[data-dp-side-rail="1"] .dp-rail-skeleton-field::after {
        content:"" !important;
        position:absolute !important;
        left:0 !important;
        top:50% !important;
        width:min(150px,75%) !important;
        height:8px !important;
        border-radius:999px !important;
        background:linear-gradient(90deg,#e7ebf0 20%,#f6f8fa 50%,#e7ebf0 80%) !important;
        background-size:220% 100% !important;
        transform:translateY(-50%) !important;
        animation:dp-rail-skeleton 1.2s linear infinite !important;
      }
      @keyframes dp-rail-skeleton { to { background-position:-220% 0; } }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function markWaitingPlaceholders() {
    const panel = runtime.panel;
    if (!panel) return;
    const pattern = /(?:ФИО|ПІБ|Адрес|Адреса|MAC)[^]{0,80}(?:ожидан|очіку|загруз|завантаж|нет данных|немає даних|^\s*[—-]\s*$)/i;
    for (const node of panel.querySelectorAll("span,p,li,td,dd,small")) {
      if (node.children.length || node.classList.contains("dp-rail-skeleton-field")) continue;
      const text = safeText(node.textContent, 160);
      if (text && pattern.test(text)) {
        node.classList.add("dp-rail-skeleton-field");
        node.setAttribute("aria-label", text);
      }
    }
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
    markWaitingPlaceholders();
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

  function chipMarkup(key, iconName, label) {
    return `
      <div class="chip" data-chip="${key}" data-loading="true" title="${label}">
        ${icon(iconName)}
        <span class="chip-value skeleton-inline"></span>
        <button type="button" class="copy-button" data-copy-key="${key}" aria-label="Копировать ${label}" disabled>
          ${icon("copy")}<span class="tooltip">${label}: копировать</span>
        </button>
      </div>`;
  }

  function shellMarkup() {
    return `
      <div class="shell" data-expanded="true" data-flyout="" data-mode="diagnostic">
        <main class="anchor" aria-label="Workbench compact panel">
          <header class="anchor-head">
            <div class="brand-mark">${icon("brand")}</div>
            <span class="system-label skeleton-inline"></span>
            <button type="button" class="icon-button" data-action="collapse" aria-label="Свернуть панель">
              <span class="collapse-icon">${icon("collapse")}</span><span class="tooltip">Свернуть</span>
            </button>
          </header>

          <section class="identity" aria-label="Абонент">
            <div class="identity-icon">${icon("user")}</div>
            <div class="identity-text">
              <strong class="identity-name skeleton-line"></strong>
              <span class="identity-address skeleton-line short"></span>
            </div>
          </section>

          <section class="chips" aria-label="Ключевые данные">
            ${chipMarkup("contract", "contract", "Договор")}
            ${chipMarkup("ip", "ip", "IP")}
            ${chipMarkup("mac", "mac", "MAC")}
          </section>

          <section class="session-card" aria-label="Статус сессии">
            <div class="session-icon">${icon("session")}</div>
            <div class="session-text">
              <span class="session-label">Сессия</span>
              <strong class="session-status skeleton-line short"></strong>
            </div>
            <span class="session-tone" data-tone="idle"></span>
          </section>

          <section class="quick-actions" aria-label="Быстрые действия">
            <button type="button" data-action="details" aria-label="Подробная диагностика">
              ${icon("quick")}<span class="tooltip">Подробная диагностика</span>
            </button>
            <button type="button" data-action="mentor" aria-label="Диагност-наставник">
              ${icon("mentor")}<span class="tooltip">Диагност-наставник</span>
            </button>
            <button type="button" data-action="history" aria-label="История абонента">
              ${icon("history")}<span class="tooltip">История абонента</span>
            </button>
            <button type="button" data-action="stop" aria-label="Остановить диагностику" disabled>
              ${icon("stop")}<span class="tooltip">Остановить диагностику</span>
            </button>
          </section>

          <footer class="anchor-foot">
            <span class="mode-indicator">${icon("quick")}<b>Быстрая</b></span>
            <button type="button" class="icon-button" data-action="open-source" aria-label="Открыть текущую карточку">
              ${icon("external")}<span class="tooltip">Текущая карточка</span>
            </button>
          </footer>
        </main>

        <nav class="edge-rail" aria-label="Workbench rail">
          <button type="button" class="brand" data-action="toggle" aria-label="Свернуть или развернуть Workbench">
            <span class="status-dot" data-tone="idle"></span>${icon("brand")}<span class="tooltip">Workbench</span>
          </button>
          <div class="rail-actions">
            <button type="button" data-action="details" aria-label="Подробная диагностика">
              ${icon("quick")}<span class="tooltip">Подробная диагностика</span>
            </button>
            <button type="button" data-action="mentor" aria-label="Диагност-наставник">
              ${icon("mentor")}<span class="tooltip">Диагност-наставник</span>
            </button>
            <button type="button" data-action="history" aria-label="История абонента">
              ${icon("history")}<span class="tooltip">История абонента</span>
            </button>
          </div>
          <button type="button" class="rail-collapse" data-action="collapse" aria-label="Свернуть панель">
            <span class="collapse-icon">${icon("collapse")}</span><span class="tooltip">Свернуть</span>
          </button>
        </nav>

        <aside class="flyout" aria-label="Workbench details" aria-hidden="true">
          <header class="flyout-head">
            <div class="flyout-heading">
              <span class="flyout-icon">${icon("quick")}</span>
              <strong class="flyout-title">Подробная диагностика</strong>
            </div>
            <button type="button" class="icon-button" data-action="close-flyout" aria-label="Закрыть модуль">
              ${icon("close")}<span class="tooltip">Закрыть</span>
            </button>
          </header>
          <div class="flyout-body"><slot name="workbench"></slot></div>
        </aside>
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
        width:${MAIN_WIDTH}px;
        height:100vh;
        overflow:visible;
        color:#172033;
        background:#f5f7fa;
        border-left:1px solid #d1d8e2;
        font:11px/1.3 "Segoe UI",Arial,sans-serif;
        transition:width .14s ease;
      }
      :host([data-expanded="false"]) { width:${COLLAPSED_WIDTH}px; }
      *,*::before,*::after { box-sizing:border-box; }
      button { font:inherit; }
      svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .shell {
        position:relative;
        display:grid;
        grid-template-columns:minmax(0,1fr) ${COLLAPSED_WIDTH}px;
        width:100%;
        height:100%;
        overflow:visible;
        background:#f5f7fa;
      }
      :host([data-expanded="false"]) .shell { grid-template-columns:${COLLAPSED_WIDTH}px; }
      .anchor {
        position:relative;
        z-index:2;
        display:flex;
        flex-direction:column;
        min-width:0;
        height:100%;
        overflow:hidden;
        background:#f7f8fa;
      }
      :host([data-expanded="false"]) .anchor { display:none; }

      .anchor-head {
        display:flex;
        align-items:center;
        gap:6px;
        height:38px;
        min-height:38px;
        padding:4px 5px 4px 7px;
        background:#ffffff;
        border-bottom:1px solid #e0e5ec;
      }
      .brand-mark {
        display:grid;
        place-items:center;
        width:27px;
        height:27px;
        color:#1570ef;
        background:#eef4ff;
        border-radius:6px;
      }
      .system-label {
        min-width:0;
        flex:1;
        overflow:hidden;
        color:#475467;
        font-weight:650;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .icon-button,.quick-actions button,.edge-rail button,.copy-button {
        position:relative;
        display:grid;
        place-items:center;
        padding:0;
        border:0;
        cursor:pointer;
      }
      .icon-button {
        width:28px;
        height:28px;
        color:#667085;
        background:transparent;
        border-radius:5px;
      }
      .icon-button:hover,.icon-button:focus-visible { color:#172033; background:#eef1f5; outline:none; }

      .identity {
        display:grid;
        grid-template-columns:31px minmax(0,1fr);
        align-items:center;
        gap:7px;
        min-height:58px;
        padding:7px;
        background:#ffffff;
        border-bottom:1px solid #e0e5ec;
      }
      .identity-icon {
        display:grid;
        place-items:center;
        width:31px;
        height:31px;
        color:#475467;
        background:#f2f4f7;
        border-radius:50%;
      }
      .identity-text { display:grid; gap:4px; min-width:0; }
      .identity-name {
        overflow:hidden;
        color:#172033;
        font-size:11.5px;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .identity-address {
        overflow:hidden;
        color:#667085;
        font-size:9.5px;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .chips {
        display:flex;
        align-items:center;
        gap:3px;
        min-height:38px;
        padding:5px 6px;
        overflow:hidden;
        background:#ffffff;
        border-bottom:1px solid #e0e5ec;
      }
      .chip {
        display:grid;
        grid-template-columns:13px minmax(0,1fr) 17px;
        align-items:center;
        gap:2px;
        min-width:0;
        height:25px;
        padding:0 2px 0 5px;
        color:#344054;
        background:#f2f4f7;
        border:1px solid #e1e6ed;
        border-radius:999px;
      }
      .chip[data-chip="contract"] { flex:1.08; }
      .chip[data-chip="ip"] { flex:.9; }
      .chip[data-chip="mac"] { flex:1.12; }
      .chip > svg { width:12px; height:12px; color:#667085; }
      .chip-value {
        min-width:0;
        overflow:hidden;
        font:650 8.7px/1 Consolas,"Segoe UI",sans-serif;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .copy-button {
        width:17px;
        height:17px;
        color:#98a2b3;
        background:transparent;
        border-radius:50%;
      }
      .copy-button svg { width:11px; height:11px; }
      .copy-button:hover:not(:disabled),.copy-button:focus-visible:not(:disabled) { color:#175cd3; background:#dfeaff; outline:none; }
      .copy-button:disabled { opacity:.3; cursor:default; }
      .copy-button[data-copied="true"] { color:#067647; background:#d1fadf; }

      .session-card {
        display:grid;
        grid-template-columns:28px minmax(0,1fr) 9px;
        align-items:center;
        gap:6px;
        min-height:47px;
        margin:6px;
        padding:6px;
        background:#ffffff;
        border:1px solid #e0e5ec;
        border-radius:6px;
      }
      .session-icon {
        display:grid;
        place-items:center;
        width:28px;
        height:28px;
        color:#175cd3;
        background:#eff8ff;
        border-radius:6px;
      }
      .session-text { display:grid; gap:2px; min-width:0; }
      .session-label { color:#98a2b3; font-size:8.5px; text-transform:uppercase; letter-spacing:.06em; }
      .session-status {
        overflow:hidden;
        color:#344054;
        font-size:9.5px;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .session-tone {
        width:8px;
        height:8px;
        background:#98a2b3;
        border-radius:50%;
      }
      .session-tone[data-tone="ok"] { background:#12b76a; }
      .session-tone[data-tone="warning"] { background:#f79009; }
      .session-tone[data-tone="error"] { background:#f04438; }
      .session-tone[data-tone="loading"] { background:#2e90fa; animation:pulse 1.1s infinite ease-in-out; }

      .quick-actions {
        display:grid;
        grid-template-columns:repeat(4,1fr);
        gap:4px;
        padding:0 6px 6px;
      }
      .quick-actions button {
        height:37px;
        color:#475467;
        background:#ffffff;
        border:1px solid #dfe4eb;
        border-radius:6px;
      }
      .quick-actions button:hover:not(:disabled),.quick-actions button:focus-visible:not(:disabled) {
        color:#175cd3;
        background:#f5f9ff;
        border-color:#b2ccff;
        outline:none;
      }
      .quick-actions button.active { color:#175cd3; background:#eff8ff; border-color:#84adff; }
      .quick-actions button:disabled { color:#c3c9d2; background:#f5f6f7; cursor:default; }

      .anchor-foot {
        display:flex;
        align-items:center;
        justify-content:space-between;
        min-height:35px;
        margin-top:auto;
        padding:4px 6px 4px 8px;
        color:#667085;
        background:#ffffff;
        border-top:1px solid #e0e5ec;
      }
      .mode-indicator { display:flex; align-items:center; gap:5px; min-width:0; }
      .mode-indicator svg { width:13px; height:13px; }
      .mode-indicator b { overflow:hidden; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }

      .edge-rail {
        position:relative;
        z-index:2;
        display:flex;
        flex-direction:column;
        align-items:center;
        min-width:0;
        height:100%;
        padding:6px 5px;
        color:#98a2b3;
        background:#172033;
        border-left:1px solid #263247;
      }
      .edge-rail button {
        width:37px;
        height:37px;
        color:inherit;
        background:transparent;
        border-radius:6px;
      }
      .edge-rail button:hover,.edge-rail button:focus-visible,.edge-rail button.active {
        color:#ffffff;
        background:#29384e;
        outline:none;
      }
      .edge-rail button.active { color:#72e3d3; background:#213b43; }
      .brand { color:#72e3d3 !important; }
      .rail-actions {
        display:grid;
        gap:4px;
        width:100%;
        margin-top:10px;
        padding-top:8px;
        border-top:1px solid #2d3a4e;
      }
      .rail-collapse { margin-top:auto; }
      .status-dot {
        position:absolute;
        top:3px;
        right:3px;
        width:8px;
        height:8px;
        background:#7b8ba1;
        border:2px solid #172033;
        border-radius:50%;
      }
      .status-dot[data-tone="ok"] { background:#32c88a; }
      .status-dot[data-tone="warning"] { background:#f5b942; }
      .status-dot[data-tone="error"] { background:#ef6673; }
      .status-dot[data-tone="loading"] { background:#5aa9ff; animation:pulse 1.1s infinite ease-in-out; }

      .flyout {
        position:absolute;
        z-index:1;
        top:0;
        right:${MAIN_WIDTH}px;
        bottom:0;
        width:min(${FLYOUT_WIDTH}px,calc(100vw - ${MAIN_WIDTH}px));
        display:grid;
        grid-template-rows:38px minmax(0,1fr);
        overflow:hidden;
        color:#172033;
        background:#f4f6f8;
        border-left:1px solid #cfd6e0;
        border-right:1px solid #d8dee7;
        box-shadow:-14px 0 30px rgba(16,24,40,.14);
        opacity:0;
        visibility:hidden;
        transform:translateX(18px);
        transition:opacity .14s ease,transform .14s ease,visibility .14s ease;
        pointer-events:none;
      }
      .shell[data-flyout]:not([data-flyout=""]) .flyout {
        opacity:1;
        visibility:visible;
        transform:translateX(0);
        pointer-events:auto;
      }
      :host([data-expanded="false"]) .flyout { display:none; }
      .flyout-head {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:4px 5px 4px 8px;
        background:#ffffff;
        border-bottom:1px solid #d8dee7;
      }
      .flyout-heading { display:flex; align-items:center; gap:6px; min-width:0; }
      .flyout-icon { display:grid; place-items:center; width:25px; height:25px; color:#175cd3; background:#eff8ff; border-radius:5px; }
      .flyout-icon svg { width:15px; height:15px; }
      .flyout-title { overflow:hidden; font-size:10.5px; text-overflow:ellipsis; white-space:nowrap; }
      .flyout-body { min-height:0; overflow:hidden; }
      ::slotted(#dp-panel) { width:100% !important; height:100% !important; min-width:0 !important; max-width:none !important; }

      .tooltip {
        position:absolute;
        top:50%;
        right:43px;
        z-index:40;
        width:max-content;
        max-width:220px;
        padding:4px 6px;
        color:#f8fafc;
        background:#111827;
        border:1px solid #344054;
        border-radius:4px;
        opacity:0;
        visibility:hidden;
        transform:translateY(-50%);
        pointer-events:none;
        white-space:nowrap;
      }
      .anchor .tooltip,.flyout .tooltip { right:34px; }
      button:hover > .tooltip,button:focus-visible > .tooltip { opacity:1; visibility:visible; }

      .skeleton-line,.skeleton-inline {
        position:relative;
        display:block;
        min-width:40px;
        min-height:9px;
        overflow:hidden;
        color:transparent !important;
        border-radius:999px;
        background:linear-gradient(90deg,#e7ebf0 20%,#f6f8fa 50%,#e7ebf0 80%);
        background-size:220% 100%;
        animation:skeleton 1.2s linear infinite;
      }
      .skeleton-line { width:76%; height:9px; }
      .skeleton-line.short { width:56%; height:8px; }
      .skeleton-inline { width:42px; height:8px; }
      .has-value { color:inherit !important; background:none !important; animation:none !important; }
      .chip[data-loading="false"] .chip-value { color:#344054 !important; background:none; animation:none; }
      @keyframes skeleton { to { background-position:-220% 0; } }
      @keyframes pulse { 0%,100% { opacity:.45; transform:scale(.8); } 50% { opacity:1; transform:scale(1.15); } }

      @media (max-width:860px) {
        :host { width:260px; }
        .flyout { right:260px; width:calc(100vw - 260px); }
      }
    `;
  }

  function createHost() {
    if (runtime.host?.isConnected) return runtime.host;
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.expanded = String(runtime.state.expanded);
    host.dataset.flyout = "";
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

  function flyoutMeta(kind) {
    if (kind === "mentor") return { title: "Диагност-наставник", icon: "mentor" };
    if (kind === "history") return { title: "История абонента", icon: "history" };
    return { title: "Подробная диагностика", icon: "quick" };
  }

  function applyShellState() {
    if (!runtime.host || !runtime.root) return;
    const mode = currentPanelMode();
    runtime.state.mode = mode;
    runtime.state.flyout = normalizeFlyout(runtime.state.flyout);
    runtime.host.dataset.expanded = String(runtime.state.expanded);
    runtime.host.dataset.flyout = runtime.state.flyout;
    const shell = runtime.root.querySelector(".shell");
    if (shell) {
      shell.dataset.expanded = String(runtime.state.expanded);
      shell.dataset.mode = mode;
      shell.dataset.flyout = runtime.state.flyout;
    }

    runtime.root.querySelectorAll("[data-action]").forEach(button => {
      const action = button.dataset.action;
      const selected = (
        (action === "details" && runtime.state.flyout === "details")
        || (action === "mentor" && runtime.state.flyout === "mentor")
        || (action === "history" && runtime.state.flyout === "history")
      );
      button.classList.toggle("active", selected);
    });

    const meta = flyoutMeta(runtime.state.flyout);
    const title = runtime.root.querySelector(".flyout-title");
    const iconBox = runtime.root.querySelector(".flyout-icon");
    if (title) title.textContent = meta.title;
    if (iconBox) iconBox.innerHTML = icon(meta.icon);
    const flyout = runtime.root.querySelector(".flyout");
    if (flyout) flyout.setAttribute("aria-hidden", runtime.state.flyout ? "false" : "true");

    const collapseName = runtime.state.expanded ? "Свернуть панель" : "Развернуть панель";
    runtime.root.querySelectorAll('[data-action="collapse"]').forEach(button => {
      button.setAttribute("aria-label", collapseName);
      const holder = button.querySelector(".collapse-icon");
      if (holder) holder.innerHTML = icon(runtime.state.expanded ? "collapse" : "expand");
    });

    const modeIndicator = runtime.root.querySelector(".mode-indicator");
    if (modeIndicator) {
      const mentor = mode === "mentor";
      modeIndicator.innerHTML = `${icon(mentor ? "mentor" : "quick")}<b>${mentor ? "Наставник" : "Быстрая"}</b>`;
    }
    applyPageReserve();
  }

  function setExpanded(expanded) {
    runtime.state.expanded = Boolean(expanded);
    if (!runtime.state.expanded) runtime.state.flyout = "";
    applyShellState();
    persistSettings();
    if (runtime.state.expanded) scheduleSync();
  }

  function setFlyout(kind) {
    runtime.state.flyout = normalizeFlyout(kind);
    if (runtime.state.flyout) runtime.state.expanded = true;
    applyShellState();
  }

  function scrollToTarget(selector) {
    window.requestAnimationFrame(() => {
      const target = runtime.panel?.querySelector(selector) || document.querySelector(selector);
      if (!target) return;
      try { target.scrollIntoView({ block: "start", behavior: "smooth" }); }
      catch (_) { target.scrollIntoView(); }
    });
  }

  function requestMode(mode, openKind = "") {
    const wanted = normalizeMode(mode);
    const current = currentPanelMode();
    const toggle = runtime.panel?.querySelector('[data-dp-operation-mode="mentor"]');
    if (wanted !== current && toggle) toggle.click();
    runtime.state.mode = wanted;
    if (openKind) runtime.state.flyout = normalizeFlyout(openKind);
    applyShellState();
    persistSettings();
    window.setTimeout(() => {
      runtime.state.mode = currentPanelMode();
      applyShellState();
      scrollToTarget(runtime.state.mode === "mentor" ? "#dp-mentor-workspace" : "#dp-status, #dp-results");
    }, 40);
  }

  function openDetails() {
    setFlyout("details");
    requestMode("diagnostic", "details");
  }

  function openMentor() {
    setFlyout("mentor");
    requestMode("mentor", "mentor");
  }

  function openHistory() {
    setFlyout("history");
    const buttons = [...(runtime.panel?.querySelectorAll("button, a") || [])];
    const action = buttons.find(node => /разобрать\s+историю|история\s+абонента/i.test(safeText(node.textContent, 80)));
    if (action) action.click();
    window.setTimeout(() => scrollToTarget("#dp-history-result, #dp-history, [data-dp-history]"), 50);
  }

  function clickStop() {
    const stop = runtime.panel?.querySelector("#dp-stop");
    if (stop && !stop.disabled) stop.click();
  }

  function openSource() {
    try { window.focus(); } catch (_) {}
  }

  async function writeClipboard(value, button) {
    const text = String(value || "");
    if (!text) return;
    try {
      const gmSetClipboard = globalThis.__SIMNET_EXTENSION_COMPAT__?.api?.GM_setClipboard;
      if (typeof gmSetClipboard === "function") gmSetClipboard(text);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      button.dataset.copied = "true";
      if (runtime.copyTimer) window.clearTimeout(runtime.copyTimer);
      runtime.copyTimer = window.setTimeout(() => {
        button.removeAttribute("data-copied");
        runtime.copyTimer = 0;
      }, 900);
    } catch (_) {}
  }

  function copyContextValue(key, button) {
    const context = runtime.context || globalThis.__SIMNET_AUTO_CONTEXT__?.current?.() || {};
    const value = key === "contract" && context.contract ? `abon${context.contract}` : context[key];
    writeClipboard(value, button);
  }

  function emitAction(action) {
    try {
      window.dispatchEvent(new CustomEvent("simnet-workbench-rail-action", {
        detail: { action, state: { ...runtime.state }, context: runtime.context, source: "compact-side-rail" }
      }));
    } catch (_) {}
  }

  function handleClick(event) {
    const copyButton = event.target.closest("button[data-copy-key]");
    if (copyButton) {
      copyContextValue(copyButton.dataset.copyKey, copyButton);
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    emitAction(action);
    switch (action) {
      case "toggle": setExpanded(!runtime.state.expanded); break;
      case "collapse": setExpanded(!runtime.state.expanded); break;
      case "details": openDetails(); break;
      case "mentor": openMentor(); break;
      case "history": openHistory(); break;
      case "stop": clickStop(); break;
      case "close-flyout": setFlyout(""); break;
      case "open-source": openSource(); break;
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

  function compactStatus(status, tone) {
    const text = safeText(status?.textContent || "", 90);
    if (text) return text;
    if (tone === "loading") return "Сбор данных";
    if (tone === "ok") return "Готово";
    if (tone === "warning") return "Требует внимания";
    if (tone === "error") return "Ошибка";
    return "";
  }

  function renderStatus() {
    const status = runtime.panel?.querySelector("#dp-status") || document.querySelector("#dp-status");
    const tone = statusTone(status);
    const text = compactStatus(status, tone);
    for (const dot of runtime.root?.querySelectorAll(".status-dot,.session-tone") || []) dot.dataset.tone = tone;
    const session = runtime.root?.querySelector(".session-status");
    if (session) {
      session.textContent = text;
      session.classList.toggle("has-value", Boolean(text));
    }
    const brand = runtime.root?.querySelector('[data-action="toggle"]');
    if (brand) brand.title = text || "Workbench";
    const stop = runtime.panel?.querySelector("#dp-stop");
    for (const button of runtime.root?.querySelectorAll('[data-action="stop"]') || []) {
      button.disabled = !stop || stop.disabled;
    }
  }

  function setSkeletonValue(node, value, title = "") {
    if (!node) return;
    const text = safeText(value, 180);
    node.textContent = text;
    node.classList.toggle("has-value", Boolean(text));
    if (title || text) node.title = title || text;
    else node.removeAttribute("title");
  }

  function renderChip(key, value) {
    const chip = runtime.root?.querySelector(`[data-chip="${key}"]`);
    if (!chip) return;
    const text = safeText(value, 120);
    const label = chip.querySelector(".chip-value");
    const copy = chip.querySelector(".copy-button");
    chip.dataset.loading = text ? "false" : "true";
    chip.title = text || chip.title;
    if (label) label.textContent = text;
    if (copy) copy.disabled = !text;
  }

  function renderContext() {
    if (!runtime.root) return;
    const context = runtime.context || globalThis.__SIMNET_AUTO_CONTEXT__?.current?.() || null;
    const system = context?.system === "userside" ? "UserSide" : context?.system === "billing" ? "Billing" : "";
    setSkeletonValue(runtime.root.querySelector(".system-label"), system);
    setSkeletonValue(runtime.root.querySelector(".identity-name"), context?.name || "");
    setSkeletonValue(runtime.root.querySelector(".identity-address"), context?.address || "");
    renderChip("contract", context?.contract ? `abon${context.contract}` : "");
    renderChip("ip", context?.ip || "");
    renderChip("mac", context?.mac || "");
  }

  function observeRuntime() {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    runtime.observer = new MutationObserver(scheduleSync);
    if (runtime.panel) {
      runtime.observer.observe(runtime.panel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden", "open", "data-operation-mode"]
      });
    }
    const status = runtime.panel?.querySelector("#dp-status");
    if (status) {
      runtime.statusObserver = new MutationObserver(renderStatus);
      runtime.statusObserver.observe(status, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"]
      });
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
    version: "0.4.0",
    runtime,
    open: () => setExpanded(true),
    close: () => setExpanded(false),
    openDetails,
    openMentor,
    openHistory,
    toggle: () => setExpanded(!runtime.state.expanded)
  };

  window.addEventListener("simnet-workbench-context", event => {
    runtime.context = event.detail || null;
    renderContext();
  });
  window.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (runtime.state.flyout) setFlyout("");
    else if (runtime.state.expanded) setExpanded(false);
  }, true);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("pagehide", () => {
    runtime.observer?.disconnect();
    runtime.statusObserver?.disconnect();
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
    if (runtime.frame) window.cancelAnimationFrame(runtime.frame);
    if (runtime.copyTimer) window.clearTimeout(runtime.copyTimer);
    restorePageReserve();
  });

  install();
})();
