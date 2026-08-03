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
      .dp-olt-data-hint{display:flex!important;align-items:flex-start!important;gap:5px!important;margin:5px 0 7px!important;padding:4px 7px!important;color:#526174!important;background:#f8fafc!important;border:1px solid #d7dee8!important;border-radius:5px!important;font:600 9px/1.35 Verdana,Tahoma,sans-serif!important}
      .dp-olt-data-hint>i{color:#2563eb!important;font-style:normal!important;font-weight:800!important}
      .dp-port-100-note{margin:1px 0 4px!important;padding:6px 8px!important;color:#7a4d0b!important;background:#fff8eb!important;border:1px solid #f1d39b!important;border-radius:6px!important;font:600 8.5px/1.4 "Segoe UI",Arial,sans-serif!important}
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
      "no-internet": ["↯", "Нет интернета"]
    };
    controls.querySelectorAll("[data-live-scenario]").forEach((button) => {
      const definition = definitions[button.dataset.liveScenario];
      if (!definition || button.dataset.dpPolished === "1") return;
      button.dataset.dpPolished = "1";
      button.classList.add("dp-scenario-polished");
      button.innerHTML = `<span aria-hidden="true">${definition[0]}</span><span>${definition[1]}</span>`;
    });
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
    note.innerHTML = "<i>i</i><span>Для точного вывода проверь: OLT, SN ONU, MAC ONU и MAC абонента должны быть заполнены и соответствовать фактическому оборудованию.</span>";
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
      note.textContent = "Линк 100 Мбит/с: если тариф выше 100, проверь 8 жил/4 пары, обжим и коннекторы, Fast Ethernet-порт, автосогласование и принудительную настройку 100M.";
      entity.insertAdjacentElement("afterend", note);
    }
  }

  function enhanceSpotlightHelp() {
    const card = document.querySelector("#dp-source-spotlight-card.show");
    if (!card) return;
    const title = text(card.querySelector("b")?.textContent);
    const body = card.querySelector("span");
    if (!body || !/Ethernet-порт ONU/i.test(title) || /8 жил|четыре пары/i.test(body.textContent)) return;
    body.textContent = `${text(body.textContent)} Если линк согласован на 100 Мбит/с при более быстром тарифе, проверь 8 жил/4 пары, обжим, коннекторы, возможности портов, автосогласование и принудительную скорость 100M.`;
  }

  function apply() {
    installStyle();
    polishModes();
    polishScenarios();
    annotateOltTable();
    decoratePortSpeed();
    enhanceSpotlightHelp();
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
  window.setTimeout(apply, 350);
  window.setTimeout(apply, 1200);

  const startedAt = Date.now();
  const lifetime = OLT_ACTIONS.has(action()) ? 45000 : 15000;
  observer = new MutationObserver(() => {
    apply();
    if (Date.now() - startedAt > lifetime) observer?.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), lifetime + 500);

  globalThis.__SIMNET_OPERATOR_UI_POLISH__ = Object.freeze({ apply });
})();
