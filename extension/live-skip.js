"use strict";

(() => {
  const SKIPS_KEY = "wb_live_skipped_tasks_v1";
  let skippedByContext = {};

  const originalRenderFocus = renderFocus;
  const originalBuildSteps = buildSteps;

  function skipContextKey() {
    const context = effectiveContext();
    if (workflow?.key) return workflow.key;
    if (context.contract) return `contract:${context.contract}`;
    if (context.billingId) return `billing:${context.billingId}`;
    if (context.customerId) return `userside:${context.customerId}`;
    return "no-context";
  }

  function currentSkipped() {
    return skippedByContext[skipContextKey()] || {};
  }

  function skipIdFor(task) {
    if (!task) return "";
    if (task.id === "missing-olt" || task.id === "poll-onu") return "line";
    if (task.id === "check-session") return "session";
    return task.skipId || task.id || "";
  }

  function isSkipped(task) {
    const id = typeof task === "string" ? task : skipIdFor(task);
    return Boolean(id && currentSkipped()[id]);
  }

  async function persistSkipped() {
    try { await chrome.storage.session.set({ [SKIPS_KEY]: skippedByContext }); } catch (_) {}
  }

  async function loadSkipped() {
    try {
      const result = await chrome.storage.session.get({ [SKIPS_KEY]: {} });
      skippedByContext = result?.[SKIPS_KEY] || {};
    } catch (_) {
      skippedByContext = {};
    }
  }

  async function skipTask(task) {
    const id = skipIdFor(task);
    if (!id) return;
    const key = skipContextKey();
    skippedByContext = {
      ...skippedByContext,
      [key]: {
        ...(skippedByContext[key] || {}),
        [id]: {
          id,
          taskId: task.id,
          title: task.title,
          severity: task.severity || "info",
          skippedAt: Date.now()
        }
      }
    };
    await persistSkipped();
  }

  async function restoreSkipped(id) {
    const key = skipContextKey();
    const next = { ...(skippedByContext[key] || {}) };
    delete next[id];
    skippedByContext = { ...skippedByContext, [key]: next };
    await persistSkipped();
  }

  async function restoreAllSkipped() {
    const key = skipContextKey();
    skippedByContext = { ...skippedByContext, [key]: {} };
    await persistSkipped();
  }

  function alertTask(alert, context) {
    if (alert?.id === "missing-olt") {
      return { ...alert, hints: missingOltHints(context), route: true, skipId: "line" };
    }
    return {
      ...alert,
      hints: [
        alert.text,
        `Источник предупреждения: ${alert.source || "Billing"}.`,
        "Нажми «Подсветить», чтобы перейти к конкретному полю."
      ]
    };
  }

  function rawTaskCandidates() {
    const context = effectiveContext();
    const cp = checkpoints();
    const session = evidence().session || {};

    if (!context.contract && !context.billingId && !context.customerId) {
      return [{
        id: "open-subscriber",
        severity: "info",
        title: "Открой карточку абонента",
        target: "subscriber",
        hints: ["Live Assistant подхватит договор, IP и доступные данные после открытия карточки Billing или UserSide."],
        skippable: false
      }];
    }

    const tasks = (Array.isArray(snapshot?.alerts) ? snapshot.alerts : [])
      .map(alert => alertTask(alert, context));

    if (!cp.sessionResolved) {
      let title = "Проверь сессию в Juniper NEW";
      let severity = "info";
      if (session.opened && session.status === "loading") title = "Juniper открыт — жду загрузку";
      else if (session.opened && session.status === "unknown") {
        title = "Juniper открыт, результат не распознан";
        severity = "warning";
      }
      tasks.push({
        id: "check-session",
        skipId: "session",
        severity,
        title,
        target: "session",
        hints: sessionHints()
      });
    }

    if (!cp.onuPolled) {
      tasks.push({
        id: "poll-onu",
        skipId: "line",
        severity: "info",
        title: cp.oltKnown ? "Подтверди состояние ONU" : "Сначала определи OLT",
        target: "line",
        hints: cp.oltKnown ? lineHints(context) : missingOltHints(context),
        route: !cp.oltKnown
      });
    }

    if (!tasks.length) {
      tasks.push({
        id: "checks-complete",
        severity: "ok",
        title: "Основные чекпоинты пройдены",
        target: "subscriber",
        hints: ["Абонент определён, авторизация проверена и live-состояние линии получено."],
        skippable: false
      });
    }

    return tasks;
  }

  function activeSkippedRecords() {
    const activeIds = new Set(rawTaskCandidates().map(skipIdFor));
    return Object.values(currentSkipped())
      .filter(record => activeIds.has(record.id))
      .sort((left, right) => left.skippedAt - right.skippedAt);
  }

  currentTask = function currentTaskWithSkip() {
    const candidates = rawTaskCandidates();
    const next = candidates.find(task => !isSkipped(task));
    if (next) return next;

    const skipped = activeSkippedRecords();
    return {
      id: "skipped-summary",
      severity: "info",
      title: "Оставшиеся проверки отложены",
      target: "",
      hints: [
        skipped.length
          ? `Пропущено проверок: ${skipped.length}. Они не засчитаны как выполненные и доступны для возврата ниже.`
          : "Нет доступного следующего шага. Обнови состояние страницы."
      ],
      skippable: false,
      paused: true
    };
  };

  renderFocus = function renderFocusWithSkip(task) {
    originalRenderFocus(task);
    const card = document.querySelector(".focus-card");
    card?.classList.toggle("is-paused", Boolean(task.paused));

    const actions = document.querySelector("#focusActions");
    if (!actions) return;

    const forbidden = new Set(["open-subscriber", "checks-complete", "skipped-summary"]);
    const canSkip = task.skippable !== false && !forbidden.has(task.id);
    if (canSkip) {
      actions.insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="skip-choice" data-skip-task="${escapeHtml(skipIdFor(task))}" data-skip-title="${escapeHtml(task.title)}" data-skip-source="${escapeHtml(task.id)}">Пропустить</button>`
      );
    }

    if (task.id === "skipped-summary") {
      actions.insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="primary-choice" data-restore-all-skips>Вернуть пропущенные</button>`
      );
    }
  };

  buildSteps = function buildStepsWithSkip() {
    return originalBuildSteps().map(step => {
      const skipped = !step.complete && isSkipped(step.id);
      return {
        ...step,
        skipped,
        attention: skipped ? false : step.attention,
        detail: skipped ? `Отложено оператором · ${step.detail}` : step.detail
      };
    });
  };

  renderChecklist = function renderChecklistWithSkip(steps) {
    const progress = document.querySelector("#progressChip");
    const checklist = document.querySelector("#checklist");
    if (!progress || !checklist) return;

    progress.textContent = `${steps.filter(step => step.complete).length} / ${steps.length}`;
    const rows = steps.map((step, index) => {
      const classes = [
        "step",
        step.complete ? "done" : "",
        step.attention ? "attention" : "",
        step.skipped ? "skipped" : "",
        !step.complete && !step.attention && !step.skipped ? "active" : ""
      ].filter(Boolean).join(" ");
      const marker = step.skipped ? "↷" : step.attention ? "!" : step.complete ? "✓" : index + 1;
      const tool = step.skipped
        ? `<span class="step-tools"><button type="button" data-restore-skip="${escapeHtml(step.id)}">Вернуть</button></span>`
        : !step.complete
          ? `<span class="step-tools"><button type="button" data-highlight="${escapeHtml(step.target)}">Поле</button></span>`
          : "";
      return `<div class="${classes}"><span class="step-state">${marker}</span><span class="step-copy"><strong>${escapeHtml(step.title)}</strong><span title="${escapeHtml(step.detail)}">${escapeHtml(step.detail)}</span></span>${tool}</div>`;
    });

    const mappedIds = new Set(["session", "line"]);
    const extra = activeSkippedRecords().filter(record => !mappedIds.has(record.id));
    if (extra.length) {
      rows.push(`<div class="skipped-stack"><span class="skipped-stack-title">Отложено</span>${extra.map(record => `
        <div class="skipped-item severity-${escapeHtml(record.severity)}">
          <span>${escapeHtml(record.title)}</span>
          <button type="button" data-restore-skip="${escapeHtml(record.id)}">Вернуть</button>
        </div>`).join("")}</div>`);
    }

    checklist.innerHTML = rows.join("");
  };

  document.addEventListener("click", async event => {
    const skipButton = event.target.closest("[data-skip-task]");
    if (skipButton) {
      event.preventDefault();
      event.stopPropagation();
      await skipTask({
        id: skipButton.dataset.skipSource,
        skipId: skipButton.dataset.skipTask,
        title: skipButton.dataset.skipTitle,
        severity: document.querySelector(".focus-card")?.classList.contains("severity-critical")
          ? "critical"
          : document.querySelector(".focus-card")?.classList.contains("severity-warning")
            ? "warning"
            : "info"
      });
      render();
      return;
    }

    const restoreButton = event.target.closest("[data-restore-skip]");
    if (restoreButton) {
      event.preventDefault();
      event.stopPropagation();
      await restoreSkipped(restoreButton.dataset.restoreSkip);
      render();
      return;
    }

    if (event.target.closest("[data-restore-all-skips]")) {
      event.preventDefault();
      event.stopPropagation();
      await restoreAllSkipped();
      render();
    }
  }, true);

  void loadSkipped().then(() => render());
})();
