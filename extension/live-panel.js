"use strict";

const CORE_STATE = "SIMNET_WB_CORE_STATE";
const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
const GET_ACTIVE_STATE = "SIMNET_WB_GET_ACTIVE_STATE";
const SET_PANEL_MODE = "SIMNET_WB_SET_PANEL_MODE";
const PANEL_PORT_NAME = "SIMNET_WB_SIDE_PANEL_PORT";
const WORKFLOW_COMMAND = "SIMNET_WB_WORKFLOW_COMMAND";
const WORKFLOW_STATE = "SIMNET_WB_WORKFLOW_STATE";
const ACTIVE_TAB_CHANGED = "SIMNET_WB_ACTIVE_TAB_CHANGED";
const HINTS_KEY = "wb_live_hint_levels_v1";

let snapshot = null;
let workflow = null;
let mode = "live";
let activeTabId = null;
let hintLevels = {};
let panelPort = null;

const $ = selector => document.querySelector(selector);
const safe = (value, max = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = value => safe(value, 700).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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
  return workflow?.key || context.key || [context.system, context.contract, context.billingId, context.customerId].filter(Boolean).join("|") || "no-context";
}

function hintKey(taskId) {
  return `${contextKey()}::${taskId || "none"}`;
}

function hintLevel(taskId) {
  return Number(hintLevels[hintKey(taskId)] || 0);
}

async function loadHintLevels() {
  try {
    const result = await chrome.storage.session.get({ [HINTS_KEY]: {} });
    hintLevels = result?.[HINTS_KEY] || {};
  } catch (_) {
    hintLevels = {};
  }
}

async function advanceHint(taskId, max = 4) {
  const key = hintKey(taskId);
  hintLevels = { ...hintLevels, [key]: Math.min(max, Number(hintLevels[key] || 0) + 1) };
  try { await chrome.storage.session.set({ [HINTS_KEY]: hintLevels }); } catch (_) {}
}

function factText(state = snapshot) {
  return (state?.facts || []).join(" ").toLowerCase();
}

function evidence() {
  return snapshot?.evidence || {};
}

function checkpoints() {
  return snapshot?.checkpoints || {};
}

function topAlert() {
  return Array.isArray(snapshot?.alerts) ? snapshot.alerts[0] || null : null;
}

function missingOltHints(context) {
  const tmc = workflow?.tmc || context.tmc || evidence().tmc || null;
  return [
    "Для PON-подключения не указана OLT. Сейчас важно восстановить привязку, а не выбирать опрос наугад.",
    "Открой «Технические данные» и проверь поле OLT. Пустое поле означает, что нужен дополнительный источник.",
    "Вернись на основную карточку Billing и открой карточку этого же абонента в UserSide.",
    "В UserSide открой ТМЦ и найди блок «Найдено на OLT»: название головы, IP, порт и время обновления.",
    tmc?.found
      ? `Фоново найден источник ТМЦ: ${[tmc.name, tmc.ip, tmc.port, tmc.updatedAtText].filter(Boolean).join(" · ")}. Сверь его вручную.`
      : "Готовый результат ещё не найден. Продолжи маршрут через UserSide ТМЦ."
  ];
}

function sessionHints() {
  const session = evidence().session || {};
  return [
    "Нужно подтвердить наличие или отсутствие активной сессии.",
    "Открой Juniper NEW. Сам факт открытия вкладки засчитает первый чекпоинт.",
    "Дождись загрузки содержимого. Ищи признаки сессии, IP и MAC, а не только открытый блок.",
    "Нажми «Подсветить», чтобы Workbench показал Juniper NEW на странице.",
    session.resolved
      ? `${session.summary}${session.ip ? ` · IP ${session.ip}` : ""}${session.mac ? ` · MAC ${session.mac}` : ""}`
      : "Результат пока не распознан. Проверь содержимое Juniper и обнови состояние."
  ];
}

