"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_SHELL__) return;

  const HOST_ID = "simnet-mentor-shell";
  const PANEL_SELECTOR = "#dp-panel";
  const SETTINGS_KEY = "simnet_mentor_shell_v1";
  const RAIL_WIDTH = 48;
  const ANCHOR_WIDTH = 280;
  const EXPANDED_WIDTH = RAIL_WIDTH + ANCHOR_WIDTH;
  const FLYOUT_WIDTH = 540;

  const state = {
    collapsed: false,
    flyout: "",
    panel: null,
    host: null,
    root: null,
    basePaddingRight: "0px",
    observer: null,
    timer: 0
  };

  const icons = {
    brand: "M5 5h14v14H5zM8 9h8M8 13h5M8 17h7",
    mentor: "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM9 21h6M12 17v4M9.5 10.5l1.6 1.6 3.5-4",
    quick: "M13 2 5 14h7l-1 8 8-12h-7z",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
    more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
    collapse: "M15 5 8 12l7 7",
    close: "M6 6l12 12M18 6 6 18",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-4 3-6 7-6s7 2 7 6",
    arrow: "M9 18l6-6-6-6",
    info: "M12 17v-6M12 7h.01",
    check: "M5 12l4 4L19 6"
  };

  function svg(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.info}"></path></svg>`;
  }

  function safeText(value, max = 120) {
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
        <nav class="rail" aria-label="Workbench">
          <button class="brand" data-action="collapse" aria-label="Workbench">${svg("brand")}<span class="tip">Workbench</span></button>
          <button class="active" data-action="mentor" aria-label="Помощник-наставник">${svg("mentor")}<span class="tip">Помощник-наставник</span></button>
          <button data-action="quick" aria-label="Быстрая диагностика">${svg("quick")}<span class="tip">Быстрая диагностика</span></button>
          <button data-action="history" aria-label="История абонента">${svg("history")}<span class="tip">История абонента</span></button>
          <button data-action="more" aria-label="Дополнительно">${svg("more")}<span class="tip">Дополнительно</span></button>
          <button class="rail-bottom" data-action="collapse" aria-label="Свернуть">${svg("collapse")}<span class="tip">Свернуть</span></button>
        </nav>

        <aside class="anchor" aria-label="Помощник-наставник">
          <header class="subscriber-head">
            <span class="avatar">${svg("user")}</span>
            <div class="subscriber-copy">
              <strong data-context-title>Ожидаю карточку</strong>
              <span data-context-meta>Контекст определится текущей системой</span>
            </div>
          </header>

          <div class="chips" aria-label="Ключевые данные">
            <span class="chip skeleton" data-chip="contract"></span>
            <span class="chip skeleton" data-chip="ip"></span>
            <span class="chip skeleton" data-chip="mac"></span>
          </div>

          <section class="session-card">
            <div class="section-label">Статус сессии</div>
            <div class="session-row">
              <span class="session-dot"></span>
              <strong data-session-status>Ожидание данных</strong>
            </div>
            <small data-session-meta>Workbench ещё не завершил проверку</small>
          </section>

          <section class="mentor-card emphasis">
            <div class="section-label">Что важно сейчас</div>
            <strong data-mentor-title>Открой карточку абонента</strong>
            <p data-mentor-text>Помощник будет показывать одну актуальную подсказку по текущему контексту.</p>
          </section>

          <section class="mentor-card next-step">
            <div class="section-label">Следующая проверка</div>
            <button type="button" data-action="quick-inline">
              <span>${svg("quick")}</span>
              <span><b>Быстрый разбор</b><small>Открыть существующую диагностику</small></span>
              ${svg("arrow")}
            </button>
          </section>

          <div class="facts">
            <span>${svg("check")} Контекст страницы</span>
            <span>${svg("check")} Подсказки по ходу работы</span>
            <span>${svg("check")} Решение остаётся за оператором</span>
          </div>
        </aside>

        <section class="flyout" aria-label="Расширенный модуль">
          <header class="flyout-head">
            <strong data-flyout-title>Быстрая диагностика</strong>
            <button type="button" data-action="close-flyout" aria-label="Закрыть">${svg("close")}</button>
          </header>
          <div class="flyout-body"><slot name="workbench"></slot></div>
        </section>
      </div>`;
  }

  function shellCss() {
    return `
      :host{all:initial;position:fixed;z-index:2147483647;top:0;right:0;bottom:0;width:${EXPANDED_WIDTH}px;height:100vh;color:#e7edf7;font:12px/1.4 "Segoe UI",Arial,sans-serif;transition:width .16s ease}
      :host([data-collapsed="true"]){width:${RAIL_WIDTH}px}
      *,*::before,*::after{box-sizing:border-box}
      button{font:inherit}
      svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .shell{position:relative;display:grid;grid-template-columns:${RAIL_WIDTH}px ${ANCHOR_WIDTH}px;width:100%;height:100%;background:#0d141f;border-left:1px solid #273244}
      :host([data-collapsed="true"]) .shell{grid-template-columns:${RAIL_WIDTH}px}
      .rail{display:flex;flex-direction:column;align-items:center;gap:7px;padding:8px 5px;background:#0a1019;border-right:1px solid #202b3a}
      .rail button{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;color:#8f9caf;background:transparent;border:0;border-radius:9px;cursor:pointer}
      .rail button:hover,.rail button:focus-visible{color:#fff;background:#1b2737;outline:none}
      .rail button.active{color:#c9a8ff;background:#2c2143}
      .rail .brand{color:#d8e2f0;background:#172131}
      .rail-bottom{margin-top:auto!important}
      .tip{position:absolute;right:46px;top:50%;z-index:5;padding:5px 7px;color:#fff;background:#101827;border:1px solid #344155;border-radius:6px;opacity:0;visibility:hidden;transform:translateY(-50%);white-space:nowrap;pointer-events:none}
      .rail button:hover .tip,.rail button:focus-visible .tip{opacity:1;visibility:visible}
      .anchor{display:flex;flex-direction:column;gap:10px;min-width:0;height:100%;padding:12px;background:#101823;overflow:hidden}
      :host([data-collapsed="true"]) .anchor{display:none}
      .subscriber-head{display:flex;align-items:center;gap:9px;min-height:42px}
      .avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;color:#dbe6f5;background:#1c2735;border:1px solid #324055;border-radius:50%}
      .subscriber-copy{display:grid;gap:2px;min-width:0}
      .subscriber-copy strong,.subscriber-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .subscriber-copy strong{font-size:12px}
      .subscriber-copy span{color:#8f9caf;font-size:10px}
      .chips{display:flex;gap:5px;min-height:25px;overflow:hidden}
      .chip{display:inline-flex;align-items:center;min-width:0;height:24px;padding:0 7px;color:#cbd6e5;background:#182332;border:1px solid #2b394c;border-radius:7px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chip.skeleton{width:72px;background:linear-gradient(90deg,#182332 20%,#243246 50%,#182332 80%);background-size:200% 100%;animation:shimmer 1.2s infinite}
      .session-card,.mentor-card{padding:10px;background:#151f2c;border:1px solid #2a3748;border-radius:9px}
      .section-label{margin-bottom:7px;color:#7f8da2;font-size:9px;text-transform:uppercase;letter-spacing:.06em}
      .session-row{display:flex;align-items:center;gap:7px}
      .session-dot{width:8px;height:8px;background:#6c7b8f;border-radius:50%}
      .session-card small{display:block;margin-top:4px;color:#7f8da2;font-size:9px}
      .mentor-card strong{display:block;margin-bottom:5px;color:#f1f5fb;font-size:12px}
      .mentor-card p{margin:0;color:#aeb9c9;font-size:10px;line-height:1.45}
      .mentor-card.emphasis{border-color:#5b477e;background:#1d1830}
      .mentor-card.emphasis .section-label{color:#b99bea}
      .next-step{padding:0;overflow:hidden;border-color:#274a70;background:#11233a}
      .next-step .section-label{padding:9px 10px 0;color:#6ea8e8}
      .next-step button{display:grid;grid-template-columns:28px 1fr 18px;align-items:center;gap:7px;width:100%;padding:8px 10px 10px;color:#e5edf8;text-align:left;background:transparent;border:0;cursor:pointer}
      .next-step button:hover{background:#172d49}
      .next-step button>span:first-child{display:grid;place-items:center;color:#63d68f}
      .next-step b,.next-step small{display:block}
      .next-step small{margin-top:2px;color:#7f91a8;font-size:9px}
      .facts{display:grid;gap:5px;margin-top:auto;color:#8896aa;font-size:9px}
      .facts span{display:flex;align-items:center;gap:6px}
      .facts svg{width:12px;height:12px;color:#56c98a}
      .flyout{position:absolute;top:0;right:100%;display:grid;grid-template-rows:44px minmax(0,1fr);width:min(${FLYOUT_WIDTH}px,calc(100vw - ${EXPANDED_WIDTH}px));height:100vh;background:#0e1621;border-left:1px solid #283548;border-right:1px solid #283548;box-shadow:-14px 0 32px rgba(0,0,0,.28);opacity:0;visibility:hidden;transform:translateX(18px);transition:opacity .16s ease,transform .16s ease,visibility .16s}
      :host([data-flyout="open"]) .flyout{opacity:1;visibility:visible;transform:translateX(0)}
      :host([data-collapsed="true"]) .flyout{display:none}
      .flyout-head{display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#121c28;border-bottom:1px solid #283548}
      .flyout-head button{display:grid;place-items:center;width:30px;height:30px;color:#9aa8ba;background:transparent;border:0;border-radius:6px;cursor:pointer}
      .flyout-head button:hover{color:#fff;background:#202d3e}
      .flyout-body{min-height:0;overflow:auto;background:#0f1722}
      ::slotted(#dp-panel){width:100%!important;min-width:0!important;max-width:none!important;height:100%!important;min-height:0!important;max-height:none!important;margin:0!important;border-radius:0!important;box-shadow:none!important}
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
    return host;
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
    panel.dataset.mentorShell = "1";
    panel.classList.remove("collapsed", "overlay-mode", "resizing");
    const styles = {
      position: "relative", inset: "auto", top: "auto", right: "auto", bottom: "auto", left: "auto",
      width: "100%", "min-width": "0", "max-width": "none", height: "100%", "min-height": "0", "max-height": "none",
      margin: "0", transform: "none", "border-radius": "0", "box-shadow": "none"
    };
    for (const [name, value] of Object.entries(styles)) panel.style.setProperty(name, value, "important");
    if (panel.parentElement !== state.host) state.host.appendChild(panel);
  }

  function currentContext() {
    const input = state.panel?.querySelector("#dp-input");
    const value = safeText(input?.value || "", 40);
    const contract = value.match(/\d{4,14}/)?.[0] || "";
    const status = state.panel?.querySelector("#dp-status");
    return { contract, status: safeText(status?.textContent || "", 120) };
  }

  function renderAnchor() {
    if (!state.root) return;
    const context = currentContext();
    const title = state.root.querySelector("[data-context-title]");
    const meta = state.root.querySelector("[data-context-meta]");
    const contractChip = state.root.querySelector('[data-chip="contract"]');
    const session = state.root.querySelector("[data-session-status]");
    const sessionMeta = state.root.querySelector("[data-session-meta]");
    if (context.contract) {
      title.textContent = `abon${context.contract}`;
      meta.textContent = location.hostname.includes("userside") ? "UserSide" : "Billing";
      contractChip.textContent = `Договор ${context.contract}`;
      contractChip.classList.remove("skeleton");
    }
    if (context.status) {
      session.textContent = context.status;
      sessionMeta.textContent = "Статус из существующего Workbench";
    }
  }

  function setCollapsed(value) {
    state.collapsed = Boolean(value);
    if (state.collapsed) state.flyout = "";
    state.host.dataset.collapsed = String(state.collapsed);
    state.host.dataset.flyout = state.flyout ? "open" : "";
    reservePage();
    saveSettings();
  }

  function openFlyout(kind, title) {
    state.flyout = kind;
    setCollapsed(false);
    state.host.dataset.flyout = "open";
    const heading = state.root.querySelector("[data-flyout-title]");
    if (heading) heading.textContent = title;
  }

  function closeFlyout() {
    state.flyout = "";
    state.host.dataset.flyout = "";
  }

  function clickExistingHistory() {
    const candidate = [...(state.panel?.querySelectorAll("button,a") || [])]
      .find(node => /разобрать\s+историю|история\s+абонента/i.test(safeText(node.textContent, 80)));
    candidate?.click();
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "collapse") setCollapsed(!state.collapsed);
    if (action === "mentor") { closeFlyout(); setCollapsed(false); }
    if (action === "quick" || action === "quick-inline") openFlyout("quick", "Быстрая диагностика");
    if (action === "history") { clickExistingHistory(); openFlyout("history", "История абонента"); }
    if (action === "more") openFlyout("more", "Дополнительные инструменты");
    if (action === "close-flyout") closeFlyout();
  }

  function observe() {
    state.observer?.disconnect();
    state.observer = new MutationObserver(() => {
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => {
        renderAnchor();
        if (state.panel) patchPanel(state.panel);
      }, 80);
    });
    if (state.panel) state.observer.observe(state.panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "value"] });
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
      } else if (attempts >= 120) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  globalThis.__SIMNET_MENTOR_SHELL__ = {
    version: "0.1.0",
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
    window.clearTimeout(state.timer);
    restorePage();
  });

  install();
})();
