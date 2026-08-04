"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";
const PANEL_PORT_NAME = "SIMNET_WB_SIDE_PANEL_PORT";
const DECISIONS_KEY = "wb_live_decisions_v1";
const WORKFLOW_COMMAND = "SIMNET_WB_WORKFLOW_COMMAND";
const WORKFLOW_STATE = "SIMNET_WB_WORKFLOW_STATE";
const ACTIVE_TAB_CHANGED = "SIMNET_WB_ACTIVE_TAB_CHANGED";

let snapshot = null;
let workflow = null;
let mode = "live";
let activeTabId = null;
let decisionsByContext = {};
let panelPort = null;

const $ = selector => document.querySelector(selector);
const safe = (value, max = 260) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = value => safe(value, 500).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const send = message => chrome.runtime.sendMessage(message);
const normalizeMode = value => value === "quick" ? "quick" : "live";

function effectiveContext(state = snapshot) {
  const context = state?.context || {};
  if (!workflow) return context;
  return {
    ...context,
    contract: context.contract || workflow.contract || "",
    login: context.login || workflow.login || "",
    billingId: context.billingId || workflow.billingId || "",
    olt: context.olt || workflow.billingOlt || null,
    tmc: context.tmc?.found ? context.tmc : workflow.tmc || context.tmc || null
  };
}

function contextKey() {
  const context = effectiveContext();
  return context.key || workflow?.key || [context.system, context.contract, context.billingId, context.customerId].filter(Boolean).join("|") || "no-context";
}

function currentDecisions() {
  return decisionsByContext[contextKey()] || {};
}

async function loadDecisions() {
  try {
    const result = await chrome.storage.session.get({ [DECISIONS_KEY]: {} });
    decisionsByContext = result?.[DECISIONS_KEY] || {};
  } catch (_) {
    decisionsByContext = {};
  }
}

async function saveDecision(stepId, answer) {
  const key = contextKey();
  decisionsByContext = {
    ...decisionsByContext,
    [key]: { ...(decisionsByContext[key] || {}), [stepId]: answer }
  };
  try { await chrome.storage.session.set({ [DECISIONS_KEY]: decisionsByContext }); } catch (_) {}
}

function factText(state = snapshot) {
  return (state?.facts || []).join(" ").toLowerCase();
}

function accessSummary(context = {}) {
  const checks = Array.isArray(context.accessChecks) ? context.accessChecks : [];
  const known = checks.filter(check => check.value && check.state !== "unknown");
  const warnings = checks.filter(check => check.state === "warn");
  if (warnings.length) return warnings.map(check => `${check.label}: ${check.value || "проверить"}`).join(" · ");
  if (known.length) return `Доступ и ограничения: ${known.length}/${checks.length} подтверждено`;
  return "Проверь доступ, блокировку, группу, тариф и день начала";
}

function lineState(context, joined) {
  const liveSeen = /(сигнал|rx\s*[:=]|tx\s*[:=]|distance|расстоян|onu.{0,25}(online|offline)|ont.{0,25}(online|offline))/i.test(joined);
  const liveNegative = /(сигнал|onu|ont|оптик).{0,55}(offline|down|не доступ|не найден|крит|плох|los)/i.test(joined);
  const billingOlt = context.olt?.present;
  const tmcOlt = context.tmc?.found || workflow?.tmc?.found;
  return { liveSeen, liveNegative, billingOlt, tmcOlt };
}

function buildSteps(state = snapshot) {
  const context = effectiveContext(state);
  const joined = factText(state);
  const decisions = currentDecisions();
  const sessionSeen = /сесси|bras|авторизац|juniper/.test(joined);
  const sessionNegative = /(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined);
  const accessWarnings = (context.accessChecks || []).some(check => check.state === "warn");
  const line = lineState(context, joined);

  let lineDetail = "Уточни OLT и выполни соответствующий live-опрос";
  if (line.liveSeen) lineDetail = line.liveNegative ? "Есть отклонение в состоянии линии" : "Live-состояние линии получено";
  else if (context.olt?.status === "missing") lineDetail = "OLT не указана — нужен маршрут через UserSide ТМЦ";
  else if (context.olt?.present) lineDetail = `OLT: ${context.olt.name || "определена"} · ${context.olt.technology || "тип уточняется"}`;
  else if (line.tmcOlt) lineDetail = "OLT найдена в ТМЦ — вернись в Billing и заполни техданные";

  return [
    {
      id: "subscriber",
      title: "Абонент подтверждён",
      detail: context.contract ? `${context.login || `abon${context.contract}`} · карточка определена` : "Открой карточку Billing или UserSide",
      complete: Boolean(context.contract) || decisions.subscriber === "yes",
      attention: decisions.subscriber === "no",
      highlight: "subscriber"
    },
    {
      id: "session",
      title: "Сессия / авторизация",
      detail: sessionSeen ? (sessionNegative ? "Сессия не подтверждена" : accessSummary(context)) : accessSummary(context),
      complete: sessionSeen || decisions.session === "yes",
      attention: sessionNegative || accessWarnings || decisions.session === "no",
      highlight: "session"
    },
    {
      id: "line",
      title: "Линия и ONU",
      detail: lineDetail,
      complete: line.liveSeen || decisions.line === "yes",
      attention: line.liveNegative || decisions.line === "no" || context.olt?.status === "missing",
      highlight: "line"
    }
  ];
}