function lineHints(context) {
  const olt = context.olt || workflow?.billingOlt || {};
  return [
    "После определения OLT нужно подтвердить фактическое состояние линии live-опросом.",
    "Сначала сверь технологию в технических данных: EPON, GPON, GCOM или Huawei.",
    "Не запускай все варианты подряд — используй poller, соответствующий технологии и голове.",
    "Нажми «Подсветить», чтобы Workbench показал подходящий вариант опроса.",
    olt.present
      ? `Для текущей привязки подходит: ${olt.technologyLabel || olt.technology || "технология требует ручной проверки"}${olt.name ? ` · ${olt.name}` : ""}.`
      : "OLT ещё не подтверждена. Вернись к маршруту определения головы."
  ];
}

function currentTask() {
  const context = effectiveContext();
  const cp = checkpoints();
  const session = evidence().session || {};
  const alert = topAlert();

  if (!context.contract && !context.billingId && !context.customerId) {
    return {
      id: "open-subscriber",
      severity: "info",
      title: "Открой карточку абонента",
      target: "subscriber",
      hints: ["Live Assistant подхватит договор, IP и доступные данные после открытия карточки Billing или UserSide."]
    };
  }

  if (alert?.id === "missing-olt") {
    return { ...alert, hints: missingOltHints(context), route: true };
  }

  if (alert) {
    return {
      ...alert,
      hints: [alert.text, `Источник предупреждения: ${alert.source || "Billing"}.`, "Нажми «Подсветить», чтобы перейти к конкретному полю."]
    };
  }

  if (!cp.sessionResolved) {
    let title = "Проверь сессию в Juniper NEW";
    let severity = "info";
    if (session.opened && session.status === "loading") title = "Juniper открыт — жду загрузку";
    else if (session.opened && session.status === "unknown") {
      title = "Juniper открыт, результат не распознан";
      severity = "warning";
    }
    return {
      id: "check-session",
      severity,
      title,
      target: "session",
      hints: sessionHints()
    };
  }

  if (!cp.onuPolled) {
    return {
      id: "poll-onu",
      severity: "info",
      title: cp.oltKnown ? "Подтверди состояние ONU" : "Сначала определи OLT",
      target: "line",
      hints: cp.oltKnown ? lineHints(context) : missingOltHints(context),
      route: !cp.oltKnown
    };
  }

  return {
    id: "checks-complete",
    severity: "ok",
    title: "Основные чекпоинты пройдены",
    target: "subscriber",
    hints: ["Абонент определён, авторизация проверена и live-состояние линии получено."]
  };
}

function taskText(task) {
  const level = Math.min(hintLevel(task.id), Math.max(0, task.hints.length - 1));
  return task.hints[level] || task.hints[0] || "";
}

function buildSteps() {
  const context = effectiveContext();
  const cp = checkpoints();
  const session = evidence().session || {};
  const oltMissing = context.olt?.status === "missing";

  return [
    {
      id: "subscriber",
      title: "Абонент подтверждён",
      detail: cp.subscriberOpened ? `${context.login || context.contract || "карточка"} определена` : "Открой карточку Billing или UserSide",
      complete: Boolean(cp.subscriberOpened),
      attention: false,
      target: "subscriber"
    },
    {
      id: "session",
      title: "Сессия / авторизация",
      detail: session.status === "active"
        ? "Сессия подтверждена автоматически"
        : session.status === "absent"
          ? "Juniper открыт: сессия не найдена"
          : session.opened
            ? "Juniper открыт, жду распознавание результата"
            : "Открой Juniper NEW",
      complete: Boolean(cp.sessionResolved),
      attention: session.status === "absent" || session.status === "unknown",
      target: "session"
    },
    {
      id: "line",
      title: "Линия и ONU",
      detail: cp.onuPolled
        ? "Live-опрос выполнен"
        : oltMissing
          ? "OLT не указана — требуется поиск через ТМЦ"
          : cp.oltKnown
            ? "OLT определена — выполни live-опрос"
            : "Уточни техническую привязку",
      complete: Boolean(cp.onuPolled),
      attention: Boolean(oltMissing || evidence().line?.problem),
      target: "line"
    }
  ];
}

