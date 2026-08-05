"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__) return;

  const HOST_ID = "simnet-workbench-dock";
  const PAGE_STYLE_ID = "simnet-workbench-dock-page-style";
  const OPEN_PANEL = "SIMNET_WB_OPEN_SIDE_PANEL";
  const PANEL_VISIBILITY = "SIMNET_WB_PANEL_VISIBILITY";
  const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
  const WORKFLOW_COMMAND = "SIMNET_WB_WORKFLOW_COMMAND";
  const CATEGORY_KEY = "simnet_wb_case_category_v1";
  const RAIL_WIDTH = 48;
  const FLYOUT_WIDTH = 280;
  const CLOSE_DELAY_MS = 240;
  const core = globalThis.__SIMNET_WORKBENCH_CORE__;

  const state = {
    host: null,
    root: null,
    observer: null,
    unsubscribe: null,
    visible: true,
    open: false,
    pinned: false,
    activeModule: "active",
    snapshot: core?.getState?.() || null,
    closeTimer: 0,
    errorTimer: 0,
    categoryByContext: {},
    copied: ""
  };

  const MODULES = Object.freeze([
    { id: "active", label: "Наставник", short: "Кейс", icon: "mentor", color: "#8f65e8" },
    { id: "diagnostics", label: "Диагностика", short: "Диагноз", icon: "bolt", color: "#5ad895" },
    { id: "history", label: "История", short: "История", icon: "history", color: "#f2c15b" },
    { id: "settings", label: "Настройки", short: "Настр", icon: "settings", color: "#92a2b7" }
  ]);

  const FLYOUT_MODULES = Object.freeze([
    { id: "juniper", label: "Juniper", parent: "diagnostics" },
    { id: "onu", label: "ONU", parent: "diagnostics" },
    { id: "ping", label: "Ping", parent: "diagnostics" },
    { id: "history-full", label: "История", parent: "history" }
  ]);

  const CATEGORIES = Object.freeze([
    { id: "no-service", label: "Нет интернета" },
    { id: "speed", label: "Скорость" },
    { id: "wifi", label: "Wi-Fi" },
    { id: "tv", label: "TV / IPTV" },
    { id: "billing", label: "Оплата" },
    { id: "other", label: "Другое" }
  ]);

  const TALK_SCRIPTS = Object.freeze([
    { id: "check", label: "Проверяю", text: "Сейчас проверю активную сессию и фактическое состояние линии." },
    { id: "binding", label: "Привязка", text: "Секунду, сверяю техническую привязку оборудования и параметры подключения." },
    { id: "issue", label: "Отклонение", text: "На линии вижу отклонение. Уточняю источник, чтобы назвать дальнейшие действия." },
    { id: "wait", label: "Ожидание", text: "Проверка ещё выполняется. Пожалуйста, оставайтесь на линии." }
  ]);

  const ICONS = Object.freeze({
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    bolt: "M13 2 5 14h7l-1 8 8-12h-7z",
    history: "M3 3v18h18M12 7v5l4 2M5 3h14M5 21h14",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0v3M12 6V3M19.4 15a7.97 7.97 0 0 0 .6-3 7.97 7.97 0 0 0-.6-3l2.5-2-2.1-2.1-2 2.5a7.97 7.97 0 0 0-3-.6 7.97 7.97 0 0 0-3 .6L9.9 4.9 7.8 7l2.5 2a7.97 7.97 0 0 0-.6 3 7.97 7.97 0 0 0 .6 3l-2.5 2 2.1 2.1 2-2.5a7.97 7.97 0 0 0 3 .6 7.97 7.97 0 0 0 3-.6l2 2.5 2.1-2.1-2.5-2Z",
    expand: "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5",
    close: "M7 7l10 10M17 7 7 17",
    target: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    route: "M5 5h5v5H5V5Zm9 9h5v5h-5v-5ZM10 7h4a3 3 0 0 1 3 3v4M7 10v4a3 3 0 0 0 3 3h4",
    copy: "M9 9h10v10H9V9ZM5 5h10v4M5 5v10h4",
    chevronLeft: "M15 18l-6-6 6-6",
    externalLink: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
  });

  const safe = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const escapeHtml = value => safe(value, 900).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.mentor}"></path></svg>`;

  function context() {
    return state.snapshot?.context || {};
  }

  function evidence() {
    return state.snapshot?.evidence || {};
  }

  function checkpoints() {
    return state.snapshot?.checkpoints || {};
  }

  function subscriberKey() {
    const current = context();
    if (current.contract) return `contract:${current.contract}`;
    if (current.billingId) return `billing:${current.billingId}`;
    if (current.customerId) return `userside:${current.customerId}`;
    return "no-context";
  }

  function currentCategory() {
    return state.categoryByContext[subscriberKey()] || "";
  }

  function severityRank(value) {
    return ({ critical: 0, warning: 1, info: 2, ok: 3 })[value] ?? 9;
  }

  function sortedAlerts() {
    return (Array.isArray(state.snapshot?.alerts) ? state.snapshot.alerts : [])
      .filter(Boolean)
      .slice()
      .sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  }

  function derivedTask() {
    const current = context();
    const cp = checkpoints();
    const ev = evidence();
    const alert = sortedAlerts()[0] || null;

    if (!current.contract && !current.billingId && !current.customerId) {
      return {
        id: "subscriber",
        severity: "info",
        title: "Открой карточку абонента",
        detail: "Workbench подхватит договор и IP автоматически.",
        target: "subscriber"
      };
    }

    if (alert) {
      return {
        id: alert.id || "alert",
        severity: alert.severity || "warning",
        title: safe(alert.title || "Требуется внимание", 72),
        detail: safe(alert.text || alert.source || "Проверь подтверждающий источник.", 170),
        target: alert.target || "subscriber",
        route: alert.id === "missing-olt"
      };
    }

    if (!cp.sessionResolved) {
      return {
        id: "session",
        severity: ev.session?.status === "unknown" ? "warning" : "info",
        title: ev.session?.opened ? "Статус Juniper не распознан" : "Проверь сессию в Juniper NEW",
        detail: ev.session?.opened ? "Дождись результата online/offline." : "Открой Juniper NEW и дождись статуса.",
        target: "session"
      };
    }

    if (!cp.onuPolled) {
      const needsOlt = Boolean(ev.pon?.isPon && !cp.oltKnown);
      return {
        id: "line",
        severity: needsOlt ? "warning" : "info",
        title: needsOlt ? "Сначала определи OLT" : "Выполни live-опрос ONU",
        detail: needsOlt ? "Без привязки нельзя выбирать poller наугад." : "Подтверди статус, порт и оптические показатели.",
        target: "line",
        route: needsOlt
      };
    }

    if (ev.line?.problem) {
      return {
        id: "line-problem",
        severity: "warning",
        title: "Live-опрос выявил отклонение",
        detail: safe(ev.line.summary || "Сверь статус ONU и оптические показатели.", 170),
        target: "line"
      };
    }

    return {
      id: "complete",
      severity: "ok",
      title: "Основные проверки выполнены",
      detail: "Сессия и live-состояние линии подтверждены.",
      target: "subscriber"
    };
  }

  function stepModel() {
    const current = context();
    const cp = checkpoints();
    const ev = evidence();
    const alerts = sortedAlerts();
    const subscriberAlert = alerts.find(alert => /billing|access|block|group|tariff|start/i.test(`${alert.id || ""} ${alert.target || ""}`));
    const sessionAlert = alerts.find(alert => /session|juniper/i.test(`${alert.id || ""} ${alert.target || ""}`));
    const lineAlert = alerts.find(alert => alert.id === "missing-olt" || /line|olt|onu|poller/i.test(`${alert.id || ""} ${alert.target || ""}`));

    return [
      {
        id: "subscriber",
        label: "Абонент",
        complete: Boolean(cp.subscriberOpened || current.contract || current.billingId || current.customerId),
        attention: Boolean(subscriberAlert),
        detail: subscriberAlert?.title || "Карточка"
      },
      {
        id: "session",
        label: "Сессия",
        complete: Boolean(cp.sessionResolved),
        attention: Boolean(sessionAlert || ev.session?.absent),
        detail: ev.session?.status === "active" ? "online" : ev.session?.status === "absent" ? "offline" : "Juniper"
      },
      {
        id: "line",
        label: "ONU",
        complete: Boolean(cp.onuPolled),
        attention: Boolean(lineAlert || ev.line?.problem || (ev.pon?.isPon && !cp.oltKnown)),
        detail: cp.onuPolled ? "опрошена" : cp.oltKnown ? "готова к опросу" : "OLT"
      }
    ];
  }

  function metricModel() {
    const current = context();
    const ev = evidence();
    const cp = checkpoints();
    const facts = Array.isArray(state.snapshot?.facts) ? state.snapshot.facts : [];
    const optical = facts.join(" ").match(/(?:RX|Rx|ONU RX)[^\d-]*(-?\d+(?:[.,]\d+)?)\s*dBm/i)?.[1] || "";
    const session = ev.session?.status === "active"
      ? "Online"
      : ev.session?.status === "absent"
        ? "Offline"
        : ev.session?.opened
          ? "Loading"
          : "—";
    const olt = current.olt?.name || current.tmc?.name || (cp.oltKnown ? "Найдена" : "—");
    const mac = current.mac || ev.session?.mac || "—";

    return [
      { id: "ip", label: "IP", value: current.ip || "—", tone: current.ip ? "ok" : "muted", copy: current.ip || "" },
      { id: "session", label: "BRAS", value: session, tone: session === "Online" ? "ok" : session === "Offline" ? "danger" : "muted" },
      { id: "olt", label: "OLT", value: safe(olt, 24), tone: cp.oltKnown ? "ok" : "warn" },
      { id: "onu", label: "ONU", value: optical ? `${optical} dBm` : cp.onuPolled ? "Опрошена" : "—", tone: ev.line?.problem ? "warn" : cp.onuPolled ? "ok" : "muted" },
      { id: "mac", label: "MAC", value: safe(mac, 22), tone: mac !== "—" ? "ok" : "muted", copy: mac !== "—" ? mac : "" },
      { id: "category", label: "Кейс", value: CATEGORIES.find(item => item.id === currentCategory())?.label || "Не выбран", tone: currentCategory() ? "info" : "muted" }
    ];
  }

  function footerMetrics() {
    const metrics = metricModel();
    return [
      metrics.find(item => item.id === "onu"),
      metrics.find(item => item.id === "session"),
      metrics.find(item => item.id === "mac")
    ].filter(Boolean);
  }

  function taskActions(task) {
    const actions = [];
    if (task.target) actions.push({ id: "highlight", label: "Подсветить", icon: "target", target: task.target, primary: true });
    if (task.route) actions.push({ id: "route", label: "Маршрут OLT", icon: "route" });
    actions.push({ id: "refresh", label: "Обновить", icon: "refresh" });
    return actions.slice(0, 3);
  }

  function pageReserve() {
    if (!state.visible) return 0;
    if (!state.open) return RAIL_WIDTH;
    return RAIL_WIDTH + Math.min(FLYOUT_WIDTH, Math.max(220, window.innerWidth - RAIL_WIDTH));
  }

  function ensurePageStyle() {
    let style = document.getElementById(PAGE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = PAGE_STYLE_ID;
      style.textContent = `
        html.simnet-wb-dock-reserved body {
          margin-right: var(--simnet-wb-dock-reserve, 0px) !important;
          max-width: calc(100vw - var(--simnet-wb-dock-reserve, 0px)) !important;
          box-sizing: border-box !important;
          transition: margin-right .2s ease, max-width .2s ease !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function applyPageSpacing() {
    ensurePageStyle();
    const reserve = pageReserve();
    document.documentElement.style.setProperty("--simnet-wb-dock-reserve", `${reserve}px`);
    document.documentElement.classList.toggle("simnet-wb-dock-reserved", reserve > 0);
  }

  function clearCloseTimer() {
    window.clearTimeout(state.closeTimer);
    state.closeTimer = 0;
  }

  function openDock(moduleId, pin = false) {
    clearCloseTimer();
    state.activeModule = MODULES.some(module => module.id === moduleId) ? moduleId : "active";
    state.open = true;
    if (pin) state.pinned = true;
    render();
    applyPageSpacing();
  }

  function closeDock(force = false) {
    if (state.pinned && !force) return;
    clearCloseTimer();
    state.open = false;
    if (force) state.pinned = false;
    render();
    applyPageSpacing();
  }

  function scheduleClose() {
    clearCloseTimer();
    if (state.pinned) return;
    state.closeTimer = window.setTimeout(() => closeDock(), CLOSE_DELAY_MS);
  }

  function setVisible(visible) {
    state.visible = Boolean(visible);
    if (state.host) state.host.style.setProperty("display", state.visible ? "block" : "none", "important");
    if (!state.visible) {
      state.open = false;
      state.pinned = false;
    }
    applyPageSpacing();
  }

  function showError(message) {
    window.clearTimeout(state.errorTimer);
    const node = state.root?.querySelector(".dock-error");
    if (!node) return;
    node.textContent = safe(message || "Действие не выполнено", 130);
    node.hidden = false;
    state.errorTimer = window.setTimeout(() => { node.hidden = true; }, 3200);
  }

  async function openNativePanel(mode = "live") {
    try {
      const response = await chrome.runtime.sendMessage({ type: OPEN_PANEL, mode });
      if (!response?.ok) throw new Error(response?.error || "Chrome Side Panel не открылся");
    } catch (error) {
      showError(error?.message || error);
    }
  }

  async function runCoreAction(action, target = "") {
    try {
      const response = await chrome.runtime.sendMessage({ type: CORE_COMMAND, action, target });
      if (response && response.ok === false) throw new Error(response.error || "Команда не выполнена");
    } catch (error) {
      showError(error?.message || error);
    }
  }

  async function startOltRoute() {
    try {
      const response = await chrome.runtime.sendMessage({ type: WORKFLOW_COMMAND, action: "start-olt" });
      if (!response?.ok) throw new Error(response?.error || "Маршрут OLT не запущен");
    } catch (error) {
      showError(error?.message || error);
    }
  }

  async function copyValue(value, id = "") {
    const text = safe(value, 240);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      state.copied = id || text;
      render();
      window.setTimeout(() => {
        if (state.copied === (id || text)) {
          state.copied = "";
          render();
        }
      }, 1300);
    } catch (error) {
      showError("Не удалось скопировать значение");
    }
  }

  async function setCategory(categoryId) {
    const key = subscriberKey();
    if (key === "no-context") {
      showError("Сначала открой карточку абонента");
      return;
    }
    state.categoryByContext = { ...state.categoryByContext, [key]: categoryId };
    try { await chrome.storage.session.set({ [CATEGORY_KEY]: state.categoryByContext }); } catch (_) {}
    render();
  }

  async function loadCategories() {
    try {
      const result = await chrome.storage.session.get({ [CATEGORY_KEY]: {} });
      state.categoryByContext = result?.[CATEGORY_KEY] || {};
    } catch (_) {
      state.categoryByContext = {};
    }
  }

  function moduleTitle() {
    return MODULES.find(module => module.id === state.activeModule)?.label || "Active Case";
  }

  function identityHtml() {
    const current = context();
    const task = derivedTask();
    const title = current.login || (current.contract ? `abon${current.contract}` : "Нет абонента");
    const ip = current.ip || "IP не определён";
    const copyButton = current.ip
      ? `<button type="button" class="copy-value" data-copy-value="${escapeHtml(current.ip)}" data-copy-id="ip" title="Копировать IP">${state.copied === "ip" ? "✓" : svg("copy")}${escapeHtml(ip)}</button>`
      : `<span class="identity-ip muted">${escapeHtml(ip)}</span>`;
    return `<div class="identity-row">
      <span class="health-dot severity-${escapeHtml(task.severity)}" title="${escapeHtml(task.severity)}"></span>
      <strong>${escapeHtml(title)}</strong>
      ${copyButton}
    </div>`;
  }

  function activeModuleHtml() {
    const task = derivedTask();
    const steps = stepModel();
    const category = CATEGORIES.find(item => item.id === currentCategory());
    const actions = taskActions(task).map(action => {
      const attrs = action.id === "highlight"
        ? `data-highlight="${escapeHtml(action.target)}"`
        : action.id === "route"
          ? "data-start-olt-route"
          : `data-core-action="${escapeHtml(action.id)}"`;
      return `<button type="button" class="action-btn${action.primary ? " primary" : ""}" ${attrs}>${svg(action.icon)}<span>${escapeHtml(action.label)}</span></button>`;
    }).join("");

    return `<section class="module-pane active-case" data-pane="active">
      ${identityHtml()}
      ${category ? `<span class="category-chip">${escapeHtml(category.label)}</span>` : ""}
      <article class="active-task severity-${escapeHtml(task.severity)}">
        <div class="task-heading"><span>Сейчас важно</span><button type="button" class="help" data-tip="${escapeHtml(task.detail)}" aria-label="Что это значит">?</button></div>
        <strong title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</strong>
        <div class="task-actions">${actions}</div>
      </article>
      <div class="mini-steps">${steps.map(step => {
        const marker = step.attention ? "!" : step.complete ? "✓" : "·";
        const klass = step.attention ? "attention" : step.complete ? "done" : "pending";
        return `<div class="mini-step ${klass}" data-step="${escapeHtml(step.id)}"><span>${marker}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div>`;
      }).join("")}</div>
    </section>`;
  }

  function metricsModuleHtml() {
    return `<section class="module-pane metrics-pane" data-pane="metrics">
      ${identityHtml()}
      <div class="metric-grid">${metricModel().map(metric => {
        const copy = metric.copy
          ? `<button type="button" class="metric-copy" data-copy-value="${escapeHtml(metric.copy)}" data-copy-id="metric-${escapeHtml(metric.id)}" title="Копировать">${state.copied === `metric-${metric.id}` ? "✓" : svg("copy")}</button>`
          : "";
        return `<article class="metric-card tone-${escapeHtml(metric.tone)}"><span>${escapeHtml(metric.label)}</span><strong title="${escapeHtml(metric.value)}">${escapeHtml(metric.value)}</strong>${copy}</article>`;
      }).join("")}</div>
      <button type="button" class="wide-action" data-core-action="refresh">${svg("refresh")}Обновить факты</button>
      <div class="flyout-nav">${FLYOUT_MODULES.map(mod => `<button type="button" class="flyout-nav-btn" data-flyout="${escapeHtml(mod.id)}"><strong>${escapeHtml(mod.label)}</strong></button>`).join("")}</div>
    </section>`;
  }

  function juniperModuleHtml() {
    const current = context();
    const ev = evidence();
    const sessionStatus = ev.session?.status === "active" ? "Online" : ev.session?.status === "absent" ? "Offline" : "—";
    return `<section class="module-pane flyout-module" data-pane="juniper">
      <header class="flyout-module-header">
        <button type="button" class="back-btn" data-back-to="diagnostics">${svg("chevronLeft")}</button>
        <strong>Juniper / Авторизация</strong>
        <button type="button" class="head-action" data-close-dock>${svg("close")}</button>
      </header>
      <div class="flyout-status-bar">
        <span class="status-dot ${ev.session?.opened ? "ok" : "muted"}"></span>
        <span>${ev.session?.opened ? "Данные обновлены" : "Ожидание данных"}</span>
        <button type="button" class="mini-refresh" data-core-action="refresh">${svg("refresh")}</button>
      </div>
      <article class="flyout-data-card">
        <div class="data-row"><span>Статус:</span><strong>${sessionStatus}</strong></div>
        <div class="data-row"><span>IP:</span><strong>${current.ip || "—"}</strong></div>
        <div class="data-row"><span>NAS Port:</span><strong>${ev.session?.nasPort || "—"}</strong></div>
        <div class="data-row"><span>Последнее событие:</span><strong>${ev.session?.lastEvent || "—"}</strong></div>
      </article>
      <article class="mentor-compact">
        <div class="mentor-title">${svg("mentor")}Что важно сейчас</div>
        <p>${ev.session?.opened ? "Сессия найдена в Juniper NEW." : "Открой Juniper NEW для проверки сессии."}</p>
      </article>
      <footer class="flyout-footer">
        <button type="button" class="footer-btn" data-open-source>${svg("externalLink")}Источник</button>
        <button type="button" class="footer-btn" data-show-raw>RAW</button>
      </footer>
    </section>`;
  }

  function onuModuleHtml() {
    const ev = evidence();
    const optical = (Array.isArray(state.snapshot?.facts) ? state.snapshot.facts.join(" ") : "").match(/(?:RX|Rx|ONU RX)[^\d-]*(-?\d+(?:[.,]\d+)?)\s*dBm/i)?.[1] || "—";
    return `<section class="module-pane flyout-module" data-pane="onu">
      <header class="flyout-module-header">
        <button type="button" class="back-btn" data-back-to="diagnostics">${svg("chevronLeft")}</button>
        <strong>ONU / Состояние</strong>
        <button type="button" class="head-action" data-close-dock>${svg("close")}</button>
      </header>
      <div class="flyout-status-bar">
        <span class="status-dot ${ev.line?.problem ? "warn" : "ok"}"></span>
        <span>${ev.line?.problem ? "Требуется внимание" : "В норме"}</span>
        <button type="button" class="mini-refresh" data-core-action="refresh">${svg("refresh")}</button>
      </div>
      <article class="flyout-data-card">
        <div class="data-row"><span>Optical RX:</span><strong>${optical !== "—" ? `${optical} dBm` : "—"}</strong></div>
        <div class="data-row"><span>Статус:</span><strong>${ev.line?.problem ? "Отклонение" : "OK"}</strong></div>
      </article>
      <footer class="flyout-footer">
        <button type="button" class="footer-btn" data-open-source>${svg("externalLink")}Источник</button>
        <button type="button" class="footer-btn" data-show-raw>RAW</button>
      </footer>
    </section>`;
  }

  function pingModuleHtml() {
    return `<section class="module-pane flyout-module" data-pane="ping">
      <header class="flyout-module-header">
        <button type="button" class="back-btn" data-back-to="diagnostics">${svg("chevronLeft")}</button>
        <strong>Ping / Доступность</strong>
        <button type="button" class="head-action" data-close-dock>${svg("close")}</button>
      </header>
      <div class="flyout-status-bar">
        <span class="status-dot muted"></span>
        <span>Данные не загружены</span>
        <button type="button" class="mini-refresh" data-core-action="refresh">${svg("refresh")}</button>
      </div>
      <article class="flyout-data-card">
        <p class="placeholder-text">Модуль Ping готов к работе. Нажмите «Обновить» для запуска проверки.</p>
      </article>
      <footer class="flyout-footer">
        <button type="button" class="footer-btn" data-open-source>${svg("externalLink")}Источник</button>
      </footer>
    </section>`;
  }

  function historyModuleHtml() {
    const history = Array.isArray(state.snapshot?.history) ? state.snapshot.history : [];
    return `<section class="module-pane flyout-module" data-pane="history-full">
      <header class="flyout-module-header">
        <button type="button" class="back-btn" data-back-to="history">${svg("chevronLeft")}</button>
        <strong>История проверок</strong>
        <button type="button" class="head-action" data-close-dock>${svg("close")}</button>
      </header>
      <div class="flyout-history-list">${history.length ? history.map(item => `<div class="history-item"><span>${escapeHtml(item.date || "—")}</span><small>${escapeHtml(item.result || "—")}</small></div>`).join("") : '<p class="placeholder-text">История пуста</p>'}</div>
      <footer class="flyout-footer">
        <button type="button" class="footer-btn" data-open-source>${svg("externalLink")}Журнал</button>
      </footer>
    </section>`;
  }

  function scriptsModuleHtml() {
    return `<section class="module-pane scripts-pane" data-pane="scripts">
      ${identityHtml()}
      <div class="module-intro"><strong>Речевые модули</strong><span>Клик копирует готовую фразу.</span></div>
      <div class="script-list">${TALK_SCRIPTS.map(script => `<button type="button" class="script-btn" data-copy-value="${escapeHtml(script.text)}" data-copy-id="script-${escapeHtml(script.id)}" data-tip="${escapeHtml(script.text)}"><strong>${state.copied === `script-${script.id}` ? "Скопировано" : escapeHtml(script.label)}</strong><span>${escapeHtml(script.text)}</span></button>`).join("")}</div>
    </section>`;
  }

  function matrixModuleHtml() {
    const selected = currentCategory();
    return `<section class="module-pane matrix-pane" data-pane="matrix">
      ${identityHtml()}
      <div class="module-intro"><strong>Категория обращения</strong><span>Выбор сохраняется для текущего абонента.</span></div>
      <div class="category-grid">${CATEGORIES.map(category => `<button type="button" class="category-btn${selected === category.id ? " selected" : ""}" data-category="${escapeHtml(category.id)}"><span>${selected === category.id ? "✓" : ""}</span><strong>${escapeHtml(category.label)}</strong></button>`).join("")}</div>
    </section>`;
  }

  function footerHtml() {
    return footerMetrics().map(metric => `<span class="footer-chip tone-${escapeHtml(metric.tone)}"><b>${escapeHtml(metric.label)}</b>${escapeHtml(metric.value)}</span>`).join("");
  }

  function render() {
    if (!state.root) return;
    const flyout = state.root.querySelector(".flyout");
    const stage = state.root.querySelector(".module-stage");
    const footer = state.root.querySelector(".dock-footer");
    const title = state.root.querySelector("#dockModuleTitle");
    if (!flyout || !stage || !footer || !title) return;

    flyout.classList.toggle("open", state.open);
    flyout.classList.toggle("pinned", state.pinned);
    flyout.dataset.module = state.activeModule;
    title.textContent = moduleTitle();

    state.root.querySelectorAll(".rail-button[data-module]").forEach(button => {
      button.classList.toggle("active", button.dataset.module === state.activeModule && state.open);
      button.setAttribute("aria-expanded", String(button.dataset.module === state.activeModule && state.open));
    });

    const activeModule = state.activeModule === "diagnostics" ? "metrics" : state.activeModule;
    stage.innerHTML = activeModule === "metrics"
      ? metricsModuleHtml()
      : activeModule === "scripts"
        ? scriptsModuleHtml()
        : activeModule === "matrix"
          ? matrixModuleHtml()
          : activeModuleHtml();
    footer.innerHTML = footerHtml();
  }

  function renderFlyout(moduleId) {
    if (!state.root) return;
    const stage = state.root.querySelector(".module-stage");
    if (!stage) return;

    stage.innerHTML = moduleId === "juniper"
      ? juniperModuleHtml()
      : moduleId === "onu"
        ? onuModuleHtml()
        : moduleId === "ping"
          ? pingModuleHtml()
          : moduleId === "history-full"
            ? historyModuleHtml()
            : metricsModuleHtml();
  }

  function hideLegacyRuntime() {
    document.getElementById("simnet-mentor-shell")?.remove();
    for (const selector of [
      "#simnet-map-investigation-launcher-v3",
      "#simnet-map-investigation-panel-v3",
      "#simnet-map-investigation-launcher",
      "#simnet-map-investigation-panel"
    ]) {
      const node = document.querySelector(selector);
      if (node) node.style.setProperty("display", "none", "important");
    }

    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    panel.dataset.sidepanelRuntime = "hidden";
    for (const [property, value] of Object.entries({
      position: "fixed",
      left: "-100000px",
      top: "-100000px",
      right: "auto",
      bottom: "auto",
      width: "1px",
      height: "1px",
      "min-width": "0",
      "max-width": "1px",
      "max-height": "1px",
      overflow: "hidden",
      opacity: "0",
      "pointer-events": "none",
      "clip-path": "inset(100%)",
      transform: "none"
    })) panel.style.setProperty(property, value, "important");
  }

  function installDock() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed!important;right:0!important;top:0!important;width:${RAIL_WIDTH}px!important;height:100vh!important;z-index:2147483647!important;font-family:"Segoe UI",Arial,sans-serif}
      *{box-sizing:border-box}
      button{font:inherit}
      .dock{position:fixed;right:0;top:0;width:${RAIL_WIDTH}px;height:100vh;color:#dce7f4;pointer-events:auto}
      .rail{position:absolute;right:0;top:0;z-index:3;display:flex;flex-direction:column;align-items:center;gap:6px;width:${RAIL_WIDTH}px;height:100%;padding:7px 5px;background:#090f17;border-left:1px solid #27364a;box-shadow:-6px 0 18px rgba(0,0,0,.3)}
      .rail-button{position:relative;display:grid;place-items:center;width:38px;height:42px;padding:0;color:#8291a5;background:transparent;border:1px solid transparent;border-radius:10px;cursor:pointer;transition:color .15s ease,background .15s ease,border-color .15s ease}
      .rail-button:hover,.rail-button:focus-visible,.rail-button.active{color:#fff;background:#211a35;border-color:#5d477f;outline:none}
      .rail-button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .rail-button .label{position:absolute;right:46px;top:50%;padding:5px 7px;color:#fff;background:#101826;border:1px solid #34465e;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;font-size:10px;pointer-events:none}
      .rail-button:hover .label{opacity:1;visibility:visible}
      .rail-button[data-module="active"]::after{content:"";position:absolute;right:4px;bottom:5px;width:6px;height:6px;background:#5ad895;border:1px solid #07110c;border-radius:50%}
      .rail-spacer{flex:1}
      .flyout{position:fixed;right:${RAIL_WIDTH}px;top:0;z-index:2;display:grid;grid-template-rows:36px minmax(0,1fr) 32px;width:min(${FLYOUT_WIDTH}px,calc(100vw - ${RAIL_WIDTH}px));height:100vh;color:#dce7f4;background:#0d1622;border-left:1px solid #314159;border-right:1px solid #243246;box-shadow:-18px 0 36px rgba(0,0,0,.34);opacity:0;visibility:hidden;transform:translateX(18px);pointer-events:none;overflow:hidden;transition:opacity .16s ease,transform .2s ease,visibility .2s ease}
      .flyout.open{opacity:1;visibility:visible;transform:translateX(0);pointer-events:auto}
      .flyout-head{display:flex;align-items:center;gap:7px;min-width:0;padding:4px 7px;border-bottom:1px solid #233248;background:#101a28}
      .flyout-head .brand{width:6px;height:18px;background:#8f65e8;border-radius:3px;box-shadow:0 0 10px rgba(143,101,232,.5)}
      .flyout-head strong{min-width:0;flex:1;overflow:hidden;color:#f4f7fb;font-size:9px;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase;letter-spacing:.08em}
      .head-action{display:grid;place-items:center;width:24px;height:24px;padding:0;color:#92a2b7;background:#182436;border:1px solid #34475f;border-radius:6px;cursor:pointer}
      .head-action:hover{color:#fff;border-color:#6c568e}
      .head-action svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .module-stage{min-height:0;padding:8px;overflow:hidden}
      .module-pane{display:grid;align-content:start;gap:8px;height:100%;min-height:0;overflow:hidden}
      .identity-row{display:flex;align-items:center;gap:5px;min-width:0;height:22px;padding:0 2px}
      .identity-row>strong{min-width:0;flex:1;overflow:hidden;color:#f6f9fc;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      .health-dot{width:7px;height:7px;border-radius:50%;background:#6990b2;box-shadow:0 0 0 2px rgba(105,144,178,.12)}
      .health-dot.severity-ok{background:#57d792;box-shadow:0 0 0 2px rgba(87,215,146,.13)}
      .health-dot.severity-warning{background:#f2c15b;box-shadow:0 0 0 2px rgba(242,193,91,.13)}
      .health-dot.severity-critical{background:#f16d78;box-shadow:0 0 0 2px rgba(241,109,120,.14)}
      .copy-value{display:flex;align-items:center;gap:3px;max-width:100px;height:20px;padding:0 4px;color:#aabbd0;background:#142033;border:1px solid #30445d;border-radius:5px;font-size:8px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .copy-value svg,.metric-copy svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.8}
      .identity-ip{font-size:8px}.muted{color:#728298}
      .category-chip{justify-self:start;padding:2px 5px;color:#bda9e7;background:#211a34;border:1px solid #4d3b6e;border-radius:999px;font-size:7px}
      .active-task{display:grid;gap:4px;min-height:64px;padding:6px;background:#111d2b;border:1px solid #31435b;border-left:2px solid #6b88aa;border-radius:7px;overflow:hidden}
      .active-task.severity-ok{border-left-color:#59d794;background:#10251e}.active-task.severity-warning{border-left-color:#f0bf58;background:#282211}.active-task.severity-critical{border-left-color:#ef6c78;background:#2a161b}
      .task-heading{display:flex;align-items:center;gap:4px;color:#8293a9;font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      .task-heading span{flex:1}.help{position:relative;display:grid;place-items:center;width:15px;height:15px;padding:0;color:#9fb0c5;background:#172437;border:1px solid #384b63;border-radius:50%;font-size:9px;cursor:help}
      [data-tip]{position:relative}
      [data-tip]:hover::after{content:attr(data-tip);position:absolute;right:0;bottom:calc(100% + 5px);z-index:20;width:200px;padding:5px 6px;color:#edf3fa;background:#0a111b;border:1px solid #41536a;border-radius:5px;box-shadow:0 6px 18px rgba(0,0,0,.38);font:8px/1.35 "Segoe UI",Arial,sans-serif;white-space:normal;text-transform:none;letter-spacing:0;pointer-events:none}
      .active-task>strong{display:block;overflow:hidden;color:#fff;font-size:10px;line-height:1.2;white-space:nowrap;text-overflow:ellipsis}
      .task-actions{display:flex;align-items:center;gap:3px;min-width:0;flex-wrap:wrap}
      .action-btn,.wide-action{display:flex;align-items:center;justify-content:center;gap:3px;min-width:0;height:22px;padding:0 5px;color:#b9c7d7;background:#172437;border:1px solid #394d65;border-radius:5px;font-size:7px;font-weight:700;cursor:pointer;white-space:nowrap}
      .action-btn.primary,.wide-action{color:#07130d;background:#5ad895;border-color:#5ad895}.action-btn:hover,.wide-action:hover{filter:brightness(1.08)}
      .action-btn svg,.wide-action svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
      .mini-steps{display:grid;gap:2px;min-height:0;overflow:hidden}
      .mini-step{display:grid;grid-template-columns:15px 60px minmax(0,1fr);align-items:center;gap:3px;min-height:20px;padding:2px 3px;border-bottom:1px solid #223146;font-size:7px}
      .mini-step>span{display:grid;place-items:center;width:14px;height:14px;color:#8fa1b6;background:#172235;border:1px solid #31445c;border-radius:5px;font-weight:800}.mini-step.done>span{color:#06150e;background:#59d795;border-color:#59d795}.mini-step.attention>span{color:#201600;background:#f0be59;border-color:#f0be59}
      .mini-step strong{color:#dfe7f1;font-size:8px}.mini-step small{display:block;overflow:hidden;color:#8494a8;text-overflow:ellipsis;white-space:nowrap}
      .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;min-height:0}
      .metric-card{position:relative;display:grid;gap:2px;min-width:0;min-height:42px;padding:5px;background:#111d2b;border:1px solid #2d4057;border-radius:6px;overflow:hidden}.metric-card>span{color:#7f91a7;font-size:7px;font-weight:800;text-transform:uppercase}.metric-card>strong{overflow:hidden;color:#eaf0f7;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.metric-card.tone-ok{border-color:#276446}.metric-card.tone-warn{border-color:#6f5b2f}.metric-card.tone-danger{border-color:#71343e}.metric-card.tone-info{border-color:#4d3d72}
      .metric-copy{position:absolute;right:4px;bottom:4px;display:grid;place-items:center;width:18px;height:18px;padding:0;color:#8699af;background:#172438;border:1px solid #344961;border-radius:4px;cursor:pointer}
      .wide-action{width:100%;margin-top:auto}
      .flyout-nav{display:grid;gap:3px;padding:4px 2px}.flyout-nav-btn{display:flex;align-items:center;gap:4px;min-height:28px;padding:4px 6px;text-align:left;color:#cbd6e2;background:#111d2b;border:1px solid #2d4057;border-radius:6px;cursor:pointer}.flyout-nav-btn:hover{color:#fff;background:#211a34;border-color:#674f8b}.flyout-nav-btn strong{font-size:8px;font-weight:600}
      .flyout-module{display:grid!important;grid-template-rows:auto auto minmax(0,1fr) auto!important;gap:4px!important;height:100%!important;overflow:hidden!important}
      .flyout-module-header{display:flex;align-items:center;gap:6px;min-width:0;height:28px;padding:0 4px;border-bottom:1px solid #233248;background:#101a28}
      .flyout-module-header>strong{min-width:0;flex:1;overflow:hidden;color:#f4f7fb;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
      .back-btn{display:grid;place-items:center;width:24px;height:24px;padding:0;color:#92a2b7;background:#182436;border:1px solid #34475f;border-radius:6px;cursor:pointer}.back-btn:hover{color:#fff;border-color:#6c568e}.back-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8}
      .flyout-status-bar{display:flex;align-items:center;gap:6px;min-height:22px;padding:3px 4px;color:#7e8fa4;background:#0d1622;border:1px solid #233248;border-radius:5px;font-size:7px}
      .status-dot{width:6px;height:6px;border-radius:50%;background:#6990b2}.status-dot.ok{background:#57d792}.status-dot.warn{background:#f2c15b}.status-dot.muted{background:#3a4a5e}
      .mini-refresh{display:grid;place-items:center;width:18px;height:18px;padding:0;color:#8699af;background:#172438;border:1px solid #344961;border-radius:4px;cursor:pointer;margin-left:auto}.mini-refresh:hover{color:#fff}.mini-refresh svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:1.8}
      .flyout-data-card{display:grid;gap:4px;min-height:0;padding:6px;background:#111d2b;border:1px solid #2d4057;border-radius:6px;overflow:hidden}
      .data-row{display:flex;align-items:center;gap:6px;min-height:20px;font-size:8px}.data-row>span{color:#7f91a7;min-width:90px}.data-row>strong{color:#eaf0f7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mentor-compact{display:grid;gap:3px;min-height:0;padding:6px;background:#1a1228;border:1px solid #4d3b6e;border-left:2px solid #8f65e8;border-radius:6px;overflow:hidden}
      .mentor-title{display:flex;align-items:center;gap:4px;color:#bda9e7;font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.mentor-title svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8}
      .mentor-compact>p{color:#a8b7c8;font-size:8px;line-height:1.3;margin:0}
      .flyout-footer{display:flex;align-items:center;gap:4px;min-height:28px;padding:4px;border-top:1px solid #233248;background:#0d1622}
      .footer-btn{display:flex;align-items:center;gap:3px;min-height:24px;padding:0 6px;color:#b9c7d7;background:#172437;border:1px solid #394d65;border-radius:5px;font-size:7px;font-weight:700;cursor:pointer}.footer-btn:hover{filter:brightness(1.08)}.footer-btn svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:1.8}
      .flyout-history-list{display:grid;gap:3px;min-height:0;overflow-y:auto;padding:4px}
      .history-item{display:grid;gap:2px;min-height:24px;padding:4px 6px;background:#111d2b;border:1px solid #2d4057;border-radius:5px;font-size:8px}.history-item>span{color:#eaf0f7}.history-item>small{color:#7e8fa4}
      .placeholder-text{color:#5a6a7e;font-size:8px;line-height:1.4;margin:8px 0;text-align:center}
      .module-intro{display:grid;gap:1px;padding:0 2px}.module-intro strong{color:#edf3fa;font-size:9px}.module-intro span{color:#7e8fa4;font-size:7px}
      .script-list{display:grid;gap:4px;min-height:0;overflow:hidden}.script-btn{display:grid;gap:2px;min-height:36px;padding:5px 6px;text-align:left;color:#dbe5ef;background:#111d2b;border:1px solid #2d4057;border-radius:6px;cursor:pointer;overflow:hidden}.script-btn:hover{border-color:#6b538f;background:#171d30}.script-btn strong{font-size:8px}.script-btn span{display:-webkit-box;overflow:hidden;color:#8798ad;font-size:7px;line-height:1.3;-webkit-box-orient:vertical;-webkit-line-clamp:1}
      .category-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;min-height:0}.category-btn{display:flex;align-items:center;gap:4px;min-height:34px;padding:4px 5px;text-align:left;color:#cbd6e2;background:#111d2b;border:1px solid #2d4057;border-radius:6px;cursor:pointer}.category-btn:hover,.category-btn.selected{color:#fff;background:#211a34;border-color:#674f8b}.category-btn span{display:grid;place-items:center;width:14px;height:14px;color:#08140e;background:#5bd895;border-radius:4px;font-size:8px}.category-btn strong{font-size:8px}
      .dock-footer{display:flex;align-items:center;gap:3px;min-width:0;padding:3px 5px;background:#0a121c;border-top:1px solid #223146;overflow:hidden}
      .footer-chip{display:flex;align-items:center;gap:2px;min-width:0;max-width:33%;height:19px;padding:0 4px;color:#a8b7c8;background:#121e2d;border:1px solid #2e4157;border-radius:5px;font-size:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.footer-chip b{color:#73859b}.footer-chip.tone-ok{border-color:#286347}.footer-chip.tone-warn{border-color:#6c582e}.footer-chip.tone-danger{border-color:#71323c}
      .dock-error{position:fixed;right:${RAIL_WIDTH + 8}px;bottom:10px;z-index:30;width:240px;padding:8px;color:#ffdce0;background:#311820;border:1px solid #743542;border-radius:8px;box-shadow:0 10px 28px rgba(0,0,0,.36);font-size:9px;line-height:1.35}
      @media(max-height:650px){.module-stage{padding:4px}.module-pane{gap:4px}.active-task{min-height:56px;padding:5px}.mini-step{min-height:18px}.metric-card{min-height:38px}.script-btn{min-height:32px}.category-btn{min-height:30px}}
    </style>
    <div class="dock">
      <aside class="flyout" aria-live="polite">
        <header class="flyout-head"><span class="brand"></span><strong id="dockModuleTitle">Active Case</strong><button type="button" class="head-action" data-open-native title="Открыть полный режим">${svg("expand")}</button><button type="button" class="head-action" data-close-dock title="Свернуть">${svg("close")}</button></header>
        <div class="module-stage"></div>
        <footer class="dock-footer"></footer>
      </aside>
      <nav class="rail" aria-label="Workbench Hover Dock">${MODULES.map(module => `<button type="button" class="rail-button" data-module="${module.id}" aria-label="${module.label}" aria-expanded="false">${svg(module.icon)}<span class="label">${module.label}</span></button>`).join("")}<span class="rail-spacer"></span></nav>
      <div class="dock-error" hidden></div>
    </div>`;

    root.addEventListener("pointerenter", clearCloseTimer, true);
    root.addEventListener("pointerleave", scheduleClose, true);
    root.addEventListener("pointerenter", event => {
      const button = event.target.closest?.(".rail-button[data-module]");
      if (button) openDock(button.dataset.module);
    }, true);

    root.addEventListener("click", event => {
      const moduleButton = event.target.closest(".rail-button[data-module]");
      if (moduleButton) {
        event.preventDefault();
        event.stopPropagation();
        const same = state.activeModule === moduleButton.dataset.module && state.open;
        state.pinned = same ? !state.pinned : true;
        openDock(moduleButton.dataset.module, state.pinned);
        return;
      }

      if (event.target.closest("[data-close-dock]")) {
        event.preventDefault();
        closeDock(true);
        return;
      }

      if (event.target.closest("[data-open-native]")) {
        event.preventDefault();
        void openNativePanel(state.activeModule === "metrics" ? "quick" : "live");
        return;
      }

      const flyoutNav = event.target.closest("[data-flyout]");
      if (flyoutNav) {
        event.preventDefault();
        renderFlyout(flyoutNav.dataset.flyout);
        return;
      }

      const backBtn = event.target.closest("[data-back-to]");
      if (backBtn) {
        event.preventDefault();
        const parentModule = backBtn.dataset.backTo;
        if (parentModule === "diagnostics") renderFlyout("metrics");
        else if (parentModule === "history") renderFlyout("history-full");
        return;
      }

      const highlight = event.target.closest("[data-highlight]");
      if (highlight) {
        event.preventDefault();
        void runCoreAction("highlight", highlight.dataset.highlight);
        return;
      }

      if (event.target.closest("[data-start-olt-route]")) {
        event.preventDefault();
        void startOltRoute();
        return;
      }

      const coreAction = event.target.closest("[data-core-action]");
      if (coreAction) {
        event.preventDefault();
        void runCoreAction(coreAction.dataset.coreAction);
        return;
      }

      const copy = event.target.closest("[data-copy-value]");
      if (copy) {
        event.preventDefault();
        void copyValue(copy.dataset.copyValue, copy.dataset.copyId);
        return;
      }

      const category = event.target.closest("[data-category]");
      if (category) {
        event.preventDefault();
        void setCategory(category.dataset.category);
      }

      const openSource = event.target.closest("[data-open-source]");
      if (openSource) {
        event.preventDefault();
        void openNativePanel("live");
        return;
      }

      const showRaw = event.target.closest("[data-show-raw]");
      if (showRaw) {
        event.preventDefault();
        showError("RAW данные доступны в полной панели");
        void openNativePanel("live");
      }
    });

    (document.body || document.documentElement).appendChild(host);
    state.host = host;
    state.root = root;
    render();
    applyPageSpacing();
  }

  async function install() {
    await loadCategories();
    installDock();
    hideLegacyRuntime();

    if (core?.subscribe) {
      state.unsubscribe = core.subscribe(snapshot => {
        state.snapshot = snapshot || null;
        render();
      });
    }

    state.observer = new MutationObserver(() => {
      hideLegacyRuntime();
      ensurePageStyle();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("resize", applyPageSpacing);
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.open) closeDock(true);
    }, true);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== PANEL_VISIBILITY) return false;
    setVisible(message.visible);
    return false;
  });

  globalThis.__SIMNET_SIDE_PANEL_LAUNCHER__ = {
    version: "0.5.0",
    open: moduleId => openDock(moduleId || "active", true),
    close: () => closeDock(true),
    setRailVisible: setVisible,
    render
  };

  window.addEventListener("pagehide", () => {
    state.observer?.disconnect();
    state.unsubscribe?.();
    clearCloseTimer();
    window.clearTimeout(state.errorTimer);
    document.documentElement.classList.remove("simnet-wb-dock-reserved");
    document.documentElement.style.removeProperty("--simnet-wb-dock-reserve");
  }, { once: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else void install();
})();