function activeStep(steps) {
  return steps.find(step => step.attention) || steps.find(step => !step.complete) || steps[steps.length - 1];
}

function focusFor(state, steps) {
  const context = effectiveContext(state);
  const joined = factText(state);

  if (!context.contract) {
    return {
      title: "Открой карточку абонента",
      text: "Live Assistant автоматически подхватит договор, IP и доступные технические данные.",
      confidence: "нет контекста",
      step: steps[0]
    };
  }

  if (state?.status?.running) {
    return {
      title: "Диагностика выполняется",
      text: "Не делай итоговый вывод до завершения текущего этапа сбора.",
      confidence: "live",
      step: activeStep(steps)
    };
  }

  if (context.kind === "billing_technical" && context.olt?.status === "missing") {
    return {
      title: "OLT в Billing не указана",
      text: "Сначала найди голову через UserSide ТМЦ. До этого четыре варианта опроса считаются недоступными.",
      confidence: "маршрут",
      step: steps.find(step => step.id === "line")
    };
  }

  if (workflow?.active && workflow.tmc?.found && context.kind === "billing_technical" && !context.olt?.present) {
    return {
      title: "Перенеси найденную OLT в техданные",
      text: "Сверь название, IP и порт из ТМЦ. Изменение Billing пока выполняется вручную оператором.",
      confidence: "ТМЦ",
      step: steps.find(step => step.id === "line")
    };
  }

  const accessWarnings = (context.accessChecks || []).filter(check => check.state === "warn");
  if (accessWarnings.length) {
    return {
      title: "Проверь доступ и ограничения",
      text: accessWarnings.map(check => `${check.label}: ${check.value || "требует проверки"}`).join(" · "),
      confidence: "важно",
      step: steps.find(step => step.id === "session")
    };
  }

  if (/(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined)) {
    return {
      title: "Сессия не подтверждена",
      text: "Активный договор и online ONU не доказывают наличие авторизации. Проверь BRAS/Juniper и соответствие IP/MAC.",
      confidence: "важно",
      step: steps.find(step => step.id === "session")
    };
  }

  if (context.olt?.present && !lineState(context, joined).liveSeen) {
    return {
      title: "OLT определена — выполни live-опрос",
      text: `Подсвечу подходящий вариант по технологии: ${context.olt.technologyLabel || context.olt.technology || "уточняется"}.`,
      confidence: "Billing",
      step: steps.find(step => step.id === "line")
    };
  }

  const step = activeStep(steps);
  return {
    title: step?.title || "Контекст собран",
    text: step?.detail || "Проверь факты и выбери следующий шаг.",
    confidence: (state?.facts || []).length ? "по данным" : "контекст",
    step
  };
}

function stageLabel(stage) {
  return ({
    billing: "Сбор Billing",
    userside: "Сбор UserSide",
    onu: "Опрос ONU / OLT",
    analysis: "Анализ фактов",
    collecting: "Сбор данных",
    done: "Диагностика завершена",
    idle: "Готов к работе"
  })[stage] || safe(stage || "Готов к работе");
}

function evidenceTokens(state = snapshot) {
  const context = effectiveContext(state);
  const joined = factText(state);
  const tokens = [];
  if (context.contract) tokens.push({ text: "Абонент найден", tone: "ok" });
  if (context.olt?.present) tokens.push({ text: `OLT: ${context.olt.technology || "указана"}`, tone: "ok" });
  else if (context.olt?.status === "missing") tokens.push({ text: "OLT: не указана", tone: "warn" });
  if (context.tmc?.found || workflow?.tmc?.found) tokens.push({ text: "ТМЦ: OLT найдена", tone: "ok" });

  for (const check of context.accessChecks || []) {
    if (!check.value || check.state === "unknown") continue;
    tokens.push({ text: `${check.label}: ${check.state === "warn" ? "проверить" : "OK"}`, tone: check.state === "warn" ? "warn" : "ok" });
  }

  if (/сесси|bras|авторизац/.test(joined)) {
    const warn = /(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined);
    tokens.push({ text: warn ? "BRAS: нет сессии" : "Сессия проверена", tone: warn ? "warn" : "ok" });
  }
  if (!tokens.length) tokens.push({ text: "Ожидает данных", tone: "muted" });
  return tokens.slice(0, 6);
}

