"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_SHELL__) return;

  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!core?.getState || !core?.subscribe) return;

  const HOST_ID = "simnet-mentor-shell";
  const PANEL_SELECTOR = "#dp-panel";
  const SETTINGS_KEY = "simnet_mentor_shell_v4";
  const RAIL_WIDTH = 48;
  const ANCHOR_WIDTH = 280;
  const EXPANDED_WIDTH = ANCHOR_WIDTH + RAIL_WIDTH;
  const FLYOUT_WIDTH = 520;

  const state = {
    collapsed: false,
    flyout: "",
    host: null,
    root: null,
    panel: null,
    snapshot: core.getState(),
    basePaddingRight: "0px",
    unsubscribe: null
  };

  const icons = {
    brand: "M5 5h14v14H5zM8 9h8M8 13h5M8 17h7",
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    collapse: "M9 5l7 7-7 7",
    close: "M6 6l12 12M18 6 6 18",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-4 3-6 7-6s7 2 7 6",
    arrow: "M9 18l6-6-6-6",
    check: "M5 12l4 4L19 6",
    play: "M8 5v14l11-7z",
    stop: "M7 7h10v10H7z"
  };

  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.brand}"></path></svg>`;
  const safeText = (value, max = 180) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  function loadSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get({ [SETTINGS_KEY]: { collapsed: false } }, result => {
          state.collapsed = Boolean(result?.[SETTINGS_KEY]?.collapsed);
          resolve();
        });
      } catch (_) { resolve(); }
    });
  }

  function saveSettings() {
    try { chrome.storage.local.set({ [SETTINGS_KEY]: { collapsed: state.collapsed } }); } catch (_) {}
  }

  function markup() {
    return `
      <div class="shell">
        <aside class="anchor">
          <header class="subscriber-head">
            <span class="avatar">${svg("user")}</span>
            <div class="subscriber-copy"><strong data-title>Ожидаю карточку</strong><span data-meta>Контекст ядра не получен</span></div>
          </header>
          <div class="chips">
            <button class="chip skeleton" data-copy="contract"></button>
            <button class="chip skeleton" data-copy="ip"></button>
            <button class="chip skeleton" data-copy="mac"></button>
          </div>
          <section class="session-card">
            <div class="section-label">Статус операции</div>
            <div class="session-row"><span class="session-dot"></span><strong data-stage>Готов к работе</strong></div>
            <small data-status>Ожидаю действие оператора</small>
          </section>
          <section class="mentor-card emphasis">
            <div class="section-label">Что важно сейчас</div>
            <strong data-mentor-title>Открой карточку абонента</strong>
            <p data-mentor-text>Интерфейс ждёт подтверждённый контекст от рабочего ядра.</p>
          </section>
          <section class="mentor-card next-step">
            <div class="section-label">Следующая проверка</div>
            <button type="button" data-action="quick-inline"><span>${svg("quick")}</span><span><b>Быстрый разбор</b><small>Диагностика через API ядра</small></span>${svg("arrow")}</button>
          </section>
          <div class="facts"><span>${svg("check")} Один источник контекста</span><span>${svg("check")} UI не анализирует страницу</span><span>${svg("check")} Решение остаётся за оператором</span></div>
        </aside>
        <nav class="rail">
          <button class="brand" data-action="collapse">${svg("brand")}<span class="tip">Workbench</span></button>
          <button class="active" data-action="mentor">${svg("mentor")}<span class="tip">Помощник-наставник</span></button>
          <button data-action="quick">${svg("quick")}<span class="tip">Быстрая диагностика</span></button>
          <button class="rail-bottom" data-action="collapse">${svg("collapse")}<span class="tip">Свернуть</span></button>
        </nav>
        <section class="flyout"><header class="flyout-head"><strong>Быстрая диагностика</strong><button data-action="close-flyout">${svg("close")}</button></header><div class="flyout-body" data-flyout-body></div></section>
        <div class="legacy-runtime" aria-hidden="true"><slot name="workbench"></slot></div>
      </div>`;
  }

  function css() {
    return `
      :host{all:initial;position:fixed;z-index:2147483647;top:0;right:0;bottom:0;width:${EXPANDED_WIDTH}px;height:100vh;color:#e7edf7;font:12px/1.4 "Segoe UI",Arial,sans-serif;transition:width .16s ease}:host([data-collapsed="true"]){width:${RAIL_WIDTH}px}
      *,*::before,*::after{box-sizing:border-box}button{font:inherit}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .shell{position:relative;display:grid;grid-template-columns:${ANCHOR_WIDTH}px ${RAIL_WIDTH}px;width:100%;height:100%;background:#0d141f;border-left:1px solid #273244}:host([data-collapsed="true"]) .shell{grid-template-columns:${RAIL_WIDTH}px}:host([data-collapsed="true"]) .anchor{display:none}:host([data-collapsed="true"]) .rail{grid-column:1}
      .anchor{grid-column:1;display:flex;flex-direction:column;gap:10px;padding:12px;background:#101823;overflow:hidden}.rail{grid-column:2;display:flex;flex-direction:column;align-items:center;gap:7px;padding:8px 5px;background:#0a1019;border-left:1px solid #202b3a}.rail button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8f9caf;background:transparent;border:0;border-radius:9px;cursor:pointer}.rail button:hover,.rail button.active{color:#fff;background:#1b2737}.rail .brand{color:#d8e2f0;background:#172131}.rail-bottom{margin-top:auto!important}.tip{position:absolute;right:46px;top:50%;padding:5px 7px;color:#fff;background:#101827;border:1px solid #344155;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap}.rail button:hover .tip{opacity:1;visibility:visible}
      .subscriber-head{display:flex;align-items:center;gap:9px;min-height:42px}.avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;background:#1c2735;border:1px solid #324055;border-radius:50%}.subscriber-copy{display:grid;gap:2px;min-width:0}.subscriber-copy strong,.subscriber-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subscriber-copy span{color:#8f9caf;font-size:10px}.chips{display:flex;gap:5px;min-height:25px;overflow:hidden}.chip{height:24px;padding:0 7px;color:#cbd6e5;background:#182332;border:1px solid #2b394c;border-radius:7px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chip.skeleton{width:72px;background:linear-gradient(90deg,#182332 20%,#243246 50%,#182332 80%);background-size:200% 100%;animation:shimmer 1.2s infinite}
      .session-card,.mentor-card{padding:10px;background:#151f2c;border:1px solid #2a3748;border-radius:9px}.section-label{margin-bottom:7px;color:#7f8da2;font-size:9px;text-transform:uppercase}.session-row{display:flex;align-items:center;gap:7px}.session-dot{width:8px;height:8px;background:#6c7b8f;border-radius:50%}.session-card small{display:block;margin-top:4px;color:#7f8da2;font-size:9px}.mentor-card strong{display:block;margin-bottom:5px}.mentor-card p{margin:0;color:#aeb9c9;font-size:10px}.emphasis{border-color:#5b477e;background:#1d1830}.next-step{padding:0;overflow:hidden;border-color:#274a70;background:#11233a}.next-step .section-label{padding:9px 10px 0;color:#6ea8e8}.next-step button{display:grid;grid-template-columns:28px 1fr 18px;align-items:center;gap:7px;width:100%;padding:8px 10px 10px;color:#e5edf8;text-align:left;background:transparent;border:0;cursor:pointer}.next-step small{display:block;color:#7f91a8;font-size:9px}.facts{display:grid;gap:5px;margin-top:auto;color:#8896aa;font-size:9px}.facts span{display:flex;align-items:center;gap:6px}.facts svg{width:12px;height:12px;color:#56c98a}
      .flyout{position:absolute;top:0;right:${EXPANDED_WIDTH}px;display:grid;grid-template-rows:44px 1fr;width:min(${FLYOUT_WIDTH}px,calc(100vw - ${EXPANDED_WIDTH}px));height:100vh;background:#0e1621;border:1px solid #283548;opacity:0;visibility:hidden;transform:translateX(18px);transition:.16s}.flyout[data-open="true"]{opacity:1;visibility:visible;transform:none}.flyout-head{display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#121c28;border-bottom:1px solid #283548}.flyout-head button{display:grid;place-items:center;width:30px;height:30px;color:#9aa8ba;background:transparent;border:0}.flyout-body{overflow:auto;padding:12px}.module-intro{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.primary-action,.secondary-action{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px;border-radius:7px;cursor:pointer}.primary-action{color:#06140d;background:#55d88a;border:0;font-weight:700}.secondary-action{color:#c7d2e1;background:#182332;border:1px solid #2e3c50}.status-strip,.summary-card,.result-card{margin-bottom:8px;padding:10px;background:#151f2c;border:1px solid #2b394b;border-radius:8px}.status-strip{display:flex;align-items:center;gap:8px}.status-strip span{width:8px;height:8px;border-radius:50%;background:#6f7e91}.status-strip.running span{background:#58a6ff}.summary-card p{margin:4px 0 0;color:#9aa8ba;font-size:10px}.result-grid{display:grid;gap:7px}.result-card span{color:#8f9daf;font-size:10px}.empty-state{display:grid;place-items:center;min-height:180px;color:#738196;text-align:center}.legacy-runtime{position:fixed!important;left:-100000px!important;top:-100000px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;clip-path:inset(100%)!important}::slotted(#dp-panel){position:relative!important;display:block!important;width:520px!important;height:800px!important}
      @keyframes shimmer{to{background-position:-200% 0}}
    `;
  }

  function reservePage() {
    if (!document.body) return;
    const width = state.collapsed ? RAIL_WIDTH : EXPANDED_WIDTH;
    document.body.style.setProperty("padding-right", `calc(${state.basePaddingRight} + ${width}px)`, "important");
    document.body.style.setProperty("box-sizing", "border-box", "important");
  }

  function patchPanel() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel || !state.host) return;
    state.panel = panel;
    panel.slot = "workbench";
    panel.dataset.mentorShell = "hidden-runtime";
    if (panel.parentElement !== state.host) state.host.appendChild(panel);
  }

  function stageLabel(stage) {
    return ({ billing: "Сбор Billing", userside: "Сбор UserSide", onu: "Опрос ONU / OLT", analysis: "Анализ", collecting: "Сбор данных", done: "Завершено", idle: "Готов к запуску" })[stage] || "Готов к запуску";
  }

  function summary(snapshot) {
    if (snapshot.status.running) return { title: "Диагностика выполняется", text: "Ядро собирает и сопоставляет данные." };
    const joined = snapshot.facts.join(" ").toLowerCase();
    if (/сесси.{0,30}(нет|отсутств|не найден)/.test(joined)) return { title: "Сессия не подтверждена", text: "Проверь авторизацию и соответствие технических данных." };
    if (/onu.{0,30}(offline|down|не доступ|не найден)/.test(joined)) return { title: "ONU требует проверки", text: "Подтверди состояние линии и актуальность привязки." };
    if (snapshot.facts.length) return { title: "Данные собраны", text: "Проверь ключевые факты и расхождения." };
    return { title: snapshot.context?.contract ? "Готов к запуску" : "Нет контекста абонента", text: snapshot.context?.contract ? "Запусти быстрый разбор." : "Открой карточку Billing или UserSide." };
  }

  function render() {
    if (!state.root) return;
    const snapshot = state.snapshot || core.getState();
    const context = snapshot.context || {};
    state.root.querySelector("[data-title]").textContent = context.fullName || context.login || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");
    state.root.querySelector("[data-meta]").textContent = context.address || (context.system === "userside" ? "UserSide" : context.system === "billing" ? "Billing" : "Контекст ядра не получен");
    const values = { contract: context.contract ? `№ ${context.contract}` : "", ip: context.ip || "", mac: context.mac || "" };
    for (const [key, value] of Object.entries(values)) {
      const chip = state.root.querySelector(`[data-copy="${key}"]`);
      chip.textContent = value;
      chip.dataset.value = value;
      chip.classList.toggle("skeleton", !value);
    }
    state.root.querySelector("[data-stage]").textContent = stageLabel(snapshot.status?.stage);
    state.root.querySelector("[data-status]").textContent = snapshot.status?.text || "Ожидаю действие оператора";
    state.root.querySelector(".session-dot").style.background = snapshot.status?.running ? "#58a6ff" : "#6c7b8f";
    if (state.flyout) renderFlyout();
  }

  function renderFlyout() {
    const snapshot = state.snapshot || core.getState();
    const context = snapshot.context || {};
    const result = summary(snapshot);
    const body = state.root.querySelector("[data-flyout-body]");
    body.innerHTML = `<div class="module-intro"><div><strong>Быстрая диагностика</strong><p>Данные и команды рабочего ядра</p></div><div><button class="primary-action" data-action="run-diagnostic" ${snapshot.status.running || !context.contract ? "disabled" : ""}>${svg("play")} ${snapshot.status.running ? "Выполняется" : "Запустить"}</button>${snapshot.status.running ? `<button class="secondary-action" data-action="stop-diagnostic">${svg("stop")} Стоп</button>` : ""}</div></div><div class="status-strip ${snapshot.status.running ? "running" : ""}"><span></span><b>${stageLabel(snapshot.status.stage)}</b></div><div class="summary-card"><b>${result.title}</b><p>${result.text}</p></div><div class="result-grid">${snapshot.facts.length ? snapshot.facts.map(fact => `<div class="result-card"><b>Факт</b><span>${safeText(fact, 260)}</span></div>`).join("") : `<div class="empty-state">Результаты появятся после запуска диагностики.</div>`}</div>`;
  }

  function setCollapsed(value) {
    state.collapsed = Boolean(value);
    if (state.collapsed) closeFlyout();
    state.host.dataset.collapsed = String(state.collapsed);
    reservePage();
    saveSettings();
  }

  function openFlyout() {
    state.flyout = "quick";
    setCollapsed(false);
    state.root.querySelector(".flyout").dataset.open = "true";
    renderFlyout();
  }

  function closeFlyout() {
    state.flyout = "";
    state.root.querySelector(".flyout").dataset.open = "false";
  }

  async function handleClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.copy) {
      const value = safeText(button.dataset.value).replace(/^№\s*/, "");
      if (value) try { await navigator.clipboard.writeText(value); } catch (_) {}
      return;
    }
    const action = button.dataset.action;
    if (action === "collapse") setCollapsed(!state.collapsed);
    if (action === "mentor") { closeFlyout(); setCollapsed(false); }
    if (action === "quick" || action === "quick-inline") openFlyout();
    if (action === "close-flyout") closeFlyout();
    if (action === "run-diagnostic") core.runDiagnostic();
    if (action === "stop-diagnostic") core.stopDiagnostic();
  }

  async function install() {
    await loadSettings();
    if (document.body) state.basePaddingRight = getComputedStyle(document.body).paddingRight || "0px";
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.collapsed = String(state.collapsed);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${css()}</style>${markup()}`;
    root.addEventListener("click", handleClick);
    (document.body || document.documentElement).appendChild(host);
    state.host = host;
    state.root = root;
    reservePage();
    patchPanel();
    state.unsubscribe = core.subscribe(snapshot => { state.snapshot = snapshot; render(); });
    const timer = setInterval(() => { patchPanel(); if (state.panel) clearInterval(timer); }, 250);
    render();
  }

  globalThis.__SIMNET_MENTOR_SHELL__ = { version: "0.4.0", openDiagnostics: openFlyout, closeFlyout, collapse: () => setCollapsed(true), expand: () => setCollapsed(false) };
  window.addEventListener("keydown", event => { if (event.key === "Escape") state.flyout ? closeFlyout() : setCollapsed(true); }, true);
  window.addEventListener("pagehide", () => state.unsubscribe?.());
  install();
})();
