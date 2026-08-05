"use strict";

(() => {
  const ROUTE_GET = "SIMNET_WB_MENTOR_ROUTE_GET";
  const ROUTE_COMMAND = "SIMNET_WB_MENTOR_ROUTE_COMMAND";
  const ROUTE_STATE = "SIMNET_WB_MENTOR_ROUTE_STATE";
  let route = null;
  let observer = null;
  let applying = false;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function actionButton(action) {
    if (!action || action.type === "complete") return "";
    const command = action.type === "highlight" ? "highlight" : action.command || "refresh";
    return `<button type="button" class="primary-choice" data-canonical-route-command="${escapeHtml(command)}">${escapeHtml(action.label || "Продолжить")}</button>`;
  }

  function apply() {
    if (applying || !route?.active) return;
    const card = document.querySelector("#oltRouteCard");
    const title = document.querySelector("#oltRouteTitle");
    const stage = document.querySelector("#oltRouteStage");
    const text = document.querySelector("#oltRouteText");
    const data = document.querySelector("#oltRouteData");
    const actions = document.querySelector("#oltRouteActions");
    if (!card || !title || !stage || !text || !data || !actions) return;

    applying = true;
    try {
      const management = route.management || {};
      const action = route.action || {};
      const progress = management.progress || { current: 1, total: 1 };
      card.hidden = false;
      card.dataset.canonicalRoute = "true";
      title.textContent = action.title || "Маршрут OLT";
      stage.textContent = `${progress.current} / ${progress.total}`;
      text.textContent = action.detail || "";
      data.innerHTML = `<span class="route-chip">${escapeHtml(action.pageMatched ? `Текущая: ${management.currentPage}` : `Следующая: ${management.expectedPage}`)}</span>`;
      actions.innerHTML = `${actionButton(action)}<button type="button" data-canonical-route-refresh>Обновить</button>`;
    } finally {
      applying = false;
    }
  }

  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({ type: ROUTE_GET });
      if (response?.ok) {
        route = response.route || null;
        apply();
      }
    } catch (_) {}
  }

  document.addEventListener("click", event => {
    const commandButton = event.target.closest("[data-canonical-route-command]");
    if (commandButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chrome.runtime.sendMessage({
        type: ROUTE_COMMAND,
        command: commandButton.dataset.canonicalRouteCommand || ""
      }).then(refresh).catch(() => {});
      return;
    }

    if (event.target.closest("[data-canonical-route-refresh]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void refresh();
      return;
    }

    const legacyHighlight = event.target.closest("[data-highlight]");
    if (legacyHighlight && route?.active && route.ui?.blockForeignHighlights) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: ROUTE_COMMAND, command: route.action?.command || "highlight" })
        .then(refresh)
        .catch(() => {});
    }
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== ROUTE_STATE) return false;
    route = message.route || null;
    apply();
    return false;
  });

  observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => observer?.disconnect(), { once: true });
  void refresh();
})();
