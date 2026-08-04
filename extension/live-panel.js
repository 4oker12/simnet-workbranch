"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";
const PANEL_PORT_NAME = "SIMNET_WB_SIDE_PANEL_PORT";
const DECISIONS_KEY = "wb_live_decisions_v1";

let snapshot = null;
let mode = "live";
let activeTabId = null;
let decisionsByContext = {};
let panelPort = null;

const $ = selector => document.querySelector(selector);
const safe = (value, max = 260) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = value => safe(value, 500).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const send = message => chrome.runtime.sendMessage(message);
const normalizeMode = value => value === "quick" ? "quick" : "live";

function contextKey(state = snapshot) {
  const context = state?.context || {};
  return context.key || [context.system, context.contract, context.billingId, context.customerId].filter(Boolean).join("|") || "no-context";
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

function buildSteps(state = snapshot) {
  const context = state?.context || {};
  const joined = factText(state);
  const decisions = currentDecisions();
  const sessionSeen = /сесси|bras|авторизац|juniper/.test(joined);
  const sessionNegative = /(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined);
  const lineSeen = /(onu|ont|olt|сигнал|оптик|gpon|epon)/.test(joined);
  const lineNegative = /(onu|ont|olt|сигнал|оптик).{0,45}(offline|down|не доступ|не найден|крит|плох)/.test(joined);

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
      detail: sessionSeen ? (sessionNegative ? "Получен отрицательный результат" : "Результат авторизации найден") : "Нужен результат BRAS/Juniper",
      complete: sessionSeen || decisions.session === "yes",
      attention: sessionNegative || decisions.session === "no",
      highlight: "session"
    },
    {
      id: "line",
      title: "Линия и ONU",
      detail: lineSeen ? (lineNegative ? "Есть отклонение в состоянии линии" : "Технические данные получены") : "Нужен live-опрос ONU/OLT",
      complete: lineSeen || decisions.line === "yes",
      attention: lineNegative || decisions.line === "no",
      highlight: "line"
    }
  ];
}

function activeStep(steps) {
  return steps.find(step => step.attention) || steps.find(step => !step.complete) || steps[steps.length - 1];
}

function focusFor(state, steps) {
  const context = state?.context || {};
  const joined = factText(state);
  if (!context.contract) return {
    title: "Открой карточку абонента",
    text: "Live Assistant автоматически подхватит договор, IP и доступные технические данные.",
    confidence: "нет контекста",
    step: steps[0]
  };
  if (state?.status?.running) return {
    title: "Диагностика выполняется",
    text: "Не делай итоговый вывод до завершения текущего этапа сбора.",
    confidence: "live",
    step: activeStep(steps)
  };
  if (/(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined)) return {
    title: "Сессия не подтверждена",
    text: "Активный договор и online ONU не доказывают наличие авторизации. Проверь BRAS/Juniper и соответствие IP/MAC.",
    confidence: "важно",
    step: steps.find(step => step.id === "session")
  };
  if (/(onu|ont|olt|сигнал|оптик).{0,45}(offline|down|не доступ|не найден|крит|плох)/.test(joined)) return {
    title: "Проверь физическое состояние линии",
    text: "Сопоставь live-данные ONU с технической привязкой абонента.",
    confidence: "важно",
    step: steps.find(step => step.id === "line")
  };
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
  const context = state?.context || {};
  const joined = factText(state);
  const tokens = [];
  if (context.contract) tokens.push({ text: "Абонент найден", tone: "ok" });
  if (/сесси|bras|авторизац/.test(joined)) {
    const warn = /(сесси|bras|авторизац).{0,45}(нет|отсутств|не найден|offline|down)/.test(joined);
    tokens.push({ text: warn ? "BRAS: нет сессии" : "Сессия проверена", tone: warn ? "warn" : "ok" });
  }
  if (/(onu|ont|olt|сигнал|оптик)/.test(joined)) {
    const warn = /(onu|ont|olt|сигнал|оптик).{0,45}(offline|down|не доступ|не найден|крит|плох)/.test(joined);
    tokens.push({ text: warn ? "ONU: требует проверки" : "ONU: данные есть", tone: warn ? "warn" : "ok" });
  }
  if (!tokens.length) tokens.push({ text: "Ожидает данных", tone: "muted" });
  return tokens.slice(0, 4);
}

