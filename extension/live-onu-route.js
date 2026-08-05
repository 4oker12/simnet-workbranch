"use strict";

(() => {
  if (globalThis.__SIMNET_LIVE_ONU_ROUTE__) return;

  const previousRenderFocus = renderFocus;
  const previousRenderChecklist = renderChecklist;

  function lineActionLabel() {
    return checkpoints()?.oltKnown ? "К опросу" : "Маршрут OLT";
  }

  function decorateLineAction(root = document) {
    const button = root.querySelector?.('[data-highlight="line"]');
    if (!button) return;
    button.textContent = lineActionLabel();
    button.classList.add("primary-choice", "onu-route-choice");
    button.title = checkpoints()?.oltKnown
      ? "Показать соответствующую вкладку опроса ONU"
      : "Перейти к определению OLT перед опросом ONU";
    button.setAttribute("aria-label", button.title);
  }

  renderFocus = function renderFocusWithOnuRoute(task) {
    previousRenderFocus(task);
    if (task?.id !== "poll-onu") return;
    decorateLineAction(document.querySelector("#focusActions") || document);
  };

  renderChecklist = function renderChecklistWithOnuRoute(steps) {
    previousRenderChecklist(steps);
    for (const row of document.querySelectorAll("#checklist .step")) {
      const title = row.querySelector(".step-copy strong")?.textContent?.trim();
      if (title !== "Линия и ONU") continue;
      decorateLineAction(row);
      break;
    }
  };

  globalThis.__SIMNET_LIVE_ONU_ROUTE__ = {
    version: "0.1.0",
    decorateLineAction
  };

  render();
})();
