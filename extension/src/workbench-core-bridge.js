"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_WORKBENCH_CORE__) return;

  const subscribers = new Set();
  const ISSUE_KEY = "simnet_workbench_current_issue_v1";
  const state = {
    context: null,
    issue: "",
    status: { running: false, text: "", stage: "idle" },
    facts: [],
    revision: 0,
    updatedAt: 0
  };

  const safeText = (value, max = 240) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const extractLogins = text => [...new Set((String(text || "").match(/\babon\d{3,12}\b/ig) || []).map(value => value.toLowerCase()))];
  const extractIps = text => [...new Set(String(text || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])]
    .filter(ip => ip.split(".").every(part => Number(part) >= 0 && Number(part) <= 255));
  const normalizeMac = text => {
    const match = String(text || "").toUpperCase().match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b|\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!match) return "";
    const compact = match[0].replace(/[-.:]/g, "");
    return compact.match(/.{2}/g)?.join(":") || "";
  };

  function panel() {
    return document.querySelector("#dp-panel");
  }

  function textOf(selector) {
    return safeText(document.querySelector(selector)?.textContent || "", 1000);
  }

  function pageText() {
    const root = document.body || document.documentElement;
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone.querySelector("#dp-panel")?.remove();
    clone.querySelector("#simnet-mentor-shell")?.remove();
    clone.querySelector("#simnet-workbench-dock")?.remove();
    return safeText(clone.textContent || "", 250000);
  }

  function controlValue(selector) {
    const control = document.querySelector(selector);
    if (!control) return "";
    if (control.tagName === "SELECT") {
      const option = control.options?.[control.selectedIndex];
      return safeText(option?.textContent || control.value || "", 180);
    }
    return safeText(control.value || control.textContent || "", 180);
  }

  function labelValue(labelPattern, max = 180) {
    for (const row of document.querySelectorAll("tr,.item,.table_block,dl,fieldset")) {
      if (row.closest("#dp-panel,#simnet-mentor-shell,#simnet-workbench-dock")) continue;
      const text = safeText(row.textContent, 1200);
      const match = text.match(labelPattern);
      if (!match) continue;
      const value = safeText(text.slice((match.index || 0) + match[0].length).replace(/^[\s:—|\-]+/, ""), max);
      if (value) return value;
    }
    return "";
  }

  function findLoginElement() {
    const candidates = document.querySelectorAll("input[value],a[href],td,th,span,b,strong,option,div");
    for (const element of candidates) {
      if (element.closest("#dp-panel,#simnet-mentor-shell,#simnet-workbench-dock")) continue;
      const value = safeText(element.value || element.textContent || "", 160);
      if (/^abon\d{3,12}$/i.test(value)) return element;
    }
    return null;
  }

  function billingRowData(loginElement) {
    const row = loginElement?.closest("tr");
    const text = safeText(row?.textContent || "", 1200);
    return {
      text,
      ip: extractIps(text).find(ip => !/^127\.|^0\.|^255\./.test(ip)) || ""
    };
  }

  function toneFrom(value, negativePattern, positivePattern = null) {
    const text = safeText(value, 220).toLowerCase();
    if (!text) return "unknown";
    if (negativePattern.test(text)) return "warn";
    if (!positivePattern || positivePattern.test(text)) return "ok";
    return "unknown";
  }

  function billingAccessChecks() {
    const access = controlValue("select[name='state']") || labelValue(/Доступ\s*/i, 120);
    const block = labelValue(/Блокировк(?:а|и)?\s*/i, 140);
    const group = controlValue("select[name*='group']") || labelValue(/Группа\s*/i, 140);
    const tariff = controlValue("select[name*='tarif'],select[name*='tariff']") || labelValue(/Тариф(?:ный план|ы на Интернет)?\s*/i, 180);
    const serviceState = controlValue("select[name='cstate']") || labelValue(/Состояние услуги\s*/i, 140);
    const startDayRaw = controlValue("input[name='start_day']") || labelValue(/День начала потребления услуг\s*/i, 80);
    const startDayMatch = String(startDayRaw).match(/-?\d+/);
    const startDayNumber = startDayMatch ? Number(startDayMatch[0]) : null;

    const checks = [
      {
        id: "access",
        label: "Доступ",
        value: access,
        state: toneFrom(access, /запрещ|deny|disabled|заблок|нет доступа/i, /разреш|allow|enabled|актив/i)
      },
      {
        id: "block",
        label: "Блокировка",
        value: block,
        state: toneFrom(block, /^(?!.*(?:нет|отсутств)).*(?:есть|да|заблок|block)/i, /нет|отсутств/i)
      },
      {
        id: "group",
        label: "Группа",
        value: group,
        state: toneFrom(group, /удал[её]н|deleted|неактив/i)
      },
      {
        id: "tariff",
        label: "Тариф",
        value: tariff || serviceState,
        state: toneFrom(`${tariff} ${serviceState}`, /заблок|blocked|отключ|неактив|stop/i)
      },
      {
        id: "start-day",
        label: "День начала",
        value: startDayRaw,
        state: startDayNumber == null ? "unknown" : startDayNumber < 0 ? "warn" : "ok"
      }
    ];

    return checks;
  }

  function detectBillingContext(text) {
    const params = new URL(location.href).searchParams;
    const action = params.get("a") || "";
    const billingId = params.get("id") || "";
    const loginElement = findLoginElement();
    const rowData = billingRowData(loginElement);
    const fallbackLogin = extractLogins(text)[0] || "";
    const login = safeText(loginElement?.value || loginElement?.textContent || fallbackLogin, 80).toLowerCase();

    const gotouser = document.querySelector("a[href*='userside.simnet.kiev.ua/script/gotouser.php']");
    let routeIp = "";
    try {
      routeIp = gotouser ? new URL(gotouser.href, location.href).searchParams.get("ip") || "" : "";
    } catch (_) {}

    const labeledIp = labelValue(/IP(?:-адрес)?\s*/i, 80);
    const ip = rowData.ip || routeIp || extractIps(labeledIp)[0] || "";
    const contract = login.replace(/^abon/i, "");
    const isSubscriberPage = action === "user" || action === "dopdata" || Boolean(login || billingId);

    return {
      system: "billing",
      kind: action === "dopdata" ? "billing_technical" : action === "user" ? "billing_user" : "billing_other",
      isSubscriberPage,
      login,
      contract,
      billingId,
      customerId: "",
      ip,
      accessChecks: billingAccessChecks()
    };
  }

  function detectUsersideContext(text) {
    const customerId = (location.pathname.match(/^\/customer\/(\d+)/) || [])[1] || "";
    const cardText = [
      document.title,
      textOf("#customer-card-customer-id"),
      textOf("#slider_content_id"),
      text
    ].join(" ");
    const login = extractLogins(cardText)[0] || "";
    const ipMacText = textOf("#ref_ip_mac") || cardText;
    const ips = extractIps(ipMacText).filter(value => !/^172\.16\.|^127\.|^0\./.test(value));
    return {
      system: "userside",
      kind: customerId ? "userside_customer" : "userside_other",
      isSubscriberPage: Boolean(customerId || login),
      login,
      contract: login.replace(/^abon/i, ""),
      billingId: "",
      customerId,
      ip: ips[0] || "",
      accessChecks: []
    };
  }

  function detectContext() {
    const text = pageText();
    const userside = /userside/i.test(location.hostname);
    const base = userside ? detectUsersideContext(text) : detectBillingContext(text);
    const userSideAddress = userside ? textOf("#ref_adr") : "";
    const userSideName = userside ? safeText(document.title.split("-")[0], 140) : "";
    const ipMacText = userside ? textOf("#ref_ip_mac") : "";

    return {
      ...base,
      fullName: userSideName || labelValue(/(?:ФИО|ПІБ|Абонент|Клиент|Клієнт)\s*/i, 140),
      address: userSideAddress || labelValue(/(?:Адрес|Адреса)\s*/i, 180),
      mac: normalizeMac(ipMacText || labelValue(/MAC(?:\s+(?:ONU|ONT|роутера|router))?\s*/i, 180) || text),
      href: location.href,
      key: [location.hostname, location.pathname, base.kind, base.login, base.billingId, base.customerId].join("|")
    };
  }

  function stageFromStatus(text, running) {
    const value = safeText(text, 180).toLowerCase();
    if (!running && /заверш|готов|успеш|итог/.test(value)) return "done";
    if (/onu|olt|сигнал|оптик/.test(value)) return "onu";
    if (/userside|юзерсайд/.test(value)) return "userside";
    if (/billing|биллинг/.test(value)) return "billing";
    if (/анализ|сопостав/.test(value)) return "analysis";
    return running ? "collecting" : "idle";
  }

  function collectFacts(context) {
    const out = [];
    for (const check of context.accessChecks || []) {
      if (!check.value) continue;
      out.push(`${check.label}: ${check.value}`);
    }
    for (const node of panel()?.querySelectorAll("#dp-results tr,#dp-results details,#dp-results .dp-result-row,#dp-results [data-dp-result]") || []) {
      const text = safeText(node.textContent, 260);
      if (!text || /ожидани|номер договора|рандом|пуск/i.test(text)) continue;
      if (!/(договор|адрес|mac|ip|onu|olt|сигнал|сесси|баланс|услуг|доступ|тариф|блокиров|группа)/i.test(text)) continue;
      if (!out.includes(text)) out.push(text);
      if (out.length >= 16) break;
    }
    return out;
  }

  function snapshot() {
    const p = panel();
    const stop = p?.querySelector("#dp-stop");
    const statusText = safeText(p?.querySelector("#dp-status")?.textContent || "", 180);
    const running = Boolean(stop && !stop.disabled);
    const context = detectContext();
    return {
      context,
      issue: state.issue,
      status: { running, text: statusText, stage: stageFromStatus(statusText, running) },
      facts: collectFacts(context),
      revision: state.revision + 1,
      updatedAt: Date.now()
    };
  }

  function publish() {
    Object.assign(state, snapshot());
    for (const listener of subscribers) {
      try {
        listener(getState());
      } catch (_) {}
    }
  }

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function setIssue(value) {
    state.issue = safeText(value, 600);
    try {
      sessionStorage.setItem(ISSUE_KEY, state.issue);
    } catch (_) {}
    publish();
  }

  function runDiagnostic() {
    const p = panel();
    const input = p?.querySelector("#dp-input");
    const contract = state.context?.contract || "";
    if (input && contract && input.value !== contract) {
      input.value = contract;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const run = p?.querySelector("#dp-run");
    if (run && !run.disabled) run.click();
  }

  function stopDiagnostic() {
    const stop = panel()?.querySelector("#dp-stop");
    if (stop && !stop.disabled) stop.click();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    listener(getState());
    return () => subscribers.delete(listener);
  }

  try {
    state.issue = safeText(sessionStorage.getItem(ISSUE_KEY) || "", 600);
  } catch (_) {}

  globalThis.__SIMNET_WORKBENCH_CORE__ = {
    version: "0.3.0",
    getState,
    setIssue,
    runDiagnostic,
    stopDiagnostic,
    refresh: publish,
    subscribe
  };

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(publish, 120);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "value", "class", "selected", "checked"]
  });
  window.addEventListener("popstate", publish);
  window.addEventListener("hashchange", publish);
  window.addEventListener("pageshow", publish);
  window.setTimeout(publish, 450);
  window.setTimeout(publish, 1400);
  publish();
})();
