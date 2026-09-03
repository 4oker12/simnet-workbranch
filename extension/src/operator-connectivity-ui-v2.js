"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_CONNECTIVITY_UI_V2__) return;

  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const { GM_getValue, GM_setValue, GM_addStyle } = compat.api;
  const SCENARIO_KEY = "dp_operator_scenario_v3";
  const STEP_KEY = "dp_operator_connectivity_step_v3";
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

  const api = () => globalThis.__SIMNET_OPERATOR_CONNECTIVITY_STATE__ || null;
  const currentMode = () => globalThis.__SIMNET_OPERATION_MODE__?.get?.()
    || document.querySelector("#dp-panel")?.dataset.operationMode
    || "diagnostic";

  function statusLabel(status) {
    return {
      ok: "Подтверждено",
      warning: "Проверь",
      error: "Тревога",
      info: "Получено",
      unknown: "Не проверено"
    }[status] || "Не проверено";
  }

  function showNotice(message) {
    const node = runtime.section?.querySelector("#dp-connectivity-v2-notice");
    if (!node) return;
    node.textContent = String(message || "");
    node.hidden = !node.textContent;
  }

  function ensureScenarioControls(workspace) {
    let controls = workspace.querySelector("#dp-operator-scenarios-v2");
    if (controls) return controls;
    controls = document.createElement("nav");
    controls.id = "dp-operator-scenarios-v2";
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
    let section = workspace.querySelector("#dp-connectivity-workspace-v2");
    if (section) {
      runtime.section = section;
      return section;
    }

    section = document.createElement("section");
    section.id = "dp-connectivity-workspace-v2";
    section.hidden = true;
    section.innerHTML = `
      <div id="dp-connectivity-v2-notice" role="status" aria-live="polite" hidden></div>
      <section class="dp-connectivity-v2-summary">
        <header>
          <div><b>Нет интернета</b><span id="dp-connectivity-v2-context">Загружаю сохранённый контекст…</span></div>
          <button type="button" id="dp-connectivity-v2-refresh" title="Перечитать текущий источник">↻</button>
        </header>
        <div id="dp-connectivity-v2-axes"></div>
        <article id="dp-connectivity-v2-hypothesis"></article>
      </section>
      <section class="dp-connectivity-v2-route">
        <header><b>Маршрут локализации</b><span>Результаты сохраняются между разделами</span></header>
        <div id="dp-connectivity-v2-steps"></div>
      </section>
      <section class="dp-connectivity-v2-card">
        <header>
          <div><span>Текущий источник</span><b id="dp-connectivity-v2-step-title"></b></div>
          <em id="dp-connectivity-v2-step-number"></em>
        </header>
        <p id="dp-connectivity-v2-step-short"></p>
        <div id="dp-connectivity-v2-entities"></div>
        <aside id="dp-connectivity-v2-explanation" hidden></aside>
        <footer>
          <button type="button" class="primary" id="dp-connectivity-v2-show">Показать источник</button>
          <button type="button" id="dp-connectivity-v2-open">Открыть раздел</button>
          <button type="button" id="dp-connectivity-v2-why">Что означает</button>
        </footer>
      </section>
      <section class="dp-connectivity-v2-next">
        <div><b id="dp-connectivity-v2-next-title"></b><span id="dp-connectivity-v2-next-short"></span></div>
        <button type="button" id="dp-connectivity-v2-next-button">Дальше</button>
      </section>
    `;
    workspace.appendChild(section);
    runtime.section = section;

    section.querySelector("#dp-connectivity-v2-refresh").addEventListener("click", () => refresh(true));
    section.querySelector("#dp-connectivity-v2-steps").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-step]");
      if (button) setStep(Number(button.dataset.connectivityStep));
    });
    section.querySelector("#dp-connectivity-v2-axes").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-axis]");
      if (!button) return;
      const index = runtime.model?.route?.steps?.findIndex((step) => step.id === button.dataset.connectivityAxis) ?? -1;
      if (index >= 0) setStep(index);
    });
    section.querySelector("#dp-connectivity-v2-entities").addEventListener("click", (event) => {
      const button = event.target.closest("[data-connectivity-entity]");
      if (button) showEntity(button.dataset.connectivityEntity);
    });
    section.querySelector("#dp-connectivity-v2-show").addEventListener("click", showCurrentStep);
    section.querySelector("#dp-connectivity-v2-open").addEventListener("click", openCurrentStep);
    section.querySelector("#dp-connectivity-v2-why").addEventListener("click", () => {
      runtime.explanationOpen = !runtime.explanationOpen;
      render();
    });
    section.querySelector("#dp-connectivity-v2-next-button").addEventListener("click", () => {
      const count = runtime.model?.route?.steps?.length || 1;
      setStep((runtime.stepIndex + 1) % count);
    });
    return section;
  }

  function setScenario(value) {
    runtime.scenario = value === "no-internet" ? "no-internet" : "finance";
    runtime.explanationOpen = false;
    try { GM_setValue(SCENARIO_KEY, runtime.scenario); } catch (_) {}
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("scenario-change");
    api()?.clearSourceHighlight?.();
    applyScenario();
  }

  function setStep(index) {
    const count = runtime.model?.route?.steps?.length || 1;
    runtime.stepIndex = Math.max(0, Math.min(count - 1, Number(index) || 0));
    runtime.explanationOpen = false;
    try { GM_setValue(STEP_KEY, runtime.stepIndex); } catch (_) {}
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("connectivity-step-change");
    api()?.clearSourceHighlight?.();
    render();
  }

  function branchStepId(model) {
    return model?.technology?.id === "pon" ? "pon-line"
      : model?.technology?.id === "ethernet" ? "ethernet-port"
        : "detect-technology";
  }

  function axisHtml(title, entity, stepId) {
    return `
      <button type="button" class="dp-connectivity-v2-axis ${escapeHtml(entity?.status || "unknown")}" data-connectivity-axis="${escapeHtml(stepId)}">
        <span>${escapeHtml(title)}</span>
        <b>${escapeHtml(entity?.value || "Не проверено")}</b>
        <small>${escapeHtml(entity?.sourceLabel || "Не проверено")}</small>
      </button>
    `;
  }

  function entityHtml(entity) {
    if (!entity) return "";
    const action = entity.available
      ? entity.sourceAction && entity.sourceAction !== globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__?.currentAction?.()
        ? "Открыть источник"
        : "Подсветить"
      : "Открыть раздел";
    return `
      <button type="button" class="dp-connectivity-v2-entity ${escapeHtml(entity.status)}" data-connectivity-entity="${escapeHtml(entity.key)}">
        <span>
          <small>${escapeHtml(entity.label)}</small>
          <b>${escapeHtml(entity.value)}</b>
          <em>${escapeHtml(entity.sourceLabel || "Не проверено")}</em>
        </span>
        <i>${escapeHtml(action)}</i>
      </button>
    `;
  }

  function render() {
    const section = runtime.section;
    const model = runtime.model;
    if (!section || !model?.route) return;
    const steps = model.route.steps;
    runtime.stepIndex = Math.max(0, Math.min(steps.length - 1, runtime.stepIndex));

    section.querySelector("#dp-connectivity-v2-context").textContent = `${model.subscriber} · ${model.technology.label}`;
    section.querySelector("#dp-connectivity-v2-axes").innerHTML = [
      axisHtml("Доступ", model.entities.accessSummary, "access"),
      axisHtml("Juniper 2", model.entities.sessionState, "session"),
      axisHtml(model.technology.id === "pon" ? "Линия PON" : model.technology.id === "ethernet" ? "Порт Ethernet" : "Технология", model.technology.id === "unknown" ? model.entities.technology : model.entities.lineState, branchStepId(model))
    ].join("");

    const hypothesis = section.querySelector("#dp-connectivity-v2-hypothesis");
    hypothesis.className = model.hypothesis.status;
    hypothesis.innerHTML = `<span>Рабочая гипотеза</span><b>${escapeHtml(model.hypothesis.title)}</b><p>${escapeHtml(model.hypothesis.message)}</p>`;

    const route = section.querySelector("#dp-connectivity-v2-steps");
    route.style.gridTemplateColumns = `repeat(${steps.length},minmax(0,1fr))`;
    route.innerHTML = steps.map((step, index) => `
      <button type="button" data-connectivity-step="${index}" class="${index === runtime.stepIndex ? "active" : ""}">
        <i>${index + 1}</i><span>${escapeHtml(step.title)}</span>
      </button>
    `).join("");

    const step = steps[runtime.stepIndex];
    section.querySelector("#dp-connectivity-v2-step-title").textContent = step.title;
    section.querySelector("#dp-connectivity-v2-step-number").textContent = `${runtime.stepIndex + 1} / ${steps.length}`;
    section.querySelector("#dp-connectivity-v2-step-short").textContent = step.short;
    section.querySelector("#dp-connectivity-v2-entities").innerHTML = step.entityKeys.map((key) => entityHtml(model.entities[key])).join("");

    const explanation = section.querySelector("#dp-connectivity-v2-explanation");
    explanation.textContent = step.why;
    explanation.hidden = !runtime.explanationOpen;
    section.querySelector("#dp-connectivity-v2-why").textContent = runtime.explanationOpen ? "Скрыть пояснение" : "Что означает";

    const next = steps[runtime.stepIndex + 1];
    section.querySelector("#dp-connectivity-v2-next-title").textContent = next ? `Следом: ${next.title}` : "Маршрут пройден";
    section.querySelector("#dp-connectivity-v2-next-short").textContent = next ? next.short : "Все полученные источники сохранены в контексте абонента.";
    section.querySelector("#dp-connectivity-v2-next-button").textContent = next ? "Дальше" : "Сначала";
  }

  function showEntity(key) {
    const result = api()?.focusEntity?.(key, { navigate: true });
    if (result?.navigating) return;
    if (result?.ok) {
      showNotice("");
      return;
    }
    const entity = runtime.model?.entities?.[key];
    if (!entity?.available) {
      const step = runtime.model?.route?.steps?.find((item) => item.entityKeys.includes(key));
      if (step && api()?.openStep?.(step.id)) return;
    }
    showNotice(`Источник «${entity?.label || key}» сохранён, но соответствующая строка на текущей странице не найдена.`);
  }

  function showCurrentStep() {
    const step = runtime.model?.route?.steps?.[runtime.stepIndex];
    if (!step) return;
    const result = api()?.focusStep?.(step.id);
    if (result?.navigating || result?.ok) {
      showNotice("");
      return;
    }
    showNotice(`Источник шага «${step.title}» ещё не получен. Открываю соответствующий раздел.`);
    api()?.openStep?.(step.id);
  }

  function openCurrentStep() {
    const step = runtime.model?.route?.steps?.[runtime.stepIndex];
    if (!step) return;
    if (!api()?.openStep?.(step.id)) showNotice(`Для раздела «${step.title}» пока не удалось построить переход.`);
  }

  function refresh(feedback = false) {
    const stateApi = api();
    if (!stateApi) {
      if (feedback) showNotice("Новая модель состояния ещё не загружена.");
      return;
    }
    runtime.model = stateApi.refresh();
    if (feedback) showNotice("Текущий источник перечитан и сохранён в контексте абонента.");
    render();
  }

  function applyScenario() {
    const workspace = runtime.workspace;
    if (!workspace || !runtime.section) return;
    workspace.dataset.scenario = runtime.scenario;
    workspace.querySelectorAll("#dp-operator-scenarios-v2 [data-operator-scenario]").forEach((button) => {
      const active = button.dataset.operatorScenario === runtime.scenario;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const visible = currentMode() === "navigator" && runtime.scenario === "no-internet";
    runtime.section.hidden = !visible;
    if (visible) refresh(false);
  }

  function install() {
    const panel = document.querySelector("#dp-panel");
    const workspace = panel?.querySelector("#dp-operator-workspace");
    if (!panel || !workspace) return false;
    runtime.panel = panel;
    runtime.workspace = workspace;
    ensureScenarioControls(workspace);
    ensureSection(workspace);
    if (!runtime.unsubscribe && api()?.subscribe) {
      runtime.unsubscribe = api().subscribe((model) => {
        runtime.model = model;
        if (runtime.scenario === "no-internet" && currentMode() === "navigator") render();
      });
    }
    runtime.model = api()?.read?.() || runtime.model;
    applyScenario();
    api()?.consumePendingFocus?.();
    return true;
  }

  document.addEventListener("dp:operation-mode-change", applyScenario);

  if (!install()) {
    const startedAt = Date.now();
    const observer = new MutationObserver(() => {
      if (install() || Date.now() - startedAt > 10000) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 10500);
  }

  GM_addStyle(`
    #dp-operator-scenarios-v2{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px!important;padding:7px 10px!important;background:#fff!important;border-bottom:1px solid #d5dde8!important}
    #dp-operator-scenarios-v2 button{min-height:30px!important;padding:0 8px!important;color:#526174!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:750 9px/1 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}
    #dp-operator-scenarios-v2 button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}
    #dp-operator-workspace[data-scenario="no-internet"]>:is(.dp-operator-summary,.dp-operator-route,.dp-operator-focus-card,.dp-operator-next){display:none!important}
    #dp-connectivity-workspace-v2{display:grid!important;min-height:0!important;background:var(--dp-bg,#eef2f7)!important}
    #dp-connectivity-workspace-v2[hidden]{display:none!important}
    #dp-connectivity-v2-notice{margin:8px 10px 0!important;padding:7px 8px!important;color:#92400e!important;background:#fffbeb!important;border:1px solid #f5c46d!important;border-radius:7px!important;font-size:9px!important;line-height:1.4!important}
    #dp-connectivity-v2-notice[hidden]{display:none!important}
    .dp-connectivity-v2-summary{display:grid!important;gap:7px!important;padding:9px 10px!important}
    .dp-connectivity-v2-summary>header{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important}.dp-connectivity-v2-summary>header>div{display:grid!important;gap:2px!important}.dp-connectivity-v2-summary>header b{color:#172033!important;font-size:12px!important}.dp-connectivity-v2-summary>header span{color:#64748b!important;font-size:9px!important}.dp-connectivity-v2-summary>header button{width:27px!important;height:27px!important;padding:0!important;color:#334155!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important;cursor:pointer!important}
    #dp-connectivity-v2-axes{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
    .dp-connectivity-v2-axis{display:grid!important;gap:2px!important;min-width:0!important;min-height:64px!important;padding:7px!important;text-align:left!important;background:#fff!important;border:1px solid #d5dde8!important;border-top:3px solid #94a3b8!important;border-radius:8px!important;cursor:pointer!important}.dp-connectivity-v2-axis.ok{border-top-color:#16a34a!important}.dp-connectivity-v2-axis.warning{border-top-color:#d97706!important}.dp-connectivity-v2-axis.error{border-top-color:#dc2626!important}.dp-connectivity-v2-axis>span{color:#64748b!important;font-size:8px!important}.dp-connectivity-v2-axis>b{overflow:hidden!important;color:#172033!important;font-size:9px!important;line-height:1.25!important;text-overflow:ellipsis!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important}.dp-connectivity-v2-axis>small{overflow:hidden!important;color:#64748b!important;font-size:7.3px!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    #dp-connectivity-v2-hypothesis{display:grid!important;gap:2px!important;padding:8px 9px!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;border-left:4px solid #64748b!important;border-radius:8px!important}#dp-connectivity-v2-hypothesis.ok{background:#f0fdf4!important;border-color:#a7d9b8!important;border-left-color:#16a34a!important}#dp-connectivity-v2-hypothesis.warning{background:#fffbeb!important;border-color:#f4cc7b!important;border-left-color:#d97706!important}#dp-connectivity-v2-hypothesis.error{background:#fef2f2!important;border-color:#f0a6a6!important;border-left-color:#dc2626!important}#dp-connectivity-v2-hypothesis>span{color:#64748b!important;font-size:7.5px!important;text-transform:uppercase!important}#dp-connectivity-v2-hypothesis>b{color:#172033!important;font-size:10px!important}#dp-connectivity-v2-hypothesis>p{margin:0!important;color:#526174!important;font-size:8.7px!important;line-height:1.4!important}
    .dp-connectivity-v2-route{padding:9px 10px!important;background:#fff!important;border-top:1px solid #d5dde8!important;border-bottom:1px solid #d5dde8!important}.dp-connectivity-v2-route>header{display:flex!important;justify-content:space-between!important;gap:8px!important;margin-bottom:7px!important}.dp-connectivity-v2-route>header b{color:#334155!important;font-size:10px!important}.dp-connectivity-v2-route>header span{color:#7b8798!important;font-size:8px!important}#dp-connectivity-v2-steps{display:grid!important;gap:4px!important}#dp-connectivity-v2-steps button{display:grid!important;place-items:center!important;gap:3px!important;min-width:0!important;min-height:45px!important;padding:4px 2px!important;color:#64748b!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-radius:7px!important;font:700 7.8px/1.15 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}#dp-connectivity-v2-steps i{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#475569!important;background:#e2e8f0!important;border-radius:50%!important;font-style:normal!important}#dp-connectivity-v2-steps button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}#dp-connectivity-v2-steps button.active i{color:#fff!important;background:#2563eb!important}
    .dp-connectivity-v2-card{display:grid!important;gap:8px!important;margin:9px 10px!important;padding:10px!important;background:#fff!important;border:1px solid #b8c6d8!important;border-radius:10px!important;box-shadow:0 2px 8px rgba(15,23,42,.06)!important}.dp-connectivity-v2-card>header{display:flex!important;justify-content:space-between!important;align-items:flex-start!important;gap:8px!important}.dp-connectivity-v2-card>header>div{display:grid!important;gap:2px!important}.dp-connectivity-v2-card>header span{color:#1d4ed8!important;font-size:8px!important;font-weight:750!important;text-transform:uppercase!important}.dp-connectivity-v2-card>header b{color:#172033!important;font-size:13px!important}.dp-connectivity-v2-card>header em{padding:3px 6px!important;color:#475569!important;background:#f1f5f9!important;border-radius:999px!important;font-size:8px!important;font-style:normal!important;font-weight:750!important}#dp-connectivity-v2-step-short{margin:0!important;color:#526174!important;font-size:9px!important;line-height:1.4!important}#dp-connectivity-v2-entities{display:grid!important;gap:5px!important}
    .dp-connectivity-v2-entity{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;width:100%!important;padding:8px 9px!important;text-align:left!important;background:#f8fafc!important;border:1px solid #d5dde8!important;border-left:3px solid #64748b!important;border-radius:7px!important;cursor:pointer!important}.dp-connectivity-v2-entity.ok{border-left-color:#16a34a!important}.dp-connectivity-v2-entity.warning{border-left-color:#d97706!important}.dp-connectivity-v2-entity.error{border-left-color:#dc2626!important}.dp-connectivity-v2-entity>span{display:grid!important;gap:1px!important;min-width:0!important}.dp-connectivity-v2-entity small{color:#64748b!important;font-size:8px!important}.dp-connectivity-v2-entity b{overflow:hidden!important;color:#172033!important;font-size:9.5px!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-connectivity-v2-entity em{overflow:hidden!important;color:#7b8798!important;font-size:7.3px!important;font-style:normal!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-connectivity-v2-entity i{flex:0 0 auto!important;color:#1d4ed8!important;font-size:7.8px!important;font-style:normal!important;font-weight:750!important}
    #dp-connectivity-v2-explanation{padding:8px 9px!important;color:#7a4d0b!important;background:#fff8eb!important;border:1px solid #f2d39b!important;border-radius:7px!important;font-size:8.5px!important;line-height:1.45!important}#dp-connectivity-v2-explanation[hidden]{display:none!important}.dp-connectivity-v2-card>footer{display:flex!important;flex-wrap:wrap!important;gap:5px!important}.dp-connectivity-v2-card>footer button,.dp-connectivity-v2-next button{min-height:29px!important;padding:0 8px!important;color:#334155!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:7px!important;font:750 8.5px/1 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}.dp-connectivity-v2-card>footer button.primary{color:#fff!important;background:#2563eb!important;border-color:#1d4ed8!important}
    .dp-connectivity-v2-next{position:sticky!important;bottom:0!important;display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important;padding:9px 10px!important;background:rgba(255,255,255,.98)!important;border-top:1px solid #d5dde8!important}.dp-connectivity-v2-next>div{display:grid!important;gap:1px!important;min-width:0!important}.dp-connectivity-v2-next b{color:#334155!important;font-size:9px!important}.dp-connectivity-v2-next span{overflow:hidden!important;color:#64748b!important;font-size:8px!important;text-overflow:ellipsis!important;white-space:nowrap!important}.dp-connectivity-v2-next button{flex:0 0 auto!important;color:#1d4ed8!important;border-color:#93c5fd!important}
    mark.dp-operator-source-mark{padding:2px 4px!important;background:#fde047!important;color:#111827!important;border:2px solid #f59e0b!important;border-radius:3px!important;box-shadow:0 0 0 4px rgba(245,158,11,.22)!important}
    @container (max-width:420px){#dp-connectivity-v2-axes{grid-template-columns:1fr!important}#dp-connectivity-v2-steps button span{display:none!important}#dp-connectivity-v2-steps button{min-height:34px!important}}
  `);

  globalThis.__SIMNET_OPERATOR_CONNECTIVITY_UI_V2__ = Object.freeze({ install, render, refresh });
})();
