"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_TECH_GUIDE__) return;

  const runtime = {
    guide: null,
    expanded: false,
    activeKey: "",
    target: null,
    dims: [],
    frame: null,
    card: null,
    raf: 0
  };

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const STEPS = Object.freeze({
    technology: {
      number: "1",
      title: "Технология",
      body: "Определяет ветку диагностики: PON, Ethernet или Wireless.",
      prompt: "Проверь сам: соответствует ли выбранная технология фактическому способу подключения?"
    },
    olt: {
      number: "2",
      title: "OLT",
      body: "Указывает, на каком устройстве нужно искать и опрашивать ONU/ONT.",
      prompt: "Проверь сам: совпадает ли эта OLT с фактической OLT из UserSide, ТМЦ или live-опроса?"
    },
    onu: {
      number: "3",
      title: "Идентификатор ONU/ONT",
      body: "Для GPON обычно используется серийный ID, для EPON — MAC ONU.",
      prompt: "Проверь сам: какой идентификатор нужен именно для выбранной OLT и заполнено ли правильное поле?"
    },
    subscriberMac: {
      number: "4",
      title: "MAC абонента",
      body: "Это ожидаемый MAC оборудования за ONU. Он сравнивается с MAC, изученным live-опросом.",
      prompt: "Проверь сам: совпадает ли ожидаемый MAC с фактически изученным за ONU?"
    }
  });

  function isTechDataPage() {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("a") === "dopdata" && url.searchParams.get("tmpl") === "1") return true;
    } catch (_) {}
    return document.querySelector('input[name="a"][value="dopdata"]')
      && document.querySelector('input[name="tmpl"][value="1"]');
  }

  function selectedValue(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") {
      return text(control.selectedOptions?.[0]?.textContent || control.value);
    }
    return text(control.value || control.textContent);
  }

  function visibleControl(control) {
    if (!(control instanceof Element)) return null;
    if (control.matches("select.selectized")) {
      return control.parentElement?.querySelector(":scope > .selectize-control")
        || (control.nextElementSibling?.matches?.(".selectize-control") ? control.nextElementSibling : null)
        || control;
    }
    return control;
  }

  function rowFor(control) {
    return visibleControl(control)?.closest("tr") || control?.closest?.("tr") || visibleControl(control) || control || null;
  }

  function fieldInfo() {
    const technology = document.querySelector('[name="dopfield_39"]');
    const olt = document.querySelector('[name="dopfield_29"]');
    const gponSerial = document.querySelector('[name="dopfield_38"]');
    const eponMac = document.querySelector('[name="dopfield_19"]');
    const subscriberMac = document.querySelector('[name="dopfield_4"]');
    const technologyValue = selectedValue(technology);
    const oltValue = selectedValue(olt);
    const preferGpon = /gpon|huawei/i.test(`${technologyValue} ${oltValue}`);
    const preferEpon = /epon/i.test(`${technologyValue} ${oltValue}`);
    const onuControl = preferGpon
      ? gponSerial
      : preferEpon
        ? eponMac
        : selectedValue(gponSerial)
          ? gponSerial
          : eponMac;
    return {
      technology: { control: technology, target: rowFor(technology), value: technologyValue },
      olt: { control: olt, target: rowFor(olt), value: oltValue },
      onu: {
        control: onuControl,
        target: rowFor(onuControl),
        value: selectedValue(onuControl),
        label: onuControl === gponSerial ? "GPON Serial" : "EPON MAC"
      },
      subscriberMac: { control: subscriberMac, target: rowFor(subscriberMac), value: selectedValue(subscriberMac) }
    };
  }

  function shortValue(value, max = 28) {
    const normalized = text(value);
    if (!normalized) return "Пусто";
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  }

  function currentPp() {
    try {
      return new URL(location.href).searchParams.get("pp")
        || document.querySelector('input[name="pp"]')?.value
        || "";
    } catch (_) {
      return "";
    }
  }

  function currentId() {
    try {
      return new URL(location.href).searchParams.get("id")
        || document.querySelector('input[name="id"]')?.value
        || "";
    } catch (_) {
      return "";
    }
  }

  function pollAction(fields) {
    const value = `${fields.olt.value} ${fields.technology.value}`;
    if (!/pon/i.test(value) && !/huawei|gcom|gpon|epon/i.test(value)) return "";
    if (/huawei/i.test(value)) return "313";
    if (/gcom/i.test(value)) return "312";
    if (/gpon/i.test(value)) return "311";
    if (/epon/i.test(value)) return "310";
    return "";
  }

  function pollUrl(fields) {
    const action = pollAction(fields);
    if (!action) return "";
    try {
      const url = new URL("/cgi-bin/adm/stat.pl", location.origin);
      const pp = currentPp();
      const id = currentId();
      if (pp) url.searchParams.set("pp", pp);
      if (id) url.searchParams.set("id", id);
      url.searchParams.set("a", action);
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function historyUrl() {
    const link = document.querySelector('a[href*="a=dopdata"][href*="act=revisions"]');
    return link?.href || "";
  }

  function installStyle() {
    if (document.getElementById("dp-tech-guide-style")) return;
    const style = document.createElement("style");
    style.id = "dp-tech-guide-style";
    style.textContent = `
      #dp-tech-guide{display:grid!important;gap:6px!important;padding:7px 10px!important;background:#f8fafc!important;border-bottom:1px solid #d5dde8!important}
      #dp-tech-guide[hidden]{display:none!important}
      #dp-tech-guide>header{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
      #dp-tech-guide>header>div{display:grid!important;gap:1px!important;min-width:0!important}
      #dp-tech-guide>header b{font:800 10px/1.2 "Segoe UI",Arial,sans-serif!important;color:#172033!important}
      #dp-tech-guide>header span{font:600 8px/1.25 "Segoe UI",Arial,sans-serif!important;color:#64748b!important}
      #dp-tech-guide-toggle{flex:0 0 auto!important;padding:5px 8px!important;color:#1d4ed8!important;background:#eff6ff!important;border:1px solid #bfdbfe!important;border-radius:6px!important;font:750 8.5px/1 "Segoe UI",Arial,sans-serif!important}
      #dp-tech-guide-body{display:grid!important;gap:6px!important}
      #dp-tech-guide-body[hidden]{display:none!important}
      #dp-tech-guide-fields{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:4px!important}
      .dp-tech-guide-field{display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;gap:5px!important;align-items:center!important;min-height:37px!important;padding:5px 6px!important;text-align:left!important;background:#fff!important;border:1px solid #d5dde8!important;border-radius:6px!important}
      .dp-tech-guide-field>i{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#1d4ed8!important;background:#dbeafe!important;border-radius:50%!important;font:800 8px/1 Arial,sans-serif!important}
      .dp-tech-guide-field>span{display:grid!important;gap:1px!important;min-width:0!important}
      .dp-tech-guide-field b{overflow:hidden!important;font:750 8.5px/1.2 "Segoe UI",Arial,sans-serif!important;color:#334155!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      .dp-tech-guide-field small{overflow:hidden!important;font:600 7.5px/1.2 "Segoe UI",Arial,sans-serif!important;color:#64748b!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      .dp-tech-guide-field.missing{border-color:#f2cc87!important;background:#fffbeb!important}
      #dp-tech-guide-links{display:flex!important;gap:5px!important;flex-wrap:wrap!important}
      #dp-tech-guide-links a,#dp-tech-guide-links button{padding:5px 7px!important;color:#475569!important;background:#fff!important;border:1px solid #d5dde8!important;border-radius:6px!important;font:700 8px/1 "Segoe UI",Arial,sans-serif!important;text-decoration:none!important}
      #dp-tech-guide-links [aria-disabled="true"]{opacity:.48!important;pointer-events:none!important}
      .dp-tech-dim{position:fixed!important;z-index:2147483500!important;background:rgba(2,6,23,.72)!important;pointer-events:none!important}
      #dp-tech-spotlight-frame{position:fixed!important;z-index:2147483502!important;display:none!important;border:4px solid #84cc16!important;border-radius:10px!important;box-shadow:0 0 0 2px rgba(255,255,255,.92),0 0 28px rgba(132,204,22,.44)!important;pointer-events:none!important}
      #dp-tech-spotlight-frame.show{display:block!important}
      #dp-tech-spotlight-card{position:fixed!important;z-index:2147483504!important;display:none!important;width:min(390px,calc(100vw - 24px))!important;padding:10px 12px!important;color:#e2e8f0!important;background:rgba(15,23,42,.98)!important;border:1px solid rgba(132,204,22,.75)!important;border-radius:9px!important;box-shadow:0 12px 34px rgba(0,0,0,.42)!important;font:500 11px/1.4 "Segoe UI",Arial,sans-serif!important;pointer-events:none!important}
      #dp-tech-spotlight-card.show{display:grid!important;gap:3px!important}
      #dp-tech-spotlight-card b{color:#bef264!important;font-size:12px!important}
      #dp-tech-spotlight-card span{color:#e2e8f0!important}
      #dp-tech-spotlight-card em{color:#fef08a!important;font-style:normal!important;font-weight:700!important}
      #dp-tech-spotlight-card small{color:#94a3b8!important;font-size:9px!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureSpotlight() {
    if (!runtime.dims.length) {
      runtime.dims = Array.from({ length: 4 }, () => {
        const node = document.createElement("div");
        node.className = "dp-tech-dim";
        document.documentElement.appendChild(node);
        return node;
      });
    }
    if (!runtime.frame?.isConnected) {
      runtime.frame = document.createElement("div");
      runtime.frame.id = "dp-tech-spotlight-frame";
      document.documentElement.appendChild(runtime.frame);
    }
    if (!runtime.card?.isConnected) {
      runtime.card = document.createElement("div");
      runtime.card.id = "dp-tech-spotlight-card";
      runtime.card.innerHTML = "<b></b><span></span><em></em><small>Esc — закрыть фокус</small>";
      document.documentElement.appendChild(runtime.card);
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function updateSpotlight() {
    runtime.raf = 0;
    if (!runtime.activeKey || !isVisible(runtime.target)) return clearSpotlight();
    ensureSpotlight();
    const rect = runtime.target.getBoundingClientRect();
    const pad = 7;
    const left = Math.max(0, rect.left - pad);
    const top = Math.max(0, rect.top - pad);
    const right = Math.min(innerWidth, rect.right + pad);
    const bottom = Math.min(innerHeight, rect.bottom + pad);
    const [topDim, leftDim, rightDim, bottomDim] = runtime.dims;
    Object.assign(topDim.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${top}px` });
    Object.assign(leftDim.style, { left: "0px", top: `${top}px`, width: `${left}px`, height: `${Math.max(0, bottom - top)}px` });
    Object.assign(rightDim.style, { left: `${right}px`, top: `${top}px`, width: `${Math.max(0, innerWidth - right)}px`, height: `${Math.max(0, bottom - top)}px` });
    Object.assign(bottomDim.style, { left: "0px", top: `${bottom}px`, width: `${innerWidth}px`, height: `${Math.max(0, innerHeight - bottom)}px` });
    Object.assign(runtime.frame.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(20, right - left)}px`,
      height: `${Math.max(20, bottom - top)}px`
    });
    runtime.frame.classList.add("show");

    const panel = document.querySelector("#dp-panel")?.getBoundingClientRect();
    const cardWidth = runtime.card.offsetWidth || 390;
    const cardHeight = runtime.card.offsetHeight || 100;
    const maxRight = panel && panel.left > innerWidth / 2 ? panel.left - 10 : innerWidth - 10;
    const cardLeft = Math.max(10, Math.min(maxRight - cardWidth, left));
    const below = bottom + 10;
    const cardTop = below + cardHeight <= innerHeight - 10
      ? below
      : Math.max(10, top - cardHeight - 10);
    Object.assign(runtime.card.style, { left: `${cardLeft}px`, top: `${cardTop}px` });
    runtime.card.classList.add("show");
  }

  function scheduleSpotlight() {
    if (!runtime.raf) runtime.raf = requestAnimationFrame(updateSpotlight);
  }

  function clearSpotlight() {
    if (runtime.raf) cancelAnimationFrame(runtime.raf);
    runtime.raf = 0;
    runtime.activeKey = "";
    runtime.target = null;
    runtime.dims.forEach((node) => node.remove());
    runtime.dims = [];
    runtime.frame?.remove();
    runtime.card?.remove();
    runtime.frame = null;
    runtime.card = null;
  }

  function showStep(key) {
    const definition = STEPS[key];
    const fields = fieldInfo();
    const info = fields[key];
    if (!definition || !info?.target || !isVisible(info.target)) return false;
    if (runtime.activeKey === key) {
      clearSpotlight();
      return true;
    }
    clearSpotlight();
    runtime.activeKey = key;
    runtime.target = info.target;
    ensureSpotlight();
    runtime.card.querySelector("b").textContent = `${definition.number}. ${definition.title}`;
    runtime.card.querySelector("span").textContent = definition.body;
    runtime.card.querySelector("em").textContent = definition.prompt;
    info.target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(scheduleSpotlight, 220);
    return true;
  }

  function renderGuide() {
    if (!runtime.guide?.isConnected) return;
    const fields = fieldInfo();
    const buttons = runtime.guide.querySelector("#dp-tech-guide-fields");
    buttons.innerHTML = Object.keys(STEPS).map((key) => {
      const step = STEPS[key];
      const info = fields[key];
      const value = key === "onu" && info?.label
        ? `${info.label}: ${shortValue(info.value, 21)}`
        : shortValue(info?.value, key === "olt" ? 22 : 26);
      return `<button type="button" class="dp-tech-guide-field ${info?.value ? "" : "missing"}" data-tech-guide-step="${key}"><i>${step.number}</i><span><b>${step.title}</b><small>${value}</small></span></button>`;
    }).join("");

    const poll = runtime.guide.querySelector("#dp-tech-guide-poll");
    const pUrl = pollUrl(fields);
    poll.href = pUrl || "#";
    poll.setAttribute("aria-disabled", pUrl ? "false" : "true");
    poll.title = pUrl ? "Открыть подходящую вкладку опроса ONU" : "Сначала укажи технологию и OLT";

    const history = runtime.guide.querySelector("#dp-tech-guide-history");
    const hUrl = historyUrl();
    history.href = hUrl || "#";
    history.setAttribute("aria-disabled", hUrl ? "false" : "true");
  }

  function ensureGuide() {
    if (!isTechDataPage()) return false;
    const workspace = document.querySelector("#dp-operator-workspace");
    if (!workspace) return false;
    if (runtime.guide?.isConnected) {
      renderGuide();
      return true;
    }
    const guide = document.createElement("section");
    guide.id = "dp-tech-guide";
    guide.innerHTML = `
      <header><div><b>Технические данные</b><span>Связь полей: технология → OLT → ONU/ONT → MAC абонента</span></div><button type="button" id="dp-tech-guide-toggle">Разобрать</button></header>
      <div id="dp-tech-guide-body" hidden>
        <div id="dp-tech-guide-fields"></div>
        <div id="dp-tech-guide-links"><a id="dp-tech-guide-poll" href="#">Опрос ONU ↗</a><a id="dp-tech-guide-history" href="#">История изменений ↗</a></div>
      </div>`;
    workspace.querySelector(":scope > .dp-operator-header")?.insertAdjacentElement("afterend", guide);
    if (!guide.isConnected) workspace.prepend(guide);
    runtime.guide = guide;
    guide.querySelector("#dp-tech-guide-toggle").addEventListener("click", () => {
      runtime.expanded = !runtime.expanded;
      guide.querySelector("#dp-tech-guide-body").hidden = !runtime.expanded;
      guide.querySelector("#dp-tech-guide-toggle").textContent = runtime.expanded ? "Скрыть" : "Разобрать";
      if (!runtime.expanded) clearSpotlight();
      renderGuide();
    });
    guide.querySelector("#dp-tech-guide-fields").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tech-guide-step]");
      if (button) showStep(button.dataset.techGuideStep);
    });
    renderGuide();
    return true;
  }

  function applyVisibility() {
    if (!runtime.guide?.isConnected) return;
    const helperActive = document.querySelector("#dp-panel")?.dataset.operationMode === "navigator";
    runtime.guide.hidden = !helperActive || !isTechDataPage();
    if (runtime.guide.hidden) clearSpotlight();
  }

  function install() {
    installStyle();
    if (ensureGuide()) applyVisibility();
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('[name="dopfield_4"],[name="dopfield_19"],[name="dopfield_29"],[name="dopfield_38"],[name="dopfield_39"]')) {
      window.setTimeout(renderGuide, 0);
    }
  }, true);
  document.addEventListener("dp:operation-mode-change", () => window.setTimeout(() => {
    install();
    applyVisibility();
  }, 0));
  addEventListener("scroll", scheduleSpotlight, true);
  addEventListener("resize", scheduleSpotlight);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSpotlight();
  }, true);

  install();
  window.setTimeout(install, 300);
  window.setTimeout(install, 1000);
  window.setTimeout(install, 2500);

  globalThis.__SIMNET_OPERATOR_TECH_GUIDE__ = Object.freeze({
    install,
    showStep,
    clear: clearSpotlight,
    fields: fieldInfo
  });
})();
