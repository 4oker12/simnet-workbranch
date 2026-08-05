"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_DOCK_ROUTE_UI__) return;

  const HOST_ID = "simnet-workbench-dock";
  const routeApi = globalThis.__SIMNET_MENTOR_ROUTE__;
  if (!routeApi?.subscribe) return;

  let route = routeApi.getState?.() || null;
  let hostObserver = null;
  let shadowObserver = null;
  let boundRoot = null;
  let applying = false;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function buttonFor(action) {
    if (!action || action.type === "complete") return "";
    if (action.type === "wait") {
      return `<button type="button" class="action-btn primary route-primary" data-mentor-route-command="refresh"><span>${escapeHtml(action.label || "Обновить")}</span></button>`;
    }
    if (action.type === "highlight") {
      return `<button type="button" class="action-btn primary route-primary" data-mentor-route-command="highlight"><span>${escapeHtml(action.label || "Подсветить")}</span></button>`;
    }
    return `<button type="button" class="action-btn primary route-primary" data-mentor-route-command="${escapeHtml(action.command || "")}"><span>${escapeHtml(action.label || "Продолжить")}</span></button>`;
  }

  function stepsHtml(steps) {
    return (steps || []).map((step, index) => {
      const marker = step.complete ? "✓" : step.active ? String(index + 1) : "·";
      const klass = step.complete ? "done" : step.active ? "attention" : "pending";
      return `<div class="mini-step ${klass}" data-step="${escapeHtml(step.id)}">
        <span>${marker}</span>
        <strong>${escapeHtml(step.label)}</strong>
        <small>${escapeHtml(step.detail)}</small>
      </div>`;
    }).join("");
  }

  function applyRouteUi() {
    if (applying || !route?.active || !boundRoot) return;
    const activePane = boundRoot.querySelector('.module-pane[data-pane="active"]');
    if (!activePane) return;
    const taskCard = activePane.querySelector(".active-task");
    const heading = taskCard?.querySelector(".task-heading span");
    const title = taskCard?.querySelector(":scope > strong");
    const help = taskCard?.querySelector(".help");
    const actions = taskCard?.querySelector(".task-actions");
    const steps = activePane.querySelector(".mini-steps");
    if (!taskCard || !heading || !title || !actions || !steps) return;

    applying = true;
    try {
      const management = route.management || {};
      const action = route.action || {};
      const progress = management.progress || { current: 1, total: 1 };
      taskCard.classList.remove("severity-info", "severity-warning", "severity-critical", "severity-ok");
      taskCard.classList.add(`severity-${route.ui?.severity || "warning"}`);
      taskCard.dataset.routeStage = management.stage || "";
      heading.textContent = `Маршрут OLT · ${progress.current}/${progress.total}`;
      title.textContent = action.title || "Продолжи маршрут";
      title.title = action.title || "";
      if (help) help.dataset.tip = action.detail || "";
      actions.innerHTML = `${buttonFor(action)}<button type="button" class="action-btn" data-mentor-route-refresh><span>Обновить</span></button>`;
      steps.innerHTML = stepsHtml(management.steps);

      let pageChip = activePane.querySelector(".route-page-chip");
      if (!pageChip) {
        pageChip = document.createElement("span");
        pageChip.className = "route-page-chip";
        activePane.insertBefore(pageChip, taskCard);
      }
      pageChip.textContent = action.pageMatched
        ? `Страница: ${management.currentPage || "текущая"}`
        : `Нужно перейти: ${management.expectedPage || "другая страница"}`;
      pageChip.classList.toggle("matched", Boolean(action.pageMatched));
    } finally {
      applying = false;
    }
  }

  function bindRoot(root) {
    if (!root || root === boundRoot) return;
    shadowObserver?.disconnect();
    boundRoot = root;
    root.addEventListener("click", event => {
      const routeButton = event.target.closest?.("[data-mentor-route-command]");
      if (routeButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const command = routeButton.dataset.mentorRouteCommand || "";
        routeApi.execute(command).catch(() => {});
        return;
      }
      if (event.target.closest?.("[data-mentor-route-refresh]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        routeApi.refresh().catch(() => {});
      }
    }, true);

    shadowObserver = new MutationObserver(() => applyRouteUi());
    shadowObserver.observe(root, { childList: true, subtree: true });
    applyRouteUi();
  }

  function findAndBind() {
    const host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) bindRoot(host.shadowRoot);
  }

  const unsubscribe = routeApi.subscribe(next => {
    route = next || null;
    findAndBind();
    applyRouteUi();
  });

  hostObserver = new MutationObserver(findAndBind);
  hostObserver.observe(document.documentElement, { childList: true, subtree: true });
  findAndBind();

  const style = document.createElement("style");
  style.textContent = `
    #${HOST_ID}{--simnet-route-ui:1}
  `;
  (document.head || document.documentElement).appendChild(style);

  globalThis.__SIMNET_DOCK_ROUTE_UI__ = { version: "0.1.0", apply: applyRouteUi };
  window.addEventListener("pagehide", () => {
    unsubscribe?.();
    hostObserver?.disconnect();
    shadowObserver?.disconnect();
  }, { once: true });
})();
