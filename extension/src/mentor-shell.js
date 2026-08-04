"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_SHELL__) return;

  const HOST_ID = "simnet-mentor-shell";
  const PANEL_SELECTOR = "#dp-panel";
  const SETTINGS_KEY = "simnet_mentor_shell_v2";
  const RAIL_WIDTH = 48;
  const ANCHOR_WIDTH = 280;
  const EXPANDED_WIDTH = ANCHOR_WIDTH + RAIL_WIDTH;
  const FLYOUT_WIDTH = 520;

  const state = {
    collapsed: false,
    flyout: "",
    panel: null,
    host: null,
    root: null,
    basePaddingRight: "0px",
    observer: null,
    renderTimer: 0
  };

  const icons = {
    brand: "M5 5h14v14H5zM8 9h8M8 13h5M8 17h7",
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
    collapse: "M9 5l7 7-7 7",
    close: "M6 6l12 12M18 6 6 18",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-4 3-6 7-6s7 2 7 6",
    arrow: "M9 18l6-6-6-6",
    check: "M5 12l4 4L19 6",
    play: "M8 5v14l11-7z",
    stop: "M7 7h10v10H7z",
    refresh: "M20 11a8 8 0 1 0-2 5.5M20 4v7h-7",
    copy: "M9 9h10v10H9zM5 5h10v4M5 5v10h4"
  };

  function svg(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.brand}"></path></svg>`;
  }

  function safeText(value, max = 160) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

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

  function shellMarkup() {
    return `
      <div class="shell">
        <aside class="anchor" aria-label="Помощник-наставник">
          <header class="subscriber-head">
            <span class="avatar">${svg("user")}</span>
            <div class="subscriber-copy">
              <strong data-context-title>Ожидаю карточку</strong>
              <span data-context-meta>Контекст определится автоматически</span>
            </div>
          </header>

          <div class="chips">
            <button class="chip skeleton" data-copy="contract" title="Скопировать договор"></button>
            <button class="chip skeleton" data-copy="ip" title="Скопировать IP"></button>
            <button class="chip skeleton" data-copy="mac" title="Скопировать MAC"></button>
          </div>

          <section class="session-card">
            <div class="section-label">Статус операции</div>
            <div class="session-row"><span class="session-dot"></span><strong data-session-status>Готов к работе</strong></div>
            <small data-session-meta>Ожидаю действие оператора</small>
          </section>

          <section class="mentor-card emphasis">
            <div class="section-label">Что важно сейчас</div>
            <strong data-mentor-title>Открой карточку абонента</strong>
            <p data-mentor-text>Помощник покажет одну актуальную подсказку по текущему контексту.</p>
          </section>

          <section class="mentor-card next-step">
            <div class="section-label">Следующая проверка</div>
            <button type="button" data-action="quick-inline">
              <span>${svg("quick")}</span>
              <span><b>Быстрый разбор</b><small>Новый компактный интерфейс</small></span>
              ${svg("arrow")}
            </button>
          </section>

          <div class="facts">
            <span>${svg("check")} Контекст страницы</span>
            <span>${svg("check")} Подсказки по ходу работы</span>
            <span>${svg("check")} Решение остаётся за оператором</span>
          </div>
        </aside>

        <nav class="rail" aria-label="Workbench">
          <button class="brand" data-action="collapse">${svg("brand")}<span class="tip">Workbench</span></button>
          <button class="active" data-action="mentor">${svg("mentor")}<span class="tip">Помощник-наставник</span></button>
          <button data-action="quick">${svg("quick")}<span class="tip">Быстрая диагностика</span></button>
          <button data-action="history">${svg("history")}<span class="tip">История абонента</span></button>
          <button data-action="more">${svg("more")}<span class="tip">Дополнительно</span></button>
          <button class="rail-bottom" data-action="collapse">${svg("collapse")}<span class="tip">Свернуть</span></button>
        </nav>

        <section class="flyout" aria-label="Расширенный модуль">
          <header class="flyout-head">
            <strong data-flyout-title>Модуль</strong>
            <button type="button" data-action="close-flyout">${svg("close")}</button>
          </header>
          <div class="flyout-body" data-flyout-body></div>
        </section>

        <div class="legacy-runtime" aria-hidden="true"><slot name="workbench"></slot></div>
      </div>`;
  }

  function shellCss() {
    return `
      :host{all:initial;position:fixed;z-index:2147483647;top:0;right:0;bottom:0;width:${EXPANDED_WIDTH}px;height:100vh;color:#e7edf7;font:12px/1.4 "Segoe UI",Arial,sans-serif;transition:width .16s ease}
      :host([data-collapsed="true"]){width:${RAIL_WIDTH}px}
      *,*::before,*::after{box-sizing:border-box}
      button{font:inherit}
      svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .shell{position:relative;display:grid;grid-template-columns:${ANCHOR_WIDTH}px ${RAIL_WIDTH}px;width:100%;height:100%;background:#0d141f;border-left:1px solid #273244}
      :host([data-collapsed="true"]) .shell{grid-template-columns:${RAIL_WIDTH}px}
      :host([data-collapsed="true"]) .anchor{display:none}
      :host([data-collapsed="true"]) .rail{grid-column:1}
      .anchor{grid-column:1;display:flex;flex-direction:column;gap:10px;min-width:0;height:100%;padding:12px;background:#101823;overflow:hidden}
      .rail{grid-column:2;display:flex;flex-direction:column;align-items:center;gap:7px;padding:8px 5px;background:#0a1019;border-left:1px solid #202b3a}
      .rail button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8f9caf;background:transparent;border:0;border-radius:9px;cursor:pointer}
      .rail button:hover,.rail button:focus-visible{color:#fff;background:#1b2737;outline:none}.rail button.active{color:#c9a8ff;background:#2c2143}.rail .brand{color:#d8e2f0;background:#172131}.rail-bottom{margin-top:auto!important}
      .tip{position:absolute;right:46px;top:50%;z-index:5;padding:5px 7px;color:#fff;background:#101827;border:1px solid #344155;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;pointer-events:none}.rail button:hover .tip{opacity:1;visibility:visible}
      .subscriber-head{display:flex;align-items:center;gap:9px;min-height:42px}.avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;color:#dbe6f5;background:#1c2735;border:1px solid #324055;border-radius:50%}.subscriber-copy{display:grid;gap:2px;min-width:0}.subscriber-copy strong,.subscriber-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subscriber-copy span{color:#8f9caf;font-size:10px}
      .chips{display:flex;gap:5px;min-height:25px;overflow:hidden}.chip{display:inline-flex;align-items:center;min-width:0;height:24px;padding:0 7px;color:#cbd6e5;background:#182332;border:1px solid #2b394c;border-radius:7px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.chip.skeleton{width:72px;background:linear-gradient(90deg,#182332 20%,#243246 50%,#182332 80%);background-size:200% 100%;animation:shimmer 1.2s infinite}
      .session-card,.mentor-card{padding:10px;background:#151f2c;border:1px solid #2a3748;border-radius:9px}.section-label{margin-bottom:7px;color:#7f8da2;font-size:9px;text-transform:uppercase;letter-spacing:.06em}.session-row{display:flex;align-items:center;gap:7px}.session-dot{width:8px;height:8px;background:#6c7b8f;border-radius:50%}.session-card small{display:block;margin-top:4px;color:#7f8da2;font-size:9px}.mentor-card strong{display:block;margin-bottom:5px;color:#f1f5fb;font-size:12px}.mentor-card p{margin:0;color:#aeb9c9;font-size:10px;line-height:1.45}.mentor-card.emphasis{border-color:#5b477e;background:#1d1830}.mentor-card.emphasis .section-label{color:#b99bea}
      .next-step{padding:0;overflow:hidden;border-color:#274a70;background:#11233a}.next-step .section-label{padding:9px 10px 0;color:#6ea8e8}.next-step button{display:grid;grid-template-columns:28px 1fr 18px;align-items:center;gap:7px;width:100%;padding:8px 10px 10px;color:#e5edf8;text-align:left;background:transparent;border:0;cursor:pointer}.next-step button:hover{background:#172d49}.next-step button>span:first-child{display:grid;place-items:center;color:#63d68f}.next-step b,.next-step small{display:block}.next-step small{margin-top:2px;color:#7f91a8;font-size:9px}
      .facts{display:grid;gap:5px;margin-top:auto;color:#8896aa;font-size:9px}.facts span{display:flex;align-items:center;gap:6px}.facts svg{width:12px;height:12px;color:#56c98a}
      .flyout{position:absolute;top:0;right:${EXPANDED_WIDTH}px;display:grid;grid-template-rows:44px minmax(0,1fr);width:min(${FLYOUT_WIDTH}px,calc(100vw - ${EXPANDED_WIDTH}px));height:100vh;background:#0e1621;border-left:1px solid #283548;border-right:1px solid #283548;box-shadow:-14px 0 32px rgba(0,0,0,.28);opacity:0;visibility:hidden;transform:translateX(18px);transition:opacity .16s ease,transform .16s ease,visibility .16s}.flyout[data-open="true"]{opacity:1;visibility:visible;transform:translateX(0)}
      .flyout-head{display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#121c28;border-bottom:1px solid #283548}.flyout-head button{display:grid;place-items:center;width:30px;height:30px;color:#9aa8ba;background:transparent;border:0;border-radius:6px;cursor:pointer}.flyout-head button:hover{color:#fff;background:#202d3e}.flyout-body{min-height:0;overflow:auto;padding:12px;background:#0f1722}
      .module-intro{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.module-intro p{margin:3px 0 0;color:#8391a5;font-size:10px}.primary-action,.secondary-action{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px;border-radius:7px;cursor:pointer}.primary-action{color:#06140d;background:#55d88a;border:0;font-weight:700}.secondary-action{color:#c7d2e1;background:#182332;border:1px solid #2e3c50}.primary-action:disabled,.secondary-action:disabled{opacity:.45;cursor:not-allowed}
      .status-strip{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:9px 10px;background:#151f2c;border:1px solid #2b394b;border-radius:8px}.status-strip span{width:8px;height:8px;border-radius:50%;background:#6f7e91}.status-strip.running span{background:#58a6ff;box-shadow:0 0 0 4px rgba(88,166,255,.12)}
      .result-grid{display:grid;gap:7px}.result-card{padding:9px 10px;background:#131d29;border:1px solid #293648;border-radius:8px}.result-card b{display:block;margin-bottom:3px;color:#dce5f1;font-size:10px}.result-card span{color:#8f9daf;font-size:10px}.empty-state{display:grid;place-items:center;min-height:180px;color:#738196;text-align:center}.empty-state svg{width:28px;height:28px;margin-bottom:8px}
      .legacy-runtime{position:fixed!important;left:-100000px!important;top:-100000px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;clip-path:inset(100%)!important}
      ::slotted(#dp-panel){position:relative!important;inset:auto!important;width:520px!important;min-width:520px!important;height:800px!important;max-height:none!important;display:block!important;visibility:visible!important;opacity:1!important;transform:none!important}
      @keyframes shimmer{to{background-position:-200% 0}}
    `;
  }

  function createHost() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.collapsed = String(state.collapsed);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${shellCss()}</style>${shellMarkup()}`;
    root.addEventListener("click", handleClick);
    (document.body || document.documentElement).appendChild(host);
    state.host = host;
    state.root = root;
  }

  function reservePage() {
    if (!document.body) return;
    const width = state.collapsed ? RAIL_WIDTH : EXPANDED_WIDTH;
    document.body.style.setProperty("padding-right", `calc(${state.basePaddingRight} + ${width}px)`, "important");
    document.body.style.setProperty("box-sizing", "border-box", "important");
  }

  function restorePage() {
    if (!document.body) return;
    document.body.style.removeProperty("padding-right");
    document.body.style.removeProperty("box-sizing");
  }

  function patchPanel(panel) {
    state.panel = panel;
    panel.slot = "workbench";
    panel.dataset.mentorShell = "hidden-runtime";
    if (panel.parentElement !== state.host) state.host.appendChild(panel);
  }

  function textFrom(selectors) {
    for (const selector of selectors) {
      const node = state.panel?.querySelector(selector);
      const text = safeText(node?.value || node?.textContent || "", 180);
      if (text && !/ожидани|не найдено|—$/i.test(text)) return text;
    }
    return "";
  }

  function currentContext() {
    const input = state.panel?.querySelector("#dp-input");
    const value = safeText(input?.value || "", 60);
    const contract = value.match(/\d{4,14}/)?.[0] || "";
    const status = safeText(state.panel?.querySelector("#dp-status")?.textContent || "", 140);
    return {
      contract,
      status,
      fullName: textFrom(["#dp-full-name", "[data-dp-field='fullName']", "[data-field='fio']"]),
      address: textFrom(["#dp-address", "[data-dp-field='address']", "[data-field='address']"]),
      ip: textFrom(["#dp-ip", "[data-dp-field='ip']", "[data-field='ip']"]),
      mac: textFrom(["#dp-mac", "[data-dp-field='mac']", "[data-field='mac']"])
    };
  }

  function legacyRunning() {
    const stop = state.panel?.querySelector("#dp-stop");
    return Boolean(stop && !stop.disabled);
  }

  function collectFacts() {
    const facts = [];
    const nodes = [...(state.panel?.querySelectorAll("tr,details,.dp-result-row,[data-dp-result]") || [])];
    for (const node of nodes) {
      const text = safeText(node.textContent, 220);
      if (!text || /ожидани|номер договора|рандом|пуск/i.test(text)) continue;
      if (!/(договор|адрес|mac|ip|onu|olt|сигнал|сесси|баланс|услуг|доступ)/i.test(text)) continue;
      if (!facts.includes(text)) facts.push(text);
      if (facts.length >= 8) break;
    }
    return facts;
  }

  function renderAnchor() {
    if (!state.root) return;
    const context = currentContext();
    const title = state.root.querySelector("[data-context-title]");
    const meta = state.root.querySelector("[data-context-meta]");
    title.textContent = context.fullName || (context.contract ? `abon${context.contract}` : "Ожидаю карточку");
    meta.textContent = context.address || (location.hostname.includes("userside") ? "UserSide" : "Billing");

    const chipValues = { contract: context.contract ? `№ ${context.contract}` : "", ip: context.ip, mac: context.mac };
    for (const [key, value] of Object.entries(chipValues)) {
      const chip = state.root.querySelector(`[data-copy="${key}"]`);
      chip.dataset.value = value;
      chip.textContent = value;
      chip.classList.toggle("skeleton", !value);
    }

    const statusNode = state.root.querySelector("[data-session-status]");
    const statusMeta = state.root.querySelector("[data-session-meta]");
    const running = legacyRunning();
    statusNode.textContent = running ? "Диагностика выполняется" : (context.status || "Готов к работе");
    statusMeta.textContent = running ? "Данные обновляются" : "Ожидаю действие оператора";
    state.root.querySelector(".session-dot").style.background = running ? "#58a6ff" : "#6c7b8f";

    if (state.flyout) renderFlyout();
  }

  function quickMarkup() {
    const context = currentContext();
    const facts = collectFacts();
    const running = legacyRunning();
    return `
      <div class="module-intro">
        <div><strong>Быстрая диагностика</strong><p>Новый интерфейс поверх существующего диагностического ядра</p></div>
        <button class="primary-action" data-action="run-diagnostic" ${running ? "disabled" : ""}>${svg("play")} ${running ? "Выполняется" : "Запустить"}</button>
      </div>
      <div class="status-strip ${running ? "running" : ""}"><span></span><b>${safeText(context.status || (running ? "Сбор данных" : "Готов к запуску"), 120)}</b></div>
      <div class="result-grid">
        ${facts.length ? facts.map((fact, index) => `<div class="result-card"><b>${index === 0 ? "Текущий результат" : "Факт"}</b><span>${fact}</span></div>`).join("") : `<div class="empty-state"><div>${svg("quick")}<br>Результаты появятся здесь после запуска.<br>Старая белая панель больше не показывается.</div></div>`}
      </div>`;
  }

  function historyMarkup() {
    return `<div class="module-intro"><div><strong>История абонента</strong><p>Компактное представление истории будет подключено следующим этапом</p></div><button class="secondary-action" data-action="run-history">${svg("history")} Собрать</button></div><div class="empty-state"><div>${svg("history")}<br>Сейчас запускается существующая логика истории,<br>но её старый интерфейс остаётся скрытым.</div></div>`;
  }

  function moreMarkup() {
    return `<div class="module-intro"><div><strong>Дополнительные инструменты</strong><p>Технические функции будут переноситься сюда по одной</p></div></div><div class="result-grid"><button class="secondary-action" data-action="stop-diagnostic">${svg("stop")} Остановить текущую операцию</button><button class="secondary-action" data-action="refresh-view">${svg("refresh")} Обновить представление</button></div>`;
  }

  function renderFlyout() {
    const body = state.root?.querySelector("[data-flyout-body]");
    if (!body) return;
    body.innerHTML = state.flyout === "quick" ? quickMarkup() : state.flyout === "history" ? historyMarkup() : moreMarkup();
  }

  function setCollapsed(value) {
    state.collapsed = Boolean(value);
    if (state.collapsed) closeFlyout();
    state.host.dataset.collapsed = String(state.collapsed);
    reservePage();
    saveSettings();
  }

  function openFlyout(kind, title) {
    state.flyout = kind;
    setCollapsed(false);
    const flyout = state.root.querySelector(".flyout");
    flyout.dataset.open = "true";
    state.root.querySelector("[data-flyout-title]").textContent = title;
    renderFlyout();
  }

  function closeFlyout() {
    state.flyout = "";
    const flyout = state.root?.querySelector(".flyout");
    if (flyout) flyout.dataset.open = "false";
  }

  function clickLegacy(selector) {
    const node = state.panel?.querySelector(selector);
    if (node && !node.disabled) node.click();
  }

  function clickExistingHistory() {
    const candidate = [...(state.panel?.querySelectorAll("button,a") || [])].find(node => /разобрать\s+историю|история\s+абонента/i.test(safeText(node.textContent, 80)));
    candidate?.click();
  }

  async function copyValue(button) {
    const value = safeText(button.dataset.value, 180);
    if (!value) return;
    try { await navigator.clipboard.writeText(value.replace(/^№\s*/, "")); } catch (_) {}
  }

  function handleClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.copy) { void copyValue(button); return; }
    const action = button.dataset.action;
    if (!action) return;
    if (action === "collapse") setCollapsed(!state.collapsed);
    if (action === "mentor") { closeFlyout(); setCollapsed(false); }
    if (action === "quick" || action === "quick-inline") openFlyout("quick", "Быстрая диагностика");
    if (action === "history") openFlyout("history", "История абонента");
    if (action === "more") openFlyout("more", "Дополнительные инструменты");
    if (action === "close-flyout") closeFlyout();
    if (action === "run-diagnostic") { clickLegacy("#dp-run"); renderFlyout(); }
    if (action === "stop-diagnostic") { clickLegacy("#dp-stop"); renderFlyout(); }
    if (action === "run-history") { clickExistingHistory(); renderFlyout(); }
    if (action === "refresh-view") renderAnchor();
  }

  function observe() {
    state.observer?.disconnect();
    state.observer = new MutationObserver(() => {
      window.clearTimeout(state.renderTimer);
      state.renderTimer = window.setTimeout(renderAnchor, 100);
    });
    if (state.panel) state.observer.observe(state.panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "value", "disabled"] });
  }

  async function install() {
    await loadSettings();
    if (document.body) state.basePaddingRight = getComputedStyle(document.body).paddingRight || "0px";
    createHost();
    reservePage();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const panel = document.querySelector(PANEL_SELECTOR);
      if (panel) {
        window.clearInterval(timer);
        patchPanel(panel);
        observe();
        renderAnchor();
      } else if (attempts >= 120) window.clearInterval(timer);
    }, 250);
  }

  globalThis.__SIMNET_MENTOR_SHELL__ = {
    version: "0.2.0",
    openDiagnostics: () => openFlyout("quick", "Быстрая диагностика"),
    closeFlyout,
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false)
  };

  window.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (state.flyout) closeFlyout();
    else if (!state.collapsed) setCollapsed(true);
  }, true);
  window.addEventListener("pagehide", () => {
    state.observer?.disconnect();
    window.clearTimeout(state.renderTimer);
    restorePage();
  });

  install();
})();
