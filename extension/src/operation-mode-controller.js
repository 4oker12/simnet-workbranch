"use strict";

(async () => {
  if (top !== self) return;
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const { GM_getValue, GM_setValue, GM_addValueChangeListener, GM_addStyle } = compat.api;
  const MODE_KEY = "dp_workbench_operation_mode_v2";
  const LEGACY_MODE_KEY = "dp_workbench_operation_mode_v1";
  const VALID_MODES = new Set(["diagnostic", "navigator", "mentor"]);
  const runtime = {
    mode: normalizeMode(GM_getValue(MODE_KEY, "")),
    panel: null,
    controls: null,
    syncingLegacy: false,
    noticeTimer: 0
  };

  if (!runtime.mode) {
    runtime.mode = String(GM_getValue(LEGACY_MODE_KEY, "diagnostic")) === "mentor" ? "mentor" : "diagnostic";
  }

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return VALID_MODES.has(mode) ? mode : "";
  }

  function operationIsBusy() {
    const stop = document.querySelector("#dp-stop");
    return Boolean(stop && !stop.disabled);
  }

  function showNotice(message) {
    const notice = runtime.controls?.querySelector("#dp-operation-mode-v2-notice");
    if (!notice) return;
    clearTimeout(runtime.noticeTimer);
    notice.textContent = String(message || "");
    notice.hidden = !notice.textContent;
    if (notice.textContent) {
      runtime.noticeTimer = setTimeout(() => {
        notice.hidden = true;
        notice.textContent = "";
      }, 4200);
    }
  }

  function ensureControls(panel) {
    let controls = panel.querySelector("#dp-operation-mode-v2");
    if (!controls) {
      controls = document.createElement("section");
      controls.id = "dp-operation-mode-v2";
      controls.innerHTML = `
        <div class="dp-operation-mode-v2-buttons" role="tablist" aria-label="Режим Workbench">
          <button type="button" role="tab" data-dp-operation-mode-v2="diagnostic">Диагностика</button>
          <button type="button" role="tab" data-dp-operation-mode-v2="navigator">В линии</button>
          <button type="button" role="tab" data-dp-operation-mode-v2="mentor">Обучение</button>
        </div>
        <span id="dp-operation-mode-v2-notice" role="status" aria-live="polite" hidden></span>
      `;
      controls.addEventListener("click", (event) => {
        const button = event.target.closest("[data-dp-operation-mode-v2]");
        if (button) setMode(button.dataset.dpOperationModeV2, "ui");
      });
      const roleBanner = panel.querySelector("#dp-role-banner");
      if (roleBanner) roleBanner.insertAdjacentElement("afterend", controls);
      else panel.querySelector("#dp-head")?.insertAdjacentElement("afterend", controls);
      if (!controls.isConnected) panel.prepend(controls);
    }
    runtime.controls = controls;
    return controls;
  }

  function hideLegacyControl(panel) {
    const legacy = panel.querySelector("#dp-operation-mode");
    if (!legacy) return;
    legacy.hidden = true;
    legacy.setAttribute("aria-hidden", "true");
  }

  function syncLegacyMode(mode) {
    const desired = mode === "mentor" ? "mentor" : "diagnostic";
    if (String(GM_getValue(LEGACY_MODE_KEY, "diagnostic")) === desired) return;
    runtime.syncingLegacy = true;
    try { GM_setValue(LEGACY_MODE_KEY, desired); } finally {
      setTimeout(() => { runtime.syncingLegacy = false; }, 120);
    }
  }

  function renderControls() {
    if (!runtime.controls) return;
    runtime.controls.querySelectorAll("[data-dp-operation-mode-v2]").forEach((button) => {
      const active = button.dataset.dpOperationModeV2 === runtime.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
  }

  function applyMode(source = "") {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    runtime.panel = panel;
    ensureControls(panel);
    hideLegacyControl(panel);
    panel.dataset.operationMode = runtime.mode;
    renderControls();
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("mode-change");
    document.dispatchEvent(new CustomEvent("dp:operation-mode-change", {
      detail: { mode: runtime.mode, source }
    }));
  }

  function stabilizeMode(source) {
    applyMode(source);
    setTimeout(() => applyMode(source), 40);
    setTimeout(() => applyMode(source), 160);
  }

  function setMode(value, source = "api") {
    const mode = normalizeMode(value) || "diagnostic";
    if (mode !== "diagnostic" && operationIsBusy()) {
      showNotice("Сначала останови или дождись завершения активной диагностики.");
      renderControls();
      return false;
    }
    runtime.mode = mode;
    try { GM_setValue(MODE_KEY, mode); } catch (_) {}
    syncLegacyMode(mode);
    stabilizeMode(source);
    return true;
  }

  function install() {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    runtime.panel = panel;
    ensureControls(panel);
    hideLegacyControl(panel);
    syncLegacyMode(runtime.mode);
    stabilizeMode("install");
  }

  GM_addStyle(`
    #dp-operation-mode { display:none !important; }
    #dp-operation-mode-v2 {
      flex:0 0 auto !important;
      display:grid !important;
      gap:5px !important;
      padding:7px 10px !important;
      color:var(--dp-text,#172033) !important;
      background:var(--dp-surface,#fff) !important;
      border-bottom:1px solid var(--dp-border,#d5dde8) !important;
    }
    .dp-operation-mode-v2-buttons {
      display:grid !important;
      grid-template-columns:repeat(3,minmax(0,1fr)) !important;
      gap:5px !important;
    }
    .dp-operation-mode-v2-buttons button {
      min-width:0 !important;
      height:30px !important;
      padding:0 7px !important;
      overflow:hidden !important;
      color:#475569 !important;
      background:#f8fafc !important;
      border:1px solid #cbd5e1 !important;
      border-radius:7px !important;
      font:750 10px/1 "Segoe UI",Arial,sans-serif !important;
      text-overflow:ellipsis !important;
      white-space:nowrap !important;
      cursor:pointer !important;
    }
    .dp-operation-mode-v2-buttons button:hover { color:#1d4ed8 !important; border-color:#93c5fd !important; }
    .dp-operation-mode-v2-buttons button.active {
      color:#fff !important;
      background:#2563eb !important;
      border-color:#1d4ed8 !important;
      box-shadow:0 1px 2px rgba(37,99,235,.18) !important;
    }
    #dp-operation-mode-v2-notice {
      padding:6px 8px !important;
      color:#92400e !important;
      background:#fffbeb !important;
      border:1px solid #f5c46d !important;
      border-radius:7px !important;
      font-size:9.5px !important;
      line-height:1.35 !important;
    }
    #dp-operation-mode-v2-notice[hidden] { display:none !important; }
  `);

  try {
    GM_addValueChangeListener(MODE_KEY, (_key, _oldValue, newValue) => {
      const mode = normalizeMode(newValue);
      if (!mode || mode === runtime.mode) return;
      runtime.mode = mode;
      syncLegacyMode(mode);
      stabilizeMode("storage");
    });
    GM_addValueChangeListener(LEGACY_MODE_KEY, (_key, _oldValue, newValue) => {
      if (runtime.syncingLegacy) return;
      if (runtime.mode === "navigator") {
        syncLegacyMode("navigator");
        stabilizeMode("legacy-guard");
        return;
      }
      const next = String(newValue) === "mentor" ? "mentor" : "diagnostic";
      if (next !== runtime.mode) {
        runtime.mode = next;
        try { GM_setValue(MODE_KEY, next); } catch (_) {}
        stabilizeMode("legacy");
      }
    });
  } catch (_) {}

  new MutationObserver(() => {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    if (panel !== runtime.panel || !panel.querySelector("#dp-operation-mode-v2") || panel.querySelector("#dp-operation-mode:not([hidden])")) {
      install();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  globalThis.__SIMNET_OPERATION_MODE__ = Object.freeze({
    get: () => runtime.mode,
    set: setMode
  });

  install();
})();