function evidenceTokens() {
  const cp = checkpoints();
  const session = evidence().session || {};
  const accessWarnings = (effectiveContext().accessChecks || []).filter(check => check.state === "warn").length;
  const tokens = [];
  if (cp.subscriberOpened) tokens.push({ text: "Абонент найден", tone: "ok" });
  if (accessWarnings) tokens.push({ text: `Billing: предупреждений ${accessWarnings}`, tone: "warn" });
  else if ((effectiveContext().accessChecks || []).some(check => check.state === "ok")) tokens.push({ text: "Billing: без явных ограничений", tone: "ok" });
  if (session.opened && !session.resolved) tokens.push({ text: "Juniper: открыт", tone: "muted" });
  if (session.active) tokens.push({ text: "Сессия: подтверждена", tone: "ok" });
  if (session.absent) tokens.push({ text: "Сессия: отсутствует", tone: "warn" });
  if (cp.oltKnown) tokens.push({ text: "Источник OLT найден", tone: "ok" });
  else if (evidence().pon?.isPon) tokens.push({ text: "OLT требует проверки", tone: "warn" });
  if (cp.onuPolled) tokens.push({ text: "ONU: опрошена", tone: evidence().line?.problem ? "warn" : "ok" });
  if (!tokens.length) tokens.push({ text: "Ожидает действий", tone: "muted" });
  return tokens.slice(0, 6);
}

function renderMode() {
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.classList.toggle("active", normalizeMode(button.dataset.mode) === mode);
  });
  $("#liveView").hidden = mode !== "live";
  $("#quickView").hidden = mode !== "quick";
}

function renderFocus(task) {
  const card = document.querySelector(".focus-card");
  card.classList.remove("severity-critical", "severity-warning", "severity-info", "severity-ok");
  card.classList.add(`severity-${task.severity || "info"}`);
  $("#focusTitle").textContent = task.title;
  $("#focusText").textContent = taskText(task);
  $("#confidenceBadge").textContent = task.severity === "critical"
    ? "срочно"
    : task.severity === "warning"
      ? "внимание"
      : task.severity === "ok"
        ? "готово"
        : "актуально";

  const level = hintLevel(task.id);
  const max = Math.max(0, task.hints.length - 1);
  const actions = [];
  if (task.target) actions.push(`<button type="button" data-highlight="${escapeHtml(task.target)}">Подсветить</button>`);
  if (max > 0 && level < max) actions.push(`<button type="button" data-hint-task="${escapeHtml(task.id)}">Подсказка ${level + 1}/${max}</button>`);
  if (task.route && !workflow?.active) actions.push(`<button type="button" class="primary-choice" data-workflow-action="start-olt">Начать маршрут</button>`);
  $("#focusActions").innerHTML = actions.join("");
}

function routeDataAllowed() {
  return hintLevel("missing-olt") >= 4 || hintLevel("poll-onu") >= 4;
}