function renderMode() {
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.classList.toggle("active", normalizeMode(button.dataset.mode) === mode);
  });
  $("#liveView").hidden = mode !== "live";
  $("#quickView").hidden = mode !== "quick";
}

function renderFocusActions(focus) {
  const step = focus.step;
  const target = $("#focusActions");
  if (!step) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `
    <button type="button" data-highlight="${escapeHtml(step.highlight)}">Подсветить поле</button>
    <button type="button" class="primary-choice" data-answer="yes" data-step="${escapeHtml(step.id)}">Да</button>
    <button type="button" class="negative-choice" data-answer="no" data-step="${escapeHtml(step.id)}">Нет</button>`;
}

function renderChecklist(steps) {
  const active = activeStep(steps);
  $("#progressChip").textContent = `${steps.filter(step => step.complete).length} / ${steps.length}`;
  $("#checklist").innerHTML = steps.map((step, index) => {
    const classes = ["step", step.complete ? "done" : "", step.attention ? "attention" : "", active?.id === step.id ? "active" : ""].filter(Boolean).join(" ");
    const marker = step.attention ? "!" : step.complete ? "✓" : index + 1;
    const tools = active?.id === step.id
      ? `<span class="step-tools"><button type="button" data-highlight="${escapeHtml(step.highlight)}">Поле</button></span>`
      : "";
    return `<div class="${classes}"><span class="step-state">${marker}</span><span class="step-copy"><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.detail)}</span></span>${tools}</div>`;
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
  const context = state.context || {};
  const steps = buildSteps(state);
  const focus = focusFor(state, steps);
  const title = context.fullName || context.login || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");

  $("#subscriberTitle").textContent = title;
  $("#subscriberMeta").textContent = context.address || (context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Открой Billing или UserSide");
  $("#subscriberAvatar").textContent = safe(title, 1).toUpperCase() || "A";
  $("#sourceBadge").textContent = context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Нет контекста";
  $("#chips").innerHTML = [
    context.contract && `№ ${context.contract}`,
    context.ip && `IP ${context.ip}`,
    context.mac && `MAC ${context.mac}`
  ].filter(Boolean).map(value => `<span class="chip">${escapeHtml(value)}</span>`).join("");

  $("#stageText").textContent = stageLabel(state.status?.stage);
  $("#statusText").textContent = state.status?.text || "Ожидаю действие оператора";
  $("#statusDot").classList.toggle("running", Boolean(state.status?.running));
  $("#focusTitle").textContent = focus.title;
  $("#focusText").textContent = focus.text;
  $("#confidenceBadge").textContent = focus.confidence;
  renderFocusActions(focus);
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

async function load() {
  await loadDecisions();
  try {
    const response = await send({ type: GET_ACTIVE_STATE });
    if (response?.ok) {
      snapshot = response.state;
      activeTabId = response.tabId ?? null;
      mode = normalizeMode(response.mode);
    }
  } catch (_) {}
  render();
}

try { panelPort = chrome.runtime.connect({ name: PANEL_PORT_NAME }); } catch (_) {}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === CORE_STATE) {
    if (activeTabId != null && message.tabId != null && message.tabId !== activeTabId) return;
    snapshot = message.state;
    render();
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
  const answer = event.target.closest("[data-answer][data-step]");
  if (answer) {
    await saveDecision(answer.dataset.step, answer.dataset.answer);
    render();
    return;
  }
  if (event.target.closest("#runBtn")) {
    try { await send({ type: CORE_COMMAND, action: "run" }); } catch (_) {}
    return;
  }
  if (event.target.closest("#stopBtn")) {
    try { await send({ type: CORE_COMMAND, action: "stop" }); } catch (_) {}
    return;
  }
  if (event.target.closest("#refreshBtn") || event.target.closest("#quickRefreshBtn")) {
    try { await send({ type: CORE_COMMAND, action: "refresh" }); } catch (_) {}
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
