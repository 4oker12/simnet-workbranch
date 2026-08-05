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
    if (task?.stepId !== "line" && task?.id !== "line" && task?.id !== "poll-onu") return;
    decorateLineAction(document.querySelector("#focusActions") || document);
  };

  renderChecklist = function renderChecklistWithOnuRoute(steps) {
    previousRenderChecklist(steps);
    const lineRow = document.querySelector('#checklist .step[data-step-id="line"]')
      || [...document.querySelectorAll("#checklist .step")]
        .find(row => row.querySelector(".step-copy strong")?.textContent?.trim() === "Линия и ONU");
    if (lineRow) decorateLineAction(lineRow);
  };

  globalThis.__SIMNET_LIVE_ONU_ROUTE__ = {
    version: "0.2.0",
    decorateLineAction
  };

  render();
})();
