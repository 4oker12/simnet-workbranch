"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_UI_VARIANT__) return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  let timer = 0;
  let observer = null;

  function installStyle() {
    if (document.getElementById("dp-operator-ui-variant-style")) return;
    const style = document.createElement("style");
    style.id = "dp-operator-ui-variant-style";
    style.textContent = `
      #dp-panel.dp-operator-variant{--v-blue:#2f6feb;--v-border:#e2e6ec;--v-muted:#8892a0;--v-text:#1a2332;--v-bg:#f4f6f9;--v-ok:#16a34a;--v-ok-bg:#ecfdf3;--v-ok-border:#a7d9b8;--v-warn:#d97706;--v-warn-bg:#fffbeb;--v-warn-border:#f4cc7b;--v-bad:#dc2626;--v-bad-bg:#fef2f2;--v-bad-border:#f0a6a6;color:var(--v-text)!important;background:var(--v-bg)!important}
      #dp-panel.dp-operator-variant #dp-head{padding:14px 16px 10px!important;background:#fff!important;border-bottom:1px solid var(--v-border)!important}
      #dp-panel.dp-operator-variant #dp-head .dp-head-title>b{font-size:15px!important;color:var(--v-text)!important}
      #dp-panel.dp-operator-variant #dp-head .dp-version{display:none!important}
      #dp-panel.dp-operator-variant #dp-head-controls{gap:5px!important}
      #dp-panel.dp-operator-variant #dp-head-controls button:not(#dp-reload-extension){width:25px!important;height:25px!important;padding:0!important;border:1px solid #dde3ea!important;background:#fff!important;color:#7b8491!important;border-radius:6px!important}
      #dp-panel.dp-operator-variant #dp-reload-extension{height:25px!important;padding:2px 7px!important;border:1px solid #dde3ea!important;background:#eef1f5!important;color:#5b6472!important;border-radius:6px!important;font-size:10.5px!important;font-weight:700!important}
      #dp-panel.dp-operator-variant #dp-session-badge{display:flex!important;align-items:center!important;gap:6px!important;width:100%!important;margin-top:9px!important;padding:7px 10px!important;color:#166534!important;background:var(--v-ok-bg)!important;border:1px solid var(--v-ok-border)!important;border-radius:9px!important;font-size:11.5px!important;font-weight:650!important}
      #dp-panel.dp-operator-variant #dp-session-badge::before{content:"✓";font-size:14px!important;color:var(--v-ok)!important}
      #dp-panel.dp-operator-variant #dp-sync-badge,#dp-panel.dp-operator-variant #dp-role-banner{display:none!important}

      #dp-panel.dp-operator-variant #dp-operation-mode-v2{padding:10px 16px!important;background:#fff!important;border-bottom:1px solid var(--v-border)!important}
      #dp-panel.dp-operator-variant #dp-operation-mode-v2 .dp-operation-mode-v2-buttons{display:flex!important;gap:6px!important}
      #dp-panel.dp-operator-variant #dp-operation-mode-v2 button{flex:1!important;min-height:36px!important;padding:9px 0!important;border:1px solid #dde3ea!important;border-radius:8px!important;background:#fff!important;color:#5b6472!important;font-size:12.5px!important;font-weight:650!important}
      #dp-panel.dp-operator-variant #dp-operation-mode-v2 button.active{border-color:var(--v-blue)!important;background:var(--v-blue)!important;color:#fff!important}
      #dp-panel.dp-operator-variant #dp-operation-mode-v2 [data-dp-operation-mode-v2="mentor"]{display:none!important}

      #dp-panel.dp-operator-variant #dp-workspace-tabs,
      #dp-panel.dp-operator-variant #dp-status,
      #dp-panel.dp-operator-variant #dp-billing-provider,
      #dp-panel.dp-operator-variant #dp-mentor-workspace,
      #dp-panel.dp-operator-variant #dp-form,
      #dp-panel.dp-operator-variant #dp-history-actions,
      #dp-panel.dp-operator-variant #dp-results,
      #dp-panel.dp-operator-variant #dp-journal-resizer,
      #dp-panel.dp-operator-variant #dp-journal-wrap{display:none!important}

      #dp-panel.dp-operator-variant #dp-operator-workspace{padding:0!important;background:var(--v-bg)!important;border:0!important;border-radius:0!important;box-shadow:none!important}
      #dp-panel.dp-operator-variant #dp-operator-workspace>.dp-operator-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:10px 16px!important;background:var(--v-bg)!important;border:0!important}
      #dp-panel.dp-operator-variant #dp-operator-workspace>.dp-operator-header>div>b{display:none!important}
      #dp-panel.dp-operator-variant #dp-operator-context{font-size:11.5px!important;font-weight:500!important;color:#5b6472!important}
      #dp-panel.dp-operator-variant #dp-operator-context b{color:var(--v-text)!important}
      #dp-panel.dp-operator-variant #dp-operator-refresh{width:auto!important;height:auto!important;padding:0!important;border:0!important;background:transparent!important;color:var(--v-blue)!important;font-size:11.5px!important;font-weight:700!important}

      #dp-panel.dp-operator-variant #dp-operator-scenarios-live{display:flex!important;gap:6px!important;padding:0 16px 10px!important;background:var(--v-bg)!important;border:0!important}
      #dp-panel.dp-operator-variant #dp-operator-scenarios-live button{flex:1!important;min-height:34px!important;padding:8px 10px!important;border:1px solid #dde3ea!important;border-radius:8px!important;background:#fff!important;color:#5b6472!important;font-size:11.5px!important;font-weight:650!important}
      #dp-panel.dp-operator-variant #dp-operator-scenarios-live button.active{border-color:var(--v-blue)!important;background:#eef5ff!important;color:var(--v-blue)!important}
      #dp-panel.dp-operator-variant #dp-operator-scenarios-live button>span:first-child{width:auto!important;height:auto!important;background:transparent!important;color:inherit!important}

      #dp-panel.dp-operator-variant #dp-connectivity-live{display:block!important;background:var(--v-bg)!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live[hidden]{display:none!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-summary{display:block!important;padding:0!important;background:transparent!important;border:0!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-summary>header{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-axes{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;padding:0 16px 10px!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis{display:grid!important;grid-template-columns:1fr!important;grid-template-rows:auto auto!important;gap:0!important;min-height:58px!important;padding:9px 8px!important;border:1px solid var(--v-border)!important;border-left-width:3px!important;border-radius:8px!important;text-align:left!important;background:#fff!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis::before{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis span{grid-column:1!important;font-size:9px!important;font-weight:700!important;letter-spacing:.035em!important;text-transform:uppercase!important;color:#6f7a89!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis b{grid-column:1!important;margin-top:3px!important;font-size:12px!important;line-height:1.2!important;font-weight:750!important;color:var(--v-text)!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis small{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.ok{background:var(--v-ok-bg)!important;border-color:var(--v-ok-border)!important;border-left-color:var(--v-ok)!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.ok span{color:#3d7a54!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.ok b{color:#166534!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.warning,
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.unknown{background:var(--v-warn-bg)!important;border-color:var(--v-warn-border)!important;border-left-color:var(--v-warn)!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.warning span,
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.unknown span{color:#92651b!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.warning b,
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.unknown b{color:#92400e!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.error{background:var(--v-bad-bg)!important;border-color:var(--v-bad-border)!important;border-left-color:var(--v-bad)!important}
      #dp-panel.dp-operator-variant #dp-live-axes .dp-live-axis.error b{color:#991b1b!important}
      #dp-panel.dp-operator-variant #dp-live-hypothesis{display:none!important}

      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-route{padding:4px 16px 14px!important;background:var(--v-bg)!important;border:0!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-route>header{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-steps{display:flex!important;align-items:flex-start!important;gap:0!important}
      #dp-panel.dp-operator-variant #dp-live-steps button{position:relative!important;flex:1!important;display:flex!important;flex-direction:column!important;align-items:center!important;min-width:0!important;min-height:48px!important;padding:0 2px!important;border:0!important;background:transparent!important;color:var(--v-muted)!important;overflow:visible!important}
      #dp-panel.dp-operator-variant #dp-live-steps button:not(:last-child)::after{content:"";position:absolute!important;z-index:0!important;left:calc(50% + 15px)!important;right:calc(-50% + 15px)!important;top:11px!important;height:2px!important;background:#d7dee8!important}
      #dp-panel.dp-operator-variant #dp-live-steps button i{position:relative!important;z-index:1!important;display:flex!important;align-items:center!important;justify-content:center!important;width:24px!important;height:24px!important;border:2px solid #d7dee8!important;border-radius:50%!important;background:#fff!important;color:var(--v-muted)!important;font-size:11px!important;font-weight:750!important}
      #dp-panel.dp-operator-variant #dp-live-steps button span{margin-top:4px!important;font-size:10.5px!important;line-height:1.15!important;color:var(--v-muted)!important;text-align:center!important}
      #dp-panel.dp-operator-variant #dp-live-steps button.active i{border-color:var(--v-blue)!important;background:var(--v-blue)!important;color:#fff!important}
      #dp-panel.dp-operator-variant #dp-live-steps button.active span{color:var(--v-blue)!important;font-weight:700!important}
      #dp-panel.dp-operator-variant #dp-live-steps button.done i{border-color:var(--v-ok)!important;background:var(--v-ok)!important;color:#fff!important}

      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card{display:grid!important;gap:8px!important;margin:0!important;padding:0 16px 14px!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>header{padding:0!important;border:0!important;background:transparent!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>header>div{display:flex!important;align-items:baseline!important;gap:5px!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>header span{font-size:9px!important;letter-spacing:.04em!important;text-transform:uppercase!important;color:var(--v-muted)!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>header b{font-size:9px!important;letter-spacing:.04em!important;text-transform:uppercase!important;color:#5b6472!important}
      #dp-panel.dp-operator-variant #dp-live-step-number{font-size:11px!important;color:var(--v-muted)!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>p{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-entities{display:grid!important;gap:6px!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;min-height:56px!important;padding:10px 12px!important;border:1px solid var(--v-border)!important;border-left:3px solid #cbd5e1!important;border-radius:9px!important;background:#fff!important;text-align:left!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity::before{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity>span{display:grid!important;gap:2px!important;min-width:0!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity small{font-size:11px!important;color:var(--v-muted)!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity b{font-size:12.5px!important;line-height:1.2!important;font-weight:750!important;color:#5b6472!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity em{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity>i{display:block!important;padding:5px 10px!important;border:1px solid #dde3ea!important;border-radius:7px!important;background:var(--v-bg)!important;color:#5b6472!important;font-size:11px!important;font-style:normal!important;font-weight:650!important;white-space:nowrap!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.ok{border-left-color:var(--v-ok)!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.ok b{color:#166534!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.warning{border-left-color:var(--v-warn)!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.warning b{color:#92400e!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.error{border-left-color:var(--v-bad)!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity.error b{color:#991b1b!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity:disabled{opacity:1!important;cursor:default!important}
      #dp-panel.dp-operator-variant #dp-live-entities .dp-live-entity:disabled>i{border:0!important;background:transparent!important;color:#a2abb8!important;padding-right:0!important}
      #dp-panel.dp-operator-variant #dp-live-why{margin:0!important;padding:9px 11px!important;border:1px solid #dbe4f0!important;border-radius:8px!important;background:#f8fbff!important;color:#526174!important;font-size:10.5px!important;line-height:1.4!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>footer{display:flex!important;gap:8px!important;padding:0!important;border:0!important;background:transparent!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>footer button{flex:1!important;min-height:38px!important;padding:10px 0!important;border:1px solid #dde3ea!important;border-radius:8px!important;background:#fff!important;color:#5b6472!important;font-size:12.5px!important;font-weight:650!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>footer button.primary{border-color:var(--v-blue)!important;background:var(--v-blue)!important;color:#fff!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-card>footer button[hidden]{display:none!important}

      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-next{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:12px 16px!important;border-top:1px solid var(--v-border)!important;background:#fff!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-next div{display:block!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-next b{font-size:11px!important;font-weight:500!important;color:var(--v-muted)!important}
      #dp-panel.dp-operator-variant #dp-connectivity-live .dp-live-next span{display:none!important}
      #dp-panel.dp-operator-variant #dp-live-next-button{padding:7px 16px!important;border:1px solid var(--v-blue)!important;border-radius:8px!important;background:#fff!important;color:var(--v-blue)!important;font-size:12px!important;font-weight:750!important}

      #dp-panel.dp-operator-variant #dp-tech-guide{display:none!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function navigatorActive(panel) {
    return panel?.dataset.operationMode === "navigator"
      || document.querySelector('[data-dp-operation-mode-v2="navigator"].active');
  }

  function shortStatus(value, key) {
    const current = text(value);
    if (!current) return key === "line" ? "Не проверена" : "Не проверено";
    if (key === "access" && /все\s*ок/i.test(current)) return "Всё ОК";
    if (key === "session" && /актив/i.test(current)) return "Активна";
    if (key === "session" && /нет|отсутств|none/i.test(current)) return "Нет сессии";
    if (key === "line" && /onu\s*online|online/i.test(current)) return "ONU online";
    if (key === "line" && /offline/i.test(current)) return "ONU offline";
    if (/не опрош|не провер|не получ/i.test(current)) return key === "line" ? "Не проверена" : "Не проверено";
    return current.length > 22 ? `${current.slice(0, 21)}…` : current;
  }

  function polishHeader(panel) {
    const title = panel.querySelector("#dp-head .dp-head-title>b");
    if (title) {
      const version = title.querySelector(".dp-version");
      [...title.childNodes].forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) node.nodeValue = "SIMNET · Диагностика ";
      });
      version?.removeAttribute("style");
    }
    const reload = panel.querySelector("#dp-reload-extension");
    if (reload) {
      const match = text(reload.textContent).match(/\d+\.\d+\.\d+/);
      reload.textContent = `EXT ${match?.[0] || ""}`.trim();
    }
    const refresh = panel.querySelector("#dp-operator-refresh");
    if (refresh) refresh.textContent = "↻ обновить";
  }

  function polishScenarios(panel) {
    panel.querySelectorAll("#dp-operator-scenarios-live [data-live-scenario]").forEach((button) => {
      const key = button.dataset.liveScenario;
      const icon = key === "finance" ? "₴" : "↯";
      const label = key === "finance" ? "Финансы" : "Связь";
      const spans = button.querySelectorAll(":scope > span");
      if (spans.length >= 2) {
        spans[0].textContent = icon;
        spans[1].textContent = label;
      } else {
        button.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
      }
    });
    const context = panel.querySelector("#dp-operator-context");
    if (context) context.textContent = text(context.textContent).replace(/^Нет интернета\s*·?/i, "Связь ·");
  }

  function markCompletedSteps(panel) {
    const buttons = [...panel.querySelectorAll("#dp-live-steps [data-live-step]")];
    const activeIndex = buttons.findIndex((button) => button.classList.contains("active"));
    buttons.forEach((button, index) => button.classList.toggle("done", activeIndex > index));
  }

  function polishConnectivity(panel) {
    const section = panel.querySelector("#dp-connectivity-live");
    if (!section) return;

    const axes = [
      ["access", "Доступ", "access"],
      ["session", "Сессия", "session"],
      ["pon-line", "Линия", "line"]
    ];
    axes.forEach(([axisKey, label, statusKey]) => {
      const axis = section.querySelector(`[data-live-axis="${axisKey}"]`);
      if (!axis) return;
      const labelNode = axis.querySelector("span");
      const valueNode = axis.querySelector("b");
      if (labelNode) labelNode.textContent = label;
      if (valueNode) valueNode.textContent = shortStatus(valueNode.textContent, statusKey);
    });

    markCompletedSteps(panel);

    const cardHeader = section.querySelector(".dp-live-card>header>div");
    if (cardHeader) {
      const caption = cardHeader.querySelector("span");
      const title = cardHeader.querySelector("b");
      if (caption) caption.textContent = "Текущий источник ·";
      if (title && !text(title.textContent)) title.textContent = "Доступ";
    }

    section.querySelectorAll("#dp-live-entities [data-live-entity]").forEach((entity) => {
      const action = entity.querySelector(":scope > i");
      if (!action) return;
      action.textContent = entity.disabled ? "нет источника" : "Показать";
    });

    const show = section.querySelector("#dp-live-show");
    const open = section.querySelector("#dp-live-open");
    const explain = section.querySelector("#dp-live-explain");
    if (show && !show.hidden) show.textContent = "Показать всё";
    if (open && !open.hidden) open.textContent = /опрос/i.test(text(open.textContent)) ? "Открыть опрос" : "Открыть раздел";
    if (explain) explain.textContent = "Пояснить";
    const next = section.querySelector("#dp-live-next-button");
    if (next) next.textContent = "Дальше →";
    const nextTitle = section.querySelector("#dp-live-next-title");
    if (nextTitle) nextTitle.textContent = text(nextTitle.textContent).replace(/^Следом:\s*/i, "Следом: ");
  }

  function apply() {
    installStyle();
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    panel.classList.toggle("dp-operator-variant", Boolean(navigatorActive(panel)));
    if (!panel.classList.contains("dp-operator-variant")) return;
    polishHeader(panel);
    polishScenarios(panel);
    polishConnectivity(panel);
  }

  function schedule() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      apply();
    }, 0);
  }

  ["dp:operation-mode-change", "dp:operator-context-change", "dp:operator-live-captured"].forEach((name) => {
    document.addEventListener(name, schedule);
  });
  document.addEventListener("click", () => {
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 160);
  }, true);

  apply();
  [250, 700, 1400, 2800, 5000, 9000].forEach((delay) => window.setTimeout(apply, delay));
  const startedAt = Date.now();
  observer = new MutationObserver(() => {
    schedule();
    if (Date.now() - startedAt > 30000) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), 30500);

  globalThis.__SIMNET_OPERATOR_UI_VARIANT__ = Object.freeze({ apply });
})();
