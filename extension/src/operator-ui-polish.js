"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_UI_POLISH__) return;

  const OLT_ACTIONS = new Set(["310", "311", "312", "313"]);
  let observer = null;
  let scheduled = 0;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const action = () => {
    try { return new URL(location.href).searchParams.get("a") || ""; } catch (_) { return ""; }
  };
  const isTechDataPage = () => {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("a") === "dopdata" && url.searchParams.get("tmpl") === "1") return true;
    } catch (_) {}
    return Boolean(document.querySelector('input[name="a"][value="dopdata"]')
      && document.querySelector('input[name="tmpl"][value="1"]'));
  };

  function installStyle() {
    if (document.getElementById("dp-operator-ui-polish-style")) return;
    const style = document.createElement("style");
    style.id = "dp-operator-ui-polish-style";
    style.textContent = `
      #dp-operation-mode-v2 .dp-operation-mode-v2-buttons{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      #dp-operation-mode-v2 [data-dp-operation-mode-v2="mentor"]{display:none!important}
      #dp-operator-workspace>.dp-operator-header>div>b{display:none!important}
      #dp-operator-workspace>.dp-operator-header>div{gap:0!important}
      #dp-operator-workspace>.dp-operator-header #dp-operator-context{font-size:9px!important;font-weight:700!important;color:#526174!important}
      #dp-operator-scenarios-live button.dp-scenario-polished{display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important}
      #dp-operator-scenarios-live button.dp-scenario-polished>span:first-child{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#334155!important;background:#e2e8f0!important;border-radius:5px!important;font:800 11px/1 "Segoe UI",Arial,sans-serif!important}
      #dp-operator-scenarios-live button.dp-scenario-polished.active>span:first-child{color:#1d4ed8!important;background:#dbeafe!important}
      #dp-operator-scenarios-live button.dp-scenario-polished>span:last-child{font:750 9px/1 "Segoe UI",Arial,sans-serif!important}

      #dp-connectivity-live .dp-live-summary{gap:6px!important;padding:7px 9px!important}
      #dp-connectivity-live .dp-live-summary>header b{font-size:12px!important}
      #dp-connectivity-live .dp-live-summary>header span{font-size:8px!important;color:#64748b!important}
      #dp-live-axes{gap:5px!important}
      #dp-live-axes .dp-live-axis{position:relative!important;display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;grid-template-rows:auto auto!important;column-gap:5px!important;min-height:44px!important;padding:6px 7px!important;text-align:left!important}
      #dp-live-axes .dp-live-axis::before{grid-row:1/3;display:grid!important;place-items:center!important;width:18px!important;height:18px!important;margin-top:2px!important;border-radius:50%!important;font:900 10px/1 Arial,sans-serif!important}
      #dp-live-axes .dp-live-axis.ok::before{content:"✓";color:#166534!important;background:#dcfce7!important}
      #dp-live-axes .dp-live-axis.warning::before{content:"!";color:#92400e!important;background:#fef3c7!important}
      #dp-live-axes .dp-live-axis.error::before{content:"×";color:#991b1b!important;background:#fee2e2!important}
      #dp-live-axes .dp-live-axis.unknown::before{content:"·";color:#475569!important;background:#e2e8f0!important}
      #dp-live-axes .dp-live-axis span{grid-column:2!important;font-size:7.5px!important;color:#64748b!important}
      #dp-live-axes .dp-live-axis b{grid-column:2!important;font-size:9px!important;line-height:1.2!important}
      #dp-live-axes .dp-live-axis small{display:none!important}
      #dp-live-hypothesis{padding:7px 9px!important}
      #dp-live-hypothesis>span,#dp-live-hypothesis>p{display:none!important}
      #dp-live-hypothesis>b{font-size:9px!important;line-height:1.35!important}
      #dp-connectivity-live .dp-live-route>header{display:none!important}
      #dp-live-steps{gap:4px!important}
      #dp-live-steps button{min-height:35px!important;padding:4px!important}
      #dp-live-steps button i{width:16px!important;height:16px!important;font-size:7px!important}
      #dp-live-steps button span{font-size:7.5px!important}
      #dp-connectivity-live .dp-live-card{gap:5px!important;padding:7px 9px!important}
      #dp-connectivity-live .dp-live-card>header span{font-size:7px!important}
      #dp-connectivity-live .dp-live-card>header b{font-size:11px!important}
      #dp-connectivity-live .dp-live-card>p{display:none!important}
      #dp-live-entities{gap:4px!important}
      #dp-live-entities .dp-live-entity{position:relative!important;display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;min-height:38px!important;padding:5px 7px!important;text-align:left!important}
      #dp-live-entities .dp-live-entity::before{display:grid!important;place-items:center!important;width:17px!important;height:17px!important;margin-top:2px!important;border-radius:50%!important;font:900 9px/1 Arial,sans-serif!important}
      #dp-live-entities .dp-live-entity.ok::before{content:"✓";color:#166534!important;background:#dcfce7!important}
      #dp-live-entities .dp-live-entity.warning::before{content:"!";color:#92400e!important;background:#fef3c7!important}
      #dp-live-entities .dp-live-entity.error::before{content:"×";color:#991b1b!important;background:#fee2e2!important}
      #dp-live-entities .dp-live-entity.info::before{content:"i";color:#1e40af!important;background:#dbeafe!important}
      #dp-live-entities .dp-live-entity.unknown::before{content:"·";color:#475569!important;background:#e2e8f0!important}
      #dp-live-entities .dp-live-entity>span{min-width:0!important}
      #dp-live-entities .dp-live-entity small{font-size:7.5px!important;color:#64748b!important}
      #dp-live-entities .dp-live-entity b{font-size:9.5px!important;line-height:1.2!important}
      #dp-live-entities .dp-live-entity em,#dp-live-entities .dp-live-entity>i{display:none!important}
      #dp-connectivity-live .dp-live-card>footer{display:flex!important;gap:5px!important}
      #dp-connectivity-live .dp-live-card>footer button{min-height:27px!important;padding:5px 8px!important;font-size:8px!important}
      #dp-live-explain{margin-left:auto!important}
      #dp-connectivity-live .dp-live-next{padding:6px 9px!important}
      #dp-connectivity-live .dp-live-next span{display:none!important}
      #dp-connectivity-live .dp-live-next b{font-size:8px!important}

      .dp-olt-data-hint{display:flex!important;align-items:flex-start!important;gap:5px!important;margin:5px 0 7px!important;padding:4px 7px!important;color:#526174!important;background:#f8fafc!important;border:1px solid #d7dee8!important;border-radius:5px!important;font:600 9px/1.35 Verdana,Tahoma,sans-serif!important}
      .dp-olt-data-hint>i{color:#2563eb!important;font-style:normal!important;font-weight:800!important}
      .dp-port-100-note{margin:1px 0 4px!important;padding:6px 8px!important;color:#7a4d0b!important;background:#fff8eb!important;border:1px solid #f1d39b!important;border-radius:6px!important;font:600 8.5px/1.4 "Segoe UI",Arial,sans-serif!important}
      #dp-tech-guide.dp-tech-guide-forced{display:grid!important;visibility:visible!important;opacity:1!important;order:-1!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function polishModes() {
    const controls = document.querySelector("#dp-operation-mode-v2");
    if (!controls) return;
    const navigator = controls.querySelector('[data-dp-operation-mode-v2="navigator"]');
    const mentor = controls.querySelector('[data-dp-operation-mode-v2="mentor"]');
    if (navigator && navigator.textContent !== "Помощник") navigator.textContent = "Помощник";
    if (mentor && !mentor.hidden) {
      mentor.hidden = true;
      mentor.setAttribute("aria-hidden", "true");
      mentor.tabIndex = -1;
    }
    if (globalThis.__SIMNET_OPERATION_MODE__?.get?.() === "mentor") {
      globalThis.__SIMNET_OPERATION_MODE__?.set?.("navigator", "mentor-hidden");
    }
  }

  function polishScenarios() {
    const controls = document.querySelector("#dp-operator-scenarios-live");
    if (!controls) return;
    const definitions = {
      finance: ["₴", "Финансы"],
      "no-internet": ["↯", "Связь"]
    };
    controls.querySelectorAll("[data-live-scenario]").forEach((button) => {
      const definition = definitions[button.dataset.liveScenario];
      if (!definition) return;
      button.dataset.dpPolished = "1";
      button.classList.add("dp-scenario-polished");
      const current = [...button.querySelectorAll(":scope > span")].map((node) => text(node.textContent));
      if (current[0] !== definition[0] || current[1] !== definition[1]) {
        button.innerHTML = `<span aria-hidden="true">${definition[0]}</span><span>${definition[1]}</span>`;
      }
    });
  }

  function compactConnectivity() {
    const section = document.querySelector("#dp-connectivity-live");
    if (!section) return;
    const headerTitle = section.querySelector(":scope .dp-live-summary>header b");
    if (headerTitle) headerTitle.textContent = "Проверка связи";

    const axisDefinitions = [
      ["access", "Доступ"],
      ["session", "Сессия"],
      ["pon-line", "Линия"]
    ];
    axisDefinitions.forEach(([key, label]) => {
      const axis = section.querySelector(`[data-live-axis="${key}"]`);
      if (!axis) return;
      const labelNode = axis.querySelector("span");
      const valueNode = axis.querySelector("b");
      if (labelNode) labelNode.textContent = label;
      if (!valueNode) return;
      const value = text(valueNode.textContent);
      if (key === "access" && /все\s*ок/i.test(value)) valueNode.textContent = "Все ОК";
      if (key === "session" && /актив/i.test(value)) valueNode.textContent = "Активна";
      if (key === "pon-line" && /не опрош|не провер/i.test(value)) valueNode.textContent = "Не проверена";
      if (key === "pon-line" && /online/i.test(value)) valueNode.textContent = "ONU online";
    });

    const hypothesis = section.querySelector("#dp-live-hypothesis");
    const hypothesisTitle = hypothesis?.querySelector("b");
    if (hypothesisTitle) {
      const current = text(hypothesisTitle.textContent);
      if (/PON подтвержд[её]н.*ONU не опрош/i.test(current)) {
        hypothesisTitle.textContent = "Доступ и сессия работают · линия ещё не проверена";
      } else if (/Juniper 2 не проверен/i.test(current)) {
        hypothesisTitle.textContent = "Сессия ещё не проверена";
      } else if (/технология не подтверждена/i.test(current)) {
        hypothesisTitle.textContent = "Нужно определить тип подключения";
      }
    }

    const stepTitle = text(section.querySelector("#dp-live-step-title")?.textContent);
    const entities = section.querySelector("#dp-live-entities");
    if (entities) {
      const lineUnpolled = /ONU и линия/i.test(stepTitle)
        && /не опрош|не провер/i.test(text(entities.querySelector('[data-live-entity="lineState"] b')?.textContent));
      entities.querySelectorAll("[data-live-entity]").forEach((button) => {
        const key = button.dataset.liveEntity || "";
        const value = text(button.querySelector("b")?.textContent);
        button.hidden = false;
        if (["sessionStartedAt", "sessionDuration"].includes(key) && /не получено|не найдено/i.test(value)) {
          button.hidden = true;
        }
        if (lineUnpolled && ["clientPort", "learnedMac", "routerMac", "optics", "uptime"].includes(key)) {
          button.hidden = true;
        }
        if (["routerMac", "vlan"].includes(key) && /не получено|не найдено|не изучен/i.test(value)) {
          button.hidden = true;
        }
      });
    }

    const showButton = section.querySelector("#dp-live-show");
    const openButton = section.querySelector("#dp-live-open");
    const explainButton = section.querySelector("#dp-live-explain");
    const lineNeedsPoll = /ONU и линия/i.test(stepTitle)
      && /не опрош|не провер/i.test(text(section.querySelector('[data-live-entity="lineState"] b')?.textContent));
    if (lineNeedsPoll) {
      if (showButton) showButton.hidden = true;
      if (openButton) {
        openButton.hidden = false;
        openButton.textContent = "Открыть опрос";
        openButton.classList.add("primary");
      }
    } else {
      if (showButton) {
        showButton.hidden = false;
        showButton.textContent = "Показать";
      }
      if (openButton) openButton.hidden = true;
    }
    if (explainButton) explainButton.textContent = "Пояснить";
  }

  function headerCells(row) {
    return [...row.querySelectorAll(":scope > th,:scope > td")];
  }

  function findOltRequestTable() {
    for (const table of document.querySelectorAll("table")) {
      if (table.closest("#dp-panel")) continue;
      for (const row of table.rows) {
        const labels = headerCells(row).map((cell) => text(cell.innerText || cell.textContent));
        const hasOlt = labels.some((value) => /^OLT$/i.test(value));
        const hasSn = labels.some((value) => /SN\s*(?:ONU|ONT)/i.test(value));
        const hasOnuMac = labels.some((value) => /MAC\s*(?:ONU|ONT)/i.test(value));
        const hasSubscriberMac = labels.some((value) => /MAC[-\s]?адрес\s+абонент/i.test(value));
        if (hasOlt && hasSn && hasOnuMac && hasSubscriberMac) return { table, row, labels };
      }
    }
    return null;
  }

  function annotateOltTable() {
    if (!OLT_ACTIONS.has(action())) return;
    const match = findOltRequestTable();
    if (!match) return;
    const hints = [
      [/^OLT$/i, "Фактическая OLT, на которой должен находиться терминал."],
      [/SN\s*(?:ONU|ONT)/i, "Серийный номер ONU/ONT используется для точной идентификации."],
      [/MAC\s*(?:ONU|ONT)/i, "MAC ONU должен соответствовать установленному терминалу."],
      [/MAC[-\s]?адрес\s+абонент/i, "Ожидаемый MAC за ONU используется для live-сверки оборудования."]
    ];
    headerCells(match.row).forEach((cell) => {
      const label = text(cell.innerText || cell.textContent);
      const hint = hints.find(([pattern]) => pattern.test(label));
      if (hint && !cell.title) cell.title = hint[1];
    });
    if (match.table.nextElementSibling?.classList.contains("dp-olt-data-hint")) return;
    const note = document.createElement("div");
    note.className = "dp-olt-data-hint";
    note.innerHTML = "<i>i</i><span>Для точного вывода проверь: OLT, SN ONU, MAC ONU и MAC абонента должны соответствовать установленному оборудованию.</span>";
    match.table.insertAdjacentElement("afterend", note);
  }

  function decoratePortSpeed() {
    const entity = document.querySelector('#dp-live-entities [data-live-entity="clientPort"]');
    const oldNote = document.querySelector("#dp-live-entities .dp-port-100-note");
    if (!entity) {
      oldNote?.remove();
      return;
    }
    const value = text(entity.innerText || entity.textContent);
    const isHundred = /(?:^|\D)100\s*(?:Мбит|Mbit|Mbps)/i.test(value)
      && !/(?:^|\D)1000\s*(?:Мбит|Mbit|Mbps)/i.test(value);
    if (!isHundred) {
      oldNote?.remove();
      return;
    }
    if (!oldNote) {
      const note = document.createElement("div");
      note.className = "dp-port-100-note";
      note.textContent = "Линк 100 Мбит/с: при более быстром тарифе проверь 8 жил/4 пары, обжим, коннекторы, возможности портов и автосогласование.";
      entity.insertAdjacentElement("afterend", note);
    }
  }

  function enhanceSpotlightHelp() {
    const card = document.querySelector("#dp-source-spotlight-card.show");
    if (!card) return;
    const title = text(card.querySelector("b")?.textContent);
    const body = card.querySelector("span");
    if (!body || !/Ethernet-порт ONU/i.test(title) || /8 жил|четыре пары/i.test(body.textContent)) return;
    body.textContent = `${text(body.textContent)} Линк 100 Мбит/с при более быстром тарифе: проверь 8 жил/4 пары, обжим, коннекторы, возможности портов и автосогласование.`;
  }

  function surfaceTechGuide() {
    if (!isTechDataPage()) return;
    globalThis.__SIMNET_OPERATOR_TECH_GUIDE__?.install?.();
    const guide = document.querySelector("#dp-tech-guide");
    const workspace = document.querySelector("#dp-operator-workspace");
    if (!guide || !workspace) return;
    const scenarioNav = workspace.querySelector("#dp-operator-scenarios-live");
    if (scenarioNav && guide.previousElementSibling !== scenarioNav) {
      scenarioNav.insertAdjacentElement("afterend", guide);
    }
    const helperActive = document.querySelector("#dp-panel")?.dataset.operationMode === "navigator";
    guide.hidden = !helperActive;
    guide.classList.toggle("dp-tech-guide-forced", helperActive);
  }

  function apply() {
    installStyle();
    polishModes();
    polishScenarios();
    compactConnectivity();
    annotateOltTable();
    decoratePortSpeed();
    enhanceSpotlightHelp();
    surfaceTechGuide();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = window.setTimeout(() => {
      scheduled = 0;
      apply();
    }, 0);
  }

  [
    "dp:operation-mode-change",
    "dp:operator-context-change",
    "dp:operator-live-captured",
    "dp:page-focus-change"
  ].forEach((name) => document.addEventListener(name, schedule));

  document.addEventListener("click", () => {
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 180);
  }, true);

  apply();
  [350, 900, 1800, 3500, 6500, 10000].forEach((delay) => window.setTimeout(apply, delay));

  const startedAt = Date.now();
  const lifetime = isTechDataPage() || OLT_ACTIONS.has(action()) ? 30000 : 15000;
  observer = new MutationObserver(() => {
    schedule();
    if (Date.now() - startedAt > lifetime) observer?.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), lifetime + 500);

  globalThis.__SIMNET_OPERATOR_UI_POLISH__ = Object.freeze({ apply });
})();