function renderMode() {
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.classList.toggle("active", normalizeMode(button.dataset.mode) === mode);
  });
  $("#liveView").hidden = mode !== "live";
  $("#quickView").hidden = mode !== "quick";
}

function highlightButtonLabel(step) {
  if (step.id === "line") return "Показать на странице";
  if (step.id === "session") return "Подсветить Juniper";
  return "Подсветить поле";
}

function renderFocusActions(focus) {
  const step = focus.step;
  const target = $("#focusActions");
  if (!step) {
    target.innerHTML = "";
    return;
  }

  const context = effectiveContext();
  if (step.id === "line" && context.olt?.status === "missing" && !workflow?.active) {
    target.innerHTML = `
      <button type="button" data-highlight="line">Показать поля</button>
      <button type="button" class="primary-choice" data-workflow-action="start-olt">Начать маршрут</button>`;
    return;
  }

  target.innerHTML = `
    <button type="button" data-highlight="${escapeHtml(step.highlight)}">${escapeHtml(highlightButtonLabel(step))}</button>
    <button type="button" class="primary-choice" data-answer="yes" data-step="${escapeHtml(step.id)}">Да</button>
    <button type="button" class="negative-choice" data-answer="no" data-step="${escapeHtml(step.id)}">Нет</button>`;
}

function routeDefinition() {
  const context = effectiveContext();
  const tmc = workflow?.tmc || context.tmc || null;
  const active = Boolean(workflow?.active);

  if (!active && !(context.kind === "billing_technical" && context.olt?.status === "missing")) return null;

  const stage = workflow?.stage || "billing_olt_missing";
  if (!active || stage === "billing_olt_missing") {
    return {
      title: "OLT не указана",
      step: "1 / 5",
      text: "Опрос выбирать рано. Сначала вернись на карточку Billing и открой того же абонента в UserSide.",
      data: [],
      actions: [
        { label: "Показать причину", highlight: "line" },
        { label: active ? "Вернуться к карточке" : "Начать маршрут", workflow: active ? "billing-main" : "start-olt", primary: true }
      ]
    };
  }

  if (stage === "opening_billing_main" || stage === "returning_billing" || stage === "returning_billing_with_tmc") {
    return {
      title: "Перехожу в Billing",
      step: tmc?.found ? "4 / 5" : "2 / 5",
      text: "Жду загрузку исходной карточки абонента.",
      data: [],
      actions: []
    };
  }

  if (stage === "billing_main" && !tmc?.found) {
    return {
      title: "Открой UserSide",
      step: "2 / 5",
      text: "Подсвети переход UserSide и открой карточку того же абонента. Маршрут продолжится во второй вкладке.",
      data: [],
      actions: [
        { label: "Показать переход", highlight: "billing-userside", primary: true },
        { label: "Отменить", workflow: "cancel", ghost: true }
      ]
    };
  }

  if (stage === "userside_tmc") {
    return {
      title: "Найди OLT в ТМЦ",
      step: "3 / 5",
      text: "Открой ТМЦ. Нужен блок «Найдено на OLT»: название головы, IP, PON-порт и время обновления.",
      data: [],
      actions: [
        { label: "Подсветить ТМЦ", highlight: "userside-tmc", primary: true },
        { label: "Обновить данные", command: "refresh" }
      ]
    };
  }

  if (stage === "userside_tmc_found") {
    return {
      title: "OLT найдена в ТМЦ",
      step: "3 / 5",
      text: "Это учётная привязка. После возврата в Billing её нужно сверить и затем подтвердить live-опросом.",
      data: [tmc?.name, tmc?.ip, tmc?.port, tmc?.updatedAtText].filter(Boolean),
      actions: [
        { label: "Вернуться в Billing", workflow: "return-billing", primary: true },
        { label: "Показать источник", highlight: "userside-tmc" }
      ]
    };
  }

  if ((stage === "billing_main" || stage === "billing_main_with_tmc") && tmc?.found) {
    return {
      title: "Вернись в технические данные",
      step: "4 / 5",
      text: "OLT уже найдена. Открой технические данные Billing и сверь поле OLT.",
      data: [tmc.name, tmc.ip, tmc.port].filter(Boolean),
      actions: [
        { label: "Открыть техданные", workflow: "billing-technical", primary: true },
        { label: "Показать раздел", highlight: "billing-technical" }
      ]
    };
  }

  if (stage === "opening_billing_technical") {
    return {
      title: "Открываю технические данные",
      step: "4 / 5",
      text: "Жду загрузку формы Billing.",
      data: [],
      actions: []
    };
  }

  if (stage === "billing_fill_olt") {
    return {
      title: "Заполни OLT в Billing",
      step: "4 / 5",
      text: "Сверь найденные значения, выбери OLT и технологию, затем сохрани изменения. Автосохранение на этом этапе отключено.",
      data: [tmc?.name, tmc?.ip, tmc?.port, tmc?.updatedAtText].filter(Boolean),
      actions: [
        { label: "Подсветить поле OLT", highlight: "billing-olt-field", primary: true },
        { label: "Обновить после сохранения", command: "refresh" }
      ]
    };
  }

  if (stage === "billing_olt_ready") {
    const olt = context.olt?.present ? context.olt : workflow?.billingOlt;
    return {
      title: "OLT определена",
      step: "5 / 5",
      text: "Теперь можно выполнить соответствующий опрос и подтвердить фактическое состояние ONU.",
      data: [olt?.name, olt?.ip, olt?.technologyLabel || olt?.technology].filter(Boolean),
      actions: [
        { label: "Показать нужный опрос", highlight: "line", primary: true },
        { label: "Завершить маршрут", workflow: "cancel", ghost: true }
      ]
    };
  }

  return null;
}

