"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_ROUTE_CATALOG_UI__) return;

  const HOST_ID = "simnet-workbench-dock";
  const NOTES_KEY = "simnet_wb_route_catalog_notes_v1";
  const SEEN_KEY = "simnet_wb_route_catalog_seen_083";
  const CATALOG_WIDTH = 720;
  const RAIL_WIDTH = 48;
  const registry = globalThis.__SIMNET_ROUTE_REGISTRY__ || [];
  const launcher = globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__;
  const routeApi = globalThis.__SIMNET_MENTOR_ROUTE__;
  if (!registry.length || !launcher) return;

  let notes = {};
  let catalogOpen = false;
  let boundRoot = null;
  let observer = null;
  let saveTimer = 0;
  let currentRoute = routeApi?.getState?.() || null;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function activeRouteId() {
    const stage = currentRoute?.management?.stage || "";
    const target = currentRoute?.action?.target || "";
    const command = currentRoute?.action?.command || "";
    const byStage = {
      "go-billing-main": "billing-card",
      "open-userside": "billing-userside-link",
      "find-tmc": "userside-tmc",
      "return-billing": "billing-card",
      "open-technical": "billing-technical",
      "fill-olt": "billing-olt-field",
      "return-for-poll": "billing-card",
      "poll-onu": target || "poller-result",
      "wait-poll-result": "poller-result",
      complete: "poller-result"
    };
    if (byStage[stage]) return byStage[stage];
    if (command === "userside") return "billing-userside-link";
    return "";
  }

  function routeCell(item) {
    const targetButton = item.target
      ? `<button type="button" class="catalog-mini" data-catalog-highlight="${escapeHtml(item.target)}">Подсветить</button>`
      : "";
    return `<div class="catalog-point">
      <div class="catalog-top"><span class="catalog-group">${escapeHtml(item.group)}</span><span class="catalog-status ${escapeHtml(item.status)}">${item.status === "deferred" ? "отложено" : "активно"}</span></div>
      <strong>${escapeHtml(item.point)}</strong>
      <span>${escapeHtml(item.action)}</span>
      <small>${escapeHtml(item.page)} · ${escapeHtml(item.refType)}</small>
      <div class="catalog-ref"><code title="${escapeHtml(item.reference)}">${escapeHtml(item.reference)}</code><button type="button" class="catalog-copy" data-catalog-copy="${escapeHtml(item.reference)}">Копировать</button>${targetButton}</div>
    </div>`;
  }

  function rowsHtml() {
    const active = activeRouteId();
    return registry.map((item, index) => `<tr data-route-id="${escapeHtml(item.id)}" class="${item.id === active ? "current" : ""}">
      <td><span class="route-index">${index + 1}</span>${routeCell(item)}</td>
      <td><div class="catalog-note" contenteditable="true" role="textbox" spellcheck="true" data-note-id="${escapeHtml(item.id)}" data-placeholder="Твоя правка">${escapeHtml(notes[item.id] || "")}</div></td>
    </tr>`).join("");
  }

  function catalogHtml() {
    return `<section class="route-catalog-pane module-pane" data-pane="routes">
      <div class="catalog-summary"><strong>Карта маршрутов Workbench</strong><span>${registry.length} точек · системная карта слева, твои правки справа</span></div>
      <div class="route-table-wrap">
        <table class="route-table">
          <colgroup><col style="width:64%"><col style="width:36%"></colgroup>
          <thead><tr><th>Точки маршрута / элемент / endpoint</th><th>Мои правки</th></tr></thead>
          <tbody>${rowsHtml()}</tbody>
        </table>
      </div>
    </section>`;
  }

  function ensureStyle(root) {
    if (root.getElementById("simnet-route-catalog-style")) return;
    const style = document.createElement("style");
    style.id = "simnet-route-catalog-style";
    style.textContent = `
      .flyout.route-catalog-open{width:min(${CATALOG_WIDTH}px,calc(100vw - ${RAIL_WIDTH}px))!important}
      .flyout.route-catalog-open .module-stage{padding:6px!important;overflow:hidden!important}
      .flyout.route-catalog-open .dock-footer{display:none!important}
      .route-catalog-pane{display:grid!important;grid-template-rows:auto minmax(0,1fr)!important;gap:6px!important;height:100%!important;overflow:hidden!important}
      .catalog-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 6px;color:#eaf1f8;background:#111d2b;border:1px solid #2d4057;border-radius:7px}
      .catalog-summary strong{font-size:11px}.catalog-summary span{color:#8fa0b5;font-size:8px;text-align:right}
      .route-table-wrap{min-height:0;overflow:auto;border:1px solid #2b3d52;border-radius:7px;background:#0c1520}
      .route-table{width:100%;border-collapse:collapse;table-layout:fixed;color:#dbe5ef;font:9px/1.3 "Segoe UI",Arial,sans-serif}
      .route-table th{position:sticky;top:0;z-index:2;padding:7px;text-align:left;color:#aebdd0;background:#142033;border-bottom:1px solid #3a4d64;font-size:8px;text-transform:uppercase;letter-spacing:.05em}
      .route-table td{position:relative;vertical-align:top;padding:6px;border-bottom:1px solid #223146;border-right:1px solid #223146}
      .route-table td:last-child{border-right:0}.route-table tr.current td{background:rgba(255,255,255,.075);box-shadow:inset 3px 0 0 #fff}
      .route-index{position:absolute;right:5px;top:5px;color:#53657a;font-size:7px}
      .catalog-point{display:grid;gap:3px;min-width:0}.catalog-top{display:flex;align-items:center;gap:5px}.catalog-group{color:#c7b5f1;font-size:7px;font-weight:800;text-transform:uppercase}.catalog-status{padding:1px 4px;border-radius:999px;color:#91dcb1;background:#143020;font-size:6px}.catalog-status.deferred{color:#e1c27c;background:#332912}
      .catalog-point strong{padding-right:18px;color:#fff;font-size:9px}.catalog-point>span{color:#9dacc0}.catalog-point small{color:#687b92;font-size:7px}
      .catalog-ref{display:flex;align-items:center;gap:4px;min-width:0;margin-top:2px}.catalog-ref code{min-width:0;flex:1;overflow:hidden;padding:3px 4px;color:#c3d4e7;background:#09111b;border:1px solid #25374b;border-radius:4px;font:7px/1.25 Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}
      .catalog-copy,.catalog-mini{flex:0 0 auto;height:20px;padding:0 5px;color:#c9d6e4;background:#172437;border:1px solid #3b5069;border-radius:5px;font-size:7px;cursor:pointer}.catalog-mini{color:#07130d;background:#fff;border-color:#fff}
      .catalog-note{min-height:64px;padding:6px;color:#e8eef6;background:#111b28;border:1px dashed #40536b;border-radius:6px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.catalog-note:focus{border-style:solid;border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.12)}.catalog-note:empty::before{content:attr(data-placeholder);color:#60738b}
      .rail-button[data-route-catalog] svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.rail-button[data-route-catalog].active{color:#fff;background:#211a35;border-color:#fff}
    `;
    root.appendChild(style);
  }

  function setCatalogReserve() {
    const width = Math.min(CATALOG_WIDTH, Math.max(280, window.innerWidth - RAIL_WIDTH));
    document.documentElement.style.setProperty("--simnet-wb-dock-reserve", `${width + RAIL_WIDTH}px`);
    document.documentElement.classList.add("simnet-wb-dock-reserved");
  }

  function renderCatalog() {
    if (!catalogOpen || !boundRoot) return;
    const flyout = boundRoot.querySelector(".flyout");
    const stage = boundRoot.querySelector(".module-stage");
    const title = boundRoot.querySelector("#dockModuleTitle");
    const button = boundRoot.querySelector("[data-route-catalog]");
    if (!flyout || !stage || !title || !button) return;
    flyout.classList.add("route-catalog-open", "open", "pinned");
    button.classList.add("active");
    title.textContent = "Карта маршрутов";
    if (!stage.querySelector(".route-catalog-pane")) stage.innerHTML = catalogHtml();
    setCatalogReserve();
  }

  function closeCatalogMode() {
    catalogOpen = false;
    if (!boundRoot) return;
    boundRoot.querySelector(".flyout")?.classList.remove("route-catalog-open");
    boundRoot.querySelector("[data-route-catalog]")?.classList.remove("active");
  }

  function openCatalog() {
    catalogOpen = true;
    launcher.open("active");
    queueMicrotask(renderCatalog);
  }

  function saveNote(id, value) {
    notes = { ...notes, [id]: value };
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      chrome.storage.local.set({ [NOTES_KEY]: notes }).catch(() => {});
    }, 250);
  }

  function bindRoot(root) {
    if (!root || root === boundRoot) return;
    observer?.disconnect();
    boundRoot = root;
    ensureStyle(root);

    const rail = root.querySelector(".rail");
    const spacer = rail?.querySelector(".rail-spacer");
    if (rail && spacer && !root.querySelector("[data-route-catalog]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rail-button";
      button.dataset.routeCatalog = "true";
      button.setAttribute("aria-label", "Карта маршрутов");
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14M5 10h14M5 16h14M9 2v20"></path></svg><span class="label">Карта маршрутов</span>`;
      rail.insertBefore(button, spacer);
    }

    root.addEventListener("pointerenter", event => {
      if (event.target.closest?.("[data-route-catalog]")) {
        event.stopImmediatePropagation();
        openCatalog();
        return;
      }
      if (event.target.closest?.(".rail-button[data-module]")) closeCatalogMode();
    }, true);

    root.addEventListener("click", event => {
      if (event.target.closest?.("[data-route-catalog]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openCatalog();
        return;
      }
      if (event.target.closest?.(".rail-button[data-module],[data-close-dock]")) {
        closeCatalogMode();
        return;
      }
      const copy = event.target.closest?.("[data-catalog-copy]");
      if (copy) {
        event.preventDefault();
        navigator.clipboard.writeText(copy.dataset.catalogCopy || "").catch(() => {});
        copy.textContent = "✓";
        window.setTimeout(() => { copy.textContent = "Копировать"; }, 900);
        return;
      }
      const highlight = event.target.closest?.("[data-catalog-highlight]");
      if (highlight) {
        event.preventDefault();
        globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__?.highlight?.(highlight.dataset.catalogHighlight || "");
      }
    }, true);

    root.addEventListener("input", event => {
      const note = event.target.closest?.("[data-note-id]");
      if (!note) return;
      saveNote(note.dataset.noteId, note.innerText.trim());
    });

    observer = new MutationObserver(() => {
      if (catalogOpen) renderCatalog();
    });
    observer.observe(root, { childList: true, subtree: true });
    renderCatalog();
  }

  function findDock() {
    const root = document.getElementById(HOST_ID)?.shadowRoot;
    if (root) bindRoot(root);
  }

  async function install() {
    try {
      const result = await chrome.storage.local.get({ [NOTES_KEY]: {} });
      notes = result?.[NOTES_KEY] || {};
    } catch (_) { notes = {}; }

    const pageObserver = new MutationObserver(findDock);
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    findDock();

    routeApi?.subscribe?.(next => {
      currentRoute = next || null;
      if (catalogOpen && boundRoot) {
        boundRoot.querySelector(".route-catalog-pane")?.remove();
        renderCatalog();
      }
    });

    try {
      const result = await chrome.storage.session.get({ [SEEN_KEY]: false });
      const context = globalThis.__SIMNET_WORKBENCH_CORE__?.getState?.()?.context || {};
      if (!result?.[SEEN_KEY] && (context.contract || context.billingId || context.customerId)) {
        await chrome.storage.session.set({ [SEEN_KEY]: true });
        window.setTimeout(openCatalog, 700);
      }
    } catch (_) {}
  }

  globalThis.__SIMNET_ROUTE_CATALOG_UI__ = {
    version: "0.1.0",
    open: openCatalog,
    close: closeCatalogMode,
    registry
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else void install();
})();
