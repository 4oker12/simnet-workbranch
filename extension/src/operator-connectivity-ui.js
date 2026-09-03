"use strict";

(async () => {
  if (top !== self) return;
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const { GM_getValue, GM_setValue, GM_addStyle } = compat.api;
  const SCENARIO_KEY = "dp_operator_scenario_v2";
  const STEP_KEY = "dp_operator_connectivity_step_v2";
  const runtime = {
    panel: null,
    workspace: null,
    section: null,
    scenario: GM_getValue(SCENARIO_KEY, "finance") === "no-internet" ? "no-internet" : "finance",
    stepIndex: Math.max(0, Number(GM_getValue(STEP_KEY, 0)) || 0),
    model: null,
    explanationOpen: false,
    unsubscribe: null
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const connectivity = () => globalThis.__SIMNET_OPERATOR_CONNECTIVITY__ || null;
  const focusApi = () => globalThis.__SIMNET_PAGE_FOCUS__ || null;
  const currentMode = () => globalThis.__SIMNET_OPERATION_MODE__?.get?.()
    || document.querySelector("#dp-panel")?.dataset.operationMode
    || "diagnostic";

  function statusLabel(status) {
    return {
      ok: "Подтверждено",
      warning: "Проверь",
      error: "Проблема",
      info: "Контекст",
      unknown: "Не получено"
    }[status] || "Контекст";
  }

  function tone(status) {
    if (status === "error") return "error";
    if (status === "warning") return "warning";
    if (status === "ok") return "ok";
    return "info";
  }

  function showNotice(message) {
    const node = runtime.section?.querySelector("#dp-connectivity-notice");
    if (!node) return;
    node.textContent = String(message || "");
    node.hidden = !node.textContent;
  }

  function ensureScenarioControls(workspace) {
    let controls = workspace.querySelector("#dp-operator-scenarios");
    if (controls) return controls;
    controls = document.createElement("nav");
    controls.id = "dp-operator-scenarios";
    controls.setAttribute("aria-label", "Сценарий обращения");
    controls.innerHTML = `
      <button type="button" data-operator-scenario="finance">Финансы</button>
      <button type="button" data-operator-scenario="no-internet">Нет интернета</button>
    `;
    const header = workspace.querySelector(":scope > .dp-operator-header");
    header?.insertAdjacentElement("afterend", controls);
    controls.addEventListener("click", (event) => {
      const button = event.target.closest("[data-operator-scenario]");
      if (button) setScenario(button.dataset.operatorScenario);
    });
    return controls;
  }

  function ensureSection(workspace) {
    let section = workspace.querySelector("#dp-connectivity-workspace");
    if (section) {
      runtime.section = section;
      return section;
    }
    section = document.createElement("section");
    section.id = "dp-connectivity-workspace";
    section.hidden = true;
    section.innerHTML = `
      <div id="dp-connectivity-notice" role="status" aria-live="polite" hidden></div>
      <section class="dp-connectivity-summary">
        <header>
          <div><b>Нет интернета</b><span id="dp-connectivity-context">Определяю технологию…</span></div>
          <button type="button" id="dp-connectivity-refresh" title="Перечитать текущую страницу">↻</button>
        </header>
        <div id="dp-connectivity-axes"></div>
        <article id="dp-connectivity-hypothesis"></article>
      </section>
      <section class="dp-connectivity-route">
        <header><b>Маршрут локализации</b><span>Ветка зависит от технологии</span></header>
        <div id="dp-connectivity-steps"></div>
      </section>
      <section class="dp-connectivity-card">
        <header><div><span>Сейчас проверь</span><b id="dp-connectivity-step-title"></b></div><em id="dp-connectivity-step-number"></em></header>
        <p id="dp-connectivity-step-short"></p>
        <div id="dp-connectivity-entities"></div>
        <aside id="dp-connectivity-explanation" hidden></aside>
        <footer>
          <button type="button" class="primary" id="dp-connectivity-show">Показать на странице</button>
          <button type="button" id="dp-connectivity-open">Открыть раздел</button>
          <button type="button" id="dp-connectivity-why">Что означает</button>
        </footer>
      </section>
      <section class="dp-connectivity-next">
        <div><b id="dp-connectivity-next-title"></b><span id="dp-connectivity-next-short"></span></div>
        <button type="button" id="dp-connectivity-next-button">Дальше</button>
      </section>
    `;
    workspace.appendChild(section);
    runtime.section = section;

    section.querySelector("#dp-connectivity-refresh").addEventListener("click", () => refresh(true));
    section.querySelector("#dp-connectivity-steps").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-step]");
      if (button) setStep(Number(button.dataset.connectivityStep));
    });
    section.querySelector("#dp-connectivity-axes").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-axis]");
      if (!button) return;
      const model = runtime.model;
      const stepId = button.dataset.connectivityAxis;
      const index = model?.route?.steps?.findIndex((step) => step.id === stepId) ?? -1;
      if (index >= 0) setStep(index);
    });
    section.querySelector("#dp-connectivity-entities").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-entity]");
      if (button) focusEntity(button.dataset.connectivityEntity);
    });
    section.querySelector("#dp-connectivity-show").addEventListener("click", toggleFocus);
    section.querySelector("#dp-connectivity-open").addEventListener("click", openCurrentSection);
    section.querySelector("#dp-connectivity-why").addEventListener("click", () => {
      runtime.explanationOpen = !runtime.explanationOpen;
      render();
    });
    section.querySelector("#dp-connectivity-next-button").addEventListener("click", () => {
      const count = runtime.model?.route?.steps?.length || 1;
      setStep((runtime.stepIndex + 1) % count);
    });
    return section;
  }

  function setScenario(value) {
    runtime.scenario = value === "no-internet" ? "no-internet" : "finance";
    runtime.explanationOpen = false;
    try { GM_setValue(SCENARIO_KEY, runtime.scenario); } catch (_) {}
    focusApi()?.clear?.("scenario-change");
    applyScenario();
  }

  function setStep(index) {
    const count = runtime.model?.route?.steps?.length || 1;
    runtime.stepIndex = Math.max(0, Math.min(count - 1, Number(index) || 0));
    runtime.explanationOpen = false;
    try { GM_setValue(STEP_KEY, runtime.stepIndex); } catch (_) {}
    focusApi()?.clear?.("connectivity-step-change");
    render();
  }

  function axisHtml(title, entity, stepId) {
    return `
      <button type="button" class="dp-connectivity-axis ${escapeHtml(entity?.status || "unknown")}" data-connectivity-axis="${escapeHtml(stepId)}">
        <span>${escapeHtml(title)}</span>
        <b>${escapeHtml(entity?.value || "Не получено")}</b>
        <small>${escapeHtml(statusLabel(entity?.status))}</small>
      </button>
    `;
  }

  function entityHtml(entity) {
    if (!entity) return "";
    return `
      <button type="button" class="dp-connectivity-entity ${escapeHtml(entity.status)}" data-connectivity-entity="${escapeHtml(entity.key)}" ${entity.element ? "" : "disabled"}>
        <span><small>${escapeHtml(entity.label)}</small><b>${escapeHtml(entity.value)}</b></span>
        <i>${entity.element ? "Показать" : "Нет источника"}</i>
      </button>
    `;
  }

  function branchStepId(model) {
    return model?.technology?.id === "pon" ? "pon-line"
      : model?.technology?.id === "ethernet" ? "ethernet-port"
        : "detect-technology";
  }

  function render() {
    const section = runtime.section;
    const model = runtime.model;
    if (!section || !model?.route) return;
    const steps = model.route.steps;
    runtime.stepIndex = Math.max(0, Math.min(steps.length - 1, runtime.stepIndex));

    section.querySelector("#dp-connectivity-context").textContent = `${model.subscriber} · ${model.technology.label}`;
    section.querySelector("#dp-connectivity-axes").innerHTML = [
      axisHtml("Доступ", model.entities.accessSummary, "access"),
      axisHtml("Сессия", model.entities.sessionState, "session"),
      axisHtml(model.technology.id === "pon" ? "Линия PON" : model.technology.id === "ethernet" ? "Порт Ethernet" : "Технология", model.technology.id === "unknown" ? model.entities.technology : model.entities.lineState, branchStepId(model))
    ].join("");

    const hypothesis = section.querySelector("#dp-connectivity-hypothesis");
    hypothesis.className = model.hypothesis.status;
    hypothesis.innerHTML = `<span>Рабочая гипотеза</span><b>${escapeHtml(model.hypothesis.title)}</b><p>${escapeHtml(model.hypothesis.message)}</p>`;

    const routeNode = section.querySelector("#dp-connectivity-steps");
    routeNode.style.gridTemplateColumns = `repeat(${steps.length}, minmax(0,1fr))`;
    routeNode.innerHTML = steps.map((step, index) => `
      <button type="button" data-connectivity-step="${index}" class="${index === runtime.stepIndex ? "active" : ""}">
        <i>${index + 1}</i><span>${escapeHtml(step.title)}</span>
      </button>
    `).join("");

    const step = steps[runtime.stepIndex];
    section.querySelector("#dp-connectivity-step-title").textContent = step.title;
    section.querySelector("#dp-connectivity-step-number").textContent = `${runtime.stepIndex + 1} / ${steps.length}`;
    section.querySelector("#dp-connectivity-step-short").textContent = step.short;
    section.querySelector("#dp-connectivity-entities").innerHTML = step.entityKeys
      .map((key) => entityHtml(model.entities[key]))
      .join("");

    const explanation = section.querySelector("#dp-connectivity-explanation");
    explanation.textContent = step.why;
    explanation.hidden = !runtime.explanationOpen;
    section.querySelector("#dp-connectivity-why").textContent = runtime.explanationOpen ? "Скрыть пояснение" : "Что означает";

    const next = steps[runtime.stepIndex + 1];
    section.querySelector("#dp-connectivity-next-title").textContent = next ? `Следом: ${next.title}` : "Маршрут пройден";
    section.querySelector("#dp-connectivity-next-short").textContent = next ? next.short : "Сформулируй рабочую гипотезу или вернись к нужному уровню.";
    section.querySelector("#dp-connectivity-next-button").textContent = next ? "Дальше" : "Сначала";
    updateFocusButton();
  }

  function updateFocusButton() {
    const button = runtime.section?.querySelector("#dp-connectivity-show");
    if (!button) return;
    const active = Boolean(focusApi()?.isActive?.());
    button.textContent = active ? "Снять подсветку" : "Показать на странице";
    button.classList.toggle("clear", active);
  }

  function focusEntity(key) {
    const entity = runtime.model?.entities?.[key];
    if (!entity?.element) {
      showNotice(`Источник «${entity?.label || key}» пока не найден. Открой соответствующий раздел и обнови контекст.`);
      return;
    }
    showNotice("");
    focusApi()?.show?.(entity.element, {
      label: `${entity.label} · ${entity.value}`,
      tone: tone(entity.status),
      scroll: true
    });
    updateFocusButton();
  }

  function toggleFocus() {
    const focus = focusApi();
    if (focus?.isActive?.()) {
      focus.clear("connectivity-button");
      updateFocusButton();
      return;
    }
    const step = runtime.model?.route?.steps?.[runtime.stepIndex];
    if (!step) return;
    const entity = runtime.model?.entities?.[step.focusKey];
    const element = entity?.element || connectivity()?.elementForStep?.(step.id);
    if (!element) {
      showNotice(`Источник шага «${step.title}» пока не найден. Нажми «Открыть раздел».`);
      return;
    }
    showNotice("");
    focus?.show?.(element, {
      label: `${step.title} · ${entity?.value || step.short}`,
      tone: tone(entity?.status),
      scroll: true
    });
    updateFocusButton();
  }

  function openCurrentSection() {
    const step = runtime.model?.route?.steps?.[runtime.stepIndex];
    if (!step) return;
    const opened = connectivity()?.openStep?.(step.id);
    if (!opened) showNotice(`Переход для «${step.title}» не найден в текущем DOM. Нужен HTML соответствующей ссылки или кнопки Billing.`);
  }

  function refresh(feedback = false) {
    const api = connectivity();
    if (!api) {
      if (feedback) showNotice("Анализатор подключения не загружен.");
      return;
    }
    runtime.model = api.refresh();
    if (feedback) showNotice("Текущая страница перечитана. Маршрут перестроен по найденной технологии.");
    render();
  }

  function applyScenario() {
    const workspace = runtime.workspace;
    if (!workspace) return;
    workspace.dataset.scenario = runtime.scenario;
    workspace.querySelectorAll("#dp-operator-scenarios [data-operator-scenario]").forEach((button) => {
      const active = button.dataset.operatorScenario === runtime.scenario;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const navigatorActive = currentMode() === "navigator";
    runtime.section.hidden = !navigatorActive || runtime.scenario !== "no-internet";
    if (navigatorActive && runtime.scenario === "no-internet") refresh(false);
  }

  function install() {
    const panel = document.querySelector("#dp-panel");
    const workspace = panel?.querySelector("#dp-operator-workspace");
    if (!panel || !workspace) return;
    runtime.panel = panel;
    runtime.workspace = workspace;
    ensureScenarioControls(workspace);
    ensureSection(workspace);
    if (!runtime.unsubscribe && connectivity()?.subscribe) {
      runtime.unsubscribe = connectivity().subscribe((model) => {
        runtime.model = model;
        if (runtime.scenario === "no-internet" && currentMode() === "navigator") render();
      });
    }
    applyScenario();
  }

  document.addEventListener("dp:operation-mode-change", applyScenario);
  document.addEventListener("dp:page-focus-change", updateFocusButton);
  document.addEventListener("click", (event) => {
    if (runtime.scenario !== "no-internet" || currentMode() !== "navigator") return;
    if (!event.target.closest("#dp-operator-refresh")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    refresh(true);
  }, true);

  new MutationObserver((mutations) => {
    const needsInstall = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node instanceof Element && (node.matches?.("#dp-panel,#dp-operator-workspace") || node.querySelector?.("#dp-panel,#dp-operator-workspace"))));
    if (needsInstall || !document.querySelector("#dp-operator-scenarios")) install();
  }).observe(document.documentElement, { childList: true, subtree: true });

  GM_addStyle(`
    #dp-operator-scenarios{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px!important;padding:7px 10px!important;background:#fff!important;border-bottom:1px solid #d5dde8!important}
    #dp-operator-scenarios button{min-height:30px!important;padding:0 8px!important;color:#526174!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:750 9px/1 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}
    #dp-operator-scenarios button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}
    #dp-operator-workspace[data-scenario="no-internet"]>:is(.dp-operator-summary,.dp-operator-route,.dp-operator-focus-card,.dp-operator-next){display:none!important}
    #dp-connectivity-workspace{display:grid!important;min-height:0!important;background:var(--dp-bg,#eef2f7)!important}
    #dp-connectivity-workspace[hidden]{display:none!important}
    #dp-connectivity-notice{margin:8px 10px 0!important;padding:7px 8px!important;color:#92400e!important;background:#fffbeb!important;border:1px solid #f5c46d!important;border-radius:7px!important;font-size:9px!important;line-height:1.4!important}
    #dp-connectivity-notice[hidden]{display:none!important}
    .dp-connectivity-summary{display:grid!important;gap:7px!important;padding:9px 10px!important}
    .dp-connectivity-summary>header{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important}.dp-connectivity-summary>header>div{display:grid!important;gap:2px!important}.dp-connectivity-summary>header b{color:#172033!important;font-size:12px!important}.dp-connectivity-summary>header span{color:#64748b!important;font-size:9px!important}.dp-connectivity-summary>header button{width:27px!important;height:27px!important;padding:0!important;color:#334155!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important;cursor:pointer!important}
    #dp-connectivity-axes{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
    .dp-connectivity-axis{display:grid!important;gap:2px!important;min-width:0!important;min-height:59px!important;padding:7px!important;text-align:left!important;background:#fff!important;border:1px solid #d5dde8!important;border-top:3px solid #94a3b8!important;border-radius:8px!important;cursor:pointer!important}.dp-connectivity-axis.ok{border-top-color:#16a34a!important}.dp-connectivity-axis.warning{border-top-color:#d97706!important}.dp-connectivity-axis.error{border-top-color:#dc2626!important}.dp-connectivity-axis span{color:#64748b!important;font-size:8px!important}.dp-connectivity-axis b{overflow:hidden!important;color:#172033!important;font-size:9px!important;line-height:1.25!important;text-overflow:ellipsis!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important}.dp-connectivity-axis small{color:#64748b!important;font-size:7.5px!important}
    #dp-connectivity-hypothesis{display:grid!important;gap:2px!important;padding:8px 9px!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;border-left:4px solid #64748b!important;border-radius:8px!important}#dp-connectivity-hypothesis.ok{background:#f0fdf4!important;border-color:#a7d9b8!important;border-left-color:#16a34a!important}#dp-connectivity-hypothesis.warning{background:#fffbeb!important;border-color:#f4cc7b!important;border-left-color:#d97706!important}#dp-connectivity-hypothesis.error{background:#fef2f2!important;border-color:#f0a6a6!important;border-left-color:#dc2626!important}#dp-connectivity-hypothesis>span{color:#64748b!important;font-size:7.5px!important;text-transform:uppercase!important}#dp-connectivity-hypothesis>b{color:#172033!important;font-size:10px!important}#dp-connectivity-hypothesis>p{margin:0!important;color:#526174!important;font-size:8.7px!important;line-height:1.4!important}
    .dp-connectivity-route{padding:9px 10px!important;background:#fff!important;border-top:1px solid #d5dde8!important;border-bottom:1px solid #d5dde8!important}.dp-connectivity-route>header{display:flex!important;justify-content:space-between!important;gap:8px!important;margin-bottom:7px!important}.dp-connectivity-route>header b{color:#334155!important;font-size:10px!important}.dp-connectivity-route>header span{color:#7b8798!important;font-size:8px!important}#dp-connectivity-steps{display:grid!important;gap:4px!important}#dp-connectivity-steps button{display:grid!important;place-items:center!important;gap:3px!important;min-width:0!important;min-height:45px!important;padding:4px 2px!important;color:#64748b!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:700 7.8px/1.15 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}#dp-connectivity-steps i{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#475569!important;background:#e2e8f0!important;border-radius:50%!important;font-style:normal!important}#dp-connectivity-steps button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}#dp-connectivity-steps button.active i{color:#fff!important;background:#2563eb!important}
    .dp-connectivity-card{display:grid!important;gap:8px!important;margin:9px 10px!important;padding:10px!important;background:#fff!important;border:1px solid #b8c6d8!important;border-radius:10px!important;box-shadow:0 2px 8px rgba(15,23,42,.06)!important}.dp-connectivity-card>header{display:flex!important;justify-content:space-between!important;align-items:flex-start!important;gap:8px!important}.dp-connectivity-card>header>div{display:grid!important;gap:2px!important}.dp-connectivity-card>header span{color:#1d4ed8!important;font-size:8px!important;font-weight:750!important;text-transform:uppercase!important}.dp-connectivity-card>header b{color:#172033!important;font-size:13px!important}.dp-connectivity-card>header em{padding:3px 6px!important;color:#475569!important;background:#f1f5f9!important;border-radius:999px!important;font-size:8px!important;font-style:normal!important;font-weight:750!important}#dp-connectivity-step-short{margin:0!important;color:#526174!important;font-size:9px!important;line-height:1.4!important}#dp-connectivity-entities{display:grid!important;gap:5px!important}
    .dp-connectivity-entity{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;width:100%!important;padding:8px 9px!important;text-align:left!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-left:3px solid #64748b!important;border-radius:7px!important;cursor:pointer!important}.dp-connectivity-entity.ok{border-left-color:#16a34a!important}.dp-connectivity-entity.warning{border-left-color:#d97706!important}.dp-connectivity-entity.error{border-left-color:#dc2626!important}.dp-connectivity-entity>span{display:grid!important;gap:1px!important;min-width:0!important}.dp-connectivity-entity small{color:#64748b!important;font-size:8px!important}.dp-connectivity-entity b{overflow:hidden!important;color:#172033!important;font-size:9.5px!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-connectivity-entity i{flex:0 0 auto!important;color:#1d4ed8!important;font-size:7.8px!important;font-style:normal!important;font-weight:750!important}.dp-connectivity-entity:disabled{opacity:.55!important;cursor:default!important}
    #dp-connectivity-explanation{padding:8px 9px!important;color:#7a4d0b!important;background:#fff8eb!important;border:1px solid #f2d39b!important;border-radius:7px!important;font-size:8.7px!important;line-height:1.45!important}#dp-connectivity-explanation[hidden]{display:none!important}.dp-connectivity-card>footer{display:flex!important;gap:5px!important;flex-wrap:wrap!important}.dp-connectivity-card>footer button,.dp-connectivity-next button{min-height:29px!important;padding:0 8px!important;color:#334155!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important;font:750 8.5px/1 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}.dp-connectivity-card>footer button.primary{color:#fff!important;background:#2563eb!important;border-color:#1d4ed8!important}.dp-connectivity-card>footer button.primary.clear{color:#991b1b!important;background:#fef2f2!important;border-color:#f0a6a6!important}
    .dp-connectivity-next{position:sticky!important;bottom:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;padding:9px 10px!important;background:rgba(255,255,255,.98)!important;border-top:1px solid #d5dde8!important}.dp-connectivity-next>div{display:grid!important;gap:1px!important;min-width:0!important}.dp-connectivity-next b{color:#334155!important;font-size:9.5px!important}.dp-connectivity-next span{overflow:hidden!important;color:#64748b!important;font-size:8px!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-connectivity-next button{flex:0 0 auto!important;color:#1d4ed8!important;border-color:#93c5fd!important}
    @container (max-width:420px){#dp-connectivity-axes{grid-template-columns:1fr!important}#dp-connectivity-steps button span{display:none!important}#dp-connectivity-steps button{min-height:34px!important}}
  `);

  install();
})();
