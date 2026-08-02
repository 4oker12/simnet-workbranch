"use strict";

(async () => {
  if (top !== self) return;
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  if (!compat?.ready || !compat?.api) return;
  await compat.ready;

  const { GM_getValue, GM_setValue, GM_addStyle } = compat.api;
  const STEP_KEY = "dp_operator_navigator_step_v2";
  const runtime = {
    panel: null,
    workspace: null,
    stepIndex: Math.max(0, Math.min(4, Number(GM_getValue(STEP_KEY, 0)) || 0)),
    model: null,
    explainOpen: false,
    unsubscribe: null,
    focusActive: false
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function routes() {
    return globalThis.__SIMNET_OPERATOR_ROUTES__?.finance || null;
  }

  function finance() {
    return globalThis.__SIMNET_OPERATOR_FINANCE__ || null;
  }

  function focusApi() {
    return globalThis.__SIMNET_PAGE_FOCUS__ || null;
  }

  function currentMode() {
    return globalThis.__SIMNET_OPERATION_MODE__?.get?.()
      || document.querySelector("#dp-panel")?.dataset.operationMode
      || "diagnostic";
  }

  function statusLabel(status) {
    return {
      ok: "Норма",
      warning: "Проверь",
      error: "Ограничено",
      info: "Важно",
      unknown: "Не найдено"
    }[status] || "Важно";
  }

  function statusTone(status) {
    if (status === "error") return "error";
    if (status === "warning") return "warning";
    if (status === "ok") return "ok";
    return "info";
  }

  function ensureWorkspace(panel) {
    let workspace = panel.querySelector("#dp-operator-workspace");
    if (!workspace) {
      workspace = document.createElement("section");
      workspace.id = "dp-operator-workspace";
      workspace.innerHTML = `
        <header class="dp-operator-header">
          <div>
            <b>Навигатор оператора</b>
            <span id="dp-operator-context">Финансы · текущий абонент · Billing</span>
          </div>
          <button type="button" id="dp-operator-refresh" title="Перечитать данные страницы">↻</button>
        </header>
        <div id="dp-operator-notice" role="status" aria-live="polite" hidden></div>
        <section class="dp-operator-summary">
          <div id="dp-operator-axes"></div>
          <article id="dp-operator-verdict"></article>
        </section>
        <section class="dp-operator-route">
          <header><b>Маршрут взгляда</b><span>Выбери нужный смысловой блок</span></header>
          <div id="dp-operator-route-steps"></div>
        </section>
        <section class="dp-operator-focus-card">
          <header>
            <div><span>Сейчас смотри сюда</span><b id="dp-operator-step-title"></b></div>
            <em id="dp-operator-step-number"></em>
          </header>
          <p id="dp-operator-step-short"></p>
          <div id="dp-operator-entities"></div>
          <div id="dp-operator-extra"></div>
          <aside id="dp-operator-explanation" hidden></aside>
          <footer>
            <button type="button" class="primary" id="dp-operator-show">Показать на странице</button>
            <button type="button" id="dp-operator-why">Что это означает</button>
          </footer>
        </section>
        <section class="dp-operator-next">
          <div><b id="dp-operator-next-title"></b><span id="dp-operator-next-short"></span></div>
          <button type="button" id="dp-operator-next-button">Дальше</button>
        </section>
      `;
      panel.appendChild(workspace);

      workspace.querySelector("#dp-operator-refresh").addEventListener("click", () => refresh(true));
      workspace.querySelector("#dp-operator-route-steps").addEventListener("click", (event) => {
        const button = event.target.closest("[data-operator-step]");
        if (!button) return;
        setStep(Number(button.dataset.operatorStep));
      });
      workspace.querySelector("#dp-operator-entities").addEventListener("click", (event) => {
        const button = event.target.closest("[data-operator-entity]");
        if (button) focusEntity(button.dataset.operatorEntity);
      });
      workspace.querySelector("#dp-operator-extra").addEventListener("click", (event) => {
        const button = event.target.closest("[data-operator-payment-index]");
        if (button) focusPayment(Number(button.dataset.operatorPaymentIndex));
      });
      workspace.querySelector("#dp-operator-show").addEventListener("click", () => toggleStepFocus());
      workspace.querySelector("#dp-operator-why").addEventListener("click", () => {
        runtime.explainOpen = !runtime.explainOpen;
        render();
      });
      workspace.querySelector("#dp-operator-next-button").addEventListener("click", () => {
        const count = routes()?.steps?.length || 1;
        setStep((runtime.stepIndex + 1) % count);
      });
    }
    runtime.workspace = workspace;
    return workspace;
  }

  function showNotice(message) {
    const notice = runtime.workspace?.querySelector("#dp-operator-notice");
    if (!notice) return;
    notice.textContent = String(message || "");
    notice.hidden = !notice.textContent;
  }

  function setStep(index) {
    const count = routes()?.steps?.length || 1;
    runtime.stepIndex = Math.max(0, Math.min(count - 1, Number(index) || 0));
    runtime.explainOpen = false;
    try { GM_setValue(STEP_KEY, runtime.stepIndex); } catch (_) {}
    focusApi()?.clear?.("step-change");
    runtime.focusActive = false;
    render();
  }

  function axisHtml(label, entity, entityKey) {
    return `
      <button type="button" class="dp-operator-axis ${escapeHtml(entity?.status || "unknown")}" data-operator-entity="${escapeHtml(entityKey)}">
        <span>${escapeHtml(label)}</span>
        <b>${escapeHtml(entity?.value || "Не найдено")}</b>
        <small>${escapeHtml(statusLabel(entity?.status))}</small>
      </button>
    `;
  }

  function entityHtml(entity) {
    if (!entity) return "";
    return `
      <button type="button" class="dp-operator-entity ${escapeHtml(entity.status)}" data-operator-entity="${escapeHtml(entity.key)}" ${entity.element ? "" : "disabled"}>
        <span><small>${escapeHtml(entity.label)}</small><b>${escapeHtml(entity.value)}</b></span>
        <i>${entity.element ? "Показать" : "Нет источника"}</i>
      </button>
    `;
  }

  function extraHtml(step, model) {
    if (step.id === "payments") {
      if (!model.payments.length) {
        return `<div class="dp-operator-empty">История сейчас свернута. Кнопка «Показать на странице» раскроет штатный блок Billing.</div>`;
      }
      return `
        <div class="dp-operator-mini-list">
          ${model.payments.slice(0, 4).map((item, index) => `
            <button type="button" data-operator-payment-index="${index}">
              <span>${escapeHtml(item.date || "Без даты")}</span>
              <b>${escapeHtml(item.description || "Событие")}</b>
              <em>${escapeHtml(item.amount || "")}</em>
            </button>
          `).join("")}
        </div>
      `;
    }
    if (step.id === "services") {
      if (!model.activeServices.length) {
        return `<div class="dp-operator-empty">Активные дополнительные услуги не отмечены в текущем DOM.</div>`;
      }
      return `
        <div class="dp-operator-mini-list services">
          ${model.activeServices.slice(0, 6).map((item) => `
            <div><b>${escapeHtml(item.name)}</b><em>${escapeHtml(item.amountText)}</em></div>
          `).join("")}
        </div>
      `;
    }
    return "";
  }

  function render() {
    const route = routes();
    const workspace = runtime.workspace;
    const model = runtime.model;
    if (!route || !workspace || !model) return;

    workspace.querySelector("#dp-operator-context").textContent = `Финансы · ${model.subscriber} · Billing`;
    workspace.querySelector("#dp-operator-axes").innerHTML = [
      axisHtml("Состояние", model.entities.serviceState, "serviceState"),
      axisHtml("Доступ", model.entities.access, "access"),
      axisHtml("День начала", model.entities.startDay, "startDay")
    ].join("");

    const verdict = workspace.querySelector("#dp-operator-verdict");
    verdict.className = model.verdict.status;
    verdict.innerHTML = `<b>${escapeHtml(model.verdict.title)}</b><span>${escapeHtml(model.verdict.message)}</span>`;

    workspace.querySelector("#dp-operator-route-steps").innerHTML = route.steps.map((step, index) => `
      <button type="button" data-operator-step="${index}" class="${index === runtime.stepIndex ? "active" : ""}">
        <i>${index + 1}</i><span>${escapeHtml(step.title)}</span>
      </button>
    `).join("");

    const step = route.steps[runtime.stepIndex];
    workspace.querySelector("#dp-operator-step-title").textContent = step.title;
    workspace.querySelector("#dp-operator-step-number").textContent = `${runtime.stepIndex + 1} / ${route.steps.length}`;
    workspace.querySelector("#dp-operator-step-short").textContent = step.short;
    workspace.querySelector("#dp-operator-entities").innerHTML = step.entityKeys
      .map((key) => entityHtml(model.entities[key]))
      .join("");
    workspace.querySelector("#dp-operator-extra").innerHTML = extraHtml(step, model);

    const explanation = workspace.querySelector("#dp-operator-explanation");
    explanation.textContent = step.why;
    explanation.hidden = !runtime.explainOpen;
    workspace.querySelector("#dp-operator-why").textContent = runtime.explainOpen ? "Скрыть пояснение" : "Что это означает";

    const nextStep = route.steps[runtime.stepIndex + 1];
    workspace.querySelector("#dp-operator-next-title").textContent = nextStep ? `Следом: ${nextStep.title}` : "Маршрут пройден";
    workspace.querySelector("#dp-operator-next-short").textContent = nextStep
      ? nextStep.short
      : "Сформулируй ответ абоненту либо вернись к нужному блоку.";
    workspace.querySelector("#dp-operator-next-button").textContent = nextStep ? "Дальше" : "Сначала";
    updateFocusButton();
  }

  function updateFocusButton() {
    const button = runtime.workspace?.querySelector("#dp-operator-show");
    if (!button) return;
    runtime.focusActive = Boolean(focusApi()?.isActive?.());
    button.textContent = runtime.focusActive ? "Снять подсветку" : "Показать на странице";
    button.classList.toggle("clear", runtime.focusActive);
  }

  async function focusEntity(key) {
    const financeApi = finance();
    const model = runtime.model || financeApi?.read?.();
    if (!financeApi || !model) return;
    if (key === "paymentHistory") {
      await financeApi.expandPayments();
      runtime.model = financeApi.read();
      render();
    }
    const entity = runtime.model?.entities?.[key];
    if (!entity?.element) {
      showNotice(`Источник «${entity?.label || key}» не найден на этой странице.`);
      return;
    }
    showNotice("");
    focusApi()?.show?.(entity.element, {
      label: `${entity.label} · ${entity.value}`,
      tone: statusTone(entity.status),
      scroll: true
    });
    updateFocusButton();
  }

  async function toggleStepFocus() {
    const focus = focusApi();
    if (focus?.isActive?.()) {
      focus.clear("operator-button");
      updateFocusButton();
      return;
    }
    const route = routes();
    const financeApi = finance();
    const step = route?.steps?.[runtime.stepIndex];
    if (!step || !financeApi) return;
    if (step.id === "payments") {
      await financeApi.expandPayments();
      runtime.model = financeApi.read();
      render();
    }
    const entity = runtime.model?.entities?.[step.focusKey];
    const element = entity?.element || financeApi.elementForStep(step.id);
    if (!element) {
      showNotice(`Блок «${step.title}» не найден на текущей странице.`);
      return;
    }
    showNotice("");
    focus?.show?.(element, {
      label: `${step.title} · ${entity?.value || step.short}`,
      tone: statusTone(entity?.status),
      scroll: true
    });
    updateFocusButton();
  }

  function focusPayment(index) {
    const payment = runtime.model?.payments?.[index];
    if (!payment?.element) return;
    focusApi()?.show?.(payment.element, {
      label: `${payment.date} · ${payment.description}`,
      tone: "info",
      scroll: true
    });
    updateFocusButton();
  }

  function refresh(showFeedback = false) {
    const financeApi = finance();
    if (!financeApi) {
      if (showFeedback) showNotice("Финансовый анализатор ещё не загружен.");
      return;
    }
    runtime.model = financeApi.refresh();
    if (showFeedback) showNotice("Данные страницы перечитаны.");
    render();
  }

  function applyMode() {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    runtime.panel = panel;
    ensureWorkspace(panel);
    const active = currentMode() === "navigator";
    runtime.workspace.hidden = !active;
    if (active) refresh(false);
    else focusApi()?.clear?.("navigator-exit");
  }

  function install() {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    runtime.panel = panel;
    ensureWorkspace(panel);
    if (!runtime.unsubscribe && finance()?.subscribe) {
      runtime.unsubscribe = finance().subscribe((model) => {
        runtime.model = model;
        if (currentMode() === "navigator") render();
      });
    }
    applyMode();
  }

  GM_addStyle(`
    #dp-operator-workspace {
      display:none !important;
      min-height:0 !important;
      flex:1 1 auto !important;
      overflow:auto !important;
      color:var(--dp-text,#172033) !important;
      background:var(--dp-bg,#eef2f7) !important;
    }
    #dp-operator-workspace[hidden] { display:none !important; }
    #dp-panel[data-operation-mode="navigator"] > :not(#dp-head):not(#dp-operation-mode-v2):not(#dp-operator-workspace):not(#dp-panel-resize) { display:none !important; }
    #dp-panel[data-operation-mode="navigator"] #dp-operator-workspace { display:block !important; }
    .dp-operator-header {
      position:sticky !important; top:0 !important; z-index:4 !important;
      display:flex !important; justify-content:space-between !important; align-items:center !important; gap:10px !important;
      padding:10px 12px !important; background:rgba(255,255,255,.97) !important;
      border-bottom:1px solid var(--dp-border,#d5dde8) !important; box-shadow:0 1px 2px rgba(15,23,42,.04) !important;
    }
    .dp-operator-header > div { display:grid !important; gap:2px !important; min-width:0 !important; }
    .dp-operator-header b { color:#172033 !important; font-size:13px !important; }
    .dp-operator-header span { color:#64748b !important; font-size:9.5px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-operator-header button { width:28px !important; height:28px !important; padding:0 !important; color:#334155 !important; background:#fff !important; border:1px solid #cbd5e1 !important; border-radius:7px !important; font-size:16px !important; cursor:pointer !important; }
    #dp-operator-notice { margin:8px 10px 0 !important; padding:7px 8px !important; color:#92400e !important; background:#fffbeb !important; border:1px solid #f5c46d !important; border-radius:7px !important; font-size:9.5px !important; line-height:1.35 !important; }
    #dp-operator-notice[hidden] { display:none !important; }
    .dp-operator-summary { display:grid !important; gap:7px !important; padding:9px 10px !important; }
    #dp-operator-axes { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:5px !important; }
    .dp-operator-axis { position:relative !important; display:grid !important; gap:2px !important; min-width:0 !important; min-height:61px !important; padding:7px !important; text-align:left !important; background:#fff !important; border:1px solid #d5dde8 !important; border-top:3px solid #94a3b8 !important; border-radius:8px !important; cursor:pointer !important; }
    .dp-operator-axis.ok { border-top-color:#16a34a !important; }
    .dp-operator-axis.warning { border-top-color:#d97706 !important; }
    .dp-operator-axis.error { border-top-color:#dc2626 !important; }
    .dp-operator-axis > span { color:#64748b !important; font-size:8.5px !important; }
    .dp-operator-axis > b { overflow:hidden !important; color:#172033 !important; font-size:10px !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-operator-axis > small { color:#64748b !important; font-size:8px !important; }
    #dp-operator-verdict { display:grid !important; gap:2px !important; padding:8px 9px !important; background:#f8fafc !important; border:1px solid #cbd5e1 !important; border-left:4px solid #64748b !important; border-radius:8px !important; }
    #dp-operator-verdict.ok { background:#f0fdf4 !important; border-color:#a7d9b8 !important; border-left-color:#16a34a !important; }
    #dp-operator-verdict.warning { background:#fffbeb !important; border-color:#f4cc7b !important; border-left-color:#d97706 !important; }
    #dp-operator-verdict.error { background:#fef2f2 !important; border-color:#f0a6a6 !important; border-left-color:#dc2626 !important; }
    #dp-operator-verdict b { color:#172033 !important; font-size:10.5px !important; }
    #dp-operator-verdict span { color:#526174 !important; font-size:9px !important; line-height:1.35 !important; }
    .dp-operator-route { padding:9px 10px !important; background:#fff !important; border-top:1px solid #d5dde8 !important; border-bottom:1px solid #d5dde8 !important; }
    .dp-operator-route > header { display:flex !important; justify-content:space-between !important; gap:8px !important; margin-bottom:7px !important; }
    .dp-operator-route > header b { color:#334155 !important; font-size:10px !important; }
    .dp-operator-route > header span { color:#7b8798 !important; font-size:8.5px !important; }
    #dp-operator-route-steps { display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)) !important; gap:4px !important; }
    #dp-operator-route-steps button { display:grid !important; place-items:center !important; gap:3px !important; min-width:0 !important; min-height:48px !important; padding:4px 2px !important; color:#64748b !important; background:#f8fafc !important; border:1px solid #d5dde8 !important; border-radius:7px !important; font:700 8px/1.15 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    #dp-operator-route-steps i { display:grid !important; place-items:center !important; width:18px !important; height:18px !important; color:#475569 !important; background:#e2e8f0 !important; border-radius:50% !important; font-style:normal !important; }
    #dp-operator-route-steps button.active { color:#1d4ed8 !important; background:#eff6ff !important; border-color:#93c5fd !important; }
    #dp-operator-route-steps button.active i { color:#fff !important; background:#2563eb !important; }
    .dp-operator-focus-card { display:grid !important; gap:8px !important; margin:9px 10px !important; padding:10px !important; background:#fff !important; border:1px solid #b8c6d8 !important; border-radius:10px !important; box-shadow:0 2px 8px rgba(15,23,42,.06) !important; }
    .dp-operator-focus-card > header { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:8px !important; }
    .dp-operator-focus-card > header > div { display:grid !important; gap:2px !important; }
    .dp-operator-focus-card > header span { color:#1d4ed8 !important; font-size:8.5px !important; font-weight:750 !important; text-transform:uppercase !important; }
    .dp-operator-focus-card > header b { color:#172033 !important; font-size:14px !important; }
    .dp-operator-focus-card > header em { padding:3px 6px !important; color:#475569 !important; background:#f1f5f9 !important; border-radius:999px !important; font-size:8px !important; font-style:normal !important; font-weight:750 !important; }
    #dp-operator-step-short { margin:0 !important; color:#526174 !important; font-size:9.5px !important; line-height:1.4 !important; }
    #dp-operator-entities { display:grid !important; gap:5px !important; }
    .dp-operator-entity { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; width:100% !important; padding:8px 9px !important; text-align:left !important; background:#f8fafc !important; border:1px solid #d5dde8 !important; border-left:3px solid #64748b !important; border-radius:7px !important; cursor:pointer !important; }
    .dp-operator-entity.ok { border-left-color:#16a34a !important; }
    .dp-operator-entity.warning { border-left-color:#d97706 !important; }
    .dp-operator-entity.error { border-left-color:#dc2626 !important; }
    .dp-operator-entity > span { display:grid !important; gap:1px !important; min-width:0 !important; }
    .dp-operator-entity small { color:#64748b !important; font-size:8.5px !important; }
    .dp-operator-entity b { overflow:hidden !important; color:#172033 !important; font-size:10px !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-operator-entity i { flex:0 0 auto !important; color:#1d4ed8 !important; font-size:8px !important; font-style:normal !important; font-weight:750 !important; }
    .dp-operator-entity:disabled { opacity:.55 !important; cursor:default !important; }
    .dp-operator-mini-list { display:grid !important; gap:4px !important; }
    .dp-operator-mini-list button,.dp-operator-mini-list.services > div { display:grid !important; grid-template-columns:72px minmax(0,1fr) auto !important; gap:6px !important; align-items:center !important; padding:6px 7px !important; color:#334155 !important; background:#f8fafc !important; border:1px solid #e2e8f0 !important; border-radius:6px !important; text-align:left !important; cursor:pointer !important; }
    .dp-operator-mini-list span { color:#64748b !important; font-size:8px !important; }
    .dp-operator-mini-list b { overflow:hidden !important; font-size:8.8px !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-operator-mini-list em { color:#334155 !important; font-size:8.5px !important; font-style:normal !important; font-weight:750 !important; white-space:nowrap !important; }
    .dp-operator-mini-list.services > div { grid-template-columns:minmax(0,1fr) auto !important; cursor:default !important; }
    .dp-operator-empty { padding:8px !important; color:#64748b !important; background:#f8fafc !important; border:1px dashed #cbd5e1 !important; border-radius:7px !important; font-size:9px !important; line-height:1.4 !important; }
    #dp-operator-explanation { padding:8px 9px !important; color:#7a4d0b !important; background:#fff8eb !important; border:1px solid #f2d39b !important; border-radius:7px !important; font-size:9px !important; line-height:1.45 !important; }
    #dp-operator-explanation[hidden] { display:none !important; }
    .dp-operator-focus-card > footer { display:flex !important; gap:6px !important; }
    .dp-operator-focus-card > footer button,.dp-operator-next button { min-height:30px !important; padding:0 9px !important; color:#334155 !important; background:#fff !important; border:1px solid #cbd5e1 !important; border-radius:7px !important; font:750 9px/1 "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    .dp-operator-focus-card > footer button.primary { color:#fff !important; background:#2563eb !important; border-color:#1d4ed8 !important; }
    .dp-operator-focus-card > footer button.primary.clear { color:#991b1b !important; background:#fef2f2 !important; border-color:#f0a6a6 !important; }
    .dp-operator-next { position:sticky !important; bottom:0 !important; display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; padding:9px 10px !important; background:rgba(255,255,255,.98) !important; border-top:1px solid #d5dde8 !important; }
    .dp-operator-next > div { display:grid !important; gap:1px !important; min-width:0 !important; }
    .dp-operator-next b { color:#334155 !important; font-size:9.5px !important; }
    .dp-operator-next span { overflow:hidden !important; color:#64748b !important; font-size:8.5px !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .dp-operator-next button { flex:0 0 auto !important; color:#1d4ed8 !important; border-color:#93c5fd !important; }
    @container (max-width:420px) {
      #dp-operator-axes { grid-template-columns:1fr !important; }
      .dp-operator-axis { min-height:48px !important; }
      #dp-operator-route-steps button span { display:none !important; }
      #dp-operator-route-steps button { min-height:34px !important; }
    }
  `);

  document.addEventListener("dp:operation-mode-change", applyMode);
  document.addEventListener("dp:page-focus-change", updateFocusButton);

  new MutationObserver(() => {
    const panel = document.querySelector("#dp-panel");
    if (panel && (panel !== runtime.panel || !panel.querySelector("#dp-operator-workspace"))) install();
  }).observe(document.documentElement, { childList: true, subtree: true });

  install();
})();