function renderRoute() {
  const card = $("#oltRouteCard");
  const definition = routeDefinition();
  card.hidden = !definition;
  if (!definition) return;

  $("#oltRouteTitle").textContent = definition.title;
  $("#oltRouteStage").textContent = definition.step;
  $("#oltRouteText").textContent = definition.text;
  $("#oltRouteData").innerHTML = definition.data
    .map(value => `<span>${escapeHtml(value)}</span>`)
    .join("");
  $("#oltRouteActions").innerHTML = definition.actions.map(action => {
    const classes = [action.primary ? "primary" : "", action.ghost ? "ghost" : ""].filter(Boolean).join(" ");
    const attr = action.highlight
      ? `data-highlight="${escapeHtml(action.highlight)}"`
      : action.workflow
        ? `data-workflow-action="${escapeHtml(action.workflow)}"`
        : `data-core-action="${escapeHtml(action.command || "refresh")}"`;
    return `<button type="button" class="${classes}" ${attr}>${escapeHtml(action.label)}</button>`;
  }).join("");
}

function renderChecklist(steps) {
  const active = activeStep(steps);
  $("#progressChip").textContent = `${steps.filter(step => step.complete).length} / ${steps.length}`;
  $("#checklist").innerHTML = steps.map((step, index) => {
    const classes = ["step", step.complete ? "done" : "", step.attention ? "attention" : "", active?.id === step.id ? "active" : ""].filter(Boolean).join(" ");
    const marker = step.attention ? "!" : step.complete ? "✓" : index + 1;
    const toolLabel = step.id === "line" ? "Показать" : "Поле";
    const tools = active?.id === step.id
      ? `<span class="step-tools"><button type="button" data-highlight="${escapeHtml(step.highlight)}">${toolLabel}</button></span>`
      : "";
    return `<div class="${classes}"><span class="step-state">${marker}</span><span class="step-copy"><strong>${escapeHtml(step.title)}</strong><span title="${escapeHtml(step.detail)}">${escapeHtml(step.detail)}</span></span>${tools}</div>`;
  }).join("");
}

function renderFacts(state = snapshot) {
  const facts = state?.facts || [];
  $("#facts").innerHTML = facts.length
    ? facts.map((fact, index) => `<article class="fact-card"><b>Факт ${index + 1}</b><span>${escapeHtml(fact)}</span></article>`).join("")
    : `<div class="empty">Технические факты появятся после сбора данных.</div>`;
}