function routeDefinition() {
  const context = effectiveContext();
  const tmc = workflow?.tmc || context.tmc || null;
  const active = Boolean(workflow?.active);
  if (!active) return null;
  const stage = workflow.stage || "billing_olt_missing";
  const reveal = routeDataAllowed();

  if (stage === "billing_olt_missing") return {
    title: "Проверь пустое поле OLT", step: "1 / 5",
    text: "Подсказка ведёт по маршруту, но не раскрывает найденную голову заранее.", data: [],
    actions: [
      { label: "Подсветить поле", highlight: "billing-olt-field" },
      { label: "Вернуться к карточке", workflow: "billing-main", primary: true }
    ]
  };

  if (/^(?:opening_billing_main|returning_billing|returning_billing_with_tmc)$/.test(stage)) return {
    title: "Перехожу в Billing", step: tmc?.found ? "4 / 5" : "2 / 5",
    text: "Жду загрузку исходной карточки.", data: [], actions: []
  };

  if (stage === "billing_main" && !tmc?.found) return {
    title: "Открой UserSide", step: "2 / 5",
    text: "Открой карточку того же абонента. Маршрут продолжится во второй вкладке.", data: [],
    actions: [
      { label: "Показать переход", highlight: "billing-userside", primary: true },
      { label: "Отменить", workflow: "cancel", ghost: true }
    ]
  };

  if (stage === "opening_userside") return {
    title: "Открывается UserSide", step: "3 / 5", text: "Жду карточку абонента.", data: [], actions: []
  };

  if (stage === "userside_tmc") return {
    title: "Найди источник OLT", step: "3 / 5",
    text: "Открой ТМЦ и самостоятельно найди блок «Найдено на OLT».", data: [],
    actions: [
      { label: "Подсветить ТМЦ", highlight: "userside-tmc", primary: true },
      { label: "Обновить", command: "refresh" }
    ]
  };

  if (stage === "userside_tmc_found") return {
    title: "Нужный источник найден", step: "3 / 5",
    text: "Чекпоинт засчитан автоматически. Сверь данные в ТМЦ; готовое значение в панели скрыто до последней подсказки.",
    data: reveal ? [tmc?.name, tmc?.ip, tmc?.port, tmc?.updatedAtText].filter(Boolean) : [],
    actions: [
      { label: "Вернуться в Billing", workflow: "return-billing", primary: true },
      { label: "Показать источник", highlight: "userside-tmc" }
    ]
  };

  if ((stage === "billing_main" || stage === "billing_main_with_tmc") && tmc?.found) return {
    title: "Вернись в технические данные", step: "4 / 5",
    text: "Источник найден. Теперь оператор должен самостоятельно перенести и сохранить привязку.",
    data: reveal ? [tmc.name, tmc.ip, tmc.port].filter(Boolean) : [],
    actions: [
      { label: "Открыть техданные", workflow: "billing-technical", primary: true },
      { label: "Показать раздел", highlight: "billing-technical" }
    ]
  };

  if (stage === "opening_billing_technical") return {
    title: "Открываю технические данные", step: "4 / 5", text: "Жду форму Billing.", data: [], actions: []
  };

  if (stage === "billing_fill_olt") return {
    title: "Заполни OLT в Billing", step: "4 / 5",
    text: "Выбери OLT и технологию, затем сохрани. Workbench не сохраняет изменение автоматически.",
    data: reveal ? [tmc?.name, tmc?.ip, tmc?.port, tmc?.updatedAtText].filter(Boolean) : [],
    actions: [
      { label: "Подсветить поле OLT", highlight: "billing-olt-field", primary: true },
      { label: "Обновить после сохранения", command: "refresh" }
    ]
  };

  if (stage === "billing_olt_ready") {
    const olt = context.olt?.present ? context.olt : workflow.billingOlt;
    return {
      title: "OLT определена", step: "5 / 5",
      text: "Теперь подтверди привязку live-опросом соответствующего типа.",
      data: reveal ? [olt?.name, olt?.ip, olt?.technologyLabel || olt?.technology].filter(Boolean) : [],
      actions: [
        { label: "Показать нужный опрос", highlight: "line", primary: true },
        { label: "Завершить", workflow: "cancel", ghost: true }
      ]
    };
  }

  return null;
}

function renderRoute() {
  const definition = routeDefinition();
  const card = $("#oltRouteCard");
  card.hidden = !definition;
  if (!definition) return;
  $("#oltRouteTitle").textContent = definition.title;
  $("#oltRouteStage").textContent = definition.step;
  $("#oltRouteText").textContent = definition.text;
  $("#oltRouteData").innerHTML = definition.data.map(value => `<span>${escapeHtml(value)}</span>`).join("");
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
  $("#progressChip").textContent = `${steps.filter(step => step.complete).length} / ${steps.length}`;
  $("#checklist").innerHTML = steps.map((step, index) => {
    const classes = ["step", step.complete ? "done" : "", step.attention ? "attention" : "", !step.complete && !step.attention ? "active" : ""].filter(Boolean).join(" ");
    const marker = step.attention ? "!" : step.complete ? "✓" : index + 1;
    const tool = !step.complete ? `<span class="step-tools"><button type="button" data-highlight="${escapeHtml(step.target)}">Поле</button></span>` : "";
    return `<div class="${classes}"><span class="step-state">${marker}</span><span class="step-copy"><strong>${escapeHtml(step.title)}</strong><span title="${escapeHtml(step.detail)}">${escapeHtml(step.detail)}</span></span>${tool}</div>`;
  }).join("");
}

