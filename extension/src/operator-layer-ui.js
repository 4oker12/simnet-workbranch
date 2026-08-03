"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_LAYER_UI__) return;

  let scheduled = 0;
  let renderedAfterPatch = false;

  function frozenStep(step, overrides) {
    return Object.freeze({ ...step, ...overrides });
  }

  function patchRoutes() {
    const routes = globalThis.__SIMNET_OPERATOR_ROUTES__;
    if (!routes || routes.__threeLayersPatched) return Boolean(routes);
    if (typeof routes.buildNoInternet !== "function") return false;

    const originalBuild = routes.buildNoInternet;
    const buildNoInternet = (technology) => {
      const original = originalBuild(technology);
      const byId = Object.fromEntries((original.steps || []).map((step) => [step.id, step]));
      const sourceLine = byId["pon-line"] || byId["ethernet-port"] || byId["detect-technology"];

      const access = frozenStep(byId.access, {
        title: "Доступ",
        short: "Billing · услуга и ограничения",
        entityKeys: Object.freeze(["serviceState", "access"]),
        focusKey: "serviceState",
        why: "Первый слой: Billing. Здесь проверяются состояние услуги и административное разрешение доступа. Финансовые ограничения, пакет, группа и дата начала относятся к деталям этого слоя."
      });

      const line = frozenStep(sourceLine, {
        title: "Линия",
        short: technology === "pon"
          ? "ONU · регистрация и физика"
          : technology === "ethernet"
            ? "Порт · линк и привязка"
            : "Сначала определить технологию",
        why: technology === "pon"
          ? "Второй слой: физическая сеть. ONU должна быть зарегистрирована, Ethernet-порт поднят, а фактический MAC — соответствовать ожидаемому."
          : technology === "ethernet"
            ? "Второй слой: физическая сеть. Проверяются порт, линк, MAC и VLAN."
            : "Второй слой нельзя оценить, пока не определена технология подключения."
      });

      const session = frozenStep(byId.session, {
        title: "Сессия",
        short: "Juniper · авторизация",
        entityKeys: Object.freeze(["sessionState"]),
        focusKey: "sessionState",
        why: "Третий слой: авторизация. Активная сессия подтверждает, что абонент дошёл до BRAS и получил сетевой доступ. Логин, IP и таймеры остаются техническими деталями, а не отдельными выводами."
      });

      return Object.freeze({
        ...original,
        title: "Проверка связи",
        description: "Три слоя: Billing → физическая линия → авторизация Juniper.",
        steps: Object.freeze([access, line, session])
      });
    };

    globalThis.__SIMNET_OPERATOR_ROUTES__ = Object.freeze({
      ...routes,
      buildNoInternet,
      __threeLayersPatched: true
    });
    return true;
  }

  function installStyle() {
    if (document.getElementById("dp-operator-layer-ui-style")) return;
    const style = document.createElement("style");
    style.id = "dp-operator-layer-ui-style";
    style.textContent = `
      #dp-connectivity-live:not(.dp-three-layers-ready){visibility:hidden!important}
      #dp-live-axes [data-live-axis="access"]{order:1!important}
      #dp-live-axes [data-live-axis="pon-line"],
      #dp-live-axes [data-live-axis="ethernet-port"],
      #dp-live-axes [data-live-axis="detect-technology"]{order:2!important}
      #dp-live-axes [data-live-axis="session"]{order:3!important}

      #dp-live-axes .dp-live-axis>span::before{
        display:inline-grid!important;place-items:center!important;
        min-width:18px!important;height:16px!important;margin-right:4px!important;
        padding:0 3px!important;border-radius:5px!important;
        color:#475569!important;background:#e2e8f0!important;
        font:800 7px/1 "Segoe UI",Arial,sans-serif!important;
        vertical-align:middle!important
      }
      #dp-live-axes [data-live-axis="access"]>span::before{content:"B"!important}
      #dp-live-axes [data-live-axis="pon-line"]>span::before,
      #dp-live-axes [data-live-axis="ethernet-port"]>span::before,
      #dp-live-axes [data-live-axis="detect-technology"]>span::before{content:"ONU"!important}
      #dp-live-axes [data-live-axis="session"]>span::before{content:"J"!important}

      #dp-live-axes .dp-live-axis>span::after{
        display:block!important;margin-top:2px!important;
        color:#94a3b8!important;font:600 6.8px/1.15 "Segoe UI",Arial,sans-serif!important
      }
      #dp-live-axes [data-live-axis="access"]>span::after{content:"Billing · ограничения"!important}
      #dp-live-axes [data-live-axis="pon-line"]>span::after,
      #dp-live-axes [data-live-axis="ethernet-port"]>span::after,
      #dp-live-axes [data-live-axis="detect-technology"]>span::after{content:"ONU · физика"!important}
      #dp-live-axes [data-live-axis="session"]>span::after{content:"Juniper · авторизация"!important}

      #dp-live-steps{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      #dp-live-steps button span{line-height:1.15!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function apply() {
    installStyle();
    const patched = patchRoutes();
    const live = globalThis.__SIMNET_OPERATOR_LIVE_STATE__;
    if (patched && live?.render && !renderedAfterPatch) {
      renderedAfterPatch = true;
      try { live.render(); } catch (_) {}
    }

    const section = document.querySelector("#dp-connectivity-live");
    if (!section) return;

    const access = section.querySelector('#dp-live-axes [data-live-axis="access"] span');
    const line = section.querySelector('#dp-live-axes [data-live-axis="pon-line"] span, #dp-live-axes [data-live-axis="ethernet-port"] span, #dp-live-axes [data-live-axis="detect-technology"] span');
    const session = section.querySelector('#dp-live-axes [data-live-axis="session"] span');
    if (access) access.textContent = "Доступ";
    if (line) line.textContent = "Линия";
    if (session) session.textContent = "Сессия";

    const steps = section.querySelectorAll("#dp-live-steps [data-live-step]");
    const axes = section.querySelectorAll("#dp-live-axes [data-live-axis]");
    if (steps.length === 3 && axes.length === 3) {
      section.classList.add("dp-three-layers-ready");
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      apply();
    });
  }

  [
    "dp:operator-live-captured",
    "dp:operator-context-change",
    "dp:operation-mode-change"
  ].forEach((name) => document.addEventListener(name, schedule));

  document.addEventListener("click", () => window.setTimeout(schedule, 0), true);

  installStyle();
  patchRoutes();
  [0, 250, 700, 1500, 3000].forEach((delay) => window.setTimeout(schedule, delay));
  window.setTimeout(() => {
    document.querySelector("#dp-connectivity-live")?.classList.add("dp-three-layers-ready");
  }, 4500);

  globalThis.__SIMNET_OPERATOR_LAYER_UI__ = Object.freeze({ apply, patchRoutes });
})();