function render() {
  const state = snapshot || {};
  const context = effectiveContext(state);
  const steps = buildSteps(state);
  const focus = focusFor(state, steps);
  const title = context.fullName || context.login || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");

  $("#subscriberTitle").textContent = title;
  $("#subscriberMeta").textContent = context.address || (context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Открой Billing или UserSide");
  $("#subscriberAvatar").textContent = safe(title, 1).toUpperCase() || "A";
  $("#sourceBadge").textContent = context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : workflow?.active ? "Маршрут" : "Нет контекста";
  $("#chips").innerHTML = [
    context.contract && `№ ${context.contract}`,
    context.ip && `IP ${context.ip}`,
    context.mac && `MAC ${context.mac}`
  ].filter(Boolean).map(value => `<span class="chip">${escapeHtml(value)}</span>`).join("");

  $("#stageText").textContent = stageLabel(state.status?.stage);
  $("#statusText").textContent = state.status?.text || (workflow?.active ? "Маршрут определения OLT активен" : "Ожидаю действие оператора");
  $("#statusDot").classList.toggle("running", Boolean(state.status?.running || workflow?.active));
  $("#focusTitle").textContent = focus.title;
  $("#focusText").textContent = focus.text;
  $("#confidenceBadge").textContent = focus.confidence;

  renderFocusActions(focus);
  renderRoute();
  renderChecklist(steps);
  $("#evidenceChips").innerHTML = evidenceTokens(state).map(token => `<span class="evidence-chip ${token.tone}">${escapeHtml(token.text)}</span>`).join("");
  $("#runBtn").disabled = !context.contract || Boolean(state.status?.running);
  $("#runBtn").textContent = state.status?.running ? "Сбор выполняется" : "Собрать данные";
  $("#stopBtn").hidden = !state.status?.running;
  renderFacts(state);
  renderMode();
}

async function setMode(nextMode) {
  mode = normalizeMode(nextMode);
  renderMode();
  try { await send({ type: SET_PANEL_MODE, mode }); } catch (_) {}
}

async function runWorkflowAction(action) {
  try {
    const response = await send({ type: WORKFLOW_COMMAND, action });
    if (response?.ok) workflow = response.workflow || null;
  } catch (_) {}
  render();
}

async function runCoreAction(action) {
  try { await send({ type: CORE_COMMAND, action }); } catch (_) {}
}

async function load() {
  await loadDecisions();
  try {
    const response = await send({ type: GET_ACTIVE_STATE });
    if (response?.ok) {
      snapshot = response.state;
      workflow = response.workflow || null;
      activeTabId = response.tabId ?? null;
      mode = normalizeMode(response.mode);
    }
  } catch (_) {}
  render();
}

try { panelPort = chrome.runtime.connect({ name: PANEL_PORT_NAME }); } catch (_) {}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === ACTIVE_TAB_CHANGED) {
    activeTabId = message.tabId ?? null;
    snapshot = message.state || null;
    workflow = message.workflow || null;
    mode = normalizeMode(message.mode || mode);
    render();
    return;
  }

  if (message?.type === CORE_STATE) {
    if (activeTabId != null && message.tabId != null && message.tabId !== activeTabId) return;
    snapshot = message.state;
    render();
    return;
  }

  if (message?.type === WORKFLOW_STATE) {
    if (message.tabId != null && activeTabId != null && message.tabId !== activeTabId && workflow?.key !== message.workflow?.key) return;
    workflow = message.workflow || null;
    render();
    return;
  }

  if (message?.type === "SIMNET_WB_PANEL_MODE_CHANGED") {
    if (activeTabId != null && message.tabId != null && message.tabId !== activeTabId) return;
    mode = normalizeMode(message.mode);
    renderMode();
  }
});

document.addEventListener("click", async event => {
  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    await setMode(modeButton.dataset.mode);
    return;
  }

  const highlight = event.target.closest("[data-highlight]");
  if (highlight) {
    try { await send({ type: CORE_COMMAND, action: "highlight", target: highlight.dataset.highlight }); } catch (_) {}
    return;
  }

  const workflowButton = event.target.closest("[data-workflow-action]");
  if (workflowButton) {
    await runWorkflowAction(workflowButton.dataset.workflowAction);
    return;
  }

  const coreButton = event.target.closest("[data-core-action]");
  if (coreButton) {
    await runCoreAction(coreButton.dataset.coreAction);
    return;
  }

  const answer = event.target.closest("[data-answer][data-step]");
  if (answer) {
    await saveDecision(answer.dataset.step, answer.dataset.answer);
    render();
    return;
  }

  if (event.target.closest("#runBtn")) {
    await runCoreAction("run");
    return;
  }

  if (event.target.closest("#stopBtn")) {
    await runCoreAction("stop");
    return;
  }

  if (event.target.closest("#refreshBtn") || event.target.closest("#quickRefreshBtn")) {
    await runCoreAction("refresh");
    return;
  }

  if (event.target.closest("#closePanel")) {
    try { panelPort?.disconnect(); } catch (_) {}
    window.close();
  }
});

window.addEventListener("focus", () => { void load(); });
window.addEventListener("pagehide", () => {
  try { panelPort?.disconnect(); } catch (_) {}
}, { once: true });

void load();