function renderFacts() {
  const context = effectiveContext();
  const session = evidence().session || {};
  const rows = [
    ...(snapshot?.alerts || []).map(alert => `Предупреждение: ${alert.title} · ${alert.text}`),
    ...(snapshot?.facts || []),
    context.olt?.present && `OLT Billing: ${[context.olt.name, context.olt.ip, context.olt.technologyLabel].filter(Boolean).join(" · ")}`,
    (context.tmc?.found || workflow?.tmc?.found) && `OLT ТМЦ: ${[context.tmc?.name || workflow?.tmc?.name, context.tmc?.ip || workflow?.tmc?.ip, context.tmc?.port || workflow?.tmc?.port].filter(Boolean).join(" · ")}`,
    session.opened && `Juniper: ${session.summary}${session.ip ? ` · IP ${session.ip}` : ""}${session.mac ? ` · MAC ${session.mac}` : ""}`
  ].filter(Boolean);
  const unique = [...new Set(rows)];
  $("#facts").innerHTML = unique.length
    ? unique.map((fact, index) => `<article class="fact-card"><b>Факт ${index + 1}</b><span>${escapeHtml(fact)}</span></article>`).join("")
    : `<div class="empty">Технические факты появятся после сбора данных.</div>`;
}

function stageLabel(stage) {
  return ({ billing: "Сбор Billing", userside: "Сбор UserSide", onu: "Опрос ONU / OLT", analysis: "Анализ фактов", collecting: "Сбор данных", done: "Диагностика завершена", idle: "Готов к работе" })[stage] || safe(stage || "Готов к работе");
}

function render() {
  const state = snapshot || {};
  const context = effectiveContext(state);
  const task = currentTask();
  const steps = buildSteps();
  const title = context.fullName || context.login || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");

  $("#subscriberTitle").textContent = title;
  $("#subscriberMeta").textContent = context.address || (context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Открой Billing или UserSide");
  $("#subscriberAvatar").textContent = safe(title, 1).toUpperCase() || "A";
  $("#sourceBadge").textContent = context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : workflow?.active ? "Маршрут" : "Нет контекста";
  $("#chips").innerHTML = [context.contract && `№ ${context.contract}`, context.ip && `IP ${context.ip}`, context.mac && `MAC ${context.mac}`]
    .filter(Boolean).map(value => `<span class="chip">${escapeHtml(value)}</span>`).join("");

  $("#stageText").textContent = stageLabel(state.status?.stage);
  $("#statusText").textContent = state.status?.text || (workflow?.active ? "Маршрут определения OLT активен" : "Фоновая проверка контекста активна");
  $("#statusDot").classList.toggle("running", Boolean(state.status?.running || workflow?.active));

  renderFocus(task);
  renderRoute();
  renderChecklist(steps);
  $("#evidenceChips").innerHTML = evidenceTokens().map(token => `<span class="evidence-chip ${token.tone}">${escapeHtml(token.text)}</span>`).join("");
  $("#runBtn").disabled = !context.contract || Boolean(state.status?.running);
  $("#runBtn").textContent = state.status?.running ? "Сбор выполняется" : "Собрать данные фоном";
  $("#stopBtn").hidden = !state.status?.running;
  renderFacts();
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
  await loadHintLevels();
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
  if (modeButton) return void await setMode(modeButton.dataset.mode);

  const highlight = event.target.closest("[data-highlight]");
  if (highlight) {
    try { await send({ type: CORE_COMMAND, action: "highlight", target: highlight.dataset.highlight }); } catch (_) {}
    return;
  }

  const hint = event.target.closest("[data-hint-task]");
  if (hint) {
    await advanceHint(hint.dataset.hintTask);
    render();
    return;
  }

  const workflowButton = event.target.closest("[data-workflow-action]");
  if (workflowButton) return void await runWorkflowAction(workflowButton.dataset.workflowAction);

  const coreButton = event.target.closest("[data-core-action]");
  if (coreButton) return void await runCoreAction(coreButton.dataset.coreAction);

  if (event.target.closest("#runBtn")) return void await runCoreAction("run");
  if (event.target.closest("#stopBtn")) return void await runCoreAction("stop");
  if (event.target.closest("#refreshBtn") || event.target.closest("#quickRefreshBtn")) return void await runCoreAction("refresh");
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
